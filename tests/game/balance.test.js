import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// 持ち主が選んだ釣り合い（「ギリギリのスリル」: 最善の操作で満タンが最後の数秒、払わなければ負ける）。scripts/balance-sim.mjs と同じ自動の操作。
// 2026-11-21: 軍勢を速くし、湧き方を「終盤ほど一気に増やす」にしたあと、sim の最善は「ずっと長押しし、1 人に掴まれるか 4m 以内に 1 人来たら払う」
// （seed 1〜30 で満タンの中央 50.6 秒、30/30）。前（軍勢が道路を探し回るようになる前）も中央 約 50 秒だった
function play(seed, { grab = 1, near = 4, crowd = 1 } = {}) {
  const g = createGame({ seed });
  g.pressStart();
  const DT = 1 / 30;
  let t = 0;
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2) {
    const n = g.enemies.list.filter((e) => e.state !== 'dead' && e.dist <= near).length;
    if (g.grabbing >= grab || n >= crowd) g.puff();
    g.update(DT); t += DT;
    if (g.power.value >= CONFIG.power.max - 1e-6) return { full: t, end: g.power.value };
  }
  return { full: Infinity, end: g.power.value };
}

test('最善に近い操作で、満タンになるのは終わりの 10 秒ほど前（前とほぼ同じ）。たいていの回で届く', () => {
  const ts = Array.from({ length: 12 }, (_, i) => play(i + 1).full).sort((a, b) => a - b);
  const reached = ts.filter(Number.isFinite).length;
  expect(reached).toBeGreaterThanOrEqual(10);
  const med = ts[Math.floor(ts.length / 2)];
  expect(med).toBeGreaterThan(46);
  expect(med).toBeLessThan(56);
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

test('「何人かに掴ませておく」より、早く払うほうが早く満タンになる', () => {
  const med = (o) => { const ts = Array.from({ length: 12 }, (_, i) => play(i + 1, o).full).sort((a, b) => a - b); return ts[6]; };
  const early = med({ grab: 1, crowd: Infinity });
  const lazy = med({ grab: 4, crowd: Infinity });
  expect(early).toBeLessThan(lazy);
});
