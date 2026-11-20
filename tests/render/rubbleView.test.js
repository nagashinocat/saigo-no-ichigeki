import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createRubble } from '../../src/world/rubble.js';
import { createRubbleView } from '../../src/render/rubbleView.js';

// 穴の底に置く。sweep で穴が広がると地面がなくなる
const piece = (x) => ({ pos: [x + 100, -20, 0], rot: [0, 0.5, 0], dims: [2, 1, 1], size: 2, color: [0.4, 0.3, 0.2] });

test('瓦礫の見た目: 置いた slot だけを書いて送り、止まったままのフレームは GPU へ何も送らない', () => {
  const rubble = createRubble(50);
  const view = createRubbleView(new THREE.MeshBasicMaterial(), rubble);
  rubble.add(piece(10)); rubble.add(piece(20)); rubble.add(piece(30));
  view.update();
  const attr = view.mesh.instanceMatrix;
  expect(view.mesh.count).toBe(3);
  expect(attr.updateRanges).toEqual([{ start: 0, count: 3 * 16 }]);
  const mat = new THREE.Matrix4(), pos = new THREE.Vector3();
  view.mesh.getMatrixAt(1, mat);
  expect(pos.setFromMatrixPosition(mat).x).toBeCloseTo(120, 5);
  attr.clearUpdateRanges(); // 描いて GPU へ送ると three が範囲を空にする
  const v = attr.version;
  // 何も変わらないフレーム
  for (let i = 0; i < 10; i++) view.update();
  expect(attr.version).toBe(v);
  // 1つ増えたら、その slot だけ
  rubble.add(piece(40));
  view.update();
  expect(attr.version).toBe(v + 1);
  expect(attr.updateRanges).toEqual([{ start: 3 * 16, count: 16 }]);
  expect(view.mesh.count).toBe(4);
  // 描く前にもう一度進めても、前の変更の範囲は残る
  rubble.add(piece(50));
  view.update();
  expect(attr.updateRanges).toEqual([{ start: 3 * 16, count: 16 }, { start: 4 * 16, count: 16 }]);
  // 呑まれて消えた瓦礫は大きさ 0 で隠す
  rubble.sweep(1000);
  view.update();
  view.mesh.getMatrixAt(0, mat);
  expect(new THREE.Vector3().setFromMatrixScale(mat).length()).toBe(0);
});
