import { test, expect } from 'vitest';
import { createNearPhysics } from '../../src/world/nearPhysics.js';

const box = (x = 0, y = 20, z = 0) => ({ min: [x - 1, y - 1, z - 1], max: [x + 1, y + 1, z + 1] });

test('nearPhysics.add は budget を超えると false', () => {
  const np = createNearPhysics(2);
  expect(np.add(box(), [0, 0, 0])).toBe(true);
  expect(np.add(box(5), [0, 0, 0])).toBe(true);
  expect(np.add(box(10), [0, 0, 0])).toBe(false);
  expect(np.bodies.length).toBe(2);
});

test('step で落ちて地面で止まり、役目を終えた物体は枠を空ける', () => {
  const np = createNearPhysics(1);
  np.add(box(0, 5), [0, 0, 0]);
  const dust = [];
  for (let t = 0; t < 6; t += 1 / 60) dust.push(...np.step(1 / 60));
  expect(np.bodies.length).toBe(0);
  expect(dust.length).toBe(1);
  expect(np.add(box(), [0, 0, 0])).toBe(true);
});
