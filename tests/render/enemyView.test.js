import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createEnemyView, ENEMY_LOOK } from '../../src/render/enemyView.js';
import { CONFIG } from '../../src/config.js';

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

test('主人公の体の差し替え: 粗い体で始め、細かい体ができたら差し替える（建物の陰の重ねも同じ体、材質と位置はそのまま）', async () => {
  const { buildHeroBody } = await import('../../src/render/heroBody.js');
  const low = buildHeroBody({ detail: 'low' }), mid = buildHeroBody({ detail: 'mid' });
  const view = createEnemyView(new THREE.Scene(), 'mid', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize(), heroBody: low });
  expect(view.hero.geometry).toBe(low.geometry);
  const xray = view.group.getObjectByName('hero-xray');
  expect(xray.geometry).toBe(low.geometry);
  const mat = view.hero.material, xmat = xray.material;
  view.setHeroYaw(0.7);
  view.sync([], {});
  view.setHeroBody(mid);
  expect(view.hero.geometry).toBe(mid.geometry);
  expect(xray.geometry).toBe(mid.geometry);
  expect(view.heroBody).toBe(mid);
  expect(view.hero.material).toBe(mat);
  expect(xray.material).toBe(xmat);
  expect(view.heroBuildMs).toBe(mid.buildMs);
  // シェーダーが読む属性はどちらの体にもある（差し替えてもシェーダーを作り直さない）
  for (const k of Object.keys(low.geometry.attributes)) expect(mid.geometry.attributes[k]?.itemSize, k).toBe(low.geometry.attributes[k].itemSize);
  view.sync([], {});
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  view.hero.getMatrixAt(0, m); p.setFromMatrixPosition(m);
  expect(p.y).toBe(0);
});

