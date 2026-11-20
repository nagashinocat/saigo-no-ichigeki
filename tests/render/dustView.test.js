import { test, expect } from 'vitest';
import { createDustView } from '../../src/render/dustView.js';

const p = { pos: [0, 0, 0], vel: [0, 0, 0], drag: 1, rise: 1, size: 3, grow: 2, life: 2, tint: [1, 1, 1] };

test('描く前に何度 update しても、書いた粒の範囲はすべて GPU へ送る（描画で送られるまで範囲を足していく）', () => {
  const dust = createDustView(64);
  const aPos = dust.mesh.geometry.getAttribute('aPos');
  dust.spawn(0, p); // slot 0
  dust.update(0);
  for (let i = 1; i < 10; i++) dust.spawn(0.1, p); // slot 1..9
  dust.update(0.1);
  dust.update(0.2); // 何も書いていない update は範囲を消さない
  const covered = new Set();
  for (const r of aPos.updateRanges) for (let k = r.start; k < r.start + r.count; k++) covered.add(k);
  for (let slot = 0; slot < 10; slot++) for (let c = 0; c < 3; c++) expect(covered.has(slot * 3 + c)).toBe(true);
  expect(aPos.version).toBeGreaterThan(0);
});
