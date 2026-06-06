import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveDynamicMarginPercent,
  runThreeFactorDecision,
} from './pricing-math';

describe('resolveDynamicMarginPercent', () => {
  it('returns 30% below 3,000 ETB', () => {
    assert.equal(resolveDynamicMarginPercent(2999), 30);
  });

  it('returns 20% between 3,000 and 10,000 ETB', () => {
    assert.equal(resolveDynamicMarginPercent(3000), 20);
    assert.equal(resolveDynamicMarginPercent(10000), 20);
  });

  it('returns 15% above 10,000 ETB', () => {
    assert.equal(resolveDynamicMarginPercent(10001), 15);
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

  it('matches worked example shape for $20 Men shoes', () => {
    const result = decide();
    assert.equal(result.baseEtbRef, 3300);
    assert.ok(Math.abs(result.baseAed - 73.4) < 0.01);
    assert.ok(result.totalEtb > result.baseEtbRef);
    assert.equal(result.tier, 'avg');
  });
});
