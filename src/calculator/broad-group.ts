export type BroadGroup = 'clothing' | 'shoes' | 'accessories' | 'beauty' | 'home';

// Defaults rescaled by 0.825 (= 165 / 200) so calculations match the
// previous 165 ETB/USD math while the live rate stays at 200.
export const DEFAULT_DUBAI_FACTOR_BY_GROUP: Record<BroadGroup, number> = {
  clothing: 0.627,
  shoes: 0.6765,
  accessories: 0.70125,
  beauty: 0.726,
  home: 0.7425,
};

/** Maps catalog category names to broad groups for history aggregation. */
export const BROAD_GROUP_MAP: Record<string, BroadGroup> = {
  'Men shoes': 'shoes',
  'Girls closed Shoes': 'shoes',
  'Girls flat Shoes': 'shoes',
  'Girls Hill Shoes': 'shoes',
  Cosmetics: 'beauty',
  'Phone Cover': 'accessories',
  'Bag(big)': 'accessories',
  'Bag(small)': 'accessories',
  watch: 'accessories',
  'Eye glass': 'accessories',
  Jewelery: 'accessories',
};

export function resolveBroadGroup(categoryName: string | null | undefined): BroadGroup {
  if (!categoryName) return 'clothing';
  return BROAD_GROUP_MAP[categoryName] ?? 'clothing';
}

export function defaultDubaiFactorForGroup(group: BroadGroup): number {
  return DEFAULT_DUBAI_FACTOR_BY_GROUP[group];
}
