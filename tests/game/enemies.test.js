import { test, expect } from 'vitest';
import { createEnemies, spawnRateAt, approachSpeed, lineOfSight, roadNode } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';
import { generateCity, GRID } from '../../src/world/cityGen.js';

const E = CONFIG.enemy;
const cfgWith = (enemy) => ({ ...CONFIG, enemy: { ...E, ...enemy } });
const P = GRID.PITCH;
// 道路の中心線からのずれ（縦・横の近いほう）
const offRoad = (x, z) => {
  const off = (v) => Math.abs(v - (Math.round(v / P - 0.5) + 0.5) * P);
  return Math.min(off(x), off(z));
};
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

test('軍勢は spawnPerSec で、spawnDist ほどの距離の道路の上に湧き、探す（search）', () => {
  const e = createEnemies(createRng(1), cfgWith({ spawnPerSec: 1.2, spawnRamp: 1, searchSpeed: 0, alertRate: 0 }));
  e.update(10); // 約12体
  expect(e.list.length).toBe(12);
  expect(new Set(e.list.map((x) => x.id)).size).toBe(12);
  for (const x of e.list) {
    expect(x.state).toBe('search');
    expect(offRoad(x.x, x.z)).toBeLessThanOrEqual(E.laneSpread + 1e-9);
    expect(x.dist).toBeGreaterThanOrEqual(E.spawnDist[0] - P / 2);
    expect(x.dist).toBeLessThanOrEqual(E.spawnDist[1] + P / 2);
    expect(x.dist).toBeCloseTo(Math.hypot(x.x, x.z), 9);
    expect(x.angle).toBeCloseTo(Math.atan2(x.z, x.x), 9);
  }
});

test('探す: 道路に沿って searchSpeed で飛び、交差点で曲がる（建物の間の道からはみ出さない）', () => {
  const city = generateCity(7);
  const e = createEnemies(createRng(7), CONFIG, { buildings: city.buildings });
  const seen = new Map(); // id → { dx, dz }（縦にも横にも動いたか）
  let maxOff = 0, n = 0, fast = 0;
  for (let i = 0; i < 40 * 30; i++) {
    const before = new Map(e.list.map((x) => [x.id, [x.x, x.z, x.state]]));
    e.update(1 / 30);
    for (const x of e.list) {
      const b = before.get(x.id);
      if (!b || b[2] !== 'search' || x.state !== 'search') continue;
      maxOff = Math.max(maxOff, offRoad(x.x, x.z));
      const v = Math.hypot(x.x - b[0], x.z - b[1]) * 30;
      expect(v).toBeLessThanOrEqual(E.searchSpeed + 1e-6);
      n++; if (v > E.searchSpeed * 0.95) fast++;
      const s = seen.get(x.id) ?? { dx: 0, dz: 0 };
      s.dx += Math.abs(x.x - b[0]); s.dz += Math.abs(x.z - b[1]);
      seen.set(x.id, s);
    }
  }
  expect(maxOff).toBeLessThan(GRID.ROAD / 2);
  expect(fast / n).toBeGreaterThan(0.8); // ほとんどの間は全速
  // 長く探した者は、縦の道にも横の道にも入っている（交差点で曲がる）
  const turned = [...seen.values()].filter((s) => s.dx > P && s.dz > P).length;
  expect(turned).toBeGreaterThan(seen.size * 0.3);
  expect(E.searchSpeed).toBeGreaterThanOrEqual(14);
  expect(E.searchSpeed).toBeLessThanOrEqual(18);
});

test('lineOfSight: 主人公までの線分が建物の足元にさえぎられるか', () => {
  const wall = { x: 20, z: 0, w: 4, d: 10, dist: 20 };
  expect(lineOfSight(40, 0, [wall])).toBe(false);
  expect(lineOfSight(40, 20, [wall])).toBe(true);
  expect(lineOfSight(10, 0, [wall])).toBe(true);  // 建物より手前
  expect(lineOfSight(40, 9, [wall])).toBe(false); // (20, 4.5) で角に当たる
  expect(lineOfSight(40, 9, [wall], 0)).toBe(false);
  expect(lineOfSight(40, 12, [wall], 0)).toBe(true);
  expect(lineOfSight(40, 12, [wall], 1)).toBe(false); // 広げると当たる
});

