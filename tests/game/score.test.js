import { test, expect } from 'vitest';
import { createScore } from '../../src/game/score.js';

test('一発で多く壊すほど倍率', () => {
  const s = createScore(); expect(s.addShot([100])).toBe(100); expect(s.addShot([100, 100, 100])).toBeCloseTo(300 * 1.2);
});
test('倍率は comboMax で頭打ち', () => {
  const s = createScore(); expect(s.addShot(Array(100).fill(1))).toBeCloseTo(300);
});
test('total は加算され、空の一発は 0', () => {
  const s = createScore(); expect(s.addShot([])).toBe(0); s.addShot([100]); const { addShot } = s; addShot([50, 50]); expect(s.total).toBeCloseTo(100 + 100 * 1.1);
});
