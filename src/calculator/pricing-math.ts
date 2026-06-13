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
  const cost = roundEtb(dubaiCostEtb);
  if (!Number.isFinite(cost) || cost <= 0) return 30;
  if (cost < 5000) return 30;
  if (cost <= 15000) return 20;
  return 15;
}

/** Round to the nearest whole ETB (all customer-facing amounts are integers). */
export function roundEtb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/** Apply a margin (%) to an integer Dubai cost in ETB. */
export function applyMarginEtb(dubaiCostEtb: number, marginPercent: number): number {
  const cost = roundEtb(dubaiCostEtb);
  return roundEtb((cost * (100 + marginPercent)) / 100);
}

/** Convert AED → ETB using the direct admin rate (ETB per 1 AED). */
export function convertAedToEtb(aed: number, aedToEtb: number): number {
  return roundEtb(aed * aedToEtb);
}

/** Law 1 unit total: margin on product cost only, then add delivery, then qty. */
export function finalizeLaw1UnitTotalEtb(
  dubaiCostEtb: number,
  deliveryEtb: number,
  quantity: number,
): {
  marginPercent: number;
  dubaiCostEtb: number;
  sellEtb: number;
  profitEtb: number;
  deliveryEtb: number;
  unitEtbPerUnit: number;
  totalEtb: number;
} {
  const cost = roundEtb(dubaiCostEtb);
  const delivery = roundEtb(deliveryEtb);
  const marginPercent = resolveDynamicMarginPercent(cost);
  const sellEtb = applyMarginEtb(cost, marginPercent);
  const profitEtb = sellEtb - cost;
  const unitEtbPerUnit = sellEtb + delivery;
  const qty = Math.max(1, Math.round(quantity));
  return {
    marginPercent,
    dubaiCostEtb: cost,
    sellEtb,
    profitEtb,
    deliveryEtb: delivery,
    unitEtbPerUnit,
    totalEtb: unitEtbPerUnit * qty,
  };
}

export type FactorTier = 'low' | 'high' | 'avg';
export type FactorReason =
  | 'viable'
  | 'within_ceiling'
  | 'fallback'
  | 'usd_band';

/** Factor at USD 0 (full Dubai list price). */
export const USD_BAND_FACTOR_UNDER_10 = 1.0;
/**
 * USD 10–20 inclusive. Calibrated so $10 @ rate 200, delivery 800, ×1.1 → ~3,500 ETB
 * (reverse-solved ≈ 0.915, rounded up to 0.92).
 */
export const USD_BAND_FACTOR_MID = 0.92;
/** Factor reached at the top of the high-band ramp (USD ≥ high ramp end). */
export const USD_BAND_FACTOR_HIGH = 0.82;
export const USD_BAND_MID_MIN_USD = 10;
export const USD_BAND_HIGH_MIN_USD = 20;
/** Linear ramp: factor slides from MID at $20 down to HIGH at this USD (no cliff). */
export const USD_BAND_HIGH_RAMP_END_USD = 40;

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
}

