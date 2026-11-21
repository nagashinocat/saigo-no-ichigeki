import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createExplosionView } from '../../src/render/explosionView.js';
import { createCityView } from '../../src/render/cityView.js';
import { createStyle } from '../../src/render/style.js';
import { createFrontTracker } from '../../src/render/sphereDeform.js';
import { generateCity } from '../../src/world/cityGen.js';
import { frontAt } from '../../src/game/blast.js';

// リプレイ: 描く側も最後の一発の直前へ戻せる

const camera = new THREE.PerspectiveCamera(60, 1, 1, 5000);

function playBlast(view, radius = 200, sec = 1.2) {
  const b = { id: 9, shot: { radius, isBig: true }, front: 0 };
  let t = 0;
  for (let i = 0; i < sec * 60; i++) {
    t += 1 / 60;
    b.front = frontAt(t, radius);
    view.update(1 / 60, [b], camera, 500, b.front);
    if (i === 10) view.vaporize({ x: 5, z: 5, w: 6, d: 6, h: 10, color: [1, 1, 1] });
    if (i % 7 === 0) view.dust([{ pos: [50, 2, 0], size: 4 }]);
  }
}
const dustOf = (scene) => {
  let mesh = null;
  scene.traverse((o) => { if (o.name === 'dust') mesh = o; });
  return mesh.geometry;
};

test('explosionView.reset: 球・閃光・揺れ・粉・溶ける箱が消え、同じ一発を与えると同じ見た目になる', () => {
  const scene = new THREE.Scene();
  const view = createExplosionView(scene, 'mid', { seed: 4 });
  playBlast(view);
  const geo = dustOf(scene);
  const first = { pos: geo.getAttribute('aPos').array.slice(), life: geo.getAttribute('aLife').array.slice(), n: geo.instanceCount };
  view.reset();
  expect(view.busy).toBe(false);
  expect(view.screen.flash).toBe(0);
  expect(view.cameraInfo.shake).toBe(0);
  expect(view.ground.ember).toBe(0);
  let spheres = 0;
  scene.traverse((o) => { if (o.material?.uniforms?.uBirth && o.visible) spheres++; });
  expect(spheres).toBe(0);
  expect(geo.instanceCount).toBe(0);
  // 時間は進んだままでも、粒の並びと乱数は同じになる（生まれた時刻は今の時刻からの差で比べる）
  const t0 = view.screen.time;
  playBlast(view);
  expect(geo.instanceCount).toBe(first.n);
  expect(Array.from(geo.getAttribute('aPos').array)).toEqual(Array.from(first.pos));
  const life = geo.getAttribute('aLife').array;
  for (let i = 0; i < first.n; i++) expect(life[i * 4] - t0).toBeCloseTo(first.life[i * 4], 6);
});

test('cityView の snapshot / restore: つぶした・隠したビルと props が元へ戻り、全部 GPU へ送り直す', () => {
  const city = generateCity(3);
  const view = createCityView(city, createStyle('low'), 'low');
  const meshes = [];
  view.group.traverse((o) => { if (o.isInstancedMesh) meshes.push(o); });
  const before = meshes.map((m) => m.instanceMatrix.array.slice());
  const snap = view.snapshot();
  view.update(0.5, {});
  view.crushBuilding(city.buildings[0].id, 0.4);
  view.hideBuilding(city.buildings[1].id);
  view.hideProp(city.props[0].id);
  const changed = meshes.some((m, i) => m.instanceMatrix.array.some((v, k) => v !== before[i][k]));
  expect(changed).toBe(true);
  const versions = meshes.map((m) => m.instanceMatrix.version);
  view.restore(snap);
  meshes.forEach((m, i) => {
    expect(Array.from(m.instanceMatrix.array)).toEqual(Array.from(before[i]));
    expect(m.instanceMatrix.version).toBeGreaterThan(versions[i]);
    expect(m.instanceMatrix.updateRanges.length).toBe(0); // 一部だけでなく全部を送る
    const crush = m.geometry.getAttribute('aCrush');
    if (crush) expect(crush.updateRanges.length).toBe(0);
  });
  const e = meshes.find((m) => m.geometry.getAttribute('aCrush'));
  expect(Array.from(e.geometry.getAttribute('aCrush').array)).toEqual(Array.from(snap.attrs.find((a) => a.attr === e.geometry.getAttribute('aCrush')).array));
});

test('frontTracker.reset: えぐれた穴の記憶を消す', () => {
  const tr = createFrontTracker();
  tr.update([{ id: 1, front: 50, shot: { radius: 100 } }]);
  tr.update([]);
  expect(tr.crater).toBe(100);
  tr.reset();
  expect(tr.crater).toBe(0);
  expect(tr.update([])).toEqual([]);
  expect(tr.update([{ id: 1, front: 5, shot: { radius: 100 } }])).toEqual([5, 5]);
});

test('cityView の veilBuilding: 一時的に隠し、戻すと元の姿へ（屋上の設備も）。その間に本当に隠された・つぶし始めたビルは戻さない', () => {
  const city = generateCity(3);
  const view = createCityView(city, createStyle('low'), 'low');
  const meshes = [];
  view.group.traverse((o) => { if (o.isInstancedMesh) meshes.push(o); });
  const before = meshes.map((m) => m.instanceMatrix.array.slice());
  const ids = city.buildings.slice(0, 3).map((b) => b.id);
  for (const id of ids) view.veilBuilding(id, true);
  const m = new THREE.Matrix4();
  for (const id of ids) { const { mesh, index } = view.getBuildingMesh(id); mesh.getMatrixAt(index, m); expect(m.determinant()).toBe(0); }
  view.hideBuilding(ids[1]);           // 隠している間に光に溶けた
  view.crushBuilding(ids[2], 0.4);     // 隠している間につぶれ始めた: ビルは戻すが屋上の設備は戻さない
  for (const id of ids) view.veilBuilding(id, false);
  const g0 = view.getBuildingMesh(ids[0]), g1 = view.getBuildingMesh(ids[1]), g2 = view.getBuildingMesh(ids[2]);
  g0.mesh.getMatrixAt(g0.index, m); expect(m.determinant()).not.toBe(0);
  g1.mesh.getMatrixAt(g1.index, m); expect(m.determinant()).toBe(0);
  g2.mesh.getMatrixAt(g2.index, m); expect(m.determinant()).not.toBe(0);
  // ids[0] は屋上の設備まで元どおり
  const i0 = meshes.findIndex((x) => x === g0.mesh);
  expect(Array.from(g0.mesh.instanceMatrix.array.slice(g0.index * 16, g0.index * 16 + 16))).toEqual(Array.from(before[i0].slice(g0.index * 16, g0.index * 16 + 16)));
});
