import { test, expect } from 'vitest';
import { createGame, heroSpeedFactor } from '../../src/game/game.js';
import { createEnemies, lineOfSight, maxEnemyReach, maxEnemyReachFrom } from '../../src/game/enemies.js';
import { createReplaySim, replayTargets } from '../../src/game/replaySim.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// M1（持ち主 09:11 / 09:15、spec §16）: 主人公が動く。爆心は放った瞬間の主人公の位置
const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 } } };
const DT = 1 / 30;
const step = (g, sec) => { for (let t = 0; t < sec - 1e-9; t += DT) g.update(DT); };
const H = CONFIG.hero;
// ビルの足元（主人公の半径だけ広げた四角）の内か
const inside = (g, x, z) => g.city.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + H.radius - 1e-6 && Math.abs(z - b.z) < b.d / 2 + H.radius - 1e-6);

// R1d（持ち主 13:36「キャラクターの移動速度をかなり上げよう」）: 約 2 倍の 22 m/s。軍勢の突っ込む速さ（32 m/s）よりは遅いまま
test('M1 / R1d: 速さの値は config にある（22 m/s、軍勢の突っ込む速さより遅い。掴まれる 1 人ごとに 20%、下限 40%）。操作の値も（長押し 0.18 秒・タップは 10 px 未満）', () => {
  expect(H.speed).toBe(22);
  expect(H.speed).toBeLessThan(CONFIG.enemy.speed); // 軍勢の突っ込む速さより遅い
  expect(H.speed).toBeLessThan(CONFIG.enemy.searchSpeed); // 探す速さよりも遅い
  expect(H.grabSlow).toBe(0.2);
  expect(H.minSpeedFrac).toBe(0.4);
  expect(CONFIG.controls.longPressSec).toBe(0.18);
  expect(CONFIG.controls.tapMovePx).toBe(10);
  expect([0, 1, 2, 3, 4, 6].map((n) => heroSpeedFactor(n))).toEqual([1, 0.8, 0.6, 0.4, 0.4, 0.4].map((v) => expect.closeTo(v, 9)));
});

test('M1: 溜めていない（1 本目の指がない）ときは動かない。溜めている間だけ、なめらかに加速して speed で進む', () => {
  const g = createGame({ seed: 3, cfg: quiet });
  g.begin();
  g.setMove(0, -1);
  step(g, 1);
  expect(g.hero.x).toBe(0);
  expect(g.hero.z).toBe(0);
  g.pressStart();
  g.update(DT);
  const v1 = Math.hypot(g.hero.vx, g.hero.vz);
  expect(v1).toBeGreaterThan(0);
  expect(v1).toBeLessThan(H.speed * 0.5); // 一気に全速にならない
  // R1d: 加速も速い（約 0.25 秒で全速の 9 割より上）
  step(g, 0.25 - DT);
  expect(Math.hypot(g.hero.vx, g.hero.vz)).toBeGreaterThan(H.speed * 0.9);
  step(g, 0.35);
  expect(Math.hypot(g.hero.vx, g.hero.vz)).toBeCloseTo(H.speed, 0);
  expect(g.hero.z).toBeLessThan(-4);
  // 離した（溜めをやめた）ら止まっていく
  g.pressCancel();
  step(g, 1);
  expect(Math.hypot(g.hero.vx, g.hero.vz)).toBeLessThan(0.2);
  // 体は進む向きを向く（heading は x 軸から z 軸へ。-z へ進んだ）
  expect(Math.abs(Math.atan2(Math.sin(g.hero.heading + Math.PI / 2), Math.cos(g.hero.heading + Math.PI / 2)))).toBeLessThan(0.05);
});

test('M1: ビルの足元は通り抜けず、壁に沿って滑る。斜めに押し続けても、どのフレームでも足元の外', () => {
  const g = createGame({ seed: 5, cfg: quiet });
  g.pressStart();
  let slid = 0;
  // 斜めにいろいろな向きへ 25 秒動き回る（広場から通りへ、ビルの壁にぶつかる）
  for (let i = 0; i < 25 * 30; i++) {
    const a = Math.floor(i / 60) * 1.1 + 0.4;
    g.setMove(Math.cos(a), Math.sin(a));
    const x0 = g.hero.x, z0 = g.hero.z;
    g.update(DT);
    expect(inside(g, g.hero.x, g.hero.z), `frame ${i}`).toBe(false);
    const d = Math.hypot(g.hero.x - x0, g.hero.z - z0);
    // 斜めに押して進めた距離が全速の一歩より短いのに止まってはいない: 壁に沿って滑った
    if (d > 0.05 && d < H.speed * DT * 0.9 && Math.hypot(g.hero.vx, g.hero.vz) > 1) slid++;
  }
  expect(slid).toBeGreaterThan(5);
  expect(Math.hypot(g.hero.x, g.hero.z)).toBeGreaterThan(20); // 広場から出ている
});

