import { test, expect } from 'vitest';
import { TITLES, earnedTitles, titleName, pickTitle, runSeed } from '../../src/game/titles.js';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';
import { citySeed } from '../../src/game/daily.js';
import { steerBot, actBot } from '../../src/game/bot.js';

// R3（spec §15 珍しい結末の称号）
const E = CONFIG.enemy;
// Pass 2: 払ったあとの守り（guardSec。tests/game/puffGuard.test.js）は、ここでは外す（払うの当たり・数え方だけを見る）
const quiet = { ...CONFIG, enemy: { ...E, spawnPerSec: 0 }, puff: { ...CONFIG.puff, guardSec: 0 } };
const still = { ...quiet, enemy: { ...quiet.enemy, drainPerSec: 0 } };
const DT = 1 / 30;
const bonus = (timeLeft) => ({ base: 1, timeLeft, near: 0, timeMul: 1, closeMul: 1, mul: 1 });
const clearO = (o = {}) => ({ clear: true, total: 10, survivors: [], bonus: bonus(5), puffsUsed: 2, rank: 'B', ...o });

// R3 fix1: 称号は 20 以上・一回に一つ（いちばん珍しいもの）。前の 5 つは名前と条件のまま
const has = (ctx, id) => earnedTitles(ctx).includes(id);
const S0 = { puffs: 2, maxCombo: 0, hides: 2, spotted: 2, bossGrabbed: false, kills: { normal: 30, patrol: 30, heavy: 5, drainer: 5, boss: 1 }, release: { timeLeft: 5, near: 9, power: 100, centreDist: 25 } };
const R = (o = {}, st = {}, extra = {}) => ({ reason: 'released', outcome: clearO(o), stats: { ...S0, ...st }, damage: 2.4e12, cityValue: 0.42e12, ...extra });

test('R3: 前の 5 つの称号の名前（brief のまま）', () => {
  const byId = Object.fromEntries(TITLES.map((t) => [t.id, t.name]));
  expect(byId).toMatchObject({ blackhole: 'すべてを飲み込んだ者', closeCall: 'ギリギリの英雄', noPuff: '払わぬ者', sweep: '一掃', dragged: '道連れ' });
  expect(titleName('sweep')).toBe('一掃');
});

test('R3 fix1: 20 以上・id は重ならない・どれも短い名前・条件の説明・珍しさ 1〜5', () => {
  expect(TITLES.length).toBeGreaterThanOrEqual(20);
  expect(new Set(TITLES.map((t) => t.id)).size).toBe(TITLES.length);
  expect(new Set(TITLES.map((t) => t.name)).size).toBe(TITLES.length);
  for (const t of TITLES) {
    expect(t.name.length, t.id).toBeLessThanOrEqual(10);
    expect(t.cond.length, t.id).toBeGreaterThan(3);
    expect([1, 2, 3, 4, 5]).toContain(t.rarity);
  }
  // 珍しさの段がいくつもある（どれも同じではない）
  expect(new Set(TITLES.map((t) => t.rarity)).size).toBeGreaterThanOrEqual(4);
});

test('R3: ブラックホールの結末 → すべてを飲み込んだ者', () => {
  expect(has({ reason: 'blackhole', outcome: null, stats: { ...S0, release: null } }, 'blackhole')).toBe(true);
  expect(has(R(), 'blackhole')).toBe(false);
});

test('R3: 残り 1 秒以内の撃退成功 → ギリギリの英雄（失敗は付かない）', () => {
  expect(has(R({ bonus: bonus(1) }), 'closeCall')).toBe(true);
  expect(has(R({ bonus: bonus(0.47) }), 'closeCall')).toBe(true);
  expect(has(R({ bonus: bonus(1.01) }), 'closeCall')).toBe(false);
  expect(has(R({ clear: false, survivors: [{}], bonus: bonus(0.2) }), 'closeCall')).toBe(false);
});

