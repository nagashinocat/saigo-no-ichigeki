import { test, expect } from 'vitest';
import { createBlast } from '../../src/game/blast.js';
import { CONFIG } from '../../src/config.js';

const shot = (radius) => ({ amount: 50, radius, isBig: true });

test('front は speed で広がり shot.radius で止まって done', () => {
  const b = createBlast(shot(100), []);
  expect(b.front).toBe(0); expect(b.done).toBe(false);
  b.update(0.5);
  expect(b.front).toBeCloseTo(CONFIG.blast.speed * 0.5); expect(b.done).toBe(false);
  b.update(5);
  expect(b.front).toBe(100); expect(b.done).toBe(true);
  b.update(1); expect(b.front).toBe(100);
});
test('各対象は front が dist を越えた更新で一度だけ Hit になる', () => {
  const b = createBlast(shot(300), [{ id: 2, dist: 100 }, { id: 1, dist: 40 }, { id: 3, dist: 40 }]);
  expect(b.update(0.1)).toEqual([]); // front 16
  const h = b.update(0.2); // front 48
  expect(h.map((x) => x.id).sort()).toEqual([1, 3]);
  expect(b.update(0.5).map((x) => x.id)).toEqual([2]); // front 128
  expect(b.update(1)).toEqual([]);
});
test('dist < radius*vaporizeRatio は vaporize、それ以外は push', () => {
  const r = 200, lim = r * CONFIG.blast.vaporizeRatio; // 36
  const b = createBlast(shot(r), [{ id: 1, dist: lim - 1 }, { id: 2, dist: lim }, { id: 3, dist: 150 }]);
  const h = b.update(2);
  expect(h.find((x) => x.id === 1).kind).toBe('vaporize');
  expect(h.find((x) => x.id === 2).kind).toBe('push');
  expect(h.find((x) => x.id === 3).kind).toBe('push');
});
test('radius より遠い対象は Hit にならない', () => {
  const b = createBlast(shot(100), [{ id: 1, dist: 100.5 }, { id: 2, dist: 100 }]);
  const h = b.update(10);
  expect(h.map((x) => x.id)).toEqual([2]); expect(b.done).toBe(true);
});
