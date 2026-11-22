import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// M2（持ち主 09:11、spec §16「払うを 3 回くらいの回数制限」）: 1 回のゲームで払うのは puff.uses 回まで。払うたびに力も cost 使う
const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0 } };
const step = (g, n, dt = 0.1) => { for (let i = 0; i < n; i++) g.update(dt); };
const settlePuff = (g) => { for (let i = 0; i < 100 && g.blasts.length; i++) g.update(0.1); };

test('M2: 払うは 1 回のゲームで 3 回まで（puff.uses）。使い切ると、力が足りていても払えない', () => {
  expect(CONFIG.puff.uses).toBe(3);
  const g = createGame({ seed: 1, cfg: quiet });
  expect(g.puffsLeft).toBe(3);
  g.pressStart();
  step(g, 200); // 20 秒溜める（60 の力）
  for (let k = 0; k < 3; k++) {
    expect(g.canPuff).toBe(true);
    expect(g.puff()).toBe(true);
    expect(g.puffsLeft).toBe(2 - k);
    settlePuff(g);
  }
  const v = g.power.value;
  expect(v).toBeGreaterThan(CONFIG.puff.cost * 3);
  expect(g.canPuff).toBe(false);
  expect(g.puff()).toBe(false);
  expect(g.power.value).toBe(v); // 何も使わない
  expect(g.puffsLeft).toBe(0);
});

test('M2: 力が足りずに払えなかったとき・広がっている間に押したときは、回数を使わない', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.pressStart();
  expect(g.puff()).toBe(false); // 力 0
  expect(g.puffsLeft).toBe(3);
  step(g, 60);
  expect(g.puff()).toBe(true);
  expect(g.puff()).toBe(false); // 前の払うが広がっている間
  expect(g.puffsLeft).toBe(2);
});

test('M2: 払えない理由（puffBlock）: 回数を使い切った「out」・力が足りない「short」・広がっている間「busy」。払えるときは null', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.pressStart();
  expect(g.puffBlock).toBe('short');
  step(g, 200);
  expect(g.puffBlock).toBe(null);
  g.puff();
  expect(g.puffBlock).toBe('busy');
  settlePuff(g); g.puff(); settlePuff(g); g.puff(); settlePuff(g);
  expect(g.puffBlock).toBe('out');
});

test('M2: 払うたびに力も少し使う（cost は 4〜5% から調整した値。0 ではない）', () => {
  expect(CONFIG.puff.cost).toBeGreaterThan(0);
  expect(CONFIG.puff.cost / CONFIG.power.max).toBeLessThanOrEqual(0.08);
});
