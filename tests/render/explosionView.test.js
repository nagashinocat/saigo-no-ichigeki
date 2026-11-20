import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createExplosionView } from '../../src/render/explosionView.js';
import { TIERS } from '../../src/render/quality.js';
import { CONFIG } from '../../src/config.js';

const camera = new THREE.PerspectiveCamera(60, 1, 1, 5000);
const make = (tier = 'mid') => {
  const scene = new THREE.Scene();
  return { scene, view: createExplosionView(scene, tier, { sunDir: new THREE.Vector3(0.8, 0.4, -0.4).normalize() }) };
};
const shot = (radius) => ({ amount: 10, radius, isBig: false });
const spheresVisible = (scene) => {
  let n = 0;
  scene.traverse((o) => { if (o.material?.uniforms?.uBirth && o.visible) n++; });
  return n;
};
// blasts を game.blasts と同じ形で進める
function run(view, list, sec, dt = 1 / 60) {
  for (let t = 0; t < sec; t += dt) {
    for (const b of list) b.front = Math.min(b.shot.radius, b.front + CONFIG.blast.speed * dt);
    const live = list.filter((b) => b.front < b.shot.radius);
    view.update(dt, live, camera, 500);
  }
}

test('同時に生きている一発ごとに球を描き、終わった球は消えていき、やがて busy でなくなる', () => {
  const { scene, view } = make();
  const list = [{ id: 1, shot: shot(200), front: 0 }, { id: 2, shot: shot(80), front: 0 }];
  view.update(1 / 60, list, camera, 500);
  expect(spheresVisible(scene)).toBe(2);
  expect(view.busy).toBe(true);
  run(view, list, 2.5);
  expect(spheresVisible(scene)).toBe(0);
  expect(view.busy).toBe(false);
});

test('粉の粒の数は dustMax を超えない', () => {
  for (const tier of ['low', 'mid']) {
    const { scene, view } = make(tier);
    const dust = scene.getObjectByName('dust');
    for (let i = 0; i < 40; i++) {
      view.dust(Array.from({ length: 300 }, (_, k) => ({ pos: [k, 5, i], size: 3 })));
      view.update(1 / 60, [], camera, 500);
    }
    expect(dust.geometry.instanceCount).toBeLessThanOrEqual(TIERS[tier].dustMax);
    expect(dust.geometry.attributes.aPos.count).toBe(TIERS[tier].dustMax);
  }
});

test('放つと白く光ってすぐ収まり、揺れは front が速く広がる間だけ出る', () => {
  const { view } = make();
  view.begin(shot(300));
  view.update(1 / 60, [], camera, 500);
  expect(view.screen.flash).toBeGreaterThan(0.5);
  view.update(0.5, [], camera, 500);
  expect(view.screen.flash).toBe(0);

  const b = { id: 7, shot: shot(300), front: 0 };
  run(view, [b], 0.5);
  const growing = view.cameraInfo.shake;
  expect(growing).toBeGreaterThan(0);
  // 同じ速さなら大きな一発ほど揺れが大きい
  const small = make().view;
  run(small, [{ id: 1, shot: shot(60), front: 0 }], 0.3);
  expect(small.cameraInfo.shake).toBeLessThan(growing);
  run(view, [b], 3);
  expect(view.cameraInfo.shake).toBeLessThan(growing * 0.01);
});

test('cameraInfo は今の球の大きさと、先回りの大きさ（最後の半径を超えない）を返す', () => {
  const { view } = make();
  const b = { id: 3, shot: shot(400), front: 0 };
  run(view, [b], 0.5);
  const { front, goal } = view.cameraInfo;
  expect(front).toBeCloseTo(b.front, 5);
  expect(goal).toBeGreaterThan(front);
  expect(goal).toBeLessThanOrEqual(400);
});

test('vaporize は光に溶ける箱を置き、溶け終わるまで busy', () => {
  const { scene, view } = make();
  view.vaporize({ x: 10, z: 5, w: 12, d: 10, h: 30, color: [0.6, 0.6, 0.65] });
  view.update(1 / 60, [], camera, 500);
  const boxes = scene.getObjectByName('vaporize').children.find((c) => c.isInstancedMesh);
  expect(boxes.count).toBe(1);
  expect(view.busy).toBe(true);
  for (let i = 0; i < 300; i++) view.update(1 / 60, [], camera, 500);
  expect(view.busy).toBe(false);
});

test('同時の一発が球の数を超えても、一番古い球を使い回して最新の一発を描く', () => {
  const { scene, view } = make();
  const list = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, shot: shot(400), front: 0 }));
  for (const b of list) { view.update(1 / 60, list.slice(0, b.id), camera, 500); }
  expect(spheresVisible(scene)).toBe(6);
  // 使い回された古い一発が消えても、新しい一発の球は残る
  run(view, list.slice(2), 1.2); // 前線はまだ途中（160 m/s × 1.2 s < 400 m）
  expect(spheresVisible(scene)).toBe(6);
  run(view, list.slice(2), 4);
  expect(spheresVisible(scene)).toBe(0);
});
