import { test, expect } from 'vitest';
import { surfaceNets } from '../../src/render/surfaceNets.js';

// 間隔をそろえない格子（後ろ半分は粗い）で、半径 0.3 の球
const xs = Array.from({ length: 41 }, (_, i) => -0.5 + i * 0.025);
const zs = [];
for (let z = -0.5, h = 0.025; z <= 0.52; z += h, h = z > 0 ? Math.min(0.06, h * 1.2) : h) zs.push(z);
const sphere = (x, y, z) => Math.sqrt(x * x + y * y + z * z) - 0.3;

test('球の面: 頂点は面の近く、面はすべて外向き、すき間のない閉じた網', () => {
  const { positions, indices } = surfaceNets(sphere, xs, xs, zs);
  expect(positions.length / 3).toBeGreaterThan(500);
  for (let i = 0; i < positions.length; i += 3) {
    expect(Math.abs(sphere(positions[i], positions[i + 1], positions[i + 2]))).toBeLessThan(0.03);
  }
  const edges = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => [0, 1, 2].map((c) => positions[indices[t + k] * 3 + c]));
    const u = p[1].map((v, c) => v - p[0][c]), w = p[2].map((v, c) => v - p[0][c]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const centre = p[0].map((v, c) => (v + p[1][c] + p[2][c]) / 3);
    expect(n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2]).toBeGreaterThan(0);
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + (e + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  expect([...edges.values()].every((n) => n === 2)).toBe(true);
});

test('面から遠い塊を省いても、省かないときと同じ網になる', () => {
  let calls = 0;
  const counted = (x, y, z) => { calls++; return sphere(x, y, z); };
  const fast = surfaceNets(counted, xs, xs, zs);
  const fastCalls = calls;
  calls = 0;
  const full = surfaceNets(counted, xs, xs, zs, { lipschitz: Infinity });
  expect(fastCalls).toBeLessThan(calls);
  expect(Array.from(fast.positions)).toEqual(Array.from(full.positions));
  expect(Array.from(fast.indices)).toEqual(Array.from(full.indices));
});