test('演出の一人（setFocus）: 本当の場所ではなく演出の決めた姿勢で一度だけ描かれ（同じ人の色）、頭の向きを持ち、keep 0 で消える。null で元に戻る', () => {
  const view = createEnemyView(new THREE.Scene(), 'mid', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  const list = [{ id: 1, angle: 0.3, dist: 40, state: 'approach' }, { id: 2, angle: 2.0, dist: 30, state: 'dead', deadTime: 0 }];
  const pose = { x: 10, y: 3, z: -20, yaw: 0.5, pitch: 0, roll: 0, reach: 0, thrust: 1, keep: 1, head: 0.3 };
  view.setFocus({ id: 2, pose });
  view.sync(list, {});
  expect(view.mesh.count).toBe(2);
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  const found = [0, 1].map((i) => { view.mesh.getMatrixAt(i, m); return p.setFromMatrixPosition(m).toArray(); });
  expect(found.filter((q) => Math.abs(q[0] - 10) < 1e-5 && Math.abs(q[1] - 3) < 1e-5 && Math.abs(q[2] + 20) < 1e-5)).toHaveLength(1);
  const pa = view.mesh.geometry.attributes.aPose;
  expect(pa.itemSize).toBe(3);
  expect(Math.max(...[0, 1].map((i) => pa.getZ(i)))).toBeCloseTo(0.3, 6);
  pose.keep = 0;
  view.sync(list, {});
  expect(view.mesh.count).toBe(1);
  view.setFocus(null);
  view.sync(list, {});
  expect(view.mesh.count).toBe(2);
});

test('R0b 演出の乗り手の列（setFocus の group）: 列の者は本当の場所に描かず、演出の姿勢で一度ずつ描く。名もない者（id: null）も描き、keep 0 で消える', () => {
  const view = createEnemyView(new THREE.Scene(), 'mid', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  const list = [{ id: 1, angle: 0.3, dist: 40, state: 'approach' }, { id: 2, angle: 2.0, dist: 30, state: 'approach' }, { id: 3, angle: 4.0, dist: 50, state: 'approach' }];
  const pose = (x) => ({ x, y: 30, z: -200, yaw: 0, pitch: 0, roll: 0, reach: 0, thrust: 1, keep: 1, head: 0 });
  const g1 = pose(100), g2 = pose(110);
  view.setFocus({ id: 1, pose: pose(90), group: [{ id: 2, pose: g1 }, { id: null, pose: g2 }] });
  view.sync(list, {});
  // 本当の場所に描かれるのは 3 だけ。1（撮る一人）・2・名もない者は演出の姿勢で
  expect(view.mesh.count).toBe(4);
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  const xs = [0, 1, 2, 3].map((i) => { view.mesh.getMatrixAt(i, m); return +p.setFromMatrixPosition(m).x.toFixed(3); });
  for (const x of [90, 100, 110]) expect(xs.filter((v) => v === x)).toHaveLength(1);
  g2.keep = 0;
  view.sync(list, {});
  expect(view.mesh.count).toBe(3);
  view.setFocus(null);
  view.sync(list, {});
  expect(view.mesh.count).toBe(3);
});

test('演出の一人の体（setRiderBody）があれば、その一人は instanced の箱の体ではなく専用の網で、同じ材質・決めた姿勢・頭の向きで描く。keep 0 や focus なしでは出さない', async () => {
  const { buildRiderBody } = await import('../../src/render/riderBody.js');
  const view = createEnemyView(new THREE.Scene(), 'low', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  const body = buildRiderBody({ detail: 'low' });
  view.setRiderBody(body);
  const fm = view.focusMesh;
  expect(fm.geometry).toBe(body.geometry);
  expect(fm.material).toBe(view.mesh.material);
  const list = [{ id: 1, angle: 0.3, dist: 40, state: 'approach' }, { id: 2, angle: 2.0, dist: 30, state: 'approach' }];
  const pose = { x: 10, y: 3, z: -20, yaw: 0.5, pitch: 0.1, roll: 0, reach: 0, thrust: 1.2, keep: 1, head: -0.3 };
  view.setFocus({ id: 2, pose });
  view.sync(list, {});
  expect(view.mesh.count).toBe(1);   // instanced はほかの一人だけ
  expect(fm.visible).toBe(true);
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  fm.getMatrixAt(0, m); p.setFromMatrixPosition(m);
  expect(p.toArray()).toEqual([10, 3, -20]);
  expect(fm.geometry.attributes.aPose.getZ(0)).toBeCloseTo(-0.3, 6);
  expect(fm.geometry.attributes.aPose.getY(0)).toBeCloseTo(1.2, 6);
  pose.keep = 0;
  view.sync(list, {});
  expect(fm.visible).toBe(false);
  view.setFocus(null);
  view.sync(list, {});
  expect(fm.visible).toBe(false);
  expect(view.mesh.count).toBe(2);
});

test('スピード感: 推進の光の尾は一つの instanced の網（バイクごとに描く回数を増やさない）。軍勢と同じ位置を使い、尾の長さと曲がりは bikePose の trail / curve', async () => {
  const { bikePose } = await import('../../src/render/bikePose.js');
  const scene = new THREE.Scene();
  const view = createEnemyView(scene, 'mid', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  const list = [
    { id: 1, x: 13, z: -30, dist: Math.hypot(13, 30), angle: Math.atan2(-30, 13), state: 'search', heading: Math.PI / 2, speed: CONFIG.enemy.searchSpeed, turn: 0, lean: 6 },
    { id: 2, angle: 2.0, dist: 2.5, state: 'grab', grabTime: 1 },
  ];
  view.sync(list, {});
  const trails = scene.getObjectByName('bike-trails');
  expect(trails.isInstancedMesh).toBe(true);
  expect(trails.instanceMatrix).toBe(view.mesh.instanceMatrix);
  expect(trails.count).toBe(view.mesh.count);
  expect(trails.material.blending).toBe(THREE.AdditiveBlending);
  expect(trails.material.depthWrite).toBe(false);
  expect(trails.material.uniforms.uThrust).toBe(view.mesh.material.uniforms.uThrust); // 推進の光と同じ色（夕方の色合わせが効く）
  const mv = view.mesh.geometry.attributes.aMove;
  expect(mv.itemSize).toBe(2);
  expect(trails.geometry.attributes.aMove).toBe(mv);
  for (const [i, e] of list.entries()) {
    const b = bikePose(e, [], 0);
    expect(mv.getX(i)).toBeCloseTo(b.trail, 6);
    expect(mv.getY(i)).toBeCloseTo(b.curve, 6);
  }
  expect(mv.getX(0)).toBeCloseTo(1, 6);
  expect(mv.getX(1)).toBe(0);
  // 乗り手は速いほど前へかがむ（頂点シェーダーが aMove を読む）
  expect(view.mesh.material.vertexShader).toContain('aMove');
});

test('演出・リプレイの間は、上空カメラ用の補助表示（目印・隠れた者の目印・建物の陰の透かし・主人公の透かし）を隠す（sync の aids）', () => {
  const sunDir = new THREE.Vector3(0.3, 1, 0.2).normalize();
  const list = [{ id: 1, angle: 0.3, dist: 40, state: 'approach' }];
  const names = ['soldier-markers', 'soldier-markers-hidden', 'soldiers-xray', 'hero-xray'];
  for (const tier of ['low', 'mid', 'high']) {
    const scene = new THREE.Scene();
    const view = createEnemyView(scene, tier, { sunDir });
    view.sync(list, {});
    const before = names.map((n) => scene.getObjectByName(n).visible);
    view.sync(list, { aids: false });
    for (const n of names) expect(scene.getObjectByName(n).visible, `${tier} ${n}`).toBe(false);
    expect(view.mesh.visible).toBe(true);
    view.sync(list, { aids: true });
    expect(names.map((n) => scene.getObjectByName(n).visible), tier).toEqual(before);
    // 隠している間に段が下がっても、戻したときは今の段どおり
    view.sync(list, { aids: false });
    view.setTier('low');
    expect(scene.getObjectByName('soldiers-xray').visible).toBe(false);
    view.sync(list, { aids: true });
    expect(scene.getObjectByName('soldiers-xray').visible).toBe(false);
    expect(scene.getObjectByName('soldier-markers').visible).toBe(true);
  }
});

test('low の段（bloom なし）では、地面の推進の光の溜まりを大きく明るくする（段が下がったときも）', () => {
  const sunDir = new THREE.Vector3(0.3, 1, 0.2).normalize();
  const u = (t) => createEnemyView(new THREE.Scene(), t, { sunDir }).shadows.material.uniforms.uPool.value;
  expect(u('low')).toBeGreaterThan(u('mid') * 1.4);
  expect(u('high')).toBe(u('mid'));
  const view = createEnemyView(new THREE.Scene(), 'mid', { sunDir });
  view.setTier('low');
  expect(view.shadows.material.uniforms.uPool.value).toBe(u('low'));
});

test('演出の一人の専用の体にも aMove がある（尾は引かず、前かがみは決めた姿勢のまま）', async () => {
  const { buildRiderBody } = await import('../../src/render/riderBody.js');
  const view = createEnemyView(new THREE.Scene(), 'low', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  view.setRiderBody(buildRiderBody({ detail: 'low' }));
  view.setFocus({ id: 1, pose: { x: 1, y: 1, z: 1, yaw: 0, pitch: 0, roll: 0, reach: 0, thrust: 1, keep: 1 } });
  view.sync([{ id: 1, angle: 0, dist: 20, state: 'approach' }], {});
  const mv = view.focusMesh.geometry.attributes.aMove;
  expect(mv.itemSize).toBe(2);
  expect(mv.getX(0)).toBe(0);
});
