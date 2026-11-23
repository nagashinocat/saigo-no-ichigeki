// R3（spec §15 珍しい結末の称号）→ R3 fix1（持ち主 19:03「称号はランダムっぽくなるように多めに用意しよう」）:
// いろいろな遊び方・偶然の出来事で取れる称号を 30。結果に出すのは一回に一つ、取れた中でいちばん珍しいもの（rarity が大きい）。
// 同じ珍しさが並んだら、その回の種（runSeed）で決まる乱数で選ぶ（同じ回なら同じ。試しでも決まって同じ）。
// 端末に一度でも出た称号を覚え、初めて出たときは NEW（records.js）。
// 珍しさ（rarity）: 1 ふつう・2 すこし珍しい・3 珍しい・4 とても珍しい・5 幻。線と珍しさは scripts/title-sim.mjs（今日の街 × いくつかの遊び方）
// で取れた割合を見て決めた（制作側の判断。持ち主が直せる。ボットの遊び方は人より狭いので目安）
import { createRng } from '../rng.js';
import { formatYen } from '../ui/format.js';
import { CONFIG } from '../config.js';

// ctx: { reason: 'released' | 'blackhole', outcome（game.outcome。時間切れは null）, stats（game.runStats）, damage（被害額）, cityValue（街の値打ちの合計）,
//        firstClearToday（今日の街で初めての撃退成功）, newBest（前の自己ベストを塗り替えた）, hour（日本時間の時。分からなければ undefined） }
const rel = (c) => (c.reason === 'released' && c.outcome ? c.outcome : null);
const clear = (c) => !!rel(c)?.clear;
const left = (c) => rel(c)?.bonus?.timeLeft ?? Infinity;
const R = (c) => c.stats?.release ?? null;
const puffsOf = (c) => rel(c)?.puffsUsed ?? c.stats?.puffs ?? null;
const ratio = (c) => (rel(c) && c.cityValue > 0 ? c.damage / c.cityValue : null);
const inHours = (h, from, to) => Number.isInteger(h) && h >= from && h <= to;

// R1i（持ち主 2026-11-23 10:29「称号も豆電球とか花火職人とか世界の破壊者とか規模のやつも」・10:39「規模の称号も色々作ってくれると助かる」）:
// 規模の称号。放った一撃の力（%。HUD のゲージと同じ）で段を刻む。放った回にはちょうど一つ付き、ほかの称号と同じく
// いちばん珍しい一つを出す仕組みに入る。from: その段の始まり（%、この値ちょうどから）。世界の破壊者は満タンちょうど（半径が最大）だけ。
// 宇宙の段（finaleTimeline.js spaceTierFor、CONFIG.spaceTier）とそろえる: 小 = 豆電球〜爆竹（力 50% 未満）、中 = 花火職人〜
// 地図を書き換えた者（50〜97%）、最大 = 国を消した者・世界の破壊者（97% = 膝から）。
// 珍しさ（制作側の判断。持ち主が直せる）: いちばん上の段（世界の破壊者、満タン）だけが珍しい（★3）、ほかはふつう〜すこし珍しい。
// 国を消した者を ★3 にすると撃退成功のほとんどが ★3 になり、★2 の撃退の称号（ギリギリの英雄・紙一重・先手必勝・今日の初撃退）が
// title-sim で一度も出なくなるので ★2。いちばん多く出る称号は 35% 以下のまま（task-R1i-report.md）
// ブラックホール（時間切れ）は一撃を放っていないので付けない（その結末には「すべてを飲み込んだ者」がある）
const SCALE_BANDS = [
  { id: 'scaleBulb', name: '豆電球', from: 0, rarity: 1 },
  { id: 'scaleSparkler', name: '線香花火', from: 20, rarity: 1 },
  { id: 'scaleCracker', name: '爆竹', from: 35, rarity: 1 },
  { id: 'scaleFireworks', name: '花火職人', from: CONFIG.spaceTier.normalPct, rarity: 1 }, // 宇宙の中の始まり（Fix round 1: 同じ設定の値）
  { id: 'scaleLauncher', name: '打ち上げ師', from: 65, rarity: 2 },
  { id: 'scaleWrecker', name: '街の解体屋', from: 80, rarity: 2 },
  { id: 'scaleMapmaker', name: '地図を書き換えた者', from: 90, rarity: 2 },
  { id: 'scaleNation', name: '国を消した者', from: CONFIG.spaceTier.maxPct, rarity: 2 }, // 宇宙の最大の始まり
  { id: 'scaleWorld', name: '世界の破壊者', from: 100, rarity: 3 },
];
// amount: 放った力（power.max と同じ単位）。満タンちょうどだけが最後の段、ほかは from ≤ 力% の段のうちいちばん上
export function scaleTitleFor(amount, cfg = CONFIG) {
  const M = cfg.power.max;
  if (amount >= M - 1e-9) return SCALE_BANDS.at(-1);
  const pct = (100 * amount) / M;
  let band = SCALE_BANDS[0];
  for (const b of SCALE_BANDS.slice(0, -1)) if (pct >= b.from - 1e-9) band = b;
  return band;
}
const scaleOfCtx = (c) => (c.reason === 'released' && Number.isFinite(R(c)?.power) ? scaleTitleFor(R(c).power) : null);
const scaleCond = (i) => {
  const b = SCALE_BANDS[i], next = SCALE_BANDS[i + 1];
  if (!next) return '力 100%（満タン）で放った';
  if (!SCALE_BANDS[i + 2]) return `力 ${b.from}% 以上・満タン未満で放った`;
  return i === 0 ? `力 ${next.from}% 未満で放った` : `力 ${b.from}〜${next.from}% 未満で放った`;
};

