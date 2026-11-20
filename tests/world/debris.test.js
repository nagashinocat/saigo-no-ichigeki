import { test, expect } from 'vitest';
import { createDebrisPool, pushVelocity, crushVelocity, slumpVelocity, DEBRIS } from '../../src/world/debris.js';
import { createRng } from '../../src/rng.js';
import { groundHeight } from '../../src/render/sphereDeform.js';

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
  // ゆるい底（r=40: 傾き 24°）の上。急な壁では滑り落ちる（下の別のテスト）
  const pool = createDebrisPool(4, createRng(1));
  pool.setCrater(100);
  pool.spawn(chunk({ pos: [40, 5, 0], size: 1 }));
  const s = pool.active[0];
  let minY = Infinity, maxD = 0;
  for (let t = 0; t < 6 && pool.count; t += 1 / 60) {
    pool.update(1 / 60);
    if (!pool.count) break;
    minY = Math.min(minY, pool.data.py[s]);
    maxD = Math.max(maxD, Math.hypot(pool.data.px[s], pool.data.py[s], pool.data.pz[s]));
  }
  // r=40 の穴の深さは sqrt(100²-40²)≈91.7 まで落ちる。穴の面（球）から破片の半分の厚みより外へは出ない
  const depth = Math.sqrt(100 * 100 - 40 * 40);
  expect(minY).toBeLessThan(-depth + 2);
  expect(maxD).toBeLessThanOrEqual(100 - 0.5 + 1e-3);
  // 穴の外は今までどおり y=0 で止まる
  const p2 = createDebrisPool(4, createRng(1));
  p2.setCrater(100);
  p2.spawn(chunk({ pos: [150, 5, 0], size: 1 }));
  const s2 = p2.active[0];
  let min2 = Infinity;
  for (let t = 0; t < 2; t += 1 / 60) { p2.update(1 / 60); if (p2.count) min2 = Math.min(min2, p2.data.py[s2]); }
  expect(min2).toBeGreaterThanOrEqual(0);
});

const settle = (pool, sec, step = 1 / 60) => {
  const dust = [], settled = [];
  for (let t = 0; t < sec; t += step) dust.push(...pool.update(step, settled));
  return { dust, settled };
};

test('穴の底や斜面で止まった破片は、土煙ではなく瓦礫として渡す（位置・向き・大きさ・色）', () => {
  const pool = createDebrisPool(4, createRng(1));
  pool.setCrater(100);
  pool.spawn(chunk({ pos: [60, -70, 0], size: 2, dims: [2, 1, 1.5], color: [0.3, 0.2, 0.1] }));
  const { dust, settled } = settle(pool, 4);
  expect(dust).toHaveLength(0);
  expect(settled).toHaveLength(1);
  expect(pool.count).toBe(0);
  const r = settled[0];
  // 穴の面（半径 100 の球）に、厚みの半分だけ内側で止まる。ゆるい面なので遠くへは滑らない
  expect(Math.hypot(...r.pos)).toBeCloseTo(100 - 0.5, 1);
  expect(Math.hypot(r.pos[0], r.pos[2])).toBeGreaterThan(50);
  expect(Math.hypot(r.pos[0], r.pos[2])).toBeLessThanOrEqual(60 + 1e-3);
  expect(r.dims).toEqual([2, 1, 1.5]);
  expect(r.size).toBe(2);
  expect(r.color).toEqual([0.3, 0.2, 0.1].map((v) => Math.fround(v)));
  expect(r.rot).toHaveLength(3);
});

test('穴の外で止まった破片は今までどおり土煙。keep の破片（建物の大きな塊）は穴の外でも瓦礫として残る', () => {
  const pool = createDebrisPool(4, createRng(1));
  pool.setCrater(100);
  pool.spawn(chunk({ pos: [150, 3, 0], size: 1 }));
  pool.spawn(chunk({ pos: [-160, 3, 0], size: 4, keep: true }));
  const { dust, settled } = settle(pool, 4);
  expect(dust.map((e) => e.size)).toEqual([1]);
  expect(settled.map((e) => e.size)).toEqual([4]);
});

