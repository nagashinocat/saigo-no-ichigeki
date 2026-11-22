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

// R1b（持ち主 08:24「宇宙の映像の横一線になって消えるところ、縦一線に消えた方がいいかも」）: 光は縦一線（光の柱）になって細り、消える
import * as THREE from 'three';
const lineOf = (sv) => sv.scene.children.find((o) => o.isMesh && o.material.uniforms?.uThin);
const domeOf = (sv) => sv.scene.children.find((o) => o.isMesh && o.material.uniforms?.uFlat);
const project = (o, cam) => {
  o.updateMatrixWorld();
  return [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(o.matrixWorld).project(cam));
};
for (const [aspect, label] of [[390 / 844, '縦長'], [16 / 9, '横長']]) {
  for (const roll of [0, 0.05]) {
    test(`R1b: 光の線は縦一線（${label}、地平の傾き ${roll}）。街から上へ立ち、地平に垂直、縦の長さは横の太さよりずっと大きい`, () => {
      const sv = createSpaceView('low');
      sv.aim({ aspect, dist: 260, alt: aspect < 1 ? 46 : 64, lookAhead: 420, lookUp: aspect < 1 ? -250 : -40, fovH: 50, fovV: 30, roll });
      sv.setLine(40, 3, 0.2, 1);
      const line = lineOf(sv);
      expect(line.visible).toBe(true);
      const pts = project(line, sv.camera);
      // 画面の縦横比をそろえて幅と高さを測る
      const xs = pts.map((p) => p.x * aspect), ys = pts.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      expect(h).toBeGreaterThan(w * 6);
      // 地平に垂直: 傾きの無い画面ではまっすぐ縦、傾いた画面では地平と同じだけ傾く（カメラの傾き roll）
      const top = pts[2].clone().add(pts[3]).multiplyScalar(0.5), bot = pts[0].clone().add(pts[1]).multiplyScalar(0.5);
      const tilt = Math.atan2((top.x - bot.x) * aspect, top.y - bot.y);
      expect(Math.abs(Math.abs(tilt) - roll)).toBeLessThan(0.01);
      expect(top.y).toBeGreaterThan(bot.y);
      // 街（地球のてっぺん）は線の下の端の近く（柱は街から上へ立つ）
      const city = new THREE.Vector3(0, 0, 0).project(sv.camera);
      expect(city.y).toBeLessThan(bot.y + 0.3 * h);
      expect(city.y).toBeGreaterThan(bot.y - 0.05);
    });
  }
}

test('R1b: 光の半球は押しつぶされると横ではなく縦へ: 幅が細り、高さが伸びる（光の柱）', () => {
  const sv = createSpaceView('low');
  const dome = domeOf(sv);
  sv.setDome(10, 0, 1, 0);
  expect(dome.scale.x).toBeCloseTo(10, 6);
  expect(dome.scale.y).toBeCloseTo(10, 6);
  sv.setDome(10, 0.6, 1, 0);
  expect(dome.scale.x).toBeLessThan(10 * 0.6);
  expect(dome.scale.y).toBeGreaterThan(10 * 1.5);
  expect(dome.scale.z).toBeCloseTo(dome.scale.x, 9);
  sv.setDome(10, 1, 1, 0);
  expect(dome.scale.x).toBeLessThan(0.2);
  expect(dome.scale.y).toBeGreaterThan(dome.scale.x * 50);
});