test('R3: 払うを 1 回も使わずに撃退成功 → 払わぬ者（失敗は付かない）', () => {
  expect(has(R({ puffsUsed: 0 }), 'noPuff')).toBe(true);
  expect(has(R({ puffsUsed: 1 }), 'noPuff')).toBe(false);
  expect(has(R({ clear: false, survivors: [{}], puffsUsed: 0 }), 'noPuff')).toBe(false);
});

test('R3: 一度の払うで 6 体以上 → 一掃（結末によらない。ブラックホールでも）', () => {
  expect(has(R({}, { maxCombo: 6 }), 'sweep')).toBe(true);
  expect(has(R({}, { maxCombo: 5 }), 'sweep')).toBe(false);
  expect(has({ reason: 'blackhole', outcome: null, stats: { ...S0, maxCombo: 9, release: null } }, 'sweep')).toBe(true);
});

test('R3: 掴んでいた大物を最後の一撃に巻き込んだ → 道連れ（撃退の成否によらない）', () => {
  expect(has(R({ dragged: true }), 'dragged')).toBe(true);
  expect(has(R({ clear: false, survivors: [{}], dragged: true }), 'dragged')).toBe(true);
  expect(has(R({ dragged: false }), 'dragged')).toBe(false);
});

// 新しい称号: [id, 付く場合, 付かない場合]
const CASES = [
  ['lastBlink', R({ bonus: bonus(0.3) }), R({ bonus: bonus(0.31) })],
  ['early', R({ bonus: bonus(6) }), R({ bonus: bonus(5.9) })],
  ['early', R({ bonus: bonus(8.5) }), R({ clear: false, survivors: [{}], bonus: bonus(9) })], // fix2: 上の限りは無い（届くのは残り約 8.5 秒まで）
  ['beforeBoss', R({}, { bossClosest: 20.1 }), R({}, { bossClosest: 20 })], // fix2: 大物を 20 m の内に近づけずに撃退成功
  ['beforeBoss', R({}, { bossClosest: 50 }), R({ clear: false, survivors: [{}] }, { bossClosest: 50 })],
  ['hermit', R({}, { hides: 6 }), R({}, { hides: 5 })],
  ['noHide', R({}, { hides: 0 }), R({ clear: false, survivors: [{}] }, { hides: 0 })],
  ['unseen', R({}, { spotted: 0 }), R({}, { spotted: 1 })],
  ['unseen', R({}, { spotted: 0 }), R({ clear: false, survivors: [{}] }, { spotted: 0 })], // fix2: すぐ放つだけでは取れない
  ['wanted', R({}, { spotted: 6 }), R({}, { spotted: 5 })],
  ['fullHouse', R({}, { release: { ...S0.release, near: 20 } }), R({}, { release: { ...S0.release, near: 19 } })],
  ['lonely', R({}, { release: { ...S0.release, near: 4 } }), R({}, { release: { ...S0.release, near: 5 } })],
  ['bossHug', R({}, { bossGrabbed: true }), R({ clear: false, survivors: [{}] }, { bossGrabbed: true })],
  ['heavyHunter', R({}, { kills: { ...S0.kills, heavy: 15 } }), R({}, { kills: { ...S0.kills, heavy: 14 } })],
  ['drainHunter', R({}, { kills: { ...S0.kills, drainer: 14 } }), R({}, { kills: { ...S0.kills, drainer: 13 } })],
  ['centre', R({}, { release: { ...S0.release, centreDist: 17 } }), R({}, { release: { ...S0.release, centreDist: 17.1 } })],
  ['outskirts', R({}, { release: { ...S0.release, centreDist: 34 } }), R({}, { release: { ...S0.release, centreDist: 33.9 } })],
  ['outskirts', R({}, { release: { ...S0.release, centreDist: 40 } }), R({ clear: false, survivors: [{}] }, { release: { ...S0.release, centreDist: 40 } })], // fix2: 撃退成功が要る
  ['wipeout', R({}, {}, { damage: 6.1 * 0.42e12 }), R({}, {}, { damage: 6.09 * 0.42e12 })],
  ['modest', R({ clear: false, survivors: [{}] }, {}, { damage: 3.49 * 0.42e12 }), R({}, {}, { damage: 3.5 * 0.42e12 })],
  ['firstClear', R({}, {}, { firstClearToday: true }), R({}, {}, { firstClearToday: false })],
  ['newBest', R({}, {}, { newBest: true }), R({}, {}, { newBest: false })],
  ['newBest', R({}, {}, { newBest: true }), R({ clear: false, survivors: [{}] }, {}, { newBest: true })], // fix2: 撃退成功が要る
  ['lowPower', R({}, { release: { ...S0.release, power: 98.9 } }), R({}, { release: { ...S0.release, power: 99 } })],
  ['allPuffs', R({ puffsUsed: 3 }, { puffs: 3 }), R({ puffsUsed: 2 }, { puffs: 2 })],
  ['bigCombo', R({}, { maxCombo: 15 }), R({}, { maxCombo: 14 })],
  ['lucky7', R({}, { release: { ...S0.release, near: 7 } }), R({}, { release: { ...S0.release, near: 8 } })],
  ['nightOwl', R({}, {}, { hour: 2 }), R({}, {}, { hour: 5 })],
  ['dawn', R({}, {}, { hour: 5 }), R({}, {}, { hour: 9 })],
  ['zorome', R({}, {}, { damage: 2.22e12 }), R({}, {}, { damage: 2.1e12 })],
];
test('R3 fix1: 新しい称号の条件（境目）', () => {
  const ids = new Set(TITLES.map((t) => t.id));
  for (const [id, yes, no] of CASES) {
    expect(ids.has(id), id).toBe(true);
    expect(has(yes, id), `${id} 付く`).toBe(true);
    expect(has(no, id), `${id} 付かない`).toBe(false);
  }
  // 条件の表がすべての称号を試している
  expect(new Set([...CASES.map((c) => c[0]), 'blackhole', 'closeCall', 'noPuff', 'sweep', 'dragged'])).toEqual(ids);
});