test('主人公の真下（r < 4m）に落ちた破片も、穴の底まで落ちて瓦礫として残る（土煙にしない）', () => {
  const pool = createDebrisPool(4, createRng(1));
  pool.setCrater(100);
  pool.spawn(chunk({ pos: [1, 5, 0], size: 1, keep: true }));
  const { dust, settled } = settle(pool, 14);
  expect(dust).toHaveLength(0);
  expect(settled).toHaveLength(1);
  const [x, y, z] = settled[0].pos;
  expect(y).toBeLessThan(-90);
  expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(100);
});

test('深い穴へ落ちていく破片は、時間や距離の上限で途中で消えずに底まで落ちて瓦礫になる', () => {
  const pool = createDebrisPool(4, createRng(1));
  pool.setCrater(440);
  pool.spawn(chunk({ pos: [100, 10, 0], size: 2 }));
  const { dust, settled } = settle(pool, 14);
  expect(dust).toHaveLength(0);
  expect(settled).toHaveLength(1);
  // 穴の面に厚みの半分だけ浮いて止まる
  const [x, y, z] = settled[0].pos;
  expect(y).toBeLessThan(-300);
  expect(y).toBeCloseTo(groundHeight(Math.hypot(x, z), [440]) + 1, 0);
});

test('slumpVelocity は中心向き 3〜18 m/s、上向き 0〜4 m/s（穴の縁から中へ崩れ落ちる）', () => {
  const rng = createRng(5);
  for (let i = 0; i < 300; i++) {
    const c = [-200 + rng() * 400, rng() * 20, -200 + rng() * 400];
    const v = slumpVelocity(c, rng);
    expect(v[0] * c[0] + v[2] * c[2]).toBeLessThan(0);
    expect(v[1]).toBeGreaterThanOrEqual(0);
    expect(v[1]).toBeLessThanOrEqual(4);
    const h = Math.hypot(v[0], v[2]);
    expect(h).toBeGreaterThanOrEqual(3 - 1e-9);
    expect(h).toBeLessThanOrEqual(18 + 1e-9);
  }
});

test('上限で置き換えるとき、瓦礫として残す大きな塊（keep）は後回しにする', () => {
  const pool = createDebrisPool(3, createRng(1));
  pool.spawn(chunk({ pos: [0, 50, 0], size: 9, keep: true }));
  for (let i = 1; i < 6; i++) pool.spawn(chunk({ pos: [i, 50, 0] }));
  expect(pool.count).toBe(3);
  const sizes = [...pool.active.subarray(0, pool.count)].map((s) => pool.data.size[s]);
  expect(sizes).toContain(9);
  // 全部 keep なら古いものから置き換える
  const p2 = createDebrisPool(2, createRng(1));
  for (let i = 0; i < 3; i++) p2.spawn(chunk({ pos: [i, 50, 0], keep: true }));
  const xs = [...p2.active.subarray(0, p2.count)].map((s) => p2.data.px[s]).sort();
  expect(xs).toEqual([1, 2]);
});

test('穴の急な壁（50°より急）では止まらずに滑り落ち、ゆるい底の方で止まって瓦礫になる', () => {
  const pool = createDebrisPool(4, createRng(1));
  pool.setCrater(100);
  pool.spawn(chunk({ pos: [95, -20, 0], size: 1 }));
  const { dust, settled } = settle(pool, 12);
  expect(dust).toHaveLength(0);
  expect(settled).toHaveLength(1);
  const [x, , z] = settled[0].pos;
  const r = Math.hypot(x, z);
  expect(r / Math.sqrt(100 * 100 - r * r)).toBeLessThanOrEqual(DEBRIS.reposeTan + 1e-6);
});
