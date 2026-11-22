import { test, expect } from 'vitest';
import { createDebrisPool, pushVelocity, crushVelocity, slumpVelocity } from '../../src/world/debris.js';
import { createRubble } from '../../src/world/rubble.js';
import { createRng } from '../../src/rng.js';

// M1（spec §16）: 爆心は放った瞬間の主人公の位置。破片の外向き・穴の面・瓦礫の穴は爆心のまわり
const C = [230, -140];

test('M1: 破片の初速は爆心から外向き（押す・つぶれる）、穴へ崩れ落ちるのは爆心へ向かう', () => {
  const rng = createRng(3);
  for (const [dx, dz] of [[50, 0], [0, -80], [-30, 40]]) {
    const p = [C[0] + dx, 3, C[1] + dz];
    const L = Math.hypot(dx, dz);
    for (const [f, sign] of [[(q) => pushVelocity(q, 100, rng, C), 1], [(q) => crushVelocity(q, rng, C), 1], [(q) => slumpVelocity(q, rng, C), -1]]) {
      const v = f(p);
      const along = (v[0] * dx + v[2] * dz) / (L * Math.hypot(v[0], v[2]));
      expect(sign * along).toBeGreaterThan(0.9); // ばらしは ±0.35 rad
    }
  }
});

test('M1: 穴の上で放した破片は、爆心のまわりの穴の面まで落ちて止まる（原点のまわりではない）', () => {
  const pool = createDebrisPool(8, createRng(5));
  pool.setCentre(C);
  pool.setCrater(60);
  pool.spawn({ pos: [C[0] + 20, 5, C[1] - 10], vel: [0, 0, 0], size: 1, dims: [1, 1, 1], color: [1, 1, 1] });
  const settled = [];
  for (let i = 0; i < 60 * 8 && !settled.length; i++) pool.update(1 / 60, settled);
  expect(settled.length).toBe(1);
  const [x, y, z] = settled[0].pos;
  const d = Math.hypot(x - C[0], y, z - C[1]);
  expect(d).toBeGreaterThan(60 - 1.5);
  expect(d).toBeLessThan(60 + 0.01);
  expect(y).toBeLessThan(-40); // 穴の底のほう
});

test('M1: 瓦礫の穴は爆心のまわり: 穴が広がると、爆心のそばの瓦礫だけが消える', () => {
  const r = createRubble(8);
  r.setLimit(8);
  r.setCentre(C);
  const dust = [];
  const put = (x, z) => r.add({ pos: [x, 0.5, z], rot: [0, 0, 0], dims: [1, 1, 1], size: 1, color: [1, 1, 1], floor: 0 }, dust);
  put(C[0] + 10, C[1]);  // 爆心のそば
  put(5, 5);             // 原点のそば（爆心から遠い）
  const out = r.sweep(40);
  expect(out.length).toBe(1);
  expect(Math.hypot(out[0].pos[0] - C[0], out[0].pos[2] - C[1])).toBeLessThan(15);
});
