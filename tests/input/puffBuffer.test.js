import { test, expect } from 'vitest';
import { createPuffBuffer } from '../../src/input/puffBuffer.js';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// R1f（持ち主 18:14「払うの反応を確実にする」）: 前の払うが広がり終わる間際（busy の残り windowSec 秒の内）のタップは捨てずに、
// 広がり終わったら払う。fix1（見直し Minor 5）: 広がり始めの直後の焦った 2 回目は覚えない（3 回しかない払うを 2 回使わない）
const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 } } };

test('R1f fix1: busy の残り windowSec（約 0.25 秒）の内のタップだけ覚え、払えるようになったら一度だけ返す。short / out・早すぎるタップは覚えない', () => {
  const b = createPuffBuffer();
  expect(b.windowSec).toBeGreaterThanOrEqual(0.2);
  expect(b.windowSec).toBeLessThanOrEqual(0.3);
  expect(b.push(10, 20, 1, 'short', 0)).toBe(false);
  expect(b.push(10, 20, 1, 'out', 0)).toBe(false);
  expect(b.push(10, 20, 1, 'busy', 0.5)).toBe(false); // 広がり始め: 覚えない
  expect(b.push(10, 20, 1, 'busy', b.windowSec + 0.01)).toBe(false); // しきいの外
  expect(b.push(10, 20, 1, 'busy', b.windowSec - 0.01)).toBe(true); // しきいの内
  expect(b.take(1.1, false)).toBeNull();
  expect(b.take(1.2, true)).toEqual({ x: 10, y: 20, t: 1 });
  expect(b.take(1.25, true)).toBeNull();
  b.push(5, 5, 2, 'busy', 0.1);
  expect(b.take(2 + b.windowSec + 0.2, true)).toBeNull(); // 古い
});

function rig() {
  const g = createGame({ seed: 1, cfg: quiet });
  g.begin(); g.pressStart();
  g.power.add(40);
  const b = createPuffBuffer();
  let t = 0;
  const tap = () => { if (!g.puff()) b.push(0, 0, t, g.puffBlock, g.puffBusyLeft); };
  const run = (frames) => { for (let i = 0; i < frames; i++) { g.update(1 / 30); t += 1 / 30; if (b.take(t, g.canPuff)) g.puff(); } };
  return { g, b, tap, run };
}

test('R1f fix1: 広がり終わる間際の 2 回目のタップは払える（取りこぼさない）。広がり始めの直後の 2 回目は使わない', () => {
  const late = rig();
  late.tap();
  expect(late.g.puffBusyLeft).toBeGreaterThan(0.4);
  while (late.g.puffBusyLeft > 0.15) late.run(1);
  late.tap(); // 間際
  expect(late.b.pending).not.toBeNull();
  late.run(15);
  expect(late.g.puffsLeft).toBe(CONFIG.puff.uses - 2);
  const early = rig();
  early.tap();
  early.run(3);
  early.tap(); // 0.1 秒後の焦った 2 回目
  early.run(30);
  expect(early.g.puffsLeft).toBe(CONFIG.puff.uses - 1);
});
