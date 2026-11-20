import { test, expect } from 'vitest';
import { createReserve } from '../../src/game/reserve.js';

test('自然に満ちるが max を超えない', () => { const r = createReserve(); r.regen(100); expect(r.value).toBe(100); });
test('draw は minLeft を残す', () => { const r = createReserve(); expect(r.draw(1000)).toBe(55); expect(r.value).toBe(5); });
test('drain は 0 まで減らせる', () => { const r = createReserve(); r.drain(1000); expect(r.value).toBe(0); expect(r.isEmpty()).toBe(true); });