export const TITLES = [
  // 前からの 5 つ（brief のまま）
  { id: 'blackhole', name: 'すべてを飲み込んだ者', rarity: 1, cond: 'ブラックホールの結末', test: (c) => c.reason === 'blackhole' },
  { id: 'closeCall', name: 'ギリギリの英雄', rarity: 2, cond: '残り 1 秒以内に放って撃退成功', test: (c) => clear(c) && left(c) <= 1 },
  { id: 'noPuff', name: '払わぬ者', rarity: 1, cond: '払うを使わずに撃退成功', test: (c) => clear(c) && puffsOf(c) === 0 },
  { id: 'sweep', name: '一掃', rarity: 1, cond: '一度の払うで 6 体以上', test: (c) => (c.stats?.maxCombo ?? 0) >= 6 },
  { id: 'dragged', name: '道連れ', rarity: 3, cond: '掴んでいた大物を最後の一撃に巻き込んだ', test: (c) => !!rel(c)?.dragged },
  // 時間
  { id: 'lastBlink', name: '刹那の一撃', rarity: 4, cond: '残り 0.3 秒以内に放って撃退成功', test: (c) => clear(c) && left(c) <= 0.3 },
  // fix2: 力は溜めている間だけ毎秒 1.9 で、撃退成功には約 98 が要るので、撃退成功で放てるのは早くても残り約 8.5 秒（title-sim の撃退成功の最大 8.5 秒）
  { id: 'early', name: '先手必勝', rarity: 2, cond: '残り 6 秒以上で放って撃退成功（早くても残り約 8.5 秒）', test: (c) => clear(c) && left(c) >= 6 },
  // fix2: 前の「残り 11 秒より前に撃退成功」は届かなかった（49 秒で力は多くて 93.1）。大物（49 秒）を一度も 20 m の内に近づけずに撃退成功
  // （title-sim fix2: 撃退成功 151 回のうち 13 回、全部の回の 3.6%）
  { id: 'beforeBoss', name: '大物知らず', rarity: 3, cond: '大物を一度も 20 m の内に近づけずに撃退成功', test: (c) => clear(c) && (c.stats?.bossClosest ?? 0) > 20 },
  // 隠れる・見つかる
  { id: 'hermit', name: '影の住人', rarity: 2, cond: '6 回以上隠れた', test: (c) => (c.stats?.hides ?? 0) >= 6 },
  { id: 'noHide', name: '正面突破', rarity: 4, cond: '一度も隠れずに撃退成功', test: (c) => clear(c) && c.stats?.hides === 0 },
  // fix2: すぐ放てば見つかる前に終わるので、撃退成功が要る
  { id: 'unseen', name: '誰にも見られず', rarity: 5, cond: '一度も見つからずに撃退成功', test: (c) => clear(c) && c.stats?.spotted === 0 },
  { id: 'wanted', name: '指名手配', rarity: 2, cond: '6 回以上見つかった', test: (c) => (c.stats?.spotted ?? 0) >= 6 },
  // 放ったときのまわり
  { id: 'fullHouse', name: '大入り満員', rarity: 3, cond: '放ったとき 15 m の内に軍勢 20 体以上', test: (c) => !!rel(c) && (R(c)?.near ?? 0) >= 20 },
  { id: 'lonely', name: '孤高の一撃', rarity: 3, cond: '15 m の内の軍勢 4 体以下で撃退成功', test: (c) => clear(c) && R(c) != null && R(c).near <= 4 },
  { id: 'lucky7', name: 'ラッキーセブン', rarity: 3, cond: '15 m の内の軍勢ちょうど 7 体で撃退成功', test: (c) => clear(c) && R(c)?.near === 7 },
  { id: 'centre', name: '街のへそ', rarity: 4, cond: '街の中心から 17 m 以内で放って撃退成功', test: (c) => clear(c) && R(c) != null && R(c).centreDist <= 17 },
  { id: 'outskirts', name: '郊外の一撃', rarity: 3, cond: '街の中心から 34 m 以上で放って撃退成功', test: (c) => clear(c) && (R(c)?.centreDist ?? 0) >= 34 },
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
  // fix2: 早く放つだけで取れる（失敗の慰め）ので ふつう
  { id: 'modest', name: '控えめな破壊者', rarity: 1, cond: '被害額が街の値打ちの 3.5 倍未満', test: (c) => ratio(c) != null && ratio(c) < 3.5 },
  { id: 'zorome', name: 'ゾロ目', rarity: 2, cond: '被害額の表示がゾロ目（¥2.2兆 など）', test: (c) => !!rel(c) && /^¥(\d)\.\1兆$/.test(formatYen(c.damage ?? 0)) },
  // 端末・日・時刻
  { id: 'firstClear', name: '今日の初撃退', rarity: 2, cond: 'その日の街で初めての撃退成功', test: (c) => clear(c) && !!c.firstClearToday },
  // fix2: 失敗どうしで被害額を少し上げるだけでも塗り替えになるので、撃退成功が要る
  { id: 'newBest', name: '記録を塗り替えた者', rarity: 3, cond: '前の自己ベストを塗り替えて撃退成功', test: (c) => clear(c) && !!c.newBest },
  { id: 'nightOwl', name: '夜ふかしの破壊者', rarity: 2, cond: '日本時間 0〜4 時に遊んだ', test: (c) => inHours(c.hour, 0, 4) },
  { id: 'dawn', name: '夜明けの一撃', rarity: 2, cond: '日本時間 5〜8 時に遊んだ', test: (c) => inHours(c.hour, 5, 8) },
  // 規模（R1i、下の SCALE_TITLES）
  ...SCALE_BANDS.map((b, i) => ({ id: b.id, name: b.name, rarity: b.rarity, cond: scaleCond(i), test: (c) => scaleOfCtx(c)?.id === b.id })),
];
// R1i: 規模の称号（表に並ぶ順 = 小さい順）
export const SCALE_TITLES = TITLES.filter((t) => SCALE_BANDS.some((b) => b.id === t.id)).map((t) => ({ ...t, from: SCALE_BANDS.find((b) => b.id === t.id).from }));

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
