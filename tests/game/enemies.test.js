import { test, expect } from 'vitest';
import { createEnemies, spawnRateAt, approachSpeed } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

const E = CONFIG.enemy;
const cfgWith = (enemy) => ({ ...CONFIG, enemy: { ...E, ...enemy } });

test('軍勢は spawnPerSec で spawnDist の範囲に湧き、speed で近づく', () => {
  const e = createEnemies(createRng(1), cfgWith({ spawnPerSec: 1.2, spawnRamp: 1 }));
  e.update(10); // 約12体
  expect(e.list.length).toBe(12);
  expect(new Set(e.list.map((x) => x.id)).size).toBe(12);
  for (const x of e.list) { expect(x.dist).toBeGreaterThanOrEqual(E.spawnDist[0] - E.speed * 10); expect(x.dist).toBeLessThanOrEqual(E.spawnDist[1]); }
  const e2 = createEnemies(createRng(2), cfgWith({ spawnPerSec: 10 }));
  e2.update(0.1); // 1体、湧いた直後
  const d0 = e2.list[0].dist; expect(d0).toBeGreaterThanOrEqual(E.spawnDist[0]); expect(d0).toBeLessThanOrEqual(E.spawnDist[1]);
  const e3 = createEnemies(createRng(2), cfgWith({ spawnPerSec: 10 }));
  e3.update(0.1);
  const before = e3.list[0].dist; e3.update(0.05);
  expect(e3.list[0].dist).toBeCloseTo(before - E.speed * 0.05);
});
test('grabRange に入ると grab になり、update が掴んでいる数を返す（最大 maxGrabbing）', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 100, spawnDist: [10, 10], speed: 100 }));
  let n = 0;
  for (let i = 0; i < 20; i++) n = e.update(0.1);
  expect(n).toBe(E.maxGrabbing);
  const grab = e.list.filter((x) => x.state === 'grab');
  expect(grab.length).toBe(E.maxGrabbing);
  for (const g of grab) expect(g.dist).toBe(E.grabRange);
  const waiting = e.list.filter((x) => x.state === 'approach' && x.dist === E.grabRange);
  expect(waiting.length).toBeGreaterThan(0);
});
test('applyBlastFront: front 内の軍勢は dead、掴んでいた者も外れる', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 100, spawnDist: [10, 10], speed: 100 }));
  for (let i = 0; i < 5; i++) e.update(0.1);
  const total = e.list.length;
  expect(e.applyBlastFront(1)).toBe(0);
  const killed = e.applyBlastFront(5);
  expect(killed).toBeGreaterThan(0);
  expect(e.list.filter((x) => x.state === 'dead').length).toBe(killed);
  expect(e.list.filter((x) => x.state === 'grab').length).toBe(0);
  expect(e.applyBlastFront(5)).toBe(0); // 二重に数えない
  expect(e.list.length).toBe(total);
  const n = e.update(0.1);
  expect(n).toBeLessThanOrEqual(E.maxGrabbing);
});
test('死んだ敵は deadTime が進み、3秒後に list から消える', () => {
  const e = createEnemies(createRng(4), cfgWith({ spawnPerSec: 10, spawnDist: [50, 50] }));
  e.update(0.1);
  const id = e.list[0].id;
  e.applyBlastFront(100);
  const d = e.list.find((x) => x.id === id); expect(d.deadTime).toBe(0);
  e.update(1); expect(d.deadTime).toBeCloseTo(1);
  e.update(2.1);
  expect(e.list.find((x) => x.id === id)).toBeUndefined();
});

test('湧く速さは時間とともに増え、rampSec（60秒）で spawnRamp 倍（3〜4倍）になり、その後は増えない', () => {
  expect(E.rampSec).toBe(CONFIG.roundSeconds);
  expect(E.spawnRamp).toBeGreaterThanOrEqual(3);
  expect(E.spawnRamp).toBeLessThanOrEqual(4);
  expect(spawnRateAt(0)).toBeCloseTo(E.spawnPerSec);
  expect(spawnRateAt(30)).toBeCloseTo(E.spawnPerSec * (1 + E.spawnRamp) / 2);
  expect(spawnRateAt(60)).toBeCloseTo(E.spawnPerSec * E.spawnRamp);
  expect(spawnRateAt(90)).toBeCloseTo(E.spawnPerSec * E.spawnRamp);
  let prev = 0;
  for (let t = 0; t <= 60; t += 5) { expect(spawnRateAt(t)).toBeGreaterThan(prev); prev = spawnRateAt(t); }
});

test('はじめの10秒より、最後の10秒のほうが3倍近く多く湧く', () => {
  const e = createEnemies(createRng(5), cfgWith({ spawnDist: [500, 500], speed: 0 }));
  for (let i = 0; i < 100; i++) e.update(0.1);
  const first = e.list.length;
  for (let i = 0; i < 400; i++) e.update(0.1);
  const before = e.list.length;
  for (let i = 0; i < 100; i++) e.update(0.1);
  const last = e.list.length - before;
  expect(last / first).toBeGreaterThan(2.6);
  expect(last / first).toBeLessThan(4);
});

test('近づくほど速度を落とす: 遠くでは speed、掴む手前では slowMin 倍まで遅くなる（距離は水平）', () => {
  expect(approachSpeed(E.spawnDist[0])).toBeCloseTo(E.speed);
  expect(approachSpeed(E.grabRange + E.slowDist)).toBeCloseTo(E.speed);
  expect(approachSpeed(E.grabRange)).toBeCloseTo(E.speed * E.slowMin);
  let prev = Infinity;
  for (let d = E.grabRange + E.slowDist; d >= E.grabRange; d -= 0.5) { const v = approachSpeed(d); expect(v).toBeLessThanOrEqual(prev + 1e-9); prev = v; }
  const e = createEnemies(createRng(2), cfgWith({ spawnPerSec: 10 }));
  e.update(0.1);
  const x = e.list[0];
  x.dist = E.grabRange + 1; const before = x.dist;
  e.update(0.02);
  expect(x.dist).toBeCloseTo(before - approachSpeed(before) * 0.02, 6);
});

test('遅くなっても、湧いてから掴むまでの秒は前とほぼ同じ（約 10.5〜14.5 秒）', () => {
  const reach = (d0) => {
    const e = createEnemies(createRng(2), cfgWith({ spawnPerSec: 10, maxGrabbing: 1e9 })); // 先に着いた者で枠が埋まらないように
    e.update(0.1);
    const x = e.list[0]; x.dist = d0;
    let t = 0;
    while (x.state === 'approach' && t < 60) { e.update(1 / 60); t += 1 / 60; }
    return t;
  };
  expect(reach(E.spawnDist[0])).toBeGreaterThan(10.3);
  expect(reach(E.spawnDist[1])).toBeLessThan(14.5);
});

test('掴んだ者は grabTime（掴んでからの秒）が進む（見た目が主人公の横へ寄るのに使う）', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 100, spawnDist: [10, 10], speed: 100 }));
  for (let i = 0; i < 3; i++) e.update(0.1);
  const g = e.list.filter((x) => x.state === 'grab');
  expect(g.length).toBeGreaterThan(0);
  const before = g.map((x) => x.grabTime);
  for (const t of before) expect(t).toBeGreaterThanOrEqual(0);
  e.update(0.05);
  g.forEach((x, i) => expect(x.grabTime).toBeCloseTo(before[i] + 0.05, 9));
  for (const x of e.list.filter((y) => y.state === 'approach')) expect(x.grabTime).toBeUndefined();
});
