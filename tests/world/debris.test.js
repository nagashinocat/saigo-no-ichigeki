import { test, expect } from 'vitest';
import { createDebrisPool, pushVelocity, DEBRIS } from '../../src/world/debris.js';
import { createRng } from '../../src/rng.js';

const chunk = (over = {}) => ({ pos: [0, 50, 0], vel: [0, 0, 0], size: 2, ...over });
const run = (pool, sec, step = 1 / 60) => {
  const dust = [];
  for (let t = 0; t < sec; t += step) dust.push(...pool.update(step));
  return dust;
};

test('capacity を超えると一番古い破片から置き換える', () => {
  const pool = createDebrisPool(3, createRng(1));
  for (let i = 0; i < 5; i++) pool.spawn(chunk({ pos: [i, 50, 0] }));
  expect(pool.count).toBe(3);
  const xs = [...pool.active.subarray(0, pool.count)].map((s) => pool.data.px[s]).sort();
  expect(xs).toEqual([2, 3, 4]);
});

test('破片は重力で落ち、地面 y=0 で止まって弾む', () => {
  const pool = createDebrisPool(4, createRng(1));
  pool.spawn(chunk({ pos: [0, 30, 0], size: 1 }));
  const s = pool.active[0];
  pool.update(0.5);
  expect(pool.data.vy[s]).toBeLessThan(-4); // 落ち始めている
  let minY = Infinity, bounced = false, prevVy = 0;
  for (let t = 0; t < 4; t += 1 / 60) {
    pool.update(1 / 60);
    if (pool.count === 0) break;
    minY = Math.min(minY, pool.data.py[s]);
    if (prevVy < -3 && pool.data.vy[s] > 0) bounced = true;
    prevVy = pool.data.vy[s];
  }
  expect(minY).toBeGreaterThanOrEqual(0);
  expect(bounced).toBe(true);
});

test('一定の距離か時間を過ぎた破片は DustEvent を出して消える', () => {
  // 距離: 横に速く飛ぶ
  let pool = createDebrisPool(4, createRng(1));
  pool.spawn(chunk({ pos: [0, 100, 0], vel: [50, 0, 0], size: 3 }));
  let dust = run(pool, 2);
  expect(dust.length).toBe(1);
  expect(dust[0].size).toBe(3);
  expect(Math.hypot(dust[0].pos[0], dust[0].pos[1] - 100, dust[0].pos[2])).toBeGreaterThan(DEBRIS.maxTravel);
  expect(pool.count).toBe(0);
  // 時間: その場に落ちて地面で止まる
  pool = createDebrisPool(4, createRng(1));
  pool.spawn(chunk({ pos: [0, 2, 0], size: 1 }));
  dust = run(pool, 4.5);
  expect(dust.length).toBe(1);
  expect(pool.count).toBe(0);
});

test('pushVelocity は中心から外向き、上向き成分を持つ', () => {
  const rng = createRng(7);
  for (let i = 0; i < 200; i++) {
    const c = [30 + rng() * 200, 5 + rng() * 40, -50 + rng() * 100];
    const v = pushVelocity(c, 100 + rng() * 300, rng);
    expect(v[0] * c[0] + v[2] * c[2]).toBeGreaterThan(0);
    expect(v[1]).toBeGreaterThanOrEqual(8);
    expect(v[1]).toBeLessThanOrEqual(30);
    const h = Math.hypot(v[0], v[2]);
    expect(h).toBeGreaterThanOrEqual(25 - 1e-9);
    expect(h).toBeLessThanOrEqual(60 + 1e-9);
  }
});
