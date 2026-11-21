// S8 fix1/fix2: 宇宙の見回る軍勢の点と火花（spaceView.setSparks）
import { test, expect } from 'vitest';
import { createSpaceView } from '../../src/render/spaceView.js';

const sparksOf = (sv) => sv.scene.children.find((o) => o.isPoints && o.geometry.getAttribute('aAge'));

test('setSparks: 渡した点を地表の少し上に置き、年齢（生きていれば -1）を書き、上限 128 で切る。空にすると描かない', () => {
  const sv = createSpaceView('mid');
  const pts = sparksOf(sv);
  expect(pts).toBeTruthy();
  expect(pts.geometry.drawRange.count).toBe(0);
  sv.setSparks([{ x: 1, z: -2, age: -1 }, { x: 3.5, z: 4, age: 0.25 }], 2);
  expect(pts.geometry.drawRange.count).toBe(2);
  const p = pts.geometry.getAttribute('position'), a = pts.geometry.getAttribute('aAge');
  expect([p.getX(0), p.getY(0), p.getZ(0)]).toEqual([1, expect.closeTo(0.15, 6), -2]);
  expect([p.getX(1), p.getZ(1)]).toEqual([3.5, 4]);
  expect(a.getX(0)).toBe(-1);
  expect(a.getX(1)).toBeCloseTo(0.25, 6);
  expect(pts.material.uniforms.uPR.value).toBe(2);
  expect(pts.material.depthTest).toBe(false);
  sv.setSparks(Array.from({ length: 300 }, (_, i) => ({ x: i, z: 0, age: -1 })));
  expect(pts.geometry.drawRange.count).toBe(128);
  sv.setSparks([]);
  expect(pts.geometry.drawRange.count).toBe(0);
});
