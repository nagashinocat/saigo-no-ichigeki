// R3（spec §15 珍しい結末の称号）→ R3 fix1（持ち主 19:03「称号はランダムっぽくなるように多めに用意しよう」）:
// いろいろな遊び方・偶然の出来事で取れる称号を 30。結果に出すのは一回に一つ、取れた中でいちばん珍しいもの（rarity が大きい）。
// 同じ珍しさが並んだら、その回の種（runSeed）で決まる乱数で選ぶ（同じ回なら同じ。試しでも決まって同じ）。
// 端末に一度でも出た称号を覚え、初めて出たときは NEW（records.js）。
// 珍しさ（rarity）: 1 ふつう・2 すこし珍しい・3 珍しい・4 とても珍しい・5 幻。線と珍しさは scripts/title-sim.mjs（今日の街 × いくつかの遊び方）
// で取れた割合を見て決めた（制作側の判断。持ち主が直せる。ボットの遊び方は人より狭いので目安）
import { createRng } from '../rng.js';
import { formatYen } from '../ui/format.js';

// ctx: { reason: 'released' | 'blackhole', outcome（game.outcome。時間切れは null）, stats（game.runStats）, damage（被害額）, cityValue（街の値打ちの合計）,
//        firstClearToday（今日の街で初めての撃退成功）, newBest（前の自己ベストを塗り替えた）, hour（日本時間の時。分からなければ undefined） }
const rel = (c) => (c.reason === 'released' && c.outcome ? c.outcome : null);
const clear = (c) => !!rel(c)?.clear;
const left = (c) => rel(c)?.bonus?.timeLeft ?? Infinity;
const R = (c) => c.stats?.release ?? null;
const puffsOf = (c) => rel(c)?.puffsUsed ?? c.stats?.puffs ?? null;
const ratio = (c) => (rel(c) && c.cityValue > 0 ? c.damage / c.cityValue : null);
const inHours = (h, from, to) => Number.isInteger(h) && h >= from && h <= to;

