import { test, expect } from 'vitest';
import { boomDelay } from '../../src/audio/audio.js';

test('無音の間に弾ける爆発は、無音が明けるまで待つ', () => {
  expect(boomDelay(10.34, 10.05)).toBeCloseTo(0.29);
});
test('無音が明けていれば待たない', () => {
  expect(boomDelay(10, 10.5)).toBe(0);
});
