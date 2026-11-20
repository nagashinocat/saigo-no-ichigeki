import { test, expect } from 'vitest';
import { createPower } from '../../src/game/power.js';

const cfg = { max: 100, chargePerSec: 2.5, minRelease: 10 };

test('貯めた力は 0 から始まり、add は max で止まって実際に増えた量を返す', () => {
  const p = createPower(cfg);
  expect(p.value).toBe(0);
  expect(p.level).toBe(0);
  expect(p.add(30)).toBe(30);
  expect(p.add(90)).toBe(70);
  expect(p.value).toBe(100);
  expect(p.level).toBe(1);
  expect(p.add(-5)).toBe(0); // 負の量では減らない
  expect(p.value).toBe(100);
});

test('spend は足りるときだけ使い true、足りなければ何も使わず false', () => {
  const p = createPower(cfg);
  p.add(10);
  expect(p.spend(8)).toBe(true);
  expect(p.value).toBe(2);
  expect(p.spend(8)).toBe(false);
  expect(p.value).toBe(2);
  expect(p.canSpend(2)).toBe(true);
  expect(p.canSpend(2.01)).toBe(false);
});

test('drain は 0 まで減らせ、0 より下にはならない', () => {
  const p = createPower(cfg);
  p.add(5);
  p.drain(3);
  expect(p.value).toBe(2);
  p.drain(1000);
  expect(p.value).toBe(0);
  p.drain(-4); // 負の量では増えない
  expect(p.value).toBe(0);
});

test('take は貯めた力をすべて取り出して 0 にする', () => {
  const p = createPower(cfg);
  p.add(42);
  expect(p.take()).toBe(42);
  expect(p.value).toBe(0);
});
