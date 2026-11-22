import { test, expect } from 'vitest';
import { TIME_LEFT, timeLeftText, isLastSeconds, timeBarFrac, timePulse, timeColor, createTimeTicks } from '../../src/ui/timeLeft.js';

// R1c（持ち主 11:03「制限時間もわかりやすくしよう」）: 上の帯の右に大きな数字と、減っていく細い帯。
// 残り 10 秒から色が琥珀 → 赤へ、数字が 1 秒に 1 回脈打ち、1 秒ごとに短い刻みの音（画面に合わせる: 遊んでいる間だけ）

test('R1c: 大きな数字は残りの秒の切り上げ、帯は全体に対する残りの割合', () => {
  expect(timeLeftText(60)).toBe('60');
  expect(timeLeftText(29.2)).toBe('30');
  expect(timeLeftText(0.01)).toBe('1');
  expect(timeLeftText(0)).toBe('0');
  expect(timeLeftText(-1)).toBe('0');
  expect(timeBarFrac(60, 60)).toBe(1);
  expect(timeBarFrac(30, 60)).toBeCloseTo(0.5, 9);
  expect(timeBarFrac(0, 60)).toBe(0);
  expect(timeBarFrac(99, 60)).toBe(1);
});

test('R1c: 残り 10 秒の状態は、ちょうど 10 秒で切り替わる（数字が 10 になる瞬間）', () => {
  expect(TIME_LEFT.last).toBe(10);
  expect(isLastSeconds(10.0001)).toBe(false);
  expect(isLastSeconds(10)).toBe(true);
  expect(isLastSeconds(9.99)).toBe(true);
  expect(isLastSeconds(0)).toBe(true);
  expect(timeLeftText(10.0001)).toBe('11');
  expect(timeLeftText(10)).toBe('10');
});

test('R1c: 色は残り 10 秒の前は無し（ふだんの白）、10 秒で琥珀、0 へ近づくほど赤', () => {
  expect(timeColor(30)).toBe(null);
  expect(timeColor(10.0001)).toBe(null);
  const [r10, g10, b10] = timeColor(10);
  const [r1, g1] = timeColor(1);
  expect(r10).toBeGreaterThan(200); expect(g10).toBeGreaterThan(140); expect(b10).toBeLessThan(120); // 琥珀
  expect(r1).toBeGreaterThan(200); expect(g1).toBeLessThan(90); // 赤
  for (let r = 10; r > 0.5; r -= 0.5) expect(timeColor(r - 0.5)[1]).toBeLessThanOrEqual(timeColor(r)[1]);
});

test('R1c: 脈打ちは残り 10 秒の間だけ、1 秒に 1 回（秒が変わる瞬間に山、そのあと減る）', () => {
  expect(timePulse(30)).toBe(0);
  expect(timePulse(10.5)).toBe(0);
  for (let n = 10; n >= 1; n--) {
    expect(timePulse(n)).toBeCloseTo(1, 6);
    expect(timePulse(n - 0.5)).toBeLessThan(0.2);
    expect(timePulse(n - 0.05)).toBeGreaterThan(timePulse(n - 0.3));
  }
  // 1 Hz: 1/60 秒ごとに見て、山（前より大きくなる所）は 10 秒の間に 10 回
  let peaks = 0, prev = 0;
  for (let i = 0; i <= 600; i++) { const p = timePulse(10 - i / 60); if (p > prev + 0.5) peaks++; prev = p; }
  expect(peaks).toBe(10);
});

const run = (ticks, from, to, dt, playing = () => true) => {
  const out = [];
  for (let r = from; r > to - 1e-9; r -= dt) out.push(...ticks.update(Math.max(0, r), playing(Math.max(0, r))));
  return out;
};

test('R1c: 刻みの音は残り 10 秒の間、整数の秒ごとに 1 回（10, 9, …, 1）。その前は鳴らない', () => {
  for (const dt of [1 / 60, 1 / 30, 1 / 144, 0.37]) {
    const ticks = createTimeTicks();
    const got = run(ticks, 60, 0, dt);
    expect(got, `dt=${dt}`).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  }
  // 引っかかり（一度に 2.5 秒進む）でも、またいだ秒の数だけ鳴らすのではなく、最後にまたいだ 1 回だけ
  const ticks = createTimeTicks();
  const seq = [11, 10.5, 8, 7.9];
  const got = seq.flatMap((r) => ticks.update(r, true));
  expect(got).toEqual([8]);
});

test('R1c: 遊んでいない間（導入・演出・リプレイ・結末）は鳴らない。戻ってもまとめて鳴らさない', () => {
  const ticks = createTimeTicks();
  expect(run(ticks, 60, 0, 1 / 60, () => false)).toEqual([]);
  // 残り 5 秒で演出が始まる → その先は鳴らない
  const t2 = createTimeTicks();
  expect(run(t2, 12, 0, 1 / 60, (r) => r > 5)).toEqual([10, 9, 8, 7, 6]);
  // 遊んでいない間に秒をまたいでも、遊びに戻った最初のフレームでは鳴らさない
  const t3 = createTimeTicks();
  expect(t3.update(9.5, false)).toEqual([]);
  expect(t3.update(8.5, true)).toEqual([]);
  expect(t3.update(7.99, true)).toEqual([8]);
});
