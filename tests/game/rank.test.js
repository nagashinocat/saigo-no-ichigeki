import { test, expect } from 'vitest';
import { rankFor, rankPoints, RANK } from '../../src/game/rank.js';
import { createGame } from '../../src/game/game.js';
import { steerBot, actBot, releaseBot } from '../../src/game/bot.js';

// R2（spec §15 評価のランク）: 撃退の成否・放ったときの残り時間・払った回数・被害額から S〜C。
// 線は scripts/rank-sim.mjs（最善の操作 + 最善の放ち方、seed 1〜60）の分布から: S は最善の操作の回の上位約 1 割
const T = 1e12;

test('R2: 線の値（rank-sim の分布から決めた）', () => {
  expect(RANK).toEqual({ S: { points: 2.87 * T, timeLeft: 3 }, A: { points: 2.62 * T }, puffStep: 0.04, puffUses: 3 });
});

test('R2: 腕前の点 = 被害額 × (1 + 0.04 × 使わなかった払う)', () => {
  expect(rankPoints({ damage: 2 * T, puffs: 3 })).toBe(2 * T);
  expect(rankPoints({ damage: 2 * T, puffs: 0 })).toBeCloseTo(2.24 * T, 0);
  expect(rankPoints({ damage: 2 * T, puffs: 1 })).toBeCloseTo(2.16 * T, 0);
});

test('R2: S と A は撃退成功が要る。失敗とブラックホールは C（被害額がいくら大きくても）', () => {
  expect(rankFor({ clear: false, timeLeft: 0.2, puffs: 0, damage: 9 * T })).toBe('C');
  expect(rankFor({ clear: false, timeLeft: 0, puffs: 0, damage: 0 })).toBe('C');
  expect(rankFor({ clear: true, timeLeft: 0.2, puffs: 0, damage: 1 * T })).toBe('B');
});

test('R2: 線の上下（S は残り 3 秒以内も要る）', () => {
  const s = RANK.S.points / 1.12, a = RANK.A.points / 1.12; // 払わなかった回の被害額の線
  expect(rankFor({ clear: true, timeLeft: 0.5, puffs: 0, damage: s })).toBe('S');
  expect(rankFor({ clear: true, timeLeft: 0.5, puffs: 0, damage: s * 0.999 })).toBe('A');
  expect(rankFor({ clear: true, timeLeft: 3.01, puffs: 0, damage: s * 1.5 })).toBe('A'); // 早く放つと S にならない
  expect(rankFor({ clear: true, timeLeft: 3, puffs: 0, damage: s })).toBe('S');
  expect(rankFor({ clear: true, timeLeft: 0.5, puffs: 3, damage: s })).toBe('B'); // 同じ被害額でも払い切ると下がる（2.56兆 < A の線）
  expect(rankFor({ clear: true, timeLeft: 0.5, puffs: 2, damage: s })).toBe('A');
  expect(rankFor({ clear: true, timeLeft: 9, puffs: 0, damage: a })).toBe('A');
  expect(rankFor({ clear: true, timeLeft: 9, puffs: 0, damage: a * 0.999 })).toBe('B');
});

// 同じ種・同じ操作なら、いつも同じ被害額とランク（乱数は種から）
function best(seed) {
  const g = createGame({ seed });
  g.begin(); g.pressStart();
  while (g.phase === 'playing') { steerBot(g); actBot(g, { grab: 2, trigger: 0, crowd: Infinity, hide: true }); g.update(1 / 30); if (releaseBot(g)) break; }
  if (g.phase !== 'over' && g.phase !== 'playing') g.settle();
  return { total: g.score.total, outcome: g.outcome };
}
test('R2: 決まって同じ（同じ種・同じ操作で被害額とランクが同じ）。outcome.rank は rankFor と同じ', () => {
  for (const seed of [12, 7]) {
    const a = best(seed), b = best(seed);
    expect(a.total).toBe(b.total);
    expect(a.outcome?.rank).toBe(b.outcome?.rank);
    if (a.outcome) expect(a.outcome.rank).toBe(rankFor({ clear: a.outcome.clear, timeLeft: a.outcome.bonus.timeLeft, puffs: a.outcome.puffsUsed, damage: a.total }));
  }
}, 20000);

test('R2: 最善の操作（seed 1〜30）で S は約 1 割（1〜5 回）。A 以上は撃退成功の回だけ、C は撃退できなかった回', () => {
  const runs = Array.from({ length: 30 }, (_, i) => best(i + 1));
  const rank = (r) => r.outcome?.rank ?? 'C';
  const S = runs.filter((r) => rank(r) === 'S').length;
  expect(S).toBeGreaterThanOrEqual(1);
  expect(S).toBeLessThanOrEqual(5);
  for (const r of runs) expect(rank(r) === 'C').toBe(!r.outcome?.clear);
  expect(runs.filter((r) => rank(r) === 'B').length).toBeGreaterThan(0);
  expect(runs.filter((r) => rank(r) === 'A').length).toBeGreaterThan(0);
}, 60000);
