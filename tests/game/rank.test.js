import { test, expect } from 'vitest';
import { rankFor, rankPoints, RANK } from '../../src/game/rank.js';
import { createGame } from '../../src/game/game.js';
import { cityValue, generateCity } from '../../src/world/cityGen.js';
import { citySeed } from '../../src/game/daily.js';
import { steerBot, actBot, releaseBot } from '../../src/game/bot.js';

// R2（spec §15 評価のランク）: 撃退の成否・放ったときの残り時間・払った回数・被害額から S〜C。
// R3（今日の街）: 街ごとに壊せるものの値打ちの合計が違うので、腕前の点は「被害額 ÷ その街の値打ちの合計」（街の何倍ぶんの被害か）にする。
// 線は scripts/rank-sim.mjs（最善の操作 + 最善の放ち方、今日の街 240 日分）の分布から: S は最善の操作の回の上位約 1 割
const T = 1e12;
const CV = 0.42 * T; // ふつうの街の値打ちの合計くらい

test('R3: 街の値打ちの合計 = 建物 + props + 高架の区間（game.js の壊せるもの）', () => {
  const c = generateCity(3);
  const sum = [...c.buildings, ...c.props, ...c.transit.segments].reduce((a, t) => a + t.value, 0);
  expect(cityValue(c)).toBeCloseTo(sum, 0);
  expect(cityValue(c)).toBeGreaterThan(0.3 * T);
  expect(createGame({ seed: 3 }).cityValue).toBe(cityValue(c));
});

test('R3: 線の値（rank-sim の今日の街 240 日分の分布から決めた、街の値打ちの何倍か）', () => {
  expect(RANK).toEqual({ S: { points: 6.85, timeLeft: 3 }, A: { points: 6.14 }, puffStep: 0.04, puffUses: 3 });
});

test('R3: 腕前の点 = 被害額 × (1 + 0.04 × 使わなかった払う) ÷ 街の値打ち', () => {
  expect(rankPoints({ damage: 2 * T, puffs: 3, cityValue: 0.5 * T })).toBeCloseTo(4, 9);
  expect(rankPoints({ damage: 2 * T, puffs: 0, cityValue: 0.5 * T })).toBeCloseTo(4.48, 9);
  expect(rankPoints({ damage: 2 * T, puffs: 1, cityValue: 0.4 * T })).toBeCloseTo(5.4, 9);
});

test('R3: 同じ腕前なら街の値打ちが違っても同じランク（値打ちの大きな街が得をしない）', () => {
  const p = RANK.S.points * 1.001 / 1.12;
  for (const cv of [0.39 * T, 0.42 * T, 0.46 * T]) {
    expect(rankFor({ clear: true, timeLeft: 0.5, puffs: 0, damage: p * cv, cityValue: cv })).toBe('S');
    expect(rankFor({ clear: true, timeLeft: 0.5, puffs: 0, damage: p * 0.99 * cv, cityValue: cv })).toBe('A');
  }
  // 同じ被害額でも、値打ちの小さな街の方が点は高い
  expect(rankPoints({ damage: T, puffs: 0, cityValue: 0.4 * T })).toBeGreaterThan(rankPoints({ damage: T, puffs: 0, cityValue: 0.45 * T }));
});

test('R2: S と A は撃退成功が要る。失敗とブラックホールは C（被害額がいくら大きくても）', () => {
  expect(rankFor({ clear: false, timeLeft: 0.2, puffs: 0, damage: 9 * T, cityValue: CV })).toBe('C');
  expect(rankFor({ clear: false, timeLeft: 0, puffs: 0, damage: 0, cityValue: CV })).toBe('C');
  expect(rankFor({ clear: true, timeLeft: 0.2, puffs: 0, damage: 1 * T, cityValue: CV })).toBe('B');
});

test('R2: 線の上下（S は残り 3 秒以内も要る）', () => {
  const up = 1 + 1e-12; // 割り算の丸めで線のすぐ下にならないよう
  const s = RANK.S.points * CV / 1.12 * up, a = RANK.A.points * CV / 1.12 * up; // 払わなかった回の被害額の線
  const r = (o) => rankFor({ clear: true, cityValue: CV, ...o });
  expect(r({ timeLeft: 0.5, puffs: 0, damage: s })).toBe('S');
  expect(r({ timeLeft: 0.5, puffs: 0, damage: s * 0.999 })).toBe('A');
  expect(r({ timeLeft: 3.01, puffs: 0, damage: s * 1.5 })).toBe('A'); // 早く放つと S にならない
  expect(r({ timeLeft: 3, puffs: 0, damage: s })).toBe('S');
  expect(r({ timeLeft: 0.5, puffs: 3, damage: s })).toBe('B'); // 同じ被害額でも払い切ると下がる（A の線より下）
  expect(r({ timeLeft: 0.5, puffs: 2, damage: s })).toBe('A');
  expect(r({ timeLeft: 9, puffs: 0, damage: a })).toBe('A');
  expect(r({ timeLeft: 9, puffs: 0, damage: a * 0.999 })).toBe('B');
});

// 同じ種・同じ操作なら、いつも同じ被害額とランク（乱数は種から）
function best(seed) {
  const g = createGame({ seed });
  g.begin(); g.pressStart();
  while (g.phase === 'playing') { steerBot(g); actBot(g, { grab: 2, trigger: 0, crowd: Infinity, hide: true }); g.update(1 / 30); if (releaseBot(g)) break; }
  if (g.phase !== 'over' && g.phase !== 'playing') g.settle();
  return { total: g.score.total, outcome: g.outcome, cityValue: g.cityValue };
}
test('R2: 決まって同じ（同じ種・同じ操作で被害額とランクが同じ）。outcome.rank は rankFor と同じ（街の値打ちで割る）', () => {
  for (const seed of [12, citySeed('20261121')]) {
    const a = best(seed), b = best(seed);
    expect(a.total).toBe(b.total);
    expect(a.outcome?.rank).toBe(b.outcome?.rank);
    if (a.outcome) {
      expect(a.outcome.cityValue).toBe(a.cityValue);
      expect(a.outcome.rank).toBe(rankFor({ clear: a.outcome.clear, timeLeft: a.outcome.bonus.timeLeft, puffs: a.outcome.puffsUsed, damage: a.total, cityValue: a.cityValue }));
    }
  }
}, 20000);

// R3: S の割合が街によらず安定: 今日の街の重ならない 2 組（30 日ずつ）で、どちらも S は約 1 割（1〜6 回）。A 以上は撃退成功の回だけ
const days = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(...from) + i * 864e5); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; });
for (const [name, from] of [['2027 年 1 月〜', [2027, 0, 1]], ['2027 年 6 月〜', [2027, 5, 1]]]) {
  test(`R3: 今日の街 30 日（${name}）で S は約 1 割（1〜6 回）。C は撃退できなかった回`, () => {
    const runs = days(from, 30).map((k) => best(citySeed(k)));
    const rank = (r) => r.outcome?.rank ?? 'C';
    const S = runs.filter((r) => rank(r) === 'S').length;
    expect(S).toBeGreaterThanOrEqual(1);
    expect(S).toBeLessThanOrEqual(6);
    for (const r of runs) expect(rank(r) === 'C').toBe(!r.outcome?.clear);
    expect(runs.filter((r) => rank(r) === 'B').length).toBeGreaterThan(0);
    expect(runs.filter((r) => rank(r) === 'A').length).toBeGreaterThan(0);
  }, 60000);
}