/** Order pricing input: Dubai factor comes from USD band only (not category). */
export interface UsdBandDecisionInput {
  ethUsd: number;
  baseAed: number;
  baseEtbRef: number;
  deliveryEtb: number;
  etbToAed: number;
  quantity: number;
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

function aedToEtbViaInverse(aed: number, etbToAed: number): number {
  return etbToAed > 0 ? convertAedToEtb(aed, 1 / etbToAed) : 0;
}

function computeStep(input: InternalStepInput): StepPricingSnapshot {
  const dubaiCostAed = input.baseAed * input.factor;
  const dubaiCostEtb = aedToEtbViaInverse(dubaiCostAed, input.etbToAed);
  const marginPercent = resolveDynamicMarginPercent(dubaiCostEtb);
  const sellEtb = applyMarginEtb(dubaiCostEtb, marginPercent);
  const profitEtb = sellEtb - dubaiCostEtb;
  const deliveryEtb = roundEtb(input.deliveryEtb);
  const sellAed = sellEtb * input.etbToAed;
  const profitAed = profitEtb * input.etbToAed;
  const deliveryAed = deliveryEtb * input.etbToAed;
  const totalAedPerUnit = sellAed + deliveryAed;
  const unitEtbPerUnit = sellEtb + deliveryEtb;
  const totalEtb = unitEtbPerUnit * input.quantity;

  return {
    factorUsed: input.factor,
    marginPercent,
    dubaiCostAed,
    dubaiCostEtb,
    sellAed,
    sellEtb,
    profitAed,
    profitEtb,
    deliveryAed,
    totalAedPerUnit,
    unitEtbPerUnit,
    totalEtb,
  };
}

/**
 * Finalize a chosen tier and enforce the hard floor (never below the USD × rate anchor).
 */
function finalizeDecision(
  snapshot: StepPricingSnapshot,
  tier: FactorTier,
  reason: FactorReason,
  input: ThreeFactorDecisionInput,
): ThreeFactorDecisionResult {
  const floorEtb = roundEtb(input.baseEtbRef);

  let unitEtbPerUnit = snapshot.unitEtbPerUnit;
  let floored = false;
  if (unitEtbPerUnit < floorEtb) {
    unitEtbPerUnit = floorEtb;
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
  const profitEtb = sellEtb - roundEtb(snapshot.dubaiCostEtb);
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
    totalEtb: unitEtbPerUnit * input.quantity,
    floored,
  };
}

/**
 * Smooth Dubai factor from USD input (same for all categories).
 *   • USD 0–10   → linear 1.0 → 0.92 (no cliff at $10)
 *   • USD 10–20  → 0.92 (calibration anchor)
 *   • USD 20–40  → linear 0.92 → 0.82 (no cliff at $20)
 *   • USD ≥ 40   → 0.82
 */
export function resolveUsdBandDubaiFactor(ethUsd: number): {
  factor: number;
  band: UsdPriceBand;
  tier: FactorTier;
} {
  if (!Number.isFinite(ethUsd) || ethUsd <= 0) {
    return {
      factor: USD_BAND_FACTOR_UNDER_10,
      band: 'under_10',
      tier: 'low',
    };
  }

  let factor: number;
  let band: UsdPriceBand;
  let tier: FactorTier;

  if (ethUsd < USD_BAND_MID_MIN_USD) {
    const span = USD_BAND_MID_MIN_USD;
    factor =
      USD_BAND_FACTOR_UNDER_10 -
      (ethUsd / span) * (USD_BAND_FACTOR_UNDER_10 - USD_BAND_FACTOR_MID);
    band = 'under_10';
    tier = 'low';
  } else if (ethUsd <= USD_BAND_HIGH_MIN_USD) {
    factor = USD_BAND_FACTOR_MID;
    band = 'mid';
    tier = 'avg';
  } else if (ethUsd < USD_BAND_HIGH_RAMP_END_USD) {
    const span = USD_BAND_HIGH_RAMP_END_USD - USD_BAND_HIGH_MIN_USD;
    factor =
      USD_BAND_FACTOR_MID -
      ((ethUsd - USD_BAND_HIGH_MIN_USD) / span) *
        (USD_BAND_FACTOR_MID - USD_BAND_FACTOR_HIGH);
    band = 'high';
    tier = 'high';
  } else {
    factor = USD_BAND_FACTOR_HIGH;
    band = 'high';
    tier = 'high';
  }

  return { factor, band, tier };
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
  });
}

/**
 * Three-factor decision engine (AED anchor):
 * 1) LOW — use if totalAed >= baseAed
 * 2) HIGH — use if totalAed <= baseAed × ceilingMultiplier
 * 3) AVG — fallback
 *
 * The chosen tier is then finalized with a hard floor clamp so the unit price
 * never drops below the USD × rate anchor.
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

export interface AedDirectPricingInput {
  /** Verified Dubai unit price in AED (from SHEIN UAE location). */
  dubaiAed: number;
  deliveryEtb: number;
  /** ETB per 1 AED (admin AED→ETB rate). */
  aedToEtb: number;
  quantity: number;
}

export interface AedDirectPricingResult {
  marginPercent: number;
  dubaiCostAed: number;
  dubaiCostEtb: number;
  sellEtb: number;
  profitEtb: number;
  unitEtbPerUnit: number;
  totalEtb: number;
}

/**
 * Direct AED pricing: convert Dubai AED → ETB, apply dynamic margin on product
 * cost only, then add delivery (shipping + commission).
 */
export function runAedDirectPricing(
  input: AedDirectPricingInput,
): AedDirectPricingResult {
  const priced = finalizeLaw1UnitTotalEtb(
    convertAedToEtb(input.dubaiAed, input.aedToEtb),
    input.deliveryEtb,
    input.quantity,
  );

  return {
    marginPercent: priced.marginPercent,
    dubaiCostAed: input.dubaiAed,
    dubaiCostEtb: priced.dubaiCostEtb,
    sellEtb: priced.sellEtb,
    profitEtb: priced.profitEtb,
    unitEtbPerUnit: priced.unitEtbPerUnit,
    totalEtb: priced.totalEtb,
  };
}

/** Law 1 — profit on Dubai product cost only; delivery added after; qty last. */
export function applyLaw1Pricing(input: Law1PricingInput): Law1PricingResult {
  const priced = finalizeLaw1UnitTotalEtb(
    input.dubaiCostEtb,
    input.deliveryEtb,
    input.quantity,
  );

  return {
    marginPercent: priced.marginPercent,
    sellingEtbPerUnit: priced.sellEtb,
    finalEtbPerUnit: priced.unitEtbPerUnit,
    totalEtb: priced.totalEtb,
  };
}
