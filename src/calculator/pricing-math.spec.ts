import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveDynamicMarginPercent,
  resolveUsdBandDubaiFactor,
  runThreeFactorDecision,
  runUsdBandDecision,
  USD_BAND_FACTOR_HIGH,
  USD_BAND_FACTOR_MID,
  USD_BAND_FACTOR_UNDER_10,
} from './pricing-math';

describe('resolveDynamicMarginPercent', () => {
  it('returns 30% below 5,000 ETB', () => {
    assert.equal(resolveDynamicMarginPercent(4999), 30);
  });

  it('returns 20% between 5,000 and 15,000 ETB', () => {
    assert.equal(resolveDynamicMarginPercent(5000), 20);
    assert.equal(resolveDynamicMarginPercent(15000), 20);
  });

  it('returns 15% above 15,000 ETB', () => {
    assert.equal(resolveDynamicMarginPercent(15001), 15);
  });
});

describe('resolveUsdBandDubaiFactor', () => {
  it('ramps factor from 1.0 toward 0.92 below $10', () => {
    const low = resolveUsdBandDubaiFactor(5);
    assert.equal(low.band, 'under_10');
    assert.equal(low.tier, 'low');
    assert.ok(low.factor > USD_BAND_FACTOR_MID);
    assert.ok(low.factor < USD_BAND_FACTOR_UNDER_10);

    const nearTen = resolveUsdBandDubaiFactor(9.99);
    assert.ok(Math.abs(nearTen.factor - USD_BAND_FACTOR_MID) < 0.01);
  });

  it('uses factor 0.92 from $10 through $20', () => {
    for (const usd of [10, 15, 20]) {
      const r = resolveUsdBandDubaiFactor(usd);
      assert.equal(r.factor, USD_BAND_FACTOR_MID);
      assert.equal(r.band, 'mid');
      assert.equal(r.tier, 'avg');
    }
  });

  it('ramps factor between 0.92 and 0.82 from $20 to $40', () => {
    const justAbove = resolveUsdBandDubaiFactor(20.01);
    assert.equal(justAbove.band, 'high');
    assert.equal(justAbove.tier, 'high');
    assert.ok(justAbove.factor > USD_BAND_FACTOR_HIGH);
    assert.ok(justAbove.factor < USD_BAND_FACTOR_MID);

    const atEnd = resolveUsdBandDubaiFactor(40);
    assert.equal(atEnd.factor, USD_BAND_FACTOR_HIGH);
    assert.equal(atEnd.band, 'high');
  });
});

describe('runUsdBandDecision', () => {
  const usdToEtb = 200;
  const usdToAed = 3.67;
  const etbToAed = usdToAed / usdToEtb;
  const deliveryEtb = 800;

  function bandPrice(ethUsd: number) {
    return runUsdBandDecision({
      ethUsd,
      baseAed: ethUsd * usdToAed,
      baseEtbRef: ethUsd * usdToEtb,
      deliveryEtb,
      etbToAed,
      quantity: 1,
      finalMultiplier: 1.1,
    });
  }

  it('hits ~3,500 ETB at $10 with Dress delivery (rate 200, ×1.1)', () => {
    const r = bandPrice(10);
    assert.equal(r.reason, 'usd_band');
    assert.equal(r.factorUsed, USD_BAND_FACTOR_MID);
    assert.ok(r.totalEtb >= 3500 && r.totalEtb <= 3520);
  });

  it('applies the same mid factor for $12 (Dress delivery)', () => {
    const r = bandPrice(12);
    assert.equal(r.factorUsed, USD_BAND_FACTOR_MID);
    assert.equal(r.tier, 'avg');
    assert.ok(r.totalEtb > 3500);
  });

  it('picks band-specific factors for $8 vs $12', () => {
    const under10 = bandPrice(8);
    const mid = bandPrice(12);
    assert.ok(under10.factorUsed > USD_BAND_FACTOR_MID);
    assert.equal(mid.factorUsed, USD_BAND_FACTOR_MID);
    assert.notEqual(under10.factorUsed, mid.factorUsed);
  });

  it('keeps total price increasing across the $20 band boundary', () => {
    const at18 = bandPrice(18);
    const at20 = bandPrice(20);
    const at22 = bandPrice(22);
    assert.ok(at18.totalEtb < at20.totalEtb);
    assert.ok(at20.totalEtb < at22.totalEtb);
    assert.ok(at18.totalEtb < at22.totalEtb);
  });
});