test('R3 fix1: 時刻の称号は時刻が分からなければ付かない。数が足りなくても止まらない', () => {
  expect(has(R({}, {}, { hour: undefined }), 'nightOwl')).toBe(false);
  expect(() => earnedTitles({ reason: 'released', outcome: clearO(), stats: {} })).not.toThrow();
  expect(() => earnedTitles({ reason: 'blackhole', outcome: null })).not.toThrow();
});

test('R3 fix1: 一回に一つ — いちばん珍しいもの。同じ珍しさは種で決まる乱数（同じ種なら同じ）', () => {
  // dragged（3）と noPuff（1）なら dragged
  const ctx = R({ puffsUsed: 0, dragged: true });
  const top = Math.max(...earnedTitles(ctx).map((id) => TITLES.find((t) => t.id === id).rarity));
  const pick = pickTitle(ctx, 1);
  expect(TITLES.find((t) => t.id === pick).rarity).toBe(top);
  // 同じ珍しさの組: 種で決まり、同じ種なら同じ。いろいろな種で、両方が出る
  const tie = TITLES.filter((t) => t.rarity === 2).map((t) => t.id);
  expect(tie.length).toBeGreaterThanOrEqual(2);
  const ctx2 = R({}, { hides: 6, spotted: 6 }); // hermit・wanted
  const r2 = (id) => TITLES.find((t) => t.id === id).rarity;
  expect(r2('hermit')).toBe(r2('wanted'));
  const picks = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    expect(pickTitle(ctx2, seed)).toBe(pickTitle(ctx2, seed));
    picks.add(pickTitle(ctx2, seed));
  }
  expect([...picks].sort()).toEqual(earnedTitles(ctx2).filter((id) => r2(id) === Math.max(...earnedTitles(ctx2).map(r2))).sort());
  expect(picks.size).toBeGreaterThanOrEqual(2);
  // 取れた称号が無ければ null
  expect(pickTitle({ reason: 'released', outcome: clearO({ clear: false, survivors: [{}], puffsUsed: 1 }), stats: { ...S0, maxCombo: 0 }, damage: 2.4e12, cityValue: 0.42e12 }, 3)).toBe(null);
});

