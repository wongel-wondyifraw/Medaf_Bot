/**
 * Dynamic profit margin tiers from per-unit Dubai cost in ETB (delivery excluded).
 *   • cost < 3,000 ETB         → 30%
 *   • 3,000 ≤ cost ≤ 10,000   → 20%
 *   • cost > 10,000 ETB        → 15%
 */
export function resolveDynamicMarginPercent(dubaiCostEtb: number): number {
  if (!Number.isFinite(dubaiCostEtb) || dubaiCostEtb <= 0) return 30;
  if (dubaiCostEtb < 3000) return 30;
  if (dubaiCostEtb <= 10000) return 20;
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
 * Three-factor decision engine (AED anchor):
 * 1) LOW — use if totalAed >= baseAed
 * 2) HIGH — use if totalAed <= baseAed × ceilingMultiplier
 * 3) AVG — fallback
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
    return {
      tier: 'low',
      reason: 'viable',
      baseAed: input.baseAed,
      baseEtbRef: input.baseEtbRef,
      deliveryEtb: input.deliveryEtb,
      ...low,
    };
  }

  const high = computeStep({ ...stepBase, factor: input.factors.high });
  const ceilingAed = input.baseAed * input.ceilingMultiplier;
  if (high.totalAedPerUnit <= ceilingAed) {
    return {
      tier: 'high',
      reason: 'within_ceiling',
      baseAed: input.baseAed,
      baseEtbRef: input.baseEtbRef,
      deliveryEtb: input.deliveryEtb,
      ...high,
    };
  }

  const avg = computeStep({ ...stepBase, factor: input.factors.avg });
  return {
    tier: 'avg',
    reason: 'fallback',
    baseAed: input.baseAed,
    baseEtbRef: input.baseEtbRef,
    deliveryEtb: input.deliveryEtb,
    ...avg,
  };
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
