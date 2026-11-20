import { test, expect } from 'vitest';
import { createDebrisPool, pushVelocity, crushVelocity, DEBRIS } from '../../src/world/debris.js';
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

test('上限で古い破片を置き換えるときも、消える破片は次の update で DustEvent になる', () => {
  const pool = createDebrisPool(3, createRng(1));
  for (let i = 0; i < 5; i++) pool.spawn(chunk({ pos: [i, 50, 0], size: 1 + i }));
  const dust = pool.update(1 / 60);
  expect(dust).toHaveLength(2);
  expect(dust.map((e) => e.pos[0]).sort()).toEqual([0, 1]);
  expect(dust.map((e) => e.size).sort()).toEqual([1, 2]);
  expect(pool.update(1 / 60)).toHaveLength(0);
});

test('crushVelocity は外向き 8〜25 m/s、上向き 2〜10 m/s（押しつぶされた破片は表面に沿ってゆっくり流れる）', () => {
  const rng = createRng(11);
  expect(DEBRIS.crushHorizontal).toEqual([8, 25]);
  expect(DEBRIS.crushUpward).toEqual([2, 10]);
  for (let i = 0; i < 300; i++) {
    const c = [-200 + rng() * 400, rng() * 60, -200 + rng() * 400];
    const v = crushVelocity(c, rng);
    expect(v[0] * c[0] + v[2] * c[2]).toBeGreaterThan(0);
    expect(v[1]).toBeGreaterThanOrEqual(2);
    expect(v[1]).toBeLessThanOrEqual(10);
    const h = Math.hypot(v[0], v[2]);
    expect(h).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(h).toBeLessThanOrEqual(25 + 1e-9);
  }
});

test('えぐれた地面の上の破片は、穴の底（球の面）まで落ちる', () => {
  const pool = createDebrisPool(4, createRng(1));
  pool.setCrater(100);
  pool.spawn(chunk({ pos: [96, 5, 0], size: 1 }));
  const s = pool.active[0];
  let minY = Infinity;
  for (let t = 0; t < 3.5 && pool.count; t += 1 / 60) { pool.update(1 / 60); if (pool.count) minY = Math.min(minY, pool.data.py[s]); }
  // r=96 の穴の深さは sqrt(100²-96²)=28。破片の半分の厚みより下へは行かない
  const depth = Math.sqrt(100 * 100 - 96 * 96);
  expect(minY).toBeLessThan(-depth + 2);
  expect(minY).toBeGreaterThanOrEqual(-depth + 0.5 - 1e-4);
  // 穴の外は今までどおり y=0 で止まる
  const p2 = createDebrisPool(4, createRng(1));
  p2.setCrater(100);
  p2.spawn(chunk({ pos: [150, 5, 0], size: 1 }));
  const s2 = p2.active[0];
  let min2 = Infinity;
  for (let t = 0; t < 2; t += 1 / 60) { p2.update(1 / 60); if (p2.count) min2 = Math.min(min2, p2.data.py[s2]); }
  expect(min2).toBeGreaterThanOrEqual(0);
});