// 一人だけ置いて動かす（湧かない設定）
function solo(enemy, extra = {}, buildings = []) {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 0, alertRate: 0, ...extra }), { buildings });
  const x = { id: 1, state: 'search', speed: E.searchSpeed, turn: 0, searchTime: 0, lane: [0, 0], ...enemy };
  x.dist = Math.hypot(x.x, x.z); x.angle = Math.atan2(x.z, x.x);
  e.list.push(x);
  return { e, x };
}

test('見つける: spotDist の内側で建物にさえぎられずに見えたら chase。さえぎられていれば探し続ける', () => {
  const [nx] = roadNode(0, 0); // 広場のすぐ外の道（x = 13）
  // 広場のまわりの道を -z へ進む者（主人公が見える）
  const a = solo({ x: nx, z: 20, heading: -Math.PI / 2, ni: 0, nj: -1, di: 0, dj: -1 });
  for (let i = 0; i < 10; i++) a.e.update(1 / 30);
  expect(a.x.state).toBe('chase');
  // 同じ場所でも、間に建物があれば見つけない
  const wall = { x: 6, z: 9, w: 3, d: 3, dist: Math.hypot(6, 9) };
  const b = solo({ x: nx, z: 20, heading: -Math.PI / 2, ni: 0, nj: -1, di: 0, dj: -1 }, { searchSpeed: 0, accel: 0 }, [wall]);
  b.x.speed = 0;
  for (let i = 0; i < 30; i++) b.e.update(1 / 30);
  expect(b.x.state).toBe('search');
  // 遠ければ見えていても見つけない
  const c = solo({ x: E.spotDist + 5, z: 0.5, heading: Math.PI / 2, ni: 1, nj: 0, di: 0, dj: 1 }, { searchSpeed: 0, accel: 0 });
  c.x.speed = 0;
  for (let i = 0; i < 30; i++) c.e.update(1 / 30);
  expect(c.x.state).toBe('search');
});

test('見つけたら: 止まって一拍にらみ、主人公へ一直線に近づき（離れない）、最後に減速して掴む', () => {
  const [nx] = roadNode(0, 0);
  const { e, x } = solo({ x: nx, z: 20, heading: -Math.PI / 2, ni: 0, nj: -1, di: 0, dj: -1 });
  while (x.state === 'search') e.update(1 / 60);
  let prev = x.dist, t = 0, still = 0, top = 0;
  const speeds = [];
  while (x.state === 'chase' && t < 20) {
    e.update(1 / 60); t += 1 / 60;
    // 見つけてから掴むまで、主人公からの距離は一度も増えない（ブレーキで止まる間の惰性も含む）
    expect(x.dist).toBeLessThanOrEqual(prev + 1e-9);
    expect(x.dist).toBeGreaterThanOrEqual(E.grabRange - 1e-9);
    if (x.speed < 0.5) still += 1 / 60;
    if (still > 0) top = Math.max(top, x.speed); // 一拍のあと
    speeds.push([prev, x.speed]); // この一歩の速さは、一歩の前の距離で決まる
    prev = x.dist;
  }
  expect(x.state).toBe('grab');
  expect(x.dist).toBeCloseTo(E.grabRange, 9);
  expect(still).toBeGreaterThanOrEqual(E.spotPause * 0.9); // 見つけた一拍
  expect(top).toBeLessThanOrEqual(E.speed + 1e-9);
  expect(E.speed).toBeGreaterThanOrEqual(8);
  expect(E.speed).toBeLessThanOrEqual(10);
  // 減速の曲線より速くない（最後の数 m で減速する）
  for (const [d, v] of speeds) if (d < E.grabRange + E.slowDist && v > 0) expect(v).toBeLessThanOrEqual(approachSpeed(d) + 1e-9);
});