// R1d: 速くなっても、一歩が主人公の半径より長いときは刻んで動かす（薄いビルの足元を一歩で飛び越えない）
test('R1d: 一歩が長くても（大きな dt・22 m/s）薄いビルの足元を通り抜けない。一歩を主人公の半径以下に刻む', async () => {
  const { createHeroMotion } = await import('../../src/game/hero.js');
  // 主人公の前（+x の 3 m 先）に、厚さ 0.2 m の薄い壁（足元は半径 1.2 m ずつ広がって 2.6 m）
  const city = { radius: 680, buildings: [{ x: 3, z: 0, w: 0.2, d: 400, h: 10 }] };
  for (const dt of [1 / 30, 0.1, 0.25, 0.5]) {
    const m = createHeroMotion(city, CONFIG);
    m.setMove(1, 0);
    m.hero.vx = H.speed; // もう全速
    for (let i = 0; i < 20; i++) {
      m.update(dt);
      expect(m.hero.x, `dt ${dt} step ${i}`).toBeLessThanOrEqual(3 - 0.1 - H.radius + 1e-9);
    }
    expect(m.hero.x).toBeCloseTo(3 - 0.1 - H.radius, 6); // 壁に当たって止まっている
  }
  // 斜めに当たれば、壁に沿って滑る（z へは進む）
  const m = createHeroMotion(city, CONFIG);
  m.setMove(Math.SQRT1_2, Math.SQRT1_2);
  for (let i = 0; i < 10; i++) m.update(0.25);
  expect(m.hero.x).toBeLessThanOrEqual(3 - 0.1 - H.radius + 1e-9);
  expect(m.hero.z).toBeGreaterThan(10);
});

test('M1: 街から出ない（中心から cityRadius − edgePad より外へ行けない）', () => {
  const g = createGame({ seed: 2, cfg: quiet });
  g.pressStart();
  // 通りに沿って +x へ（広場の中心を通る行は道路ではないので、道路の z へ寄せてから）
  g.hero.z = 13; // 広場を囲む道（中心線 13 m）
  g.setMove(1, 0);
  let max = 0;
  for (let i = 0; i < 70 * 30; i++) { g.update(DT); max = Math.max(max, Math.hypot(g.hero.x, g.hero.z)); if (g.phase !== 'playing') break; }
  expect(max).toBeLessThanOrEqual(CONFIG.cityRadius - H.edgePad + 1e-6);
  expect(max).toBeGreaterThan(CONFIG.cityRadius - H.edgePad - 30);
});

test('M1: 掴んでいる者の数だけ遅くなる（1 人で 80%、下限 40%）', () => {
  const g = createGame({ seed: 4, cfg: quiet });
  g.pressStart();
  g.hero.z = 13; g.setMove(1, 0);
  step(g, 1);
  const free = Math.hypot(g.hero.vx, g.hero.vz);
  // 二人に掴ませる（主人公のそばに置く）
  for (let k = 0; k < 2; k++) g.enemies.list.push({ id: 900 + k, x: g.hero.x + 1, z: g.hero.z + (k ? 1 : -1), state: 'grab', speed: 15, heading: 0, turn: 0, grabTime: 1 });
  step(g, 1.5);
  expect(g.grabbing).toBe(2);
  expect(Math.hypot(g.hero.vx, g.hero.vz)).toBeCloseTo(free * 0.6, 0);
});