describe('runThreeFactorDecision', () => {
  const usdToEtb = 165;
  const usdToAed = 3.67;
  const etbToAed = usdToAed / usdToEtb;
  const ethUsd = 20;
  const baseAed = ethUsd * usdToAed;
  const baseEtbRef = ethUsd * usdToEtb;
  const deliveryEtb = 500;

  const menShoesFactors = { low: 0.55, avg: 0.88, high: 1.25 };

  function decide(factors = menShoesFactors, ceilingMultiplier = 1.2) {
    return runThreeFactorDecision({
      baseAed,
      baseEtbRef,
      deliveryEtb,
      etbToAed,
      quantity: 1,
      factors,
      ceilingMultiplier,
    });
  }

  it('uses LOW when totalAed >= baseAed', () => {
    const result = decide({ low: 0.9, avg: 0.88, high: 1.25 });
    assert.equal(result.tier, 'low');
    assert.equal(result.reason, 'viable');
    assert.equal(result.factorUsed, 0.9);
    assert.ok(result.totalAedPerUnit >= baseAed);
  });

  it('uses HIGH when LOW fails but HIGH is within ceiling', () => {
    const result = decide({ low: 0.1, avg: 0.88, high: 0.75 });
    assert.equal(result.tier, 'high');
    assert.equal(result.reason, 'within_ceiling');
    assert.ok(result.totalAedPerUnit <= baseAed * 1.2);
  });

  it('falls back to AVG when HIGH exceeds ceiling', () => {
    const result = decide({ low: 0.1, avg: 0.88, high: 2.0 });
    assert.equal(result.tier, 'avg');
    assert.equal(result.reason, 'fallback');
    assert.equal(result.factorUsed, 0.88);
  });

  it('excludes delivery from margin base (Law 1)', () => {
    const result = decide({ low: 0.9, avg: 0.88, high: 1.25 });
    const expectedSell = result.dubaiCostEtb * (1 + result.marginPercent / 100);
    assert.ok(Math.abs(result.sellEtb - expectedSell) < 0.01);
    assert.ok(result.unitEtbPerUnit >= result.sellEtb + deliveryEtb - 1);
  });

  it('clamps unit price to the USD × rate floor for weak factors', () => {
    const result = decide({ low: 0.2, avg: 0.3, high: 0.35 });
    assert.equal(result.floored, true);
    assert.equal(result.unitEtbPerUnit, Math.ceil(baseEtbRef));
    assert.ok(result.unitEtbPerUnit >= baseEtbRef);
    assert.equal(result.totalEtb, Math.ceil(baseEtbRef));
  });

  it('does not clamp when the price already clears the floor', () => {
    const result = decide({ low: 0.9, avg: 0.88, high: 1.25 });
    assert.equal(result.floored, false);
    assert.ok(result.unitEtbPerUnit > baseEtbRef);
  });

  it('applies the final multiplier uplift to the chosen price', () => {
    const baseline = runThreeFactorDecision({
      baseAed,
      baseEtbRef,
      deliveryEtb,
      etbToAed,
      quantity: 1,
      factors: menShoesFactors,
      ceilingMultiplier: 1.2,
    });
    const uplifted = runThreeFactorDecision({
      baseAed,
      baseEtbRef,
      deliveryEtb,
      etbToAed,
      quantity: 1,
      factors: menShoesFactors,
      ceilingMultiplier: 1.2,
      finalMultiplier: 1.1,
    });
    assert.equal(baseline.tier, uplifted.tier);
    assert.equal(uplifted.unitEtbPerUnit, Math.ceil(baseline.unitEtbPerUnit * 1.1));
    assert.ok(uplifted.profitEtb > baseline.profitEtb);
  });

  it('matches worked example shape for $20 Men shoes', () => {
    const result = decide();
    assert.equal(result.baseEtbRef, 3300);
    assert.ok(Math.abs(result.baseAed - 73.4) < 0.01);
    assert.ok(result.totalEtb > result.baseEtbRef);
    assert.equal(result.tier, 'avg');
  });
});
