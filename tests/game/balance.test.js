import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// 持ち主が選んだ釣り合い（「ギリギリのスリル」: 最善の操作で満タンが最後の数秒）。scripts/balance-sim.mjs と同じ自動の操作:
// ずっと長押しし、2 人に掴まれるか、4m 以内に 2 人来たら払う。軍勢が道路を探し回るようになる前（一直線に近づいた頃）は
// 満タンの時刻の中央が約 50 秒（seed 1〜30）だった
function play(seed) {
  const g = createGame({ seed });
  g.pressStart();
  const DT = 1 / 30;
  let t = 0;
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2) {
    const n = g.enemies.list.filter((e) => e.state !== 'dead' && e.dist <= 4).length;
    if (g.grabbing >= 2 || n >= 2) g.puff();
    g.update(DT); t += DT;
    if (g.power.value >= CONFIG.power.max - 1e-6) return t;
  }
  return Infinity;
}

test('最善に近い操作で、満タンになるのは終わりの 10 秒ほど前（前とほぼ同じ）。たいていの回で届く', () => {
  const ts = Array.from({ length: 12 }, (_, i) => play(i + 1)).sort((a, b) => a - b);
  const reached = ts.filter(Number.isFinite).length;
  expect(reached).toBeGreaterThanOrEqual(10);
  const med = ts[Math.floor(ts.length / 2)];
  expect(med).toBeGreaterThan(46);
  expect(med).toBeLessThan(56);
});
