/**
 * Dynamic profit margin tiers from per-unit Dubai cost in ETB (delivery excluded).
 *   • cost < 5,000 ETB          → 30%
 *   • 5,000 ≤ cost ≤ 15,000    → 20%
 *   • cost > 15,000 ETB         → 15%
 *
 * Thresholds raised from 3,000/10,000 so that core mid-priced orders keep the
 * 30% tier instead of silently dropping to 20% (especially at higher FX rates).
 */
export function resolveDynamicMarginPercent(dubaiCostEtb: number): number {
  if (!Number.isFinite(dubaiCostEtb) || dubaiCostEtb <= 0) return 30;
  if (dubaiCostEtb < 5000) return 30;
  if (dubaiCostEtb <= 15000) return 20;
  return 15;
}

export type FactorTier = 'low' | 'high' | 'avg';
export type FactorReason =
  | 'viable'
  | 'within_ceiling'
  | 'fallback'
  | 'usd_band';

/** USD < 10: no Dubai discount (factor 1.0). */
export const USD_BAND_FACTOR_UNDER_10 = 1.0;
/**
 * USD 10–20 inclusive. Calibrated so $10 @ rate 200, delivery 800, ×1.1 → ~3,500 ETB
 * (reverse-solved ≈ 0.915, rounded up to 0.92).
 */
export const USD_BAND_FACTOR_MID = 0.92;
/** USD > 20. */
export const USD_BAND_FACTOR_HIGH = 0.82;
export const USD_BAND_MID_MIN_USD = 10;
export const USD_BAND_HIGH_MIN_USD = 20;

export type UsdPriceBand = 'under_10' | 'mid' | 'high';

export interface ThreeFactors {
  low: number;
  avg: number;
  high: number;
}

export interface ThreeFactorDecisionInput {
  baseAed: number;
  baseEtbRef: number;
  deliveryEtb: number;
  /** AED per ETB (= USD_TO_AED / USD_TO_ETB). */
  etbToAed: number;
  quantity: number;
  factors: ThreeFactors;
  ceilingMultiplier: number;
  /**
   * Uniform final uplift applied to the chosen per-unit price (after tier
   * selection, before the floor clamp). Defaults to 1 (no change). Lets admins
   * calibrate the whole price curve without touching factors/margins.
   */
  finalMultiplier?: number;
}

/** Order pricing input: Dubai factor comes from USD band only (not category). */
export interface UsdBandDecisionInput {
  ethUsd: number;
  baseAed: number;
  baseEtbRef: number;
  deliveryEtb: number;
  etbToAed: number;
  quantity: number;
  finalMultiplier?: number;
}

export interface StepPricingSnapshot {
  factorUsed: number;
  marginPercent: number;
  dubaiCostAed: number;
  dubaiCostEtb: number;
  sellAed: number;
  sellEtb: number;
  profitAed: number;
  profitEtb: number;
  deliveryAed: number;
  totalAedPerUnit: number;
  unitEtbPerUnit: number;
  totalEtb: number;
}

export interface ThreeFactorDecisionResult extends StepPricingSnapshot {
  tier: FactorTier;
  reason: FactorReason;
  baseAed: number;
  baseEtbRef: number;
  deliveryEtb: number;
  /** True when the hard floor (USD × rate) raised the final unit price. */
  floored: boolean;
}

interface InternalStepInput {
  factor: number;
  baseAed: number;
  baseEtbRef: number;
  deliveryEtb: number;
  deliveryAed: number;
  etbToAed: number;
  quantity: number;
}

function aedToEtb(aed: number, etbToAed: number): number {
  return etbToAed > 0 ? aed / etbToAed : 0;
}

function computeStep(input: InternalStepInput): StepPricingSnapshot {
  const dubaiCostAed = input.baseAed * input.factor;
  const dubaiCostEtb = aedToEtb(dubaiCostAed, input.etbToAed);
  const marginPercent = resolveDynamicMarginPercent(dubaiCostEtb);
  const sellAed = dubaiCostAed * (1 + marginPercent / 100);
  const profitAed = sellAed - dubaiCostAed;
  const totalAedPerUnit = sellAed + input.deliveryAed;
  const sellEtb = aedToEtb(sellAed, input.etbToAed);
  const profitEtb = aedToEtb(profitAed, input.etbToAed);
  const unitEtbPerUnit = Math.ceil(aedToEtb(totalAedPerUnit, input.etbToAed));
  const totalEtb = Math.ceil(unitEtbPerUnit * input.quantity);

  return {
    factorUsed: input.factor,
    marginPercent,
    dubaiCostAed,
    dubaiCostEtb,
    sellAed,
    sellEtb,
    profitAed,
    profitEtb,
    deliveryAed: input.deliveryAed,
    totalAedPerUnit,
    unitEtbPerUnit,
    totalEtb,
  };
}

/**
 * Finalize a chosen tier:
 *   1) apply the uniform final multiplier (calibration uplift),
 *   2) enforce the hard floor (never below the USD × rate anchor),
 * then re-derive sell/profit/total so the breakdown stays consistent.
 */
