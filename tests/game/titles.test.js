import { test, expect } from 'vitest';
import { TITLES, earnedTitles, titleName } from '../../src/game/titles.js';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// R3（spec §15 珍しい結末の称号）
const E = CONFIG.enemy;
const quiet = { ...CONFIG, enemy: { ...E, spawnPerSec: 0 } };
const still = { ...quiet, enemy: { ...quiet.enemy, drainPerSec: 0 } };
const DT = 1 / 30;
const bonus = (timeLeft) => ({ base: 1, timeLeft, near: 0, timeMul: 1, closeMul: 1, mul: 1 });
const clearO = (o = {}) => ({ clear: true, total: 10, survivors: [], bonus: bonus(5), puffsUsed: 2, rank: 'B', ...o });

test('R3: 称号の名前（brief のまま）', () => {
  expect(Object.fromEntries(TITLES.map((t) => [t.id, t.name]))).toEqual({
    blackhole: 'すべてを飲み込んだ者', closeCall: 'ギリギリの英雄', noPuff: '払わぬ者', sweep: '一掃', dragged: '道連れ',
  });
  expect(titleName('sweep')).toBe('一掃');
});

test('R3: ブラックホールの結末 → すべてを飲み込んだ者', () => {
  expect(earnedTitles({ reason: 'blackhole', outcome: null, stats: { maxCombo: 0 } })).toEqual(['blackhole']);
  expect(earnedTitles({ reason: 'released', outcome: clearO(), stats: { maxCombo: 0 } })).toEqual([]);
});

test('R3: 残り 1 秒以内の撃退成功 → ギリギリの英雄（失敗は付かない）', () => {
  expect(earnedTitles({ reason: 'released', outcome: clearO({ bonus: bonus(1) }), stats: {} })).toEqual(['closeCall']);
  expect(earnedTitles({ reason: 'released', outcome: clearO({ bonus: bonus(0.47) }), stats: {} })).toEqual(['closeCall']);
  expect(earnedTitles({ reason: 'released', outcome: clearO({ bonus: bonus(1.01) }), stats: {} })).toEqual([]);
  expect(earnedTitles({ reason: 'released', outcome: clearO({ clear: false, survivors: [{}], bonus: bonus(0.2) }), stats: {} })).toEqual([]);
});

test('R3: 払うを 1 回も使わずに撃退成功 → 払わぬ者（隠れて溜める遊び方。失敗は付かない）', () => {
  expect(earnedTitles({ reason: 'released', outcome: clearO({ puffsUsed: 0 }), stats: {} })).toEqual(['noPuff']);
  expect(earnedTitles({ reason: 'released', outcome: clearO({ puffsUsed: 1 }), stats: {} })).toEqual([]);
  expect(earnedTitles({ reason: 'released', outcome: clearO({ clear: false, survivors: [{}], puffsUsed: 0 }), stats: {} })).toEqual([]);
});

test('R3: 一度の払うで 6 体以上 → 一掃（結末によらない。ブラックホールでも）', () => {
  expect(earnedTitles({ reason: 'released', outcome: clearO(), stats: { maxCombo: 6 } })).toEqual(['sweep']);
  expect(earnedTitles({ reason: 'released', outcome: clearO(), stats: { maxCombo: 5 } })).toEqual([]);
  expect(earnedTitles({ reason: 'blackhole', outcome: null, stats: { maxCombo: 9 } })).toEqual(['blackhole', 'sweep']);
});

test('R3: 掴んでいた大物を最後の一撃に巻き込んだ → 道連れ（撃退の成否によらない）。並びは TITLES の順', () => {
  expect(earnedTitles({ reason: 'released', outcome: clearO({ dragged: true }), stats: {} })).toEqual(['dragged']);
  expect(earnedTitles({ reason: 'released', outcome: clearO({ clear: false, survivors: [{}], dragged: true }), stats: {} })).toEqual(['dragged']);
  expect(earnedTitles({ reason: 'released', outcome: clearO({ bonus: bonus(0.3), puffsUsed: 0, dragged: true }), stats: { maxCombo: 7 } })).toEqual(['closeCall', 'noPuff', 'sweep', 'dragged']);
});

// ゲームの中の数: 一度の払うでいちばん多く払った数（maxCombo）、放った瞬間に掴んでいた大物が一撃で倒れたか（outcome.dragged）
const ring = (n, dist = 6) => Array.from({ length: n }, (_, i) => ({ id: 900 + i, angle: (i / n) * Math.PI * 2, dist, state: 'chase' }));
const runUntil = (g, pred, max = 600) => { let n = 0; while (!pred() && n++ < max) g.update(DT); };
test('R3: game.maxCombo は一度の払うで払った数のいちばん多い回', () => {
  const g = createGame({ seed: 1, cfg: still });
  g.pressStart(); g.power.add(50); g.pressCancel();
  expect(g.maxCombo).toBe(0);
  g.enemies.list.push(...ring(7));
  expect(g.puff()).toBe(true);
  runUntil(g, () => g.blasts.length === 0);
  expect(g.maxCombo).toBe(7);
  g.enemies.list.push(...ring(2).map((e) => ({ ...e, id: e.id + 50 })));
  expect(g.puff()).toBe(true);
  runUntil(g, () => g.blasts.length === 0);
  expect(g.maxCombo).toBe(7);
});

function releaseWith(boss) {
  const g = createGame({ seed: 1, cfg: still });
  g.pressStart();
  g.update(DT);
  g.enemies.list.push(boss);
  g.power.take(); g.power.add(CONFIG.power.max);
  g.pressEnd();
  g.settle();
  return g;
}
test('R3: 放った瞬間に掴んでいた大物が一撃で倒れれば outcome.dragged。掴んでいない大物や、大物がいなければ付かない', () => {
  expect(releaseWith({ id: 970, kind: 'boss', angle: 0, dist: E.grabRange, state: 'grab', grabTime: 1 }).outcome.dragged).toBe(true);
  expect(releaseWith({ id: 971, kind: 'boss', angle: 0, dist: E.grabRange, state: 'cling', grabTime: 1, layer: 0 }).outcome.dragged).toBe(true);
  expect(releaseWith({ id: 972, kind: 'boss', angle: 0, dist: 40, state: 'chase' }).outcome.dragged).toBe(false);
  expect(releaseWith({ id: 973, angle: 0, dist: E.grabRange, state: 'grab', grabTime: 1 }).outcome.dragged).toBe(false);
});