test('M1: 爆心は放った瞬間の主人公の位置。放ったあとは動かない', () => {
  const g = createGame({ seed: 6, cfg: quiet });
  const shots = [];
  g.on('shot', (s) => shots.push(s));
  g.pressStart();
  g.hero.z = 13; g.setMove(1, 0);
  step(g, 4);
  const at = { x: g.hero.x, z: g.hero.z };
  expect(at.x).toBeGreaterThan(20);
  g.power.add(50);
  g.pressEnd();
  expect(shots[0].centre).toEqual(at);
  g.setMove(-1, 0);
  step(g, 3);
  expect(g.hero.x).toBe(at.x);
  expect(g.blasts.every((b) => b.shot.centre.x === at.x && b.shot.centre.z === at.z)).toBe(true);
});

test('M1: 中心から外れた所で放った一発は、その点から半径の内の軍勢だけを倒す（S9 の勝ち負けも、その点からの距離）', () => {
  const g = createGame({ seed: 8, cfg: quiet });
  g.pressStart();
  g.hero.z = 13; g.setMove(1, 0);
  step(g, 6);
  const c = { x: g.hero.x, z: g.hero.z };
  expect(Math.hypot(c.x, c.z)).toBeGreaterThan(50);
  const amount = 30, R = radiusFor(amount);
  // 爆心のまわりと、原点のまわり（爆心からは遠い）に軍勢を置く
  const put = [];
  for (let k = 0; k < 24; k++) {
    const a = k * 0.7, d = R * (0.3 + 1.4 * (k / 24));
    put.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d });
  }
  // 爆心の反対側、爆心から R + 10 m（原点からなら半径の内だが、爆心からは外）
  const L = Math.hypot(c.x, c.z);
  put.push({ x: c.x - (c.x / L) * (R + 10), z: c.z - (c.z / L) * (R + 10) });
  expect(Math.hypot(put.at(-1).x, put.at(-1).z)).toBeLessThan(R);
  put.forEach((p, k) => g.enemies.list.push({ id: 5000 + k, x: p.x, z: p.z, patrol: true, state: 'search', speed: 0, heading: 0, turn: 0, lane: [0, 0], ni: 0, nj: 0, di: 1, dj: 0 }));
  g.power.take(); g.power.add(amount);
  g.pressEnd();
  g.settle();
  const within = (p) => Math.hypot(p.x - c.x, p.z - c.z) <= R;
  for (const [k, p] of put.entries()) {
    const e = g.enemies.list.find((x) => x.id === 5000 + k);
    expect(e.state === 'dead', `rider ${k} at ${Math.hypot(p.x - c.x, p.z - c.z).toFixed(1)} m (R ${R.toFixed(1)})`).toBe(within(p));
  }
  const survivors = new Set(g.outcome.survivors.map((s) => s.id));
  for (const [k, p] of put.entries()) expect(survivors.has(5000 + k)).toBe(!within(p));
  expect(g.outcome.clear).toBe(false);
  expect(survivors.has(5000 + put.length - 1)).toBe(true);
});

test('M1: 中心から外れた一発でも、壊れるビルは爆心からの距離の順（半径の内だけ）', () => {
  const g = createGame({ seed: 9, cfg: quiet });
  const hits = [];
  g.on('hit', ({ hit, target }) => hits.push({ id: hit.id, d: Math.hypot(target.x - c.x, target.z - c.z) }));
  g.pressStart();
  g.hero.z = 13; g.setMove(1, 0);
  step(g, 6);
  const c = { x: g.hero.x, z: g.hero.z };
  g.power.take(); g.power.add(40);
  const R = radiusFor(40);
  g.pressEnd();
  g.settle();
  const bs = hits.filter((h) => h.id[0] === 'b');
  expect(bs.length).toBeGreaterThan(10);
  for (const h of bs) expect(h.d).toBeLessThanOrEqual(R + 1e-6);
  // 原点（街の中心）のそばの、爆心から半径より遠いビルは壊れない
  const far = g.city.buildings.filter((b) => Math.hypot(b.x - c.x, b.z - c.z) > R + 5);
  const hitIds = new Set(bs.map((h) => h.id));
  for (const b of far) expect(hitIds.has('b' + b.id)).toBe(false);
});

