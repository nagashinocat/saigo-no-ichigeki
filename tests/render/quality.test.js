import { test, expect } from 'vitest';
import { TIERS, pickTier, nextTier, createFpsGovernor } from '../../src/render/quality.js';

test('PC は high、スマホは mid、メモリ4GB未満のスマホは low', () => {
  expect(pickTier({ isMobile: false })).toBe('high');
  expect(pickTier({ isMobile: false, deviceMemory: 1, cores: 2 })).toBe('high');
  expect(pickTier({ isMobile: true })).toBe('mid');
  expect(pickTier({ isMobile: true, deviceMemory: 4 })).toBe('mid');
  expect(pickTier({ isMobile: true, deviceMemory: 8, cores: 8 })).toBe('mid');
  expect(pickTier({ isMobile: true, deviceMemory: 2 })).toBe('low');
  expect(pickTier({ isMobile: true, cores: 4 })).toBe('low');
});

test('TIERS の値と nextTier', () => {
  expect(TIERS.high).toEqual({ pixelRatioMax: 2, debrisMax: 6000, nearPhysicsMax: 400, piecesPerBuilding: 24, dustMax: 3000, rubbleMax: 3000, auraMax: 48, auraShell: true, bloom: true, heatHaze: true, shadows: true });
  expect(TIERS.mid).toEqual({ pixelRatioMax: 1.5, debrisMax: 2500, nearPhysicsMax: 120, piecesPerBuilding: 12, dustMax: 1200, rubbleMax: 1500, auraMax: 24, auraShell: true, bloom: true, heatHaze: false, shadows: false });
  expect(TIERS.low).toEqual({ pixelRatioMax: 1, debrisMax: 800, nearPhysicsMax: 40, piecesPerBuilding: 6, dustMax: 400, rubbleMax: 600, auraMax: 10, auraShell: false, bloom: false, heatHaze: false, shadows: false });
  expect(nextTier('high')).toBe('mid');
  expect(nextTier('mid')).toBe('low');
  expect(nextTier('low')).toBe('low');
});

test('平均fpsが target を2秒下回ると down を一度返し、また2秒たつまで返さない', () => {
  const g = createFpsGovernor({ target: 30, holdSec: 2 });
  const dt = 1 / 15;
  const results = [];
  let t = 0;
  for (let i = 0; i < 15 * 6; i++) {
    t += dt;
    results.push([t, g.sample(dt)]);
  }
  const downs = results.filter(([, r]) => r === 'down').map(([tt]) => tt);
  expect(downs.length).toBe(2);
  expect(downs[0]).toBeGreaterThanOrEqual(2 - 1e-6);
  expect(downs[0]).toBeLessThan(2.2);
  expect(downs[1] - downs[0]).toBeGreaterThanOrEqual(2 - 1e-6);
  expect(downs[1] - downs[0]).toBeLessThan(2.2);
  expect(results.every(([, r]) => r === 'down' || r === null)).toBe(true);
});

test('一瞬落ちただけでは down を返さない', () => {
  const g = createFpsGovernor({ target: 30, holdSec: 2 });
  const out = [];
  for (let i = 0; i < 120; i++) out.push(g.sample(1 / 60));
  for (let i = 0; i < 8; i++) out.push(g.sample(1 / 10)); // 約0.8秒の低下
  for (let i = 0; i < 300; i++) out.push(g.sample(1 / 60));
  expect(out.every((r) => r === null)).toBe(true);
});

test('不正な dt は無視する', () => {
  const g = createFpsGovernor({ target: 30 });
  expect(g.sample(0)).toBe(null);
  expect(g.sample(-1)).toBe(null);
  expect(g.sample(NaN)).toBe(null);
  expect(g.sample(Infinity)).toBe(null);
});

test('遊ぶ前（TAP の画面・導入・題字）は数えない: active が false の間の重いフレームは捨てられ、遊びが始まってから 2 秒たつまで down を返さない', () => {
  const g = createFpsGovernor({ target: 30, holdSec: 2 });
  for (let i = 0; i < 15 * 10; i++) expect(g.sample(1 / 15, false)).toBe(null); // 10 秒ぶんの重い導入
  // 遊びが始まった: 軽いフレームなら一度も下げない
  for (let i = 0; i < 60 * 5; i++) expect(g.sample(1 / 60)).toBe(null);
  // 重い導入のあとに重い遊び: 遊びの 2 秒がたつまでは下げない
  const h = createFpsGovernor({ target: 30, holdSec: 2 });
  for (let i = 0; i < 15 * 10; i++) h.sample(1 / 15, false);
  let first = null, t = 0;
  for (let i = 0; i < 15 * 4 && first === null; i++) { t += 1 / 15; if (h.sample(1 / 15) === 'down') first = t; }
  expect(first).toBeGreaterThanOrEqual(2 - 1e-6);
});
