import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// 持ち主が選んだ釣り合い（「ギリギリのスリル」: 最善の操作で満タンが最後の数秒、払わなければ負ける）。scripts/balance-sim.mjs と同じ自動の操作。
// R0（持ち主 22:15「かなり簡単だからもっとスピード上げて集まってくるように」）。fix1 の制作側の判断:
//  - 満タンの時刻の p50 は、満タンに届いた回だけで数えて 52〜56 秒
//  - 撃退成功は、最善の放ち方（力が L に届いた瞬間に放つ、L は 85〜100 のうち一番よいもの）で 7〜8 割
//  - 撃退には ほぼ満タン（97% より上）が要る（radiusFor の knee）
// sim の最善は「ずっと長押しし、1 人に掴まれるか 8m 以内に 1 人来たら払う」（seed 1〜30 で 22/30 が満タンに届き、届いた回の p50 53.6 秒。
// 最善の放ち方は L=99 で 22/30 = 73%）。R0 の前は 30/30・p50 50.6 秒、L=90 で 27/30 が撃退成功（43 秒で放って勝てた）
const BEST = { grab: 1, near: 8, crowd: 1 };
function play(seed, { grab = BEST.grab, near = BEST.near, crowd = BEST.crowd, spam = false } = {}) {
  const g = createGame({ seed });
  g.pressStart();
  const DT = 1 / 30;
  let t = 0;
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2) {
    const n = g.enemies.list.filter((e) => e.state !== 'dead' && e.dist <= near).length;
    if (spam || g.grabbing >= grab || n >= crowd) g.puff();
    g.update(DT); t += DT;
    if (g.power.value >= CONFIG.power.max - 1e-6) return { full: t, end: g.power.value };
  }
  return { full: Infinity, end: g.power.value };
}

test('R0: 最善に近い操作でも、満タンは終わりの数秒前（届いた回の中央 52〜56 秒、seed 1〜12 で 52.7 秒）。たいていは届くが、届かない回もある', () => {
  const ts = Array.from({ length: 12 }, (_, i) => play(i + 1).full);
  const got = ts.filter(Number.isFinite).sort((a, b) => a - b);
  expect(got.length).toBeGreaterThanOrEqual(8);
  expect(got.length).toBeLessThanOrEqual(11); // 上手に遊んでも失敗することがある
  const med = got[Math.floor(got.length / 2)];
  expect(med).toBeGreaterThanOrEqual(52);
  expect(med).toBeLessThanOrEqual(56);
});

test('R0 fix1: 払い続ける（払える力があればいつでも払う）のは最善ではない: 満タンに届かず、60 秒の力も最善の操作よりずっと少ない', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
  const spam = seeds.map((s) => play(s, { spam: true }));
  const best = seeds.map((s) => play(s));
  expect(spam.filter((r) => Number.isFinite(r.full)).length).toBe(0);
  expect(best.filter((r) => Number.isFinite(r.full)).length).toBeGreaterThan(spam.filter((r) => Number.isFinite(r.full)).length);
  for (const r of spam) expect(r.end).toBeLessThan(30);
});

test('払わずに長押しし続けるだけでは満タンに届かず、60 秒の力は 70 より十分少ない（払わなければ負ける）', () => {
  const runs = Array.from({ length: 12 }, (_, i) => play(i + 1, { grab: Infinity, crowd: Infinity }));
  for (const r of runs) expect(r.full).toBe(Infinity);
  const ends = runs.map((r) => r.end).sort((a, b) => a - b);
  expect(ends[Math.floor(ends.length / 2)]).toBeLessThan(30);
  expect(Math.max(...ends)).toBeLessThan(70);
  // 掴まれた者 6 人ぶんの減りは、貯める速さより速い
  expect(CONFIG.enemy.maxGrabbing * CONFIG.enemy.drainPerSec).toBeGreaterThan(CONFIG.power.chargePerSec * 1.5);
});

// R1: 吸う者（×2.5）・大物（×4）・2 回払う重い者が来るので、「掴まれてから払う」だけでは 12 回の半分も満タンに届かず、中央の時刻は
// どちらも Infinity になる（前の比べ方では比べられない）。満タンに届いた回の数、同じなら届いた回の中央の時刻で比べる
// TODO(M2): restore the median comparison or add a continuous metric after the retune
test('「何人かに掴ませておく」より、早く払うほうが早く満タンになる', () => {
  const rank = (o) => {
    const got = Array.from({ length: 12 }, (_, i) => play(i + 1, o).full).filter(Number.isFinite).sort((a, b) => a - b);
    return { n: got.length, med: got.length ? got[Math.floor(got.length / 2)] : Infinity };
  };
  const early = rank({ grab: 1, crowd: Infinity });
  const lazy = rank({ grab: 4, crowd: Infinity });
  expect(early.n).toBeGreaterThan(0);
  expect(early.n > lazy.n || (early.n === lazy.n && early.med < lazy.med)).toBe(true);
}, 60000);

// S9: 撃退成功（放った一発で街の軍勢を全員倒す）。最善に近い操作で力が level に届いた瞬間に離す
function releaseAtLevel(seed, level) {
  const g = createGame({ seed });
  g.pressStart();
  const DT = 1 / 30;
  for (let t = 0; t < CONFIG.roundSeconds - DT / 2; t += DT) {
    const n = g.enemies.list.filter((e) => e.state !== 'dead' && e.dist <= BEST.near).length;
    if (g.grabbing >= BEST.grab || n >= BEST.crowd) g.puff();
    g.update(DT);
    if (g.power.value >= level - 1e-6) { g.pressEnd(); g.settle(); return g.outcome; }
  }
  return null; // 届かないまま時間切れ（ブラックホール）
}

test('S9 / R0 fix1: 最善に近い操作で満タンで放てば必ず撃退成功（届かない回もある）。96% で放つと街の外側の見回る者が残って撃退失敗（ほぼ満タンまで貯める意味がある）', () => {
  const seeds = Array.from({ length: 8 }, (_, i) => i + 1);
  const full = seeds.map((s) => releaseAtLevel(s, CONFIG.power.max));
  expect(full.filter((o) => o?.clear).length).toBeGreaterThanOrEqual(6);
  for (const o of full) if (o) expect(o.clear).toBe(true); // 満タンに届けば必ず撃退成功（届かなければ時間切れ）
  for (const level of [70, 90, 96]) {
    for (const s of seeds) {
      const o = releaseAtLevel(s, level);
      if (!o) continue; // そこまで届かない回
      expect(o.clear, `L=${level} seed ${s}`).toBe(false);
      expect(o.survivors.some((v) => v.patrol)).toBe(true);
    }
  }
  // 99% なら、届いた回はみな撃退成功（満タンの少し手前で放っても勝てる）
  for (const s of seeds) { const o = releaseAtLevel(s, 99); if (o) expect(o.clear).toBe(true); }
}, 60000); // R1: 8 の種を何度も最後まで遊ぶ重いテスト（並べて走らせると既定の 5 秒を超える）
