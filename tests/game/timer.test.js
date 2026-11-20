import { test, expect } from 'vitest';
import { createTimer } from '../../src/game/timer.js';

test('pause 中は減らない', () => {
  const t = createTimer(60); t.pause(); expect(t.paused).toBe(true); t.update(5); expect(t.remaining).toBe(60);
  t.resume(); expect(t.paused).toBe(false); t.update(5); expect(t.remaining).toBe(55);
});
test('0 未満にならず isOver', () => {
  const t = createTimer(1); expect(t.isOver()).toBe(false); t.update(3); expect(t.remaining).toBe(0); expect(t.isOver()).toBe(true);
});
test('メソッドを分割代入しても動く', () => {
  const { update, pause } = createTimer(10); pause(); update(1); const t = createTimer(10); const { update: u } = t; u(2); expect(t.remaining).toBe(8);
});