test('M1: 動いた主人公でもリプレイは同じ: 写しの爆心から、本物と同じ命中が同じ順に起き、軍勢も同じ者が倒れる', () => {
  const run = () => {
    const g = createGame({ seed: 11 });
    const hits = [];
    g.on('hit', ({ hit }) => hits.push(hit.id + ':' + hit.kind));
    let shot = null, snap = null;
    g.on('shot', (s) => { shot = s; snap = g.enemies.list.map((e) => ({ ...e })); });
    g.pressStart();
    g.hero.z = 13;
    for (let i = 0; i < 12 * 30; i++) { g.setMove(1, i > 200 ? 0.6 * Math.sin(i / 20) : 0); if (g.grabbing) g.puff(); g.update(DT); }
    g.power.take(); g.power.add(45);
    g.pressEnd();
    g.settle();
    return { g, hits, shot, snap };
  };
  const a = run(), b = run();
  expect(a.shot.centre).toEqual(b.shot.centre);
  expect(Math.hypot(a.shot.centre.x, a.shot.centre.z)).toBeGreaterThan(30);
  const sim = createReplaySim({ shot: a.shot, targets: replayTargets(a.g.city, a.shot.centre), enemies: a.snap });
  const got = [];
  while (!sim.done) for (const e of sim.step(1 / 24)) got.push(e.hit.id + ':' + e.hit.kind);
  expect(got).toEqual(a.hits);
  const deadGame = new Set(a.g.enemies.list.filter((e) => e.state === 'dead').map((e) => e.id));
  const deadSim = new Set(sim.enemies.filter((e) => e.state === 'dead').map((e) => e.id));
  for (const e of a.snap) if (e.state !== 'dead') expect(deadSim.has(e.id), `enemy ${e.id}`).toBe(deadGame.has(e.id));
});

test('M1: 軍勢は動いた主人公のまわりに湧き、主人公の今の位置へ突っ込んで掴む（heroPos）', () => {
  const hero = { x: 180, z: -97 };
  const cfg = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 2, surgeMul: 1, alertAtSpawn: 1, alertRate: 1 } };
  const e = createEnemies(createRng(3), cfg, { heroPos: hero });
  e.update(1.5);
  expect(e.list.length).toBeGreaterThan(1);
  for (const x of e.list) {
    expect(x.dist).toBeCloseTo(Math.hypot(x.x - hero.x, x.z - hero.z), 9);
    expect(x.dist).toBeLessThan(CONFIG.enemy.spawnDist[1] + 30);
  }
  for (let i = 0; i < 20 * 30 && !e.list.some((x) => x.state === 'grab'); i++) e.update(DT);
  const g = e.list.find((x) => x.state === 'grab');
  expect(g).toBeTruthy();
  expect(Math.hypot(g.x - hero.x, g.z - hero.z)).toBeLessThanOrEqual(CONFIG.enemy.grabRange + 1e-6);
  // 主人公が動くと、掴んでいる者はついてくる（掴んだまま）
  hero.x += 5;
  e.update(DT);
  expect(Math.hypot(g.x - hero.x, g.z - hero.z)).toBeLessThanOrEqual(CONFIG.enemy.grabRange + 1e-6);
});

test('M1: lineOfSight は主人公の位置（hx, hz）までの線分を見る', () => {
  const b = [{ x: 100, z: 0, w: 10, d: 10 }];
  expect(lineOfSight(80, 0, b, 0, 120, 0)).toBe(false);
  expect(lineOfSight(80, 0, b, 0, 90, 0)).toBe(true);
  expect(lineOfSight(80, 20, b, 0, 120, 20)).toBe(true);
  // 省けば原点（前のまま）
  expect(lineOfSight(200, 0, b)).toBe(false);
});

test('M1: 最大溜めで必ず撃退できるのは街の中心のそばだけ（maxEnemyReachFrom: 中心から離れるほど、反対側の見回る者が遠い）', () => {
  expect(maxEnemyReachFrom(CONFIG, 0)).toBe(maxEnemyReach(CONFIG));
  expect(maxEnemyReachFrom(CONFIG, 100)).toBeCloseTo(maxEnemyReach(CONFIG) + 100, 6);
  // 最大の半径が届く、中心からの距離（約 45 m）
  const safe = CONFIG.radius.max - maxEnemyReach(CONFIG);
  expect(safe).toBeGreaterThan(20);
  expect(maxEnemyReachFrom(CONFIG, safe - 1)).toBeLessThan(CONFIG.radius.max);
  expect(maxEnemyReachFrom(CONFIG, safe + 60)).toBeGreaterThan(CONFIG.radius.max);
});