function finalizeDecision(
  snapshot: StepPricingSnapshot,
  tier: FactorTier,
  reason: FactorReason,
  input: ThreeFactorDecisionInput,
): ThreeFactorDecisionResult {
  const floorEtb = Math.max(0, input.baseEtbRef);
  const mult =
    input.finalMultiplier && input.finalMultiplier > 0
      ? input.finalMultiplier
      : 1;

  let unitEtbPerUnit = Math.ceil(snapshot.unitEtbPerUnit * mult);
  let floored = false;
  if (unitEtbPerUnit < floorEtb) {
    unitEtbPerUnit = Math.ceil(floorEtb);
    floored = true;
  }

  const base = {
    tier,
    reason,
    baseAed: input.baseAed,
    baseEtbRef: input.baseEtbRef,
    deliveryEtb: input.deliveryEtb,
  };

  // Nothing changed the price → keep the exact (unrounded) margin breakdown.
  if (unitEtbPerUnit === snapshot.unitEtbPerUnit) {
    return { ...base, ...snapshot, floored };
  }

  const sellEtb = unitEtbPerUnit - input.deliveryEtb;
  const profitEtb = sellEtb - snapshot.dubaiCostEtb;
  const sellAed = sellEtb * input.etbToAed;
  const profitAed = profitEtb * input.etbToAed;

  return {
    ...base,
    ...snapshot,
    sellEtb,
    profitEtb,
    sellAed,
    profitAed,
    unitEtbPerUnit,
    totalEtb: Math.ceil(unitEtbPerUnit * input.quantity),
    floored,
  };
}

/**
 * Resolves the single Dubai factor from user USD input (same for all categories).
 *   • USD < 10        → 1.0 (no Dubai discount)
 *   • USD 10–20       → 0.92
 *   • USD > 20        → 0.82
 */
export function resolveUsdBandDubaiFactor(ethUsd: number): {
  factor: number;
  band: UsdPriceBand;
  tier: FactorTier;
} {
  if (!Number.isFinite(ethUsd) || ethUsd < USD_BAND_MID_MIN_USD) {
    return {
      factor: USD_BAND_FACTOR_UNDER_10,
      band: 'under_10',
      tier: 'low',
    };
  }
  if (ethUsd <= USD_BAND_HIGH_MIN_USD) {
    return {
      factor: USD_BAND_FACTOR_MID,
      band: 'mid',
      tier: 'avg',
    };
  }
  return {
    factor: USD_BAND_FACTOR_HIGH,
    band: 'high',
    tier: 'high',
  };
}

/**
 * Order pricing engine: one Dubai factor per USD band (category factors ignored).
 * Law 1 still applies: margin on Dubai cost only; delivery after; qty last.
 */
export function runUsdBandDecision(
  input: UsdBandDecisionInput,
): ThreeFactorDecisionResult {
  const { factor, band, tier } = resolveUsdBandDubaiFactor(input.ethUsd);
  const deliveryAed = input.deliveryEtb * input.etbToAed;
  const snapshot = computeStep({
    factor,
    baseAed: input.baseAed,
    baseEtbRef: input.baseEtbRef,
    deliveryEtb: input.deliveryEtb,
    deliveryAed,
    etbToAed: input.etbToAed,
    quantity: input.quantity,
  });
  return finalizeDecision(snapshot, tier, 'usd_band', {
    baseAed: input.baseAed,
    baseEtbRef: input.baseEtbRef,
    deliveryEtb: input.deliveryEtb,
    etbToAed: input.etbToAed,
    quantity: input.quantity,
    factors: { low: factor, avg: factor, high: factor },
    ceilingMultiplier: 1.2,
    finalMultiplier: input.finalMultiplier,
  });
}

/**
 * Three-factor decision engine (AED anchor):
 * 1) LOW — use if totalAed >= baseAed
 * 2) HIGH — use if totalAed <= baseAed × ceilingMultiplier
 * 3) AVG — fallback
 *
 * The chosen tier is then finalized: a uniform final multiplier (calibration
 * uplift) is applied, and a hard floor clamp guarantees the unit price never
 * drops below the USD × rate anchor, whichever tier wins.
 *
 * Law 1: margin on dubai cost only; delivery added after; qty last.
 */
export function runThreeFactorDecision(
  input: ThreeFactorDecisionInput,
): ThreeFactorDecisionResult {
  const deliveryAed = input.deliveryEtb * input.etbToAed;
  const stepBase: Omit<InternalStepInput, 'factor'> = {
    baseAed: input.baseAed,
    baseEtbRef: input.baseEtbRef,
    deliveryEtb: input.deliveryEtb,
    deliveryAed,
    etbToAed: input.etbToAed,
    quantity: input.quantity,
  };

  const low = computeStep({ ...stepBase, factor: input.factors.low });
  if (low.totalAedPerUnit >= input.baseAed) {
    return finalizeDecision(low, 'low', 'viable', input);
  }

  const high = computeStep({ ...stepBase, factor: input.factors.high });
  const ceilingAed = input.baseAed * input.ceilingMultiplier;
  if (high.totalAedPerUnit <= ceilingAed) {
    return finalizeDecision(high, 'high', 'within_ceiling', input);
  }

  const avg = computeStep({ ...stepBase, factor: input.factors.avg });
  return finalizeDecision(avg, 'avg', 'fallback', input);
}

export interface Law1PricingInput {
  dubaiCostEtb: number;
  deliveryEtb: number;
  quantity: number;
}

export interface Law1PricingResult {
  marginPercent: number;
  sellingEtbPerUnit: number;
  finalEtbPerUnit: number;
  totalEtb: number;
}

/** Law 1 — profit on Dubai product cost only; delivery added after; qty last. */
export function applyLaw1Pricing(input: Law1PricingInput): Law1PricingResult {
  const marginPercent = resolveDynamicMarginPercent(input.dubaiCostEtb);
  const sellingEtbPerUnit = input.dubaiCostEtb * (1 + marginPercent / 100);
  const finalEtbPerUnit = sellingEtbPerUnit + input.deliveryEtb;
  const totalEtb = Math.ceil(finalEtbPerUnit * input.quantity);

  return {
    marginPercent,
    sellingEtbPerUnit,
    finalEtbPerUnit,
    totalEtb,
  };
}
