/** 15% above direct SHEIN cost on the product-cost portion (= factor 1.15). */
export const RESCUE_CEILING_FACTOR = 1.15;

/** Minimum rescue factor — product cost equals ethUsd × rate. */
export const RESCUE_FLOOR_FACTOR = 1.0;

/**
 * Resolves the effective Dubai factor for floor-rescue pricing.
 * When highFactor exceeds the ceiling, averages ceiling and high for a middle ground.
 */
export function resolveEffectiveRescueFactor(
  highFactor: number,
  ceilingFactor = RESCUE_CEILING_FACTOR,
  floorFactor = RESCUE_FLOOR_FACTOR,
): number {
  if (!Number.isFinite(highFactor) || highFactor <= 0) {
    highFactor = floorFactor;
  }
  const capped =
    highFactor <= ceilingFactor ? highFactor : (ceilingFactor + highFactor) / 2;
  return Math.max(capped, floorFactor);
}

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

/**
 * Law 1 — profit on Dubai product cost only; delivery added after; qty last.
 */
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
