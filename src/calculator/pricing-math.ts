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