test('grabRange に入ると grab になり、update が掴んでいる数を返す（最大 maxGrabbing）。あふれた者は queueDist で待ち、枠が空けば寄って掴む', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 100, spawnDist: [10, 10], speed: 100, slowMin: 1, chaseAccel: 1e4 }));
  let n = 0;
  for (let i = 0; i < 20; i++) n = e.update(0.1);
  expect(n).toBe(E.maxGrabbing);
  const grab = e.list.filter((x) => x.state === 'grab');
  expect(grab.length).toBe(E.maxGrabbing);
  for (const g of grab) expect(g.dist).toBeCloseTo(E.grabRange, 9);
  const waiting = e.list.filter((x) => x.state === 'chase' && Math.abs(x.dist - E.queueDist) < 1e-9);
  expect(waiting.length).toBeGreaterThan(0);
  expect(E.queueDist).toBeGreaterThan(E.grabRange);
  // 掴んでいた一人が倒れると、待っていた一人が（離れずに）寄って掴む
  const w = waiting[0];
  grab[0].state = 'dead'; grab[0].deadTime = 0;
  let prev = w.dist;
  for (let i = 0; i < 60 && w.state !== 'grab'; i++) {
    e.update(1 / 60);
    expect(w.dist).toBeLessThanOrEqual(prev + 1e-9);
    prev = w.dist;
  }
  expect(w.state).toBe('grab');
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

test('倒れた者は動かない。角度と距離だけで置かれた者（approach）も近づいて掴む', () => {
  const e = createEnemies(createRng(4), cfgWith({ spawnPerSec: 0 }));
  e.list.push({ id: 1, angle: 1, dist: 6, state: 'approach' }, { id: 2, angle: 2, dist: 8, state: 'dead', deadTime: 0 });
  e.update(0.05);
  const d = e.list[1]; const pos = [d.x, d.z, d.dist];
  for (let i = 0; i < 120; i++) e.update(1 / 30);
  expect(e.list[0].state).toBe('grab');
  expect(e.list[0].angle).toBeCloseTo(1, 6);
  expect([d.x, d.z, d.dist]).toEqual(pos);
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
  const e = createEnemies(createRng(5), cfgWith({ spawnDist: [500, 500], searchSpeed: 0, accel: 0 }));
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
  expect(approachSpeed(E.spotDist)).toBeCloseTo(E.speed);
  expect(approachSpeed(E.grabRange + E.slowDist)).toBeCloseTo(E.speed);
  expect(approachSpeed(E.grabRange)).toBeCloseTo(E.speed * E.slowMin);
  let prev = Infinity;
  for (let d = E.grabRange + E.slowDist; d >= E.grabRange; d -= 0.5) { const v = approachSpeed(d); expect(v).toBeLessThanOrEqual(prev + 1e-9); prev = v; }
});

// 本物の街で、湧いてから掴むまでの秒（払わず、掴む枠は無制限）
function reachTimes(seeds) {
  const out = [];
  out.back = 0; // 見つけたあと（chase）に主人公から離れた距離の最大
  for (const seed of seeds) {
    const city = generateCity(seed);
    const e = createEnemies(createRng(seed + 1), cfgWith({ maxGrabbing: 1e9 }), { buildings: city.buildings });
    const born = new Map(), done = new Set(), last = new Map();
    for (let t = 0; t < 59; t += 1 / 30) {
      e.update(1 / 30);
      for (const x of e.list) {
        if (x.state === 'chase' && last.has(x.id)) out.back = Math.max(out.back, x.dist - last.get(x.id));
        if (x.state === 'chase') last.set(x.id, x.dist); else last.delete(x.id);
        if (!born.has(x.id)) born.set(x.id, t);
        if (x.state === 'grab' && !done.has(x.id)) { done.add(x.id); out.push(t - born.get(x.id)); }
      }
    }
  }
  return out;
}

test('届くまでの秒の分布: 中央は前（一直線に近づいた頃の約 12 秒）と同じほど。探し回る分だけ長い者もいるが、迷い続けない', () => {
  const ts = reachTimes([1, 2, 3, 4, 5, 6]);
  expect(ts.length).toBeGreaterThan(300);
  const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
  expect(mean).toBeGreaterThan(10.5); // 前は平均 12.3 秒（10.7〜14 秒）
  expect(mean).toBeLessThan(14);
  expect(q(ts, 0.5)).toBeGreaterThan(9.5);
  expect(q(ts, 0.5)).toBeLessThan(13.5);
  expect(q(ts, 0.1)).toBeGreaterThan(7);
  expect(q(ts, 0.9)).toBeLessThan(23);
  expect(Math.max(...ts)).toBeLessThan(35);
  expect(ts.back).toBeLessThanOrEqual(1e-9); // 見つけてからは一度も離れない
});
