import { test, expect } from 'vitest';
import { sameRot } from '../../src/render/intro.js';

test('sameRot: 同じ骨・同じ値なら同じ（別の物でも）。値・骨の数・骨の名前が違えば違う', () => {
  const a = { spine: [0.1, 0, 0], head: [0, 0.2, 0] };
  expect(sameRot(a, { spine: [0.1, 0, 0], head: [0, 0.2, 0] })).toBe(true);
  expect(sameRot(a, a)).toBe(true);
  expect(sameRot(a, { spine: [0.1, 0, 0], head: [0, 0.21, 0] })).toBe(false);
  expect(sameRot(a, { spine: [0.1, 0, 0] })).toBe(false);
  expect(sameRot(a, { spine: [0.1, 0, 0], neck: [0, 0.2, 0] })).toBe(false);
  expect(sameRot({ spine: [0.1, 0, 0] }, a)).toBe(false);
  expect(sameRot(a, null)).toBe(false);
});
