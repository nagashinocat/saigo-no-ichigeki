import { test, expect } from 'vitest';
import { createRateLimit, GUARD_CUE_MAX_PER_SEC } from '../../src/audio/cues.js';

// Fix round 3（見直し Minor D）: 守りで弾く音は 1 秒に GUARD_CUE_MAX_PER_SEC 回（6 回）まで（終盤の群れで「キン」が連打にならない）
test('Fix round 3: 弾く音は 1 秒に 6 回まで。間が空けばまた鳴る', () => {
  expect(GUARD_CUE_MAX_PER_SEC).toBeLessThanOrEqual(6);
  const lim = createRateLimit(GUARD_CUE_MAX_PER_SEC);
  let n = 0;
  for (let i = 0; i < 100; i++) if (lim(i * 0.01)) n++; // 1 秒に 100 回呼ぶ
  expect(n).toBeLessThanOrEqual(6);
  expect(n).toBeGreaterThanOrEqual(5);
  expect(lim(5)).toBe(true);
  // 同じフレームに 5 回来ても、鳴るのは 1 回
  const lim2 = createRateLimit(6);
  expect([1, 1, 1, 1, 1].map((t) => lim2(t)).filter(Boolean).length).toBe(1);
});
