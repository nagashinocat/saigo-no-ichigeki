import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { steerBot, actBot, POLICY } from '../../src/game/bot.js';
import { radiusFor } from '../../src/game/charge.js';
import { CONFIG } from '../../src/config.js';
import { citySeed } from '../../src/game/daily.js';

// 持ち主が選んだ釣り合い（「ギリギリのスリル」: 最善の操作で満タンが最後の数秒、払わなければ負ける）。scripts/balance-sim.mjs と同じ自動の操作。
// R0 / R0 fix1 の制作側の判断（§16 でも保つ）:
//  - 満タンの時刻の p50 は、満タンに届いた回だけで数えて 52〜56 秒
//  - 撃退成功は、最善の放ち方で 7〜8 割
//  - 撃退には ほぼ満タン（97% より上）が要る（radiusFor の knee）
// M2（§16、持ち主 09:11 / 15:20）: 最善の操作は「動くボット」（src/game/bot.js: 街の中心へ寄り、ライトの先から外れ、突っ込む者をかわし、
// 掴まれたら払い（3 回まで）、追われたら物陰に隠れる）。前の「動かずに払うだけ」の操作は、払うが 3 回になった今は最善ではない。
// sim（seed 1〜30）: 最善は「掴まれ 2 人で払う・隠れる」で 22/30 が満タン、届いた回の p50 52.6 秒、撃退成功 L=99 で 22/30（73%）
// R1f（R3 の今日の街・持ち主 19:47）: 遊ぶ街は日本時間の日付の街（daily.js citySeed）なので、種 1〜12 ではなく、今日の街 120 日（20261101 から）を
// 5 日おきに選んだ 24 の街で確かめる（R3 で今日の街は種 1〜30 より難しい街が多かった: 前の数で 120 日 63%、種 1〜30 で 77%）。
// sim（scripts/daily-balance.mjs、120 日すべて）: fix1 で最善の撃退成功 84/120（70%）、満タン p50 52.1 秒
const DT = 1 / 30;
// Pass 2: 最善は bot.js POLICY.best（払うの守りが入り、掴まれたら 1 人目で払うのが一番よい）
const BEST = POLICY.best;
const NO_PUFF = { grab: Infinity, trigger: 0, crowd: Infinity, hide: false };
// fix2（まとめ役の判断: 三つの時期で頑健に）: 2026-07-01・2026-11-01・2027-03-01 から 120 日ずつの時期から、それぞれ 15 日おきに 8 の街（計 24）。
// sim（scripts/daily-balance.mjs、360 日すべて）: 最善の撃退成功 270/360（75%。時期ごと 72.5% / 79.2% / 73.3%）。この 24 の街で 17/24 が満タン、p50 52.1 秒
const dayKey = (y, m, d, i) => { const t = new Date(Date.UTC(y, m, d) + i * 864e5); return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`; };
const SEEDS = [[2026, 6, 1], [2026, 10, 1], [2027, 2, 1]].flatMap(([y, m, d]) => Array.from({ length: 8 }, (_, i) => citySeed(dayKey(y, m, d, i * 15))));
function play(seed, st = BEST, { centreAt = null } = {}) {
  const g = createGame({ seed });
  g.begin(); g.pressStart();
  let t = 0, grabSec = 0;
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2) {
    steerBot(g, { centreAt });
    actBot(g, st);
    g.update(DT); t += DT;
    grabSec += g.grabbing * DT;
    if (g.power.value >= CONFIG.power.max - 1e-6) return { full: t, end: g.power.value, grabSec };
  }
  return { full: Infinity, end: g.power.value, grabSec };
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

test('R0 / M2: 最善の操作（動くボット）でも、満タンは終わりの数秒前（届いた回の中央 52〜56 秒）。たいていは届くが、届かない回もある', () => {
  const ts = SEEDS.map((s) => play(s).full);
  const got = ts.filter(Number.isFinite);
  // R1f: 24 の街の 16〜21（前は 12 の種の 8〜11。fix1: 下限は前の割合 8/12 より緩めない）
  // 持ち主 10:06（「数値で85パーセントくらいのクリア確率に」）・Pass 2（まとめ役: 払う 3 回・隠れない 4 割以上を満たす折り合いで、最善は 92% まで）:
  // Fix round 1（見直し Important 2: 上限は目標に合わせる）: 24 の街の 20〜22（下限 80%、上限は 92% の 22/24 まで）。
  // この 24 の街では 21/24 が満タン・p50 55.9 秒。今日の街 360 では 90%（時期ごと 90.8 / 92.5 / 87.5%）
  expect(got.length).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.8));
  expect(got.length).toBeLessThanOrEqual(Math.floor(SEEDS.length * 0.92)); // 上手に遊んでも失敗することがある
  expect(median(got)).toBeGreaterThanOrEqual(52);
  expect(median(got)).toBeLessThanOrEqual(56);
}, 120000);

test('R0 fix1 / M2: 払い続ける（払える力があればいつでも払う。3 回はすぐ尽きる）のは最善ではない: 満タンに届かず、60 秒の力も最善よりずっと少ない', () => {
  const spam = SEEDS.map((s) => play(s, { grab: 'spam' }));
  const best = SEEDS.map((s) => play(s));
  expect(spam.filter((r) => Number.isFinite(r.full)).length).toBe(0);
  expect(best.filter((r) => Number.isFinite(r.full)).length).toBeGreaterThan(0);
  for (const r of spam) expect(r.end).toBeLessThan(30);
}, 120000);

test('払わずに長押しし続けるだけ（M2: 動いてかわしても、隠れずに）では満タンに届かず、60 秒の力は 70 より十分少ない（払わなければ負ける）', () => {
  const runs = SEEDS.map((s) => play(s, NO_PUFF));
  for (const r of runs) expect(r.full).toBe(Infinity);
  const ends = runs.map((r) => r.end);
  expect(median(ends)).toBeLessThan(30);
  expect(Math.max(...ends)).toBeLessThan(70);
  // 掴まれた者 6 人ぶんの減りは、貯める速さより速い
  expect(CONFIG.enemy.maxGrabbing * CONFIG.enemy.drainPerSec).toBeGreaterThan(CONFIG.power.chargePerSec * 1.5);
}, 120000);

// M2（TODO(M2) を消す）: 続く量で比べる（掴まれた人秒の合計）。満タンの時刻の中央は、払うが 3 回になったので比べない:
// 1 人目で払うと 3 回を早く使い切り、満タンに届く回はかえって減る（seed 1〜12、隠れるあり: 掴まれ 1 人で払う 7/12・2 人 8/12・3 人 9/12・
// 枠いっぱいの 6 人 8/12・払わない 7/12。中央はどれも 52.6 秒＝見つからずに貯めきる回）。掴まれた人秒の合計は 283 / 208 / 40 / 562 / 1199
// （早すぎも遅すぎも悪い U の形。「早く払うほど得」は、もう成り立たない）。ここで確かめるのは、最善のきっかけ（掴まれ 2 人で払う）が、
// 枠いっぱい（6 人）まで掴ませておくより、払わないより、吸われる量が少ないことだけ
test('払う（掴まれ 2 人で払う）は、枠いっぱい（6 人）まで掴ませておくより、払わないより、掴まれて吸われる量（掴まれた人秒の合計）が少ない', () => {
  const sum = (o) => SEEDS.map((s) => play(s, { ...BEST, ...o }).grabSec).reduce((a, b) => a + b, 0);
  const early = sum({}), lazy = sum({ grab: CONFIG.enemy.maxGrabbing }), never = sum({ grab: Infinity });
  expect(early).toBeLessThan(lazy);
  expect(lazy).toBeLessThan(never);
}, 240000);

// S9: 撃退成功（放った一発で街の軍勢を全員倒す）。最善の操作で力が level に届いた瞬間に離す
// topUp: level に届いたフレームで、放つ前に力を満タンにする（同じ所の満タン）
function releaseAtLevel(seed, level, centreAt = null, { topUp = false } = {}) {
  const g = createGame({ seed });
  g.begin(); g.pressStart();
  for (let t = 0; t < CONFIG.roundSeconds - DT / 2; t += DT) {
    steerBot(g, { centreAt });
    actBot(g, BEST);
    g.update(DT);
    if (g.power.value >= level - 1e-6) {
      const at = { x: g.hero.x, z: g.hero.z };
      if (topUp) g.power.add(CONFIG.power.max);
      g.pressEnd(); g.settle();
      return { ...g.outcome, at };
    }
  }
  return null; // 届かないまま時間切れ（ブラックホール）
}

// R1d の見直し（「6/8 ちょうどで壊れやすい」）: 種を 8 → 16 に増やし、届いた回の数は半分以上（sim で 30 回中 22 回）にする。言うことは同じ
test('S9 / R0 fix1 / M2: 最善の操作で満タンで放てば必ず撃退成功（街の中心のそば。届かない回もある）。96% で放つと街の外側の見回る者が残って撃退失敗。99% なら届いた回はみな撃退成功', () => {
  // R1f: 今日の街 24（前は種 1〜16 で 9 回以上）
  const seeds = SEEDS;
  const full = seeds.map((s) => releaseAtLevel(s, CONFIG.power.max));
  // 持ち主 10:06: 最善の撃退成功の下限 60% → 80%（約 85% の目標）
  expect(full.filter((o) => o?.clear).length).toBeGreaterThanOrEqual(Math.ceil(seeds.length * 0.8));
  for (const o of full) if (o) { expect(o.clear).toBe(true); expect(Math.hypot(o.at.x, o.at.z)).toBeLessThan(60); } // 中心のそば
  for (const level of [70, 90, 96]) {
    for (const s of seeds.slice(0, 8)) {
      const o = releaseAtLevel(s, level);
      if (!o) continue; // そこまで届かない回
      expect(o.clear, `L=${level} seed ${s}`).toBe(false);
      expect(o.survivors.some((v) => v.patrol)).toBe(true);
    }
  }
  // 99% なら、届いた回はみな撃退成功（満タンの少し手前で放っても勝てる）。M2 fix1: 消していたのを戻す（sim でも L=99 は 22/22）
  // Fix round 1（見直し Important 4）: Pass 2 でゆるめた所を元に戻す（99% に届いた回はみな撃退成功）。そのうえで、99% に届いた同じフレーム・
  // 同じ所で力を満タンにして放てば必ず撃退成功（「中心のそばの満タンは必ず撃退」をこの場所でも確かめる）
  for (const s of seeds) { const o = releaseAtLevel(s, 99); if (o) expect(o.clear, `L=99 seed ${s}`).toBe(true); }
  for (const s of seeds) { const o = releaseAtLevel(s, 99, null, { topUp: true }); if (o) { expect(o.clear, `L=99→満タン seed ${s}`).toBe(true); expect(Math.hypot(o.at.x, o.at.z)).toBeLessThan(60); } }
}, 300000);

// M2（§16「最大溜めで必ず撃退できるのは、街の中心のそばで放ったときだけ」）: 中心から離れて放つ操作は悪い
test('M2: 中心から 200 m の所へ寄って放つ操作は、中心のそばで放つより撃退成功が少ない。満タンでも中心から 200 m の爆心では撃退できない', () => {
  const seeds = SEEDS.slice(0, 8);
  const far = seeds.map((s) => releaseAtLevel(s, CONFIG.power.max, { x: 200, z: 0 }));
  const near = seeds.map((s) => releaseAtLevel(s, CONFIG.power.max));
  expect(far.filter((o) => o?.clear).length).toBeLessThan(near.filter((o) => o?.clear).length);
  for (const o of far) if (o && Math.hypot(o.at.x, o.at.z) > 150) expect(o.clear).toBe(false);
  // 半径だけを比べる: 満タンの半径は、中心から 200 m の点からでは街の反対の端に届かない
  expect(radiusFor(CONFIG.power.max)).toBeLessThan(CONFIG.cityRadius + 200 - 40);
}, 120000);

// 持ち主 10:06（「払う全部使って隠れる無しでもクリアできない」）・Pass 2（まとめ役）: 払うを 3 回とも使い、隠れない遊び方（bot.js POLICY.puffNoHide）でも
// 4 割以上は撃退できる（目標 5 割）。力が 99% に届いた瞬間に放つ（daily-balance と同じ。満タンを待つより撃退が多い）。
// Fix round 1: sim（今日の街 360）: 51%（時期ごと 50.8 / 53.3 / 47.5%）。この 24 の街で 12/24（下限 10 から 2 の余り）
test('Pass 2: 払う 3 回・隠れない遊び方でも、24 の街の 4 割以上（10 以上）で撃退成功', () => {
  const runs = SEEDS.map((s) => {
    const g = createGame({ seed: s });
    g.begin(); g.pressStart();
    for (let t = 0; t < CONFIG.roundSeconds - DT / 2; t += DT) {
      steerBot(g); actBot(g, POLICY.puffNoHide); g.update(DT);
      expect(g.hero.hidden).toBeFalsy();
      if (g.power.value >= 99 - 1e-6) { g.pressEnd(); g.settle(); return g.outcome.clear; }
    }
    return false;
  });
  expect(runs.filter(Boolean).length).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.4));
}, 240000);

test('持ち主 10:06: 払う 3 回・隠れない遊び方は、払うを 3 回まで使い、隠れない（遊び方の決まり）', () => {
  expect(POLICY.puffNoHide.hide).toBe(false);
  expect(POLICY.puffNoHide.lookout).toBeFalsy();
  for (const seed of SEEDS.slice(0, 4)) {
    const g = createGame({ seed });
    g.begin(); g.pressStart();
    let puffs = 0;
    for (let t = 0; g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2; t += DT) {
      steerBot(g); if (actBot(g, POLICY.puffNoHide) === 'puff') puffs++; g.update(DT);
      expect(g.hero.hidden).toBeFalsy();
    }
    expect(puffs).toBeLessThanOrEqual(CONFIG.puff.uses);
    expect(g.runStats.hides).toBe(0);
  }
}, 120000);
