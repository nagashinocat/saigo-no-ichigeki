import { test, expect } from 'vitest';
import { TITLES, SCALE_TITLES, scaleTitleFor, earnedTitles, pickTitle } from '../../src/game/titles.js';
import { spaceTierFor } from '../../src/render/finaleTimeline.js';
import { radiusFor } from '../../src/game/charge.js';
import { CONFIG } from '../../src/config.js';

// R1i（持ち主 2026-11-23 10:29・10:39）: 規模の称号。ごく小さい一撃から最大まで細かく刻んで 8〜10。その回の一撃の規模（放った力）が
// 入る段の一つだけが付き、ほかの称号と同じく「いちばん珍しい一つ」を出す仕組みに入る
const M = CONFIG.power.max;
const bonus = (timeLeft) => ({ base: 1, timeLeft, near: 0, timeMul: 1, closeMul: 1, mul: 1 });
const ctxAt = (power, o = {}) => ({
  reason: 'released',
  outcome: { clear: power >= 98.6, total: 10, survivors: [], bonus: bonus(5), puffsUsed: 2, rank: 'B', ...o },
  stats: { puffs: 2, maxCombo: 0, hides: 2, spotted: 2, bossGrabbed: false, kills: {}, release: { timeLeft: 5, near: 9, power: power * M / 100, centreDist: 25 } },
  damage: 2.4e12, cityValue: 0.42e12,
});
const scaleIds = () => new Set(SCALE_TITLES.map((t) => t.id));
const scaleOf = (ctx) => earnedTitles(ctx).filter((id) => scaleIds().has(id));

test('R1i: 規模の称号は 8〜10、小さい順に並び、持ち主の例（豆電球・花火職人・世界の破壊者）を含む。名前は短く重ならない', () => {
  expect(SCALE_TITLES.length).toBeGreaterThanOrEqual(8);
  expect(SCALE_TITLES.length).toBeLessThanOrEqual(10);
  const names = SCALE_TITLES.map((t) => t.name);
  expect(names[0]).toBe('豆電球');
  expect(names.at(-1)).toBe('世界の破壊者');
  expect(names).toContain('花火職人');
  for (let i = 1; i < SCALE_TITLES.length; i++) expect(SCALE_TITLES[i].from).toBeGreaterThan(SCALE_TITLES[i - 1].from);
  expect(SCALE_TITLES[0].from).toBe(0);
  // ほかの称号と同じ表に入っている（同じ仕組みで選ばれる）
  for (const t of SCALE_TITLES) {
    expect(TITLES.find((x) => x.id === t.id)?.name).toBe(t.name);
    expect(t.name.length).toBeLessThanOrEqual(10);
  }
  expect(new Set(TITLES.map((t) => t.name)).size).toBe(TITLES.length);
});

test('R1i: 放った一撃にはちょうど一つの規模の称号が付く（段の境目ちょうどで上の段）', () => {
  for (let p = CONFIG.power.minRelease; p <= 100 + 1e-9; p += 0.25) {
    const got = scaleOf(ctxAt(p));
    expect(got.length, `power ${p}`).toBe(1);
    expect(got[0]).toBe(scaleTitleFor(p * M / 100).id);
  }
  SCALE_TITLES.forEach((t, i) => {
    if (i > 0) {
      expect(scaleTitleFor(t.from * M / 100).id, `${t.name} の境目`).toBe(t.id);
      expect(scaleTitleFor((t.from - 0.01) * M / 100).id).toBe(SCALE_TITLES[i - 1].id);
    }
  });
  // 満タンちょうどだけが世界の破壊者
  expect(scaleTitleFor(M).name).toBe('世界の破壊者');
  expect(scaleTitleFor(M * 0.999).name).not.toBe('世界の破壊者');
  expect(scaleTitleFor(CONFIG.power.minRelease).name).toBe('豆電球');
});

test('R1i: ブラックホール（時間切れ）は一撃を放っていないので、規模の称号は付かない', () => {
  expect(scaleOf({ reason: 'blackhole', outcome: null, stats: { release: null } })).toEqual([]);
  // 放った記録がなければ付かない（止まらない）
  expect(scaleOf({ reason: 'released', outcome: null, stats: {} })).toEqual([]);
});

// 珍しさ: いちばん上の段（世界の破壊者 = 満タン）だけが珍しい（★3〜4）。ほかの段はふつう〜すこし珍しい（★1〜2）。
// 国を消した者（97% 以上・満タン未満）を ★3 にすると、撃退成功のほとんどが ★3 になり、★2 の撃退の称号（ギリギリの英雄・紙一重・先手必勝・
// 今日の初撃退）が一度も出なくなる（title-sim、task-R1i-report.md）
test('R1i: 珍しさ — いちばん上の段（世界の破壊者）は珍しい（★3〜4）、ほかの段は ふつう〜すこし珍しい（★1〜2）', () => {
  for (const t of SCALE_TITLES) {
    if (t === SCALE_TITLES.at(-1)) expect([3, 4], t.name).toContain(t.rarity);
    else expect([1, 2], t.name).toContain(t.rarity);
  }
  // 宇宙の小・中の段の称号は ★1〜2
  for (const t of SCALE_TITLES) if (spaceTierFor(radiusFor(t.from * M / 100)) !== 'max') expect(t.rarity).toBeLessThanOrEqual(2);
  // 段が上がるほど珍しさは下がらない
  for (let i = 1; i < SCALE_TITLES.length; i++) expect(SCALE_TITLES[i].rarity).toBeGreaterThanOrEqual(SCALE_TITLES[i - 1].rarity);
  // 宇宙の段と称号の段がそろう: 最大の段の称号の始まりは、宇宙の最大の始まり（力 97% = 膝）
  const firstMax = SCALE_TITLES.find((t) => spaceTierFor(radiusFor(t.from * M / 100)) === 'max');
  expect(spaceTierFor(radiusFor((firstMax.from - 0.01) * M / 100))).not.toBe('max');
});

test('R1i: 規模の称号もほかの称号と競う（いちばん珍しい一つ）', () => {
  // ★1 の一掃と並べば、より珍しい方
  const big = ctxAt(100);
  const pick = pickTitle(big, 5);
  const r = (id) => TITLES.find((t) => t.id === id).rarity;
  expect(r(pick)).toBe(Math.max(...earnedTitles(big).map(r)));
  // ★4 の街のへそが取れれば、そちらが出る
  const centre = ctxAt(100);
  centre.stats.release.centreDist = 10;
  expect(pickTitle(centre, 5)).toBe('centre');
});
