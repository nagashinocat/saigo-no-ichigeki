import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { nearCount } from '../../src/game/reach.js';
import { releaseBonus } from '../../src/game/score.js';
import { CONFIG } from '../../src/config.js';

// R2（spec §15 ギリギリのボーナス）: 放った瞬間の残り時間とすぐそばの軍勢の数を写し、一発の被害額に倍率をかける。
// 内訳は outcome.bonus（結果画面の小さな行）。払った回数（ランクの入力）も outcome に
const DT = 1 / 30;
function release(seed, sec, { puffs = true, amount = CONFIG.power.max } = {}) {
  const g = createGame({ seed });
  const over = [];
  g.on('over', (p) => over.push(p));
  g.pressStart();
  for (let t = 0; t < sec; t += DT) { if (puffs && g.grabbing > 1) g.puff(); g.update(DT); }
  g.power.take(); g.power.add(amount);
  const snap = { timeLeft: g.timer.remaining, near: nearCount(g.enemies.list, g.hero), puffsUsed: CONFIG.puff.uses - g.puffsLeft };
  g.pressEnd();
  g.settle();
  return { g, over, snap };
}

test('R2: 被害額 = 一発の被害額（基）× 残り時間の倍率 × すぐそばの倍率。内訳は放った瞬間の値', () => {
  for (const [seed, sec] of [[1, 20], [2, 55], [3, 58.5]]) {
    const { g, over, snap } = release(seed, sec);
    const b = g.outcome.bonus;
    const want = releaseBonus(snap);
    expect(b.timeLeft).toBeCloseTo(snap.timeLeft, 9);
    expect(b.near).toBe(snap.near);
    expect(b.mul).toBeCloseTo(want.mul, 12);
    expect(b.base).toBeGreaterThan(0);
    expect(g.score.total).toBeCloseTo(b.base * b.mul, 3);
    expect(over[0].total).toBe(g.score.total);
    expect(g.outcome.puffsUsed).toBe(snap.puffsUsed);
  }
}, 20000);

test('R2: 残り 10 秒より前に、誰も近くにいない所で放てば倍率は 1（被害額は基のまま）', () => {
  const { g } = release(4, 3, { puffs: false });
  expect(g.outcome.bonus.timeLeft).toBeGreaterThan(10);
  // 3 秒ではまだ誰も主人公に届いていない
  expect(g.outcome.bonus.near).toBe(0);
  expect(g.outcome.bonus.mul).toBe(1);
  expect(g.score.total).toBe(g.outcome.bonus.base);
});

test('R2: 終わり間際ほど倍率が大きい（同じ種で 20 秒と 58 秒）', () => {
  const a = release(6, 20).g.outcome.bonus, b = release(6, 58).g.outcome.bonus;
  expect(b.timeMul).toBeGreaterThan(a.timeMul);
  expect(a.timeMul).toBe(1);
  expect(b.timeMul).toBeGreaterThan(1.4);
}, 20000);