test('R3 fix1: その回の種（runSeed）は同じ回なら同じ、違う回なら（たいてい）違う', () => {
  const a = R({ bonus: bonus(0.5) }, { hides: 3 });
  expect(runSeed(a, 77)).toBe(runSeed(a, 77));
  expect(runSeed(a, 77)).not.toBe(runSeed(a, 78));
  expect(runSeed(R({ bonus: bonus(0.6) }, { hides: 3 }), 77)).not.toBe(runSeed(a, 77));
  expect(Number.isInteger(runSeed(a, 77))).toBe(true);
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

// R3 fix1（持ち主 19:03 称号を多めに）: 称号の元になる、その回の数（game.runStats）
test('R3 fix1: runStats — 見つかった回数（追われ始めた回）・大物に掴まれたか・種類ごとに倒した数・放ったときの力と中心からの距離', () => {
  const g = createGame({ seed: 1, cfg: still });
  g.pressStart(); g.power.add(50);
  let st = g.runStats;
  expect(st).toMatchObject({ puffs: 0, maxCombo: 0, hides: 0, spotted: 0, bossGrabbed: false, bossClosest: Infinity, release: null });
  expect(st.kills).toEqual({ normal: 0, patrol: 0, heavy: 0, drainer: 0, boss: 0 });
  // 追われ始めたら 1 回。追っている者がいなくなって、また追われたら 2 回
  const chaser = { id: 980, angle: 0, dist: 60, state: 'chase' };
  g.enemies.list.push(chaser);
  g.update(DT);
  expect(g.runStats.spotted).toBe(1);
  g.update(DT);
  expect(g.runStats.spotted).toBe(1);
  chaser.state = 'dead'; chaser.deadTime = 0;
  g.update(DT);
  g.enemies.list.push({ id: 981, angle: 1, dist: 60, state: 'chase' });
  g.update(DT);
  expect(g.runStats.spotted).toBe(2);
  // fix2: 大物がいちばん近づいた距離（大物知らず）
  const far = { id: 985, kind: 'boss', angle: 0, dist: 70, state: 'chase' };
  g.enemies.list.push(far);
  g.update(DT);
  expect(g.runStats.bossClosest).toBeGreaterThan(40);
  expect(g.runStats.bossClosest).toBeLessThanOrEqual(70);
  far.state = 'dead'; far.deadTime = 0;
  // 大物に掴まれた
  g.enemies.list.push({ id: 982, kind: 'boss', angle: 0, dist: E.grabRange, state: 'grab', grabTime: 1 });
  g.update(DT);
  expect(g.runStats.bossGrabbed).toBe(true);
  expect(g.runStats.bossClosest).toBeLessThanOrEqual(E.grabRange + 1);
  // 種類ごとの倒した数（最後に dead の者）
  g.enemies.list.push({ id: 983, kind: 'heavy', state: 'dead', angle: 0, dist: 300 }, { id: 984, kind: 'drainer', state: 'dead', angle: 0, dist: 300 }, { id: 9000, patrol: true, state: 'dead', angle: 0, dist: 300 });
  st = g.runStats;
  expect(st.kills).toMatchObject({ heavy: 1, drainer: 1, patrol: 1 });
  expect(st.kills.normal).toBe(1); // 980 だけ（981 はまだ追っている）
  // 放った
  g.hero.x = 30; g.hero.z = 40;
  g.power.take(); g.power.add(77);
  g.pressEnd();
  g.settle();
  st = g.runStats;
  expect(st.release).toMatchObject({ power: 77, centreDist: 50 });
  expect(st.kills.boss).toBe(2); // 985（試しで倒した）と 982（一撃）
  expect(st.release.near).toBe(g.outcome.bonus.near);
});

test('R3 fix1: runStats.hides は隠れられた回数', () => {
  const g = createGame({ seed: 2 });
  g.begin(); g.pressStart();
  for (let i = 0; i < 90; i++) g.update(DT);
  let n = 0;
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.hide(x, z)) { n++; break; }
  expect(n).toBe(1);
  expect(g.runStats.hides).toBe(1);
});

// fix2（再点検 Important 1）: 安い抜け道 — すぐ放つ・失敗するだけで珍しい称号（★3 以上）が取れないこと
const rarity = (id) => TITLES.find((t) => t.id === id).rarity;
test('fix2: 珍しさ 3 以上の称号は撃退成功か、遅くまで遊んだことの要る出来事でしか取れない（失敗・低い被害・誰にも見られず・郊外では取れない）', () => {
  const cheap = { reason: 'released', outcome: clearO({ clear: false, survivors: [{}, {}], bonus: bonus(54.7), puffsUsed: 0, rank: 'C', dragged: false }),
    stats: { puffs: 0, maxCombo: 0, hides: 0, spotted: 0, bossGrabbed: false, bossClosest: Infinity, kills: { normal: 2, patrol: 0, heavy: 0, drainer: 0, boss: 0 }, release: { timeLeft: 54.7, near: 0, power: 10.2, centreDist: 40 } },
    damage: 0.05e12, cityValue: 0.42e12, firstClearToday: false, newBest: true };
  for (const hour of [undefined, 2, 6, 13]) {
    const got = earnedTitles({ ...cheap, hour });
    for (const id of got) expect(rarity(id), id).toBeLessThanOrEqual(2);
  }
  expect(rarity('modest')).toBe(1); // 失敗の慰め（成否によらない）は ふつう
});

// 本物のゲームで: 力が minRelease を超えたらすぐ放つ（約 5 秒）。どの日の街でも、結果に出る称号は ★2 以下
test('fix2: 本物のゲームですぐ放つ — 結果に出る称号は珍しさ 2 以下（今日の街 8 日）', () => {
  for (let i = 0; i < 8; i++) {
    const key = `202611${String(i + 1).padStart(2, '0')}`;
    const g = createGame({ seed: citySeed(key) });
    g.begin(); g.pressStart();
    while (g.phase === 'playing' && g.power.value < CONFIG.power.minRelease + 0.2) { steerBot(g, {}); actBot(g, { grab: 2, trigger: 0, crowd: Infinity, hide: true }); g.update(DT); }
    expect(g.phase, key).toBe('playing');
    g.pressEnd(); g.settle();
    const ctx = { reason: 'released', outcome: g.outcome, stats: g.runStats, damage: g.score.total, cityValue: g.cityValue, firstClearToday: false, newBest: true, hour: 2 };
    expect(g.outcome.clear).toBe(false);
    for (const id of earnedTitles(ctx)) expect(rarity(id), `${key} ${id}`).toBeLessThanOrEqual(2);
  }
}, 30000);

test('fix2: 説明と条件が合う（先手必勝は残り 6 秒以上、大物知らずは 20 m）', () => {
  const t = (id) => TITLES.find((x) => x.id === id);
  expect(t('early').cond).toContain('6 秒以上');
  expect(t('early').cond).not.toContain('11');
  expect(t('beforeBoss').cond).toContain('20 m');
  expect(t('unseen').cond).toContain('撃退成功');
  expect(t('outskirts').cond).toContain('撃退成功');
  expect(t('newBest').cond).toContain('撃退成功');
});
