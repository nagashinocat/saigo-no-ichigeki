import { test, expect } from 'vitest';
import { createBlast, frontAt, blastDuration, timeAtFront } from '../../src/game/blast.js';
import { CONFIG } from '../../src/config.js';

const shot = (radius) => ({ amount: 50, radius, isBig: true });

const R = CONFIG.radius.max;
const sec = (radius) => ({ creep: Math.max(0.25, CONFIG.blast.creepSec * Math.sqrt(radius / R)), burst: Math.max(0.2, CONFIG.blast.burstSec * Math.sqrt(radius / R)) });
const speedAt = (t, radius) => (frontAt(t + 1e-4, radius) - frontAt(t - 1e-4, radius)) / 2e-4;

test('frontAt は単調増加、0 で 0、blastDuration で radius', () => {
  for (const r of [30, 150, R]) {
    const d = blastDuration(r);
    expect(frontAt(0, r)).toBe(0);
    expect(frontAt(d, r)).toBeCloseTo(r, 9);
    expect(frontAt(d + 5, r)).toBe(r);
    let prev = 0;
    for (let i = 1; i <= 400; i++) { const f = frontAt((d * i) / 400, r); expect(f).toBeGreaterThanOrEqual(prev); prev = f; }
  }
});
test('じわじわ期の終わりの front は radius の約6%で、その間の平均速度は弾ける期の最大速度の 1/8 未満', () => {
  const { creep, burst } = sec(R);
  expect(frontAt(creep, R)).toBeCloseTo(R * CONFIG.blast.creepFrac, 6);
  expect(CONFIG.blast.creepFrac).toBeCloseTo(0.06, 9);
  const avgCreep = frontAt(creep, R) / creep;
  let maxBurst = 0;
  for (let i = 0; i <= 200; i++) maxBurst = Math.max(maxBurst, speedAt(creep + 1e-3 + ((burst - 2e-3) * i) / 200, R));
  expect(avgCreep).toBeLessThan(maxBurst / 8);
});
test('速度の最大は弾ける期の前半（burstAt から burstSec の 40% 以内）にある', () => {
  const { creep, burst } = sec(R);
  let best = 0, bestT = 0;
  for (let i = 0; i <= 400; i++) { const t = creep + 1e-3 + ((burst - 2e-3) * i) / 400; const v = speedAt(t, R); if (v > best) { best = v; bestT = t; } }
  expect(bestT - creep).toBeLessThanOrEqual(burst * 0.4);
  // 最後は少しゆるむ
  expect(speedAt(creep + burst * 0.98, R)).toBeLessThan(best * 0.5);
});
test('最大の一発の blastDuration は 2.2〜2.8 秒、小さい一発（radius 30）は 0.8 秒未満', () => {
  expect(blastDuration(R)).toBeGreaterThanOrEqual(2.2); expect(blastDuration(R)).toBeLessThanOrEqual(2.8);
  expect(blastDuration(30)).toBeLessThan(0.8);
});
test('timeAtFront は frontAt の逆', () => {
  for (const f of [0, 5, 26, 100, 300, 440]) expect(frontAt(timeAtFront(f, R), R)).toBeCloseTo(f, 4);
});
test('createBlast: phase が creep → burst → done と進み、burstAt が creepSec と一致、front は終わりで止まる', () => {
  const b = createBlast(shot(R), []);
  const { creep } = sec(R);
  expect(b.burstAt).toBeCloseTo(creep, 9); expect(b.burstAt).toBeCloseTo(CONFIG.blast.creepSec, 9);
  expect(b.front).toBe(0); expect(b.phase).toBe('creep'); expect(b.done).toBe(false);
  b.update(creep - 0.05); expect(b.phase).toBe('creep'); expect(b.front).toBeLessThan(R * 0.06);
  b.update(0.1); expect(b.phase).toBe('burst'); expect(b.done).toBe(false);
  b.update(blastDuration(R)); expect(b.phase).toBe('done'); expect(b.done).toBe(true); expect(b.front).toBe(R);
  b.update(1); expect(b.front).toBe(R);
  expect(createBlast(shot(30), []).burstAt).toBeCloseTo(0.25, 9);
});
test('Hit は従来どおり各対象に一度だけ、front が dist を越えた更新で出る', () => {
  const b = createBlast(shot(300), [{ id: 2, dist: 100 }, { id: 1, dist: 40 }, { id: 3, dist: 40 }]);
  const hits = [];
  for (let i = 0; i < 400; i++) {
    const before = b.front;
    for (const h of b.update(1 / 100)) {
      const t = [{ id: 2, dist: 100 }, { id: 1, dist: 40 }, { id: 3, dist: 40 }].find((x) => x.id === h.id);
      expect(before).toBeLessThan(t.dist); expect(b.front).toBeGreaterThanOrEqual(t.dist);
      hits.push(h.id);
    }
  }
  expect(hits.sort()).toEqual([1, 2, 3]);
});
test('dist < radius*vaporizeRatio は vaporize、それ以外は push', () => {
  const r = 200, lim = r * CONFIG.blast.vaporizeRatio; // 36
  const b = createBlast(shot(r), [{ id: 1, dist: lim - 1 }, { id: 2, dist: lim }, { id: 3, dist: 150 }]);
  const h = b.update(10);
  expect(h.find((x) => x.id === 1).kind).toBe('vaporize');
  expect(h.find((x) => x.id === 2).kind).toBe('push');
  expect(h.find((x) => x.id === 3).kind).toBe('push');
});
test('radius より遠い対象は Hit にならない', () => {
  const b = createBlast(shot(100), [{ id: 1, dist: 100.5 }, { id: 2, dist: 100 }]);
  const h = b.update(10);
  expect(h.map((x) => x.id)).toEqual([2]); expect(b.done).toBe(true);
});
