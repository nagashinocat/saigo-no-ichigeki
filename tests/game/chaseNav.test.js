import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { createNavGrid, createFlowField } from '../../src/game/flowField.js';
import { CONFIG } from '../../src/config.js';

// R1f（持ち主 19:47「見つけたらビル貫通してバイクがくるよ」）: 追う軍勢は通り・広場を走り、ビルを避けて回り込む。
// 原因: chaseStep が主人公へ一直線に向き、ビルの足元を見ていなかった（主人公が通りを渡り角を曲がる道すじで、追う者が足元の内にいたフレームがあった）。
// 直したあと: 見通しがあるときだけ一直線（R0 の突っ込み）。ないときは道しるべ（flowField.js）で回り込む。動いたあとは足元から押し出す
const DT = 1 / 30;
const inside = (bs, x, z) => bs.find((b) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2);
const LEGS = [[0, -1], [1, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [0.7, 0.7], [0, 1], [-1, 0], [0, -1], [-0.7, 0.7], [1, 0]];

test('R1f: 道しるべは足元を通らずに目標へ着き、窓の外は null。作り直しは安い（数 ms 以内）', () => {
  const g = createGame({ seed: 2 });
  const bs = g.city.buildings;
  const nav = createNavGrid(bs, { cell: 2, pad: 0.9 });
  const ff = createFlowField(nav, { half: 64 });
  const b = bs.find((x) => Math.hypot(x.x, x.z) > 40 && Math.hypot(x.x, x.z) < 80);
  // ビルの北の壁のそば → 南の壁のそば（まっすぐはビルを抜ける）
  const T = { x: b.x, z: b.z - b.d / 2 - 2 }, S = { x: b.x, z: b.z + b.d / 2 + 2 };
  ff.build(T.x, T.z);
  let p = S, n = 0;
  while (Math.hypot(p.x - T.x, p.z - T.z) > 1e-6 && n < 200) {
    const q = ff.ahead(p.x, p.z, 1);
    expect(q).not.toBeNull();
    // 一歩の線分の上に足元がない
    for (let u = 0; u <= 1; u += 0.1) expect(inside(bs, p.x + (q.x - p.x) * u, p.z + (q.z - p.z) * u)).toBeUndefined();
    p = q; n++;
  }
  expect(n).toBeGreaterThan(Math.ceil((b.d + 4) / 2)); // 回り込むので、まっすぐより長い
  expect(n).toBeLessThan(200);
  expect(ff.ahead(T.x + 200, T.z, 3)).toBeNull();
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) ff.build(T.x + k, T.z);
  expect((performance.now() - t0) / 20).toBeLessThan(4);
});

test('R1f: 主人公が通りを渡り角を曲がる間、追う者（chase・よろめき）は一度もビルの足元の内に入らない（種 1〜4、毎フレーム）', () => {
  const cfg = { ...CONFIG, puff: { ...CONFIG.puff, uses: Infinity } };
  let chaseFrames = 0;
  const bad = [];
  for (const seed of [1, 2, 3, 4]) {
    const g = createGame({ seed, cfg });
    g.begin(); g.pressStart();
    const bs = g.city.buildings;
    for (let i = 0; i < 40 / DT && g.phase === 'playing'; i++) {
      const [mx, mz] = LEGS[Math.floor((i * DT) / 1.5) % LEGS.length];
      g.setMove(mx, mz);
      if (g.grabbing >= 2) g.puff();
      g.update(DT);
      for (const e of g.enemies.list) {
        if (e.x == null || !['chase', 'approach', 'stagger', 'search'].includes(e.state)) continue;
        if (e.state !== 'search') chaseFrames++;
        const b = inside(bs, e.x, e.z);
        if (b && bad.length < 5) bad.push({ seed, t: +(i * DT).toFixed(2), id: e.id, state: e.state, x: e.x, z: e.z, b: b.id });
      }
    }
  }
  expect(chaseFrames).toBeGreaterThan(1500);
  expect(bad).toEqual([]);
}, 120000);

test('R1f: ビルの向こうで見つけた者は、ビルを回り込んで主人公に着く（足元を抜けずに、数秒の内に）', () => {
  const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 }, kinds: {} } };
  let tried = 0;
  for (const seed of [1, 2, 3]) {
    const g = createGame({ seed, cfg: quiet });
    g.begin(); g.pressStart();
    const bs = g.city.buildings;
    const b = bs.find((x) => Math.hypot(x.x, x.z) > 30 && Math.hypot(x.x, x.z) < 70 && x.d > 10);
    // 主人公はビルの北の壁のそば、追う者は南の壁のそば（間にビル）。追う者は主人公の方（ビルの方）を向いている
    g.hero.x = b.x; g.hero.z = b.z + b.d / 2 + CONFIG.hero.radius + 0.5;
    const r = { id: 990, state: 'chase', x: b.x, z: b.z - b.d / 2 - 2, heading: Math.PI / 2, speed: 30, turn: 0, lane: [0, 0] };
    r.dist = Math.hypot(r.x - g.hero.x, r.z - g.hero.z); r.angle = Math.atan2(r.z - g.hero.z, r.x - g.hero.x);
    r.seenT = 0; r.lastSeen = { x: g.hero.x, z: g.hero.z };
    g.enemies.list.push(r);
    tried++;
    let t = 0;
    for (; t < 3 && !['grab', 'cling'].includes(r.state); t += DT) {
      g.update(DT);
      expect(inside(bs, r.x, r.z)).toBeUndefined();
    }
    expect(['grab', 'cling']).toContain(r.state);
    expect(t).toBeLessThan(2.5);
  }
  expect(tried).toBe(3);
});
