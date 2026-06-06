import { runThreeFactorDecision, ThreeFactors } from '../src/calculator/pricing-math';
import { CATEGORY_THREE_FACTOR_SEED } from '../src/categories/category-three-factors';

const USD_TO_ETB = 165;
const USD_TO_AED = 3.67;
const etbToAed = USD_TO_AED / USD_TO_ETB;

// Real delivery = shipping_cost + commission_etb (from migration 1780000000000)
const DELIVERY: Record<string, number> = {
  'Men shoes': 1400,
  'Girls closed Shoes': 1100,
  'Girls flat Shoes': 700,
  'Girls Hill Shoes': 800,
  Jeans: 650,
  Trousers: 650,
  Dress: 800,
  'Short Dress': 500,
  'Body top': 350,
  Shirt: 500,
  'T-shirt': 400,
  'Jacket big': 900,
  'Jacket small': 650,
  'Phone Cover': 200,
  'Bag(big)': 800,
  'Bag(small)': 600,
  watch: 600,
  'Eye glass': 300,
  Jewelery: 200,
  '2pc Cloth': 800,
  Underwear: 250,
};

function run(usd: number, name: string, factors: ThreeFactors, ceiling = 1.3) {
  return runThreeFactorDecision({
    baseAed: usd * USD_TO_AED,
    baseEtbRef: usd * USD_TO_ETB,
    deliveryEtb: DELIVERY[name] ?? 500,
    etbToAed,
    quantity: 1,
    factors,
    ceilingMultiplier: ceiling,
  });
}

// CASE A: the exact product
console.log('=== A: $16.96 across all categories (real delivery, ceiling 1.30) ===');
console.log('category               deliv  tier  mrg  dubaiETB  unit   ratio  flr');
for (const [name, f] of Object.entries(CATEGORY_THREE_FACTOR_SEED)) {
  const r = run(16.96, name, f);
  const floor = 16.96 * USD_TO_ETB;
  console.log(
    `${name.padEnd(22)}${String(DELIVERY[name]).padEnd(7)}${r.tier.padEnd(6)}${String(r.marginPercent).padEnd(5)}${String(Math.round(r.dubaiCostEtb)).padEnd(10)}${String(r.unitEtbPerUnit).padEnd(7)}${(r.unitEtbPerUnit / floor).toFixed(2).padEnd(7)}${r.floored ? 'Y' : '-'}`,
  );
}

// CASE B: Men shoes price curve with real delivery
console.log('\n=== B: Men shoes curve (delivery 1400, ceiling 1.30) ===');
console.log('USD   floor   tier  mrg  unit    ratio');
for (const usd of [5, 10, 16.96, 25, 50, 100, 200]) {
  const r = run(usd, 'Men shoes', CATEGORY_THREE_FACTOR_SEED['Men shoes']);
  const floor = usd * USD_TO_ETB;
  console.log(
    `$${String(usd).padEnd(5)}${String(Math.round(floor)).padEnd(8)}${r.tier.padEnd(6)}${String(r.marginPercent).padEnd(5)}${String(r.unitEtbPerUnit).padEnd(8)}${(r.unitEtbPerUnit / floor).toFixed(2)}`,
  );
}

// CASE C: what brings Men shoes $16.96 (4602) to ~5100?
console.log('\n=== C: levers to reach ~5100 for Men shoes $16.96 ===');
const f = CATEGORY_THREE_FACTOR_SEED['Men shoes'];
const floor = 16.96 * USD_TO_ETB;
console.log('-- raise AVG factor --');
for (const avg of [0.88, 0.95, 1.0, 1.05, 1.1]) {
  const r = run(16.96, 'Men shoes', { ...f, avg });
  console.log(`  avg ${avg}: unit=${r.unitEtbPerUnit} (mrg ${r.marginPercent}%)`);
}
console.log('-- global multiplier on 4602 --');
for (const m of [1.05, 1.1, 1.11, 1.15]) {
  console.log(`  x${m}: ${Math.ceil(4602 * m)}`);
}
console.log('-- raise margin % (avg 0.88) --');
const dubai = floor * 0.88;
for (const m of [30, 40, 45, 50]) {
  console.log(`  ${m}%: ${Math.ceil(dubai * (1 + m / 100) + 1400)}`);
}
