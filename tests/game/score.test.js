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

// R2（spec §15 ギリギリのボーナス）: 放ったときの残り時間が少ないほど、主人公のすぐそば（15 m の内）まで迫った軍勢が多いほど、被害額に倍率
import { timeBonus, closeBonus, releaseBonus } from '../../src/game/score.js';
test('R2: 残り時間の倍率 ×(1 + 0.5·clamp((10 − 残り)/10, 0, 1))', () => {
  expect(timeBonus(60)).toBe(1);
  expect(timeBonus(10)).toBe(1);
  expect(timeBonus(5)).toBeCloseTo(1.25, 12);
  expect(timeBonus(1)).toBeCloseTo(1.45, 12);
  expect(timeBonus(0)).toBe(1.5);
  expect(timeBonus(-3)).toBe(1.5);
});
test('R2: すぐそばの倍率 1 体ごとに +4%、+40% で頭打ち', () => {
  expect(closeBonus(0)).toBe(1);
  expect(closeBonus(1)).toBeCloseTo(1.04, 12);
  expect(closeBonus(6)).toBeCloseTo(1.24, 12);
  expect(closeBonus(10)).toBeCloseTo(1.4, 12);
  expect(closeBonus(37)).toBeCloseTo(1.4, 12);
});
test('R2: 二つの倍率は掛け合わせる（内訳つき）', () => {
  const b = releaseBonus({ timeLeft: 2, near: 5 });
  expect(b).toEqual({ timeLeft: 2, near: 5, timeMul: timeBonus(2), closeMul: closeBonus(5), mul: timeBonus(2) * closeBonus(5) });
  expect(b.mul).toBeCloseTo(1.4 * 1.2, 12);
  expect(releaseBonus({ timeLeft: 30, near: 0 }).mul).toBe(1);
});
test('R2: addBonus は被害額に足す（倍率の分）', () => {
  const s = createScore();
  const base = s.addShot([100, 100]);
  s.addBonus(base * 0.5);
  expect(s.total).toBeCloseTo(base * 1.5, 9);
});
