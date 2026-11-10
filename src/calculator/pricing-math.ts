/**
 * Dynamic profit margin tiers from per-unit Dubai cost in ETB (delivery excluded).
 *   • cost < 5,000 ETB          → 25%
 *   • 5,000 ≤ cost ≤ 15,000    → 15%
 *   • cost > 15,000 ETB         → 10%
 *
 * Thresholds raised from 3,000/10,000 so that core mid-priced orders keep the
 * top tier instead of silently dropping one step (especially at higher FX rates).
 */
export function resolveDynamicMarginPercent(dubaiCostEtb: number): number {
  const cost = roundEtb(dubaiCostEtb);
  if (!Number.isFinite(cost) || cost <= 0) return 25;
  if (cost < 5000) return 25;
  if (cost <= 15000) return 15;
  return 10;
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
