import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyLaw1Pricing,
  RESCUE_CEILING_FACTOR,
  RESCUE_FLOOR_FACTOR,
  resolveDynamicMarginPercent,
  resolveEffectiveRescueFactor,
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

describe('resolveEffectiveRescueFactor', () => {
  it('uses high factor directly when at or below ceiling', () => {
    assert.equal(resolveEffectiveRescueFactor(1.1), 1.1);
    assert.equal(resolveEffectiveRescueFactor(1.15), 1.15);
  });

  it('averages ceiling and high factor when above ceiling', () => {
    assert.equal(
      resolveEffectiveRescueFactor(1.5),
      (RESCUE_CEILING_FACTOR + 1.5) / 2,
    );
  });

  it('clamps to floor factor when high factor is below 1.0', () => {
    assert.equal(resolveEffectiveRescueFactor(0.9), RESCUE_FLOOR_FACTOR);
  });

  it('defaults invalid high factor to floor', () => {
    assert.equal(resolveEffectiveRescueFactor(0), RESCUE_FLOOR_FACTOR);
    assert.equal(resolveEffectiveRescueFactor(-1), RESCUE_FLOOR_FACTOR);
  });
});

describe('floor rescue pricing scenarios', () => {
  const rate = 165;
  const deliveryEtb = 500;
  const ethUsd = 20;
  const floorPerUnitEtb = ethUsd * rate;

  function priceWithFactor(factor: number) {
    const dubaiCostEtb = ethUsd * factor * rate;
    return applyLaw1Pricing({ dubaiCostEtb, deliveryEtb, quantity: 1 });
  }

  it('primary factor below floor triggers rescue need', () => {
    const primary = priceWithFactor(0.627);
    assert.ok(primary.finalEtbPerUnit < floorPerUnitEtb);
  });

  it('rescued high factor 1.1 produces total at or above floor', () => {
    const effective = resolveEffectiveRescueFactor(1.1);
    const rescued = priceWithFactor(effective);
    assert.ok(rescued.finalEtbPerUnit >= floorPerUnitEtb);
  });

  it('rescued averaged high factor 1.5 produces total at or above floor', () => {
    const effective = resolveEffectiveRescueFactor(1.5);
    const rescued = priceWithFactor(effective);
    assert.ok(rescued.finalEtbPerUnit >= floorPerUnitEtb);
  });

  it('clamped factor 1.0 produces total at or above floor', () => {
    const effective = resolveEffectiveRescueFactor(0.9);
    assert.equal(effective, 1.0);
    const rescued = priceWithFactor(effective);
    assert.ok(rescued.finalEtbPerUnit >= floorPerUnitEtb);
  });

  it('matches worked example for high factor 1.1', () => {
    const rescued = priceWithFactor(1.1);
    assert.equal(Math.round(rescued.finalEtbPerUnit), 4856);
  });
});
