/** Per-category low / avg / high Dubai factors (seed + lookup). */
export interface ThreeFactors {
  low: number;
  avg: number;
  high: number;
}

/** Delivery/pricing categories seeded by migration. */
export const CATEGORY_THREE_FACTOR_SEED: Record<string, ThreeFactors> = {
  'Men shoes': { low: 0.55, avg: 0.88, high: 1.25 },
  'Girls closed Shoes': { low: 0.48, avg: 0.8, high: 1.2 },
  'Girls flat Shoes': { low: 0.42, avg: 0.75, high: 1.15 },
  'Girls Hill Shoes': { low: 0.45, avg: 0.78, high: 1.18 },
  Jeans: { low: 0.45, avg: 0.78, high: 1.18 },
  Trousers: { low: 0.42, avg: 0.75, high: 1.15 },
  // Calibrated for ~3,700 ETB at USD $12, rate 200, delivery 800 (600+200), ×1.1 final.
  Dress: { low: 0.4, avg: 0.82, high: 1.15 },
  'Short Dress': { low: 0.38, avg: 0.7, high: 1.12 },
  'Body top': { low: 0.35, avg: 0.68, high: 1.1 },
  Shirt: { low: 0.38, avg: 0.7, high: 1.12 },
  'T-shirt': { low: 0.35, avg: 0.68, high: 1.1 },
  'Jacket big': { low: 0.58, avg: 0.9, high: 1.28 },
  'Jacket small': { low: 0.52, avg: 0.85, high: 1.22 },
  'Phone Cover': { low: 0.38, avg: 0.7, high: 1.12 },
  'Bag(big)': { low: 0.52, avg: 0.85, high: 1.22 },
  'Bag(small)': { low: 0.45, avg: 0.78, high: 1.18 },
  watch: { low: 0.48, avg: 0.8, high: 1.2 },
  'Eye glass': { low: 0.45, avg: 0.78, high: 1.18 },
  Jewelery: { low: 0.35, avg: 0.68, high: 1.1 },
  '2pc Cloth': { low: 0.45, avg: 0.78, high: 1.18 },
  // Calibrated for ~1,830 ETB at USD $6, rate 200, delivery 250, 30% margin, ×1.1 final.
  Underwear: { low: 0.45, avg: 0.9, high: 1.15 },
};

/** Maps category display name to env slug (PRICING_FACTOR_<SLUG>_LOW). */
export function categoryNameToEnvSlug(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function readEnvFactorOverride(
  env: NodeJS.ProcessEnv,
  categoryName: string | null,
  tier: 'LOW' | 'AVG' | 'HIGH',
): number | null {
  if (!categoryName) return null;
  const slug = categoryNameToEnvSlug(categoryName);
  const key = `PRICING_FACTOR_${slug}_${tier}`;
  const raw = (env[key] || '').trim();
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
