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
export type FactorReason = 'viable' | 'within_ceiling' | 'fallback';

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