export const TITLES = [
  // 前からの 5 つ（brief のまま）
  { id: 'blackhole', name: 'すべてを飲み込んだ者', rarity: 1, cond: 'ブラックホールの結末', test: (c) => c.reason === 'blackhole' },
  { id: 'closeCall', name: 'ギリギリの英雄', rarity: 2, cond: '残り 1 秒以内に放って撃退成功', test: (c) => clear(c) && left(c) <= 1 },
  { id: 'noPuff', name: '払わぬ者', rarity: 1, cond: '払うを使わずに撃退成功', test: (c) => clear(c) && puffsOf(c) === 0 },
  { id: 'sweep', name: '一掃', rarity: 1, cond: '一度の払うで 6 体以上', test: (c) => (c.stats?.maxCombo ?? 0) >= 6 },
  { id: 'dragged', name: '道連れ', rarity: 3, cond: '掴んでいた大物を最後の一撃に巻き込んだ', test: (c) => !!rel(c)?.dragged },
  // 時間
  { id: 'lastBlink', name: '刹那の一撃', rarity: 4, cond: '残り 0.3 秒以内に放って撃退成功', test: (c) => clear(c) && left(c) <= 0.3 },
  { id: 'early', name: '先手必勝', rarity: 2, cond: '残り 6 秒以上で放って撃退成功', test: (c) => clear(c) && left(c) >= 6 && left(c) <= 11 },
  { id: 'beforeBoss', name: '大物知らず', rarity: 4, cond: '大物が来る前（残り 11 秒より前）に撃退成功', test: (c) => clear(c) && left(c) > 11 },
  // 隠れる・見つかる
  { id: 'hermit', name: '影の住人', rarity: 2, cond: '6 回以上隠れた', test: (c) => (c.stats?.hides ?? 0) >= 6 },
  { id: 'noHide', name: '正面突破', rarity: 4, cond: '一度も隠れずに撃退成功', test: (c) => clear(c) && c.stats?.hides === 0 },
  { id: 'unseen', name: '誰にも見られず', rarity: 5, cond: '一度も見つからなかった', test: (c) => c.stats?.spotted === 0 && c.reason != null },
  { id: 'wanted', name: '指名手配', rarity: 2, cond: '6 回以上見つかった', test: (c) => (c.stats?.spotted ?? 0) >= 6 },
  // 放ったときのまわり
  { id: 'fullHouse', name: '大入り満員', rarity: 3, cond: '放ったとき 15 m の内に軍勢 20 体以上', test: (c) => !!rel(c) && (R(c)?.near ?? 0) >= 20 },
  { id: 'lonely', name: '孤高の一撃', rarity: 3, cond: '15 m の内の軍勢 4 体以下で撃退成功', test: (c) => clear(c) && R(c) != null && R(c).near <= 4 },
  { id: 'lucky7', name: 'ラッキーセブン', rarity: 3, cond: '15 m の内の軍勢ちょうど 7 体で撃退成功', test: (c) => clear(c) && R(c)?.near === 7 },
  { id: 'centre', name: '街のへそ', rarity: 4, cond: '街の中心から 17 m 以内で放って撃退成功', test: (c) => clear(c) && R(c) != null && R(c).centreDist <= 17 },
  { id: 'outskirts', name: '郊外の一撃', rarity: 3, cond: '街の中心から 34 m 以上で放った', test: (c) => !!rel(c) && (R(c)?.centreDist ?? 0) >= 34 },
  { id: 'lowPower', name: '紙一重', rarity: 2, cond: '力 99% 未満で放って撃退成功', test: (c) => clear(c) && R(c) != null && R(c).power < 99 },
  // 払う
  { id: 'allPuffs', name: '払い尽くした者', rarity: 4, cond: '払うを 3 回使い切って撃退成功', test: (c) => clear(c) && puffsOf(c) >= 3 },
  { id: 'bigCombo', name: '大掃除', rarity: 2, cond: '一度の払うで 15 体以上', test: (c) => (c.stats?.maxCombo ?? 0) >= 15 },
  // 軍勢の種類
  { id: 'bossHug', name: '大物を背負って', rarity: 4, cond: '大物に掴まれたことがあって撃退成功', test: (c) => clear(c) && !!c.stats?.bossGrabbed },
  { id: 'heavyHunter', name: '重量級の狩人', rarity: 2, cond: '重い者を 15 体以上倒した', test: (c) => (c.stats?.kills?.heavy ?? 0) >= 15 },
  { id: 'drainHunter', name: '吸う者退治', rarity: 2, cond: '吸う者を 14 体以上倒した', test: (c) => (c.stats?.kills?.drainer ?? 0) >= 14 },
  // 被害額
  { id: 'wipeout', name: '街ごと消した者', rarity: 3, cond: '被害額が街の値打ちの 6.1 倍以上', test: (c) => (ratio(c) ?? 0) >= 6.1 },
  { id: 'modest', name: '控えめな破壊者', rarity: 3, cond: '被害額が街の値打ちの 3.5 倍未満', test: (c) => ratio(c) != null && ratio(c) < 3.5 },
  { id: 'zorome', name: 'ゾロ目', rarity: 2, cond: '被害額の表示がゾロ目（¥2.2兆 など）', test: (c) => !!rel(c) && /^¥(\d)\.\1兆$/.test(formatYen(c.damage ?? 0)) },
  // 端末・日・時刻
  { id: 'firstClear', name: '今日の初撃退', rarity: 2, cond: 'その日の街で初めての撃退成功', test: (c) => clear(c) && !!c.firstClearToday },
  { id: 'newBest', name: '記録を塗り替えた者', rarity: 3, cond: '前の自己ベストを塗り替えた', test: (c) => !!rel(c) && !!c.newBest },
  { id: 'nightOwl', name: '夜ふかしの破壊者', rarity: 2, cond: '日本時間 0〜4 時に遊んだ', test: (c) => inHours(c.hour, 0, 4) },
  { id: 'dawn', name: '夜明けの一撃', rarity: 2, cond: '日本時間 5〜8 時に遊んだ', test: (c) => inHours(c.hour, 5, 8) },
];

export const titleName = (id) => TITLES.find((t) => t.id === id)?.name ?? id;
const rarityOf = (id) => TITLES.find((t) => t.id === id)?.rarity ?? 0;

// その回に取れた称号の id（TITLES の順）
export function earnedTitles(ctx) {
  return TITLES.filter((t) => { try { return !!t.test(ctx); } catch { return false; } }).map((t) => t.id);
}

// その回の種: 街の種と、その回の数（被害額・残り時間・払う・隠れる・見つかった回数）を混ぜる。同じ回なら同じ
export function runSeed(ctx, citySeed = 0) {
  const parts = [citySeed, Math.round((ctx.damage ?? 0) / 1e6), Math.round((rel(ctx)?.bonus?.timeLeft ?? -1) * 1000), puffsOf(ctx) ?? -1, ctx.stats?.hides ?? -1, ctx.stats?.spotted ?? -1, ctx.reason === 'blackhole' ? 7 : 3];
  let h = 0x811c9dc5;
  for (const p of parts) { h = Math.imul(h ^ (p >>> 0), 0x01000193) >>> 0; h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; }
  return (h ^ (h >>> 15)) >>> 0;
}

// 結果に出す一つ: 取れた中でいちばん珍しいもの。並んだら seed の乱数で。何も取れなければ null
export function pickTitle(ctx, seed) {
  const got = earnedTitles(ctx);
  if (!got.length) return null;
  const top = Math.max(...got.map(rarityOf));
  const tied = got.filter((id) => rarityOf(id) === top);
  return tied[Math.floor(createRng(seed)() * tied.length)];
}
