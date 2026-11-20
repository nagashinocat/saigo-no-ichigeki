import { test, expect } from 'vitest';
import { fractureBox } from '../../src/world/fracture.js';

const vol = (cs) => cs.reduce((s, c) => s + (c.max[0] - c.min[0]) * (c.max[1] - c.min[1]) * (c.max[2] - c.min[2]), 0);

test('fractureBox: 個数と体積が保たれる', () => {
  const c = fractureBox({ w: 10, h: 40, d: 10 }, 24, 3);
  expect(c.length).toBe(24);
  expect(vol(c)).toBeCloseTo(4000);
});

test('fractureBox: 破片はすべて元の箱の内側', () => {
  const size = { w: 10, h: 40, d: 14 };
  const eps = 1e-9;
  for (const ch of fractureBox(size, 30, 7)) {
    expect(ch.min[0]).toBeGreaterThanOrEqual(-size.w / 2 - eps);
    expect(ch.max[0]).toBeLessThanOrEqual(size.w / 2 + eps);
    expect(ch.min[1]).toBeGreaterThanOrEqual(-eps);
    expect(ch.max[1]).toBeLessThanOrEqual(size.h + eps);
    expect(ch.min[2]).toBeGreaterThanOrEqual(-size.d / 2 - eps);
    expect(ch.max[2]).toBeLessThanOrEqual(size.d / 2 + eps);
  }
});

test('fractureBox: 各軸で min < max、同じシードで同じ結果、pieces=1 は元の箱', () => {
  const a = fractureBox({ w: 8, h: 20, d: 8 }, 16, 5);
  for (const ch of a) for (let i = 0; i < 3; i++) expect(ch.min[i]).toBeLessThan(ch.max[i]);
  expect(fractureBox({ w: 8, h: 20, d: 8 }, 16, 5)).toEqual(a);
  expect(fractureBox({ w: 8, h: 20, d: 6 }, 1, 5)).toEqual([{ min: [-4, 0, -3], max: [4, 20, 3] }]);
});
