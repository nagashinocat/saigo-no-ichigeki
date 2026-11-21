import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createEnemyView, ENEMY_LOOK } from '../../src/render/enemyView.js';

test('主人公は浮いている: 足元に大きな穴ができても、姿の高さは y=0 のまま', () => {
  const view = createEnemyView(new THREE.Scene(), 'mid', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  for (const fronts of [[], [440], [440, 60]]) {
    view.sync([], { fronts });
    view.hero.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    expect(p.x).toBe(0); expect(p.y).toBe(0); expect(p.z).toBe(0);
  }
});

test('小さすぎる者を大きく描く基準（minPx）は CSS の px: 画素の細かい画面（pixelRatio 3）でも同じ見え方', () => {
  const view = createEnemyView(new THREE.Scene(), 'mid', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  const u = view.mesh.material.uniforms;
  view.sync([], { pointScale: 400, pixelRatio: 1 });
  const one = u.uMinPx.value / u.uPx.value;
  view.sync([], { pointScale: 1200, pixelRatio: 3 });
  expect(u.uMinPx.value / u.uPx.value).toBeCloseTo(one, 9);
  expect(u.uMinPx.value).toBeCloseTo(ENEMY_LOOK.minPx * 3, 9);
});

test('軍勢は浮遊バイクに乗って描かれる: 姿の位置は bikePose（穴の上でも浮く・掴む者は主人公の横）、真下の地面に影を落とす', async () => {
  const { bikePose } = await import('../../src/render/bikePose.js');
  const { groundHeight } = await import('../../src/render/sphereDeform.js');
  const view = createEnemyView(new THREE.Scene(), 'mid', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  const list = [
    { id: 1, angle: 0.3, dist: 40, state: 'approach' },
    { id: 2, angle: 2.0, dist: 2.5, state: 'grab' },
    { id: 3, angle: 4.0, dist: 20, state: 'dead', deadTime: 5 }, // 吹き飛んで消えた
  ];
  const fronts = [60];
  view.sync(list, { fronts });
  expect(view.mesh.count).toBe(2);
  expect(view.shadows.count).toBe(2);
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  for (const [i, e] of [[0, list[0]], [1, list[1]]]) {
    const want = bikePose(e, fronts, 0);
    view.mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(want.x, 5); expect(p.y).toBeCloseTo(want.y, 5); expect(p.z).toBeCloseTo(want.z, 5);
    view.shadows.getMatrixAt(i, m); p.setFromMatrixPosition(m);
    expect(p.y).toBeCloseTo(groundHeight(Math.hypot(want.x, want.z), fronts) + 0.06, 5);
  }
  view.mesh.getMatrixAt(0, m); p.setFromMatrixPosition(m);
  expect(p.y - groundHeight(40, fronts)).toBeGreaterThan(1.8); // 穴の上で浮いている
});

test('建物の陰の軍勢を透かして描く重ね（xray）は high だけ: mid / low は隠れた者を目印の点で示すだけ（バイクの頂点を二度描かない）', () => {
  const sunDir = new THREE.Vector3(0.3, 1, 0.2).normalize();
  const list = [{ id: 1, angle: 0.3, dist: 40, state: 'approach' }, { id: 2, angle: 1.3, dist: 60, state: 'approach' }];
  for (const tier of ['low', 'mid', 'high']) {
    const scene = new THREE.Scene();
    const view = createEnemyView(scene, tier, { sunDir });
    view.sync(list, {});
    const xray = scene.getObjectByName('soldiers-xray');
    expect(xray, tier).toBeTruthy();
    expect(xray.visible, tier).toBe(tier === 'high');
    expect(view.mesh.count).toBe(2);
    // 隠れた者の目印はどの段でも描く
    expect(scene.getObjectByName('soldier-markers-hidden').visible, tier).toBe(true);
  }
  // 画質の段が途中で下がったら、重ねも止める
  const scene = new THREE.Scene();
  const view = createEnemyView(scene, 'high', { sunDir });
  view.setTier('mid');
  expect(scene.getObjectByName('soldiers-xray').visible).toBe(false);
});

test('主人公は heroBody の体（画質の段の細かさ）で、なびく揺れの重みを持つ。影絵の強さは sync の silhouette で決まる', async () => {
  const { buildHeroBody } = await import('../../src/render/heroBody.js');
  const sunDir = new THREE.Vector3(0.3, 1, 0.2).normalize();
  for (const tier of ['low', 'mid', 'high']) {
    const view = createEnemyView(new THREE.Scene(), tier, { sunDir });
    const g = view.hero.geometry;
    expect(g.attributes.position.count, tier).toBe(buildHeroBody({ detail: tier }).counts.vertices);
    expect(g.attributes.aFlut, tier).toBeTruthy();
    expect(view.heroBuildMs, tier).toBeGreaterThan(0);
  }
  const view = createEnemyView(new THREE.Scene(), 'low', { sunDir });
  const u = view.hero.material.uniforms;
  expect(view.hero.material).not.toBe(view.mesh.material); // 軍勢とは別の材質（なびき・ただよい・影絵）
  expect(u.uTime).toBe(view.mesh.material.uniforms.uTime); // 時間や光は軍勢と同じものを使う
  view.sync([], {});
  expect(u.uSil.value).toBe(0);
  view.sync([], { silhouette: 0.9 }); // リプレイの最後のカットの強さで、真っ黒な影絵
  expect(u.uSil.value).toBe(1);
  view.sync([], { silhouette: 0.3 });
  expect(u.uSil.value).toBeGreaterThan(0.3);
  expect(u.uSil.value).toBeLessThan(0.5);
  expect(u.uWind.value.length()).toBeCloseTo(1, 6);
  // 建物の陰の重ねも同じ体と同じ動き
  const xray = view.group.children.find((c) => c.isInstancedMesh && c !== view.hero && c.geometry === view.hero.geometry);
  expect(xray).toBeTruthy();
  expect(xray.material.vertexShader).toBe(view.hero.material.vertexShader);
});
