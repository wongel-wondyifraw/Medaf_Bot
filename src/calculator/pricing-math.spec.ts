import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyMarginEtb,
  convertAedToEtb,
  resolveDynamicMarginPercent,
  roundEtb,
  runAedDirectPricing,
} from './pricing-math';

describe('resolveDynamicMarginPercent', () => {
  it('returns 25% below 5,000 ETB', () => {
    assert.equal(resolveDynamicMarginPercent(4999), 25);
    assert.equal(resolveDynamicMarginPercent(0), 25);
  });

  it('returns 15% between 5,000 and 15,000 ETB', () => {
    assert.equal(resolveDynamicMarginPercent(5000), 15);
    assert.equal(resolveDynamicMarginPercent(15000), 15);
  });

  it('returns 10% above 15,000 ETB', () => {
    assert.equal(resolveDynamicMarginPercent(15001), 10);
  });
});

describe('integer ETB helpers', () => {
  it('converts AED with the direct rate', () => {
    assert.equal(convertAedToEtb(66.88, 50), 3344);
    assert.equal(applyMarginEtb(3344, 25), 4180);
    assert.equal(roundEtb(123.6), 124);
  });
});

describe('runAedDirectPricing', () => {
  it('converts AED to ETB, applies margin, then adds delivery as integers', () => {
    const r = runAedDirectPricing({
      dubaiAed: 1,
      deliveryEtb: 800,
      aedToEtb: 200,
      quantity: 1,
    });
    assert.equal(r.dubaiCostEtb, 200);
    assert.equal(r.marginPercent, 25);
    assert.equal(r.sellEtb, 250);
    assert.equal(r.profitEtb, 50);
    assert.equal(r.unitEtbPerUnit, 1050);
    assert.equal(r.totalEtb, 1050);
  });

  it('matches the 66.88 AED trouser example at rate 50 with Trousers delivery', () => {
    const r = runAedDirectPricing({
      dubaiAed: 66.88,
      deliveryEtb: 650,
      aedToEtb: 50,
      quantity: 1,
    });
    assert.equal(r.dubaiCostEtb, 3344);
    assert.equal(r.marginPercent, 25);
    assert.equal(r.sellEtb, 4180);
    assert.equal(r.profitEtb, 836);
    assert.equal(r.unitEtbPerUnit, 4830);
    assert.equal(r.totalEtb, 4830);
  });

  it('applies 15% for 5,000–15,000 ETB and 10% above 15,000 ETB', () => {
    const mid = runAedDirectPricing({
      dubaiAed: 200,
      deliveryEtb: 600,
      aedToEtb: 50,
      quantity: 1,
    });
    assert.equal(mid.dubaiCostEtb, 10000);
    assert.equal(mid.marginPercent, 15);
    assert.equal(mid.sellEtb, 11500);
    assert.equal(mid.profitEtb, 1500);
    assert.equal(mid.unitEtbPerUnit, 12100);
    assert.equal(mid.totalEtb, 12100);

    const high = runAedDirectPricing({
      dubaiAed: 400,
      deliveryEtb: 600,
      aedToEtb: 50,
      quantity: 1,
    });
    assert.equal(high.dubaiCostEtb, 20000);
    assert.equal(high.marginPercent, 10);
    assert.equal(high.sellEtb, 22000);
    assert.equal(high.profitEtb, 2000);
    assert.equal(high.unitEtbPerUnit, 22600);
    assert.equal(high.totalEtb, 22600);
  });

  it('multiplies the per-unit total by quantity last', () => {
    const r = runAedDirectPricing({
      dubaiAed: 1,
      deliveryEtb: 500,
      aedToEtb: 200,
      quantity: 3,
    });
    assert.equal(r.unitEtbPerUnit, 750);
    assert.equal(r.totalEtb, 2250);
  });
});
