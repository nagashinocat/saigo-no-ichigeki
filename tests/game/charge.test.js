import { test, expect } from 'vitest';
import { createPower } from '../../src/game/power.js';
import { createCharge, radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

const P = { max: 100, chargePerSec: 2.5, minRelease: 10 };
const cfg = { ...CONFIG, power: P };
const make = () => { const p = createPower(P); return { p, c: createCharge(p, cfg) }; };

test('長押しの間だけ chargePerSec で力が貯まり、max で止まる', () => {
  const { p, c } = make();
  c.update(10); // 押していない間は貯まらない
  expect(p.value).toBe(0);
  c.start(); c.update(4);
  expect(p.value).toBeCloseTo(10);
  c.update(100);
  expect(p.value).toBe(100);
});

test('release は貯めた力を全部使って最後の一発を返す（半径は貯めた量で決まる）', () => {
  const { p, c } = make();
  c.start(); c.update(20);
  const shot = c.release();
  expect(shot.amount).toBeCloseTo(50);
  expect(shot.radius).toBeCloseTo(radiusFor(50, cfg));
  expect(shot.isBig).toBe(true);
  expect(p.value).toBe(0);
  expect(c.active).toBe(false);
  expect(c.release()).toBeNull();
});

test('minRelease 未満で離しても放たず、貯めた力は残り、また押すと続きから貯まる', () => {
  const { p, c } = make();
  c.start(); c.update(2); // 5
  expect(c.release()).toBeNull();
  expect(c.active).toBe(false);
  expect(p.value).toBeCloseTo(5);
  c.start(); c.update(2);
  expect(p.value).toBeCloseTo(10);
  expect(c.release().amount).toBeCloseTo(10);
});

test('押していないときの release は null', () => {
  const { c } = make();
  expect(c.active).toBe(false);
  expect(c.release()).toBeNull();
});

test('radiusFor: 0→min、power.max→max（街の端より先）、単調増加', () => {
  expect(radiusFor(0)).toBe(CONFIG.radius.min);
  expect(radiusFor(CONFIG.power.max)).toBeCloseTo(CONFIG.radius.max);
  expect(radiusFor(CONFIG.power.max * 2)).toBeCloseTo(CONFIG.radius.max);
  expect(CONFIG.radius.max).toBeGreaterThanOrEqual(CONFIG.cityRadius);
  expect(radiusFor(40)).toBeGreaterThan(radiusFor(20));
});

test('R0 fix1（満タン近くでしか撃退できない）: knee（97%）までは前と同じ形で kneeRadius まで、そこから満タンで max へ一気に広がる。単調増加', () => {
  const R = CONFIG.radius, M = CONFIG.power.max;
  expect(R.knee).toBeGreaterThanOrEqual(0.95);
  expect(R.knee).toBeLessThan(1);
  expect(radiusFor(R.knee * M)).toBeCloseTo(R.kneeRadius, 9);
  expect(radiusFor(M)).toBeCloseTo(R.max, 9);
  let prev = -Infinity;
  for (let a = 0; a <= M; a += 0.25) { const r = radiusFor(a); expect(r).toBeGreaterThan(prev); prev = r; }
  // 96% では、軍勢が街で行きうる一番遠い距離（見回る者の帯の外端、街の端 680 m）にまだ届かない
  expect(radiusFor(0.96 * M)).toBeLessThan(CONFIG.cityRadius - 40);
  // 中くらいの一発の形は前（exponent 0.75、max 730）に近い（被害額と演出の大きさを大きく変えない）
  const old = (t) => R.min + (R.max - R.min) * t ** R.exponent;
  for (const t of [0.2, 0.5, 0.8]) expect(radiusFor(t * M) / old(t)).toBeGreaterThan(0.85);
});

test('小爆発で使った分だけ、最後の一発の半径は小さくなる', () => {
  const a = make(), b = make();
  for (const { c } of [a, b]) { c.start(); c.update(20); }
  b.p.spend(CONFIG.puff.cost);
  expect(b.c.release().radius).toBeLessThan(a.c.release().radius);
});

test('createRng は同じシードで同じ列', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const sa = [a(), a(), a(), a()], sb = [b(), b(), b(), b()];
  expect(sa).toEqual(sb); expect(c()).not.toBe(sa[0]);
  for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
});

// R1b（持ち主 08:24「力のパーセントをもう少しわかりやすく」）: HUD の「撃退ライン」の目盛り。
// radiusFor の半径が街の軍勢の一番遠い所（maxEnemyReach）に届く、いちばん少ない力
test('R1b: 撃退ライン（clearThreshold）は半径が maxEnemyReach に届くいちばん少ない力。約 98%', async () => {
  const { clearThreshold } = await import('../../src/game/charge.js');
  const { maxEnemyReach } = await import('../../src/game/enemies.js');
  const L = clearThreshold();
  const reach = maxEnemyReach();
  expect(radiusFor(L)).toBeGreaterThanOrEqual(reach - 1e-6);
  expect(radiusFor(L - 0.01)).toBeLessThan(reach);
  expect(L).toBeGreaterThan(97);
  expect(L).toBeLessThan(99.5);
  // 届く所が knee の半径より内なら、knee より前の曲線を逆にたどる
  const near = { ...CONFIG, radius: { ...CONFIG.radius } };
  const Ln = clearThreshold(near, 300);
  expect(radiusFor(Ln, near)).toBeCloseTo(300, 6);
  expect(Ln).toBeLessThan(CONFIG.radius.knee * 100);
  // 最大の半径でも届かなければ満タン（100）
  expect(clearThreshold(CONFIG, CONFIG.radius.max + 50)).toBe(CONFIG.power.max);
});
