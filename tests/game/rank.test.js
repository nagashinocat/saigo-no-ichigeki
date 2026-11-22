import { test, expect } from 'vitest';
import { rankFor, RANK } from '../../src/game/rank.js';
import { createGame } from '../../src/game/game.js';
import { cityValue, generateCity } from '../../src/world/cityGen.js';
import { citySeed } from '../../src/game/daily.js';
import { steerBot, actBot, releaseBot } from '../../src/game/bot.js';

// R3 fix1（持ち主 19:03「ランクは条件にしよう」）: 点の線をやめ、はっきりした条件で決める。
//  S = 撃退成功・残り 1 秒以内に放つ・払う 0 回 / A = 撃退成功・残り 3 秒以内に放つ・払う 1 回以下 / B = 撃退成功 / C = それ以外
const T = 1e12;

test('R3 fix1: 条件の値', () => {
  expect(RANK).toEqual({ S: { timeLeft: 1, puffs: 0 }, A: { timeLeft: 3, puffs: 1 } });
});

test('R3 fix1: S = 撃退成功・残り 1 秒以内・払う 0 回', () => {
  expect(rankFor({ clear: true, timeLeft: 0.47, puffs: 0 })).toBe('S');
  expect(rankFor({ clear: true, timeLeft: 1, puffs: 0 })).toBe('S');
  expect(rankFor({ clear: true, timeLeft: 1.01, puffs: 0 })).toBe('A');
  expect(rankFor({ clear: true, timeLeft: 0.2, puffs: 1 })).toBe('A');
});

test('R3 fix1: A = 撃退成功・残り 3 秒以内・払う 1 回以下', () => {
  expect(rankFor({ clear: true, timeLeft: 3, puffs: 1 })).toBe('A');
  expect(rankFor({ clear: true, timeLeft: 2, puffs: 0 })).toBe('A');
  expect(rankFor({ clear: true, timeLeft: 3.01, puffs: 0 })).toBe('B');
  expect(rankFor({ clear: true, timeLeft: 0.2, puffs: 2 })).toBe('B');
  expect(rankFor({ clear: true, timeLeft: 0.2, puffs: 3 })).toBe('B');
});

test('R3 fix1: B = 撃退成功。C = 撃退失敗・ブラックホール（被害額がいくら大きくても）', () => {
  expect(rankFor({ clear: true, timeLeft: 40, puffs: 3 })).toBe('B');
  expect(rankFor({ clear: false, timeLeft: 0.2, puffs: 0, damage: 9 * T })).toBe('C');
  expect(rankFor({ clear: false, timeLeft: 0, puffs: 0 })).toBe('C');
  // 被害額と街の値打ちはランクに効かない
  expect(rankFor({ clear: true, timeLeft: 0.5, puffs: 0, damage: 1 })).toBe('S');
});

test('R3: 街の値打ちの合計 = 建物 + props + 高架の区間（game.js の壊せるもの。称号の「被害額の大きさ」に使う）', () => {
  const c = generateCity(3);
  const sum = [...c.buildings, ...c.props, ...c.transit.segments].reduce((a, t) => a + t.value, 0);
  expect(cityValue(c)).toBeCloseTo(sum, 0);
  expect(createGame({ seed: 3 }).cityValue).toBe(cityValue(c));
});

// 同じ種・同じ操作なら、いつも同じランク。outcome.rank は rankFor と同じ
function best(seed) {
  const g = createGame({ seed });
  g.begin(); g.pressStart();
  while (g.phase === 'playing') { steerBot(g); actBot(g, { grab: 2, trigger: 0, crowd: Infinity, hide: true }); g.update(1 / 30); if (releaseBot(g)) break; }
  if (g.phase !== 'over' && g.phase !== 'playing') g.settle();
  return { total: g.score.total, outcome: g.outcome };
}
test('R3 fix1: 決まって同じ。outcome.rank は rankFor（残り時間・払った回数）と同じ', () => {
  for (const seed of [12, citySeed('20261121')]) {
    const a = best(seed), b = best(seed);
    expect(a.total).toBe(b.total);
    expect(a.outcome?.rank).toBe(b.outcome?.rank);
    if (a.outcome) expect(a.outcome.rank).toBe(rankFor({ clear: a.outcome.clear, timeLeft: a.outcome.bonus.timeLeft, puffs: a.outcome.puffsUsed }));
  }
}, 20000);
