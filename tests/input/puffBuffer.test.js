import { test, expect } from 'vitest';
import { createPuffBuffer } from '../../src/input/puffBuffer.js';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// R1f（持ち主 18:14「払うの反応を確実にする」）: 前の払うが広がっている間（busy）のタップは捨てずに、広がり終わったら払う
test('R1f: busy のタップは覚え、払えるようになったら一度だけ返す。holdSec を過ぎたら捨てる。short / out は覚えない', () => {
  const b = createPuffBuffer({ holdSec: 0.45 });
  expect(b.push(10, 20, 1, 'short')).toBe(false);
  expect(b.push(10, 20, 1, 'out')).toBe(false);
  expect(b.push(10, 20, 1, 'busy')).toBe(true);
  expect(b.take(1.1, false)).toBeNull();
  expect(b.take(1.2, true)).toEqual({ x: 10, y: 20, t: 1 });
  expect(b.take(1.25, true)).toBeNull();
  b.push(5, 5, 2, 'busy');
  expect(b.take(2.5, true)).toBeNull(); // 古い
});

test('R1f: 続けて 2 回タップすると（2 回目は 1 回目の払うが広がっている間）、2 回目も払える（取りこぼさない）', () => {
  const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 } } };
  const g = createGame({ seed: 1, cfg: quiet });
  g.begin(); g.pressStart();
  g.power.add(40);
  const b = createPuffBuffer();
  let t = 0;
  const tap = () => { if (!g.puff()) b.push(0, 0, t, g.puffBlock); };
  tap();
  for (let i = 0; i < 3; i++) { g.update(1 / 30); t += 1 / 30; }
  tap(); // まだ広がっている
  expect(g.puffsLeft).toBe(CONFIG.puff.uses - 1);
  expect(b.pending).not.toBeNull();
  for (let i = 0; i < 30 && b.pending; i++) { g.update(1 / 30); t += 1 / 30; if (b.take(t, g.canPuff)) g.puff(); }
  expect(g.puffsLeft).toBe(CONFIG.puff.uses - 2);
});
