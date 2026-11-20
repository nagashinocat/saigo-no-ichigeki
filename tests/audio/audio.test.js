import { test, expect } from 'vitest';
import { boomDelay, createCrumbleGate, CRUMBLE_GAP_SEC } from '../../src/audio/audio.js';

test('無音の間に弾ける爆発は、無音が明けるまで待つ', () => {
  expect(boomDelay(10.34, 10.05)).toBeCloseTo(0.29);
});
test('無音が明けていれば待たない', () => {
  expect(boomDelay(10, 10.5)).toBe(0);
});

test('崩落の音は約 50 ms に一度だけ鳴り、その間の命中はまとめて次の一回に足す', () => {
  expect(CRUMBLE_GAP_SEC).toBeCloseTo(0.05);
  const gate = createCrumbleGate();
  expect(gate.take(3, 1.0)).toBe(3);
  expect(gate.take(5, 1.016)).toBe(0);
  expect(gate.take(4, 1.033)).toBe(0);
  expect(gate.take(2, 1.05)).toBe(11);
  expect(gate.take(0, 1.2)).toBe(0); // 溜まっていなければ鳴らさない
  expect(gate.take(1, 1.21)).toBe(1);
  // 60 fps で毎フレーム命中しても、1 秒に鳴るのは 20 回ほど
  const g2 = createCrumbleGate();
  let n = 0;
  for (let i = 0; i < 60; i++) if (g2.take(10, i / 60) > 0) n++;
  expect(n).toBeLessThanOrEqual(21);
});
