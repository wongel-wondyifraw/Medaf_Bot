export type BroadGroup = 'clothing' | 'shoes' | 'accessories' | 'beauty' | 'home';

export const DEFAULT_DUBAI_FACTOR_BY_GROUP: Record<BroadGroup, number> = {
  clothing: 0.76,
  shoes: 0.82,
  accessories: 0.85,
  beauty: 0.88,
  home: 0.9,
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
