import { test, expect } from 'vitest';
import { createReserve } from '../../src/game/reserve.js';
import { createCharge, radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';

test('貯めは ratePerSec で引き出し、maxDraw で止まる', () => {
  const r = createReserve({ max: 100, start: 100, regenPerSec: 0, minLeft: 5 }); const c = createCharge(r);
  c.start(); c.update(1); expect(r.value).toBe(55); c.update(10); expect(c.release().amount).toBe(90);
});
test('貯めは器の minLeft より下を引き出さない', () => {
  const r = createReserve({ max: 100, start: 20, regenPerSec: 0, minLeft: 5 }); const c = createCharge(r);
  c.start(); c.update(10); expect(r.value).toBe(5); expect(c.release().amount).toBe(15);
});
test('release で active が false になり、2回目は null', () => {
  const r = createReserve(); const c = createCharge(r);
  expect(c.active).toBe(false); c.start(); expect(c.active).toBe(true); c.update(0.1);
  expect(c.release()).not.toBeNull(); expect(c.active).toBe(false); expect(c.release()).toBeNull();
});
test('bigShotRatio 以上で isBig', () => {
  const mk = (amount) => {
    const r = createReserve({ max: 100, start: 100, regenPerSec: 0, minLeft: 5 }); const c = createCharge(r);
    c.start(); c.update(amount / 45); return c.release();
  };
  expect(mk(31.5).amount).toBeCloseTo(31.5); expect(mk(31.5).isBig).toBe(true);
  expect(mk(31).isBig).toBe(false);
});
test('radiusFor: 0→min, maxDraw→max, 単調増加', () => {
  expect(radiusFor(0)).toBe(10); expect(radiusFor(90)).toBeCloseTo(440); expect(radiusFor(40)).toBeGreaterThan(radiusFor(20));
});
test('createRng は同じシードで同じ列', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const sa = [a(), a(), a(), a()], sb = [b(), b(), b(), b()];
  expect(sa).toEqual(sb); expect(c()).not.toBe(sa[0]);
  for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
});
