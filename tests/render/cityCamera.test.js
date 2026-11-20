import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createCityCamera, fitCityCamera, layoutViews } from '../../src/render/views.js';
import { generateCity, GRID } from '../../src/world/cityGen.js';
import { CONFIG } from '../../src/config.js';

// 上空カメラから、広場と軍勢の輪（60m・90m）が見えること（seed 1）
const buildings = generateCity(1).buildings;
const boxes = buildings.map((b) => new THREE.Box3(
  new THREE.Vector3(b.x - b.w / 2, 0, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, b.h, b.z + b.d / 2)));

// 広場の 8 点（中心と、広場の半径の内側の 7 点）
function plazaPoints() {
  const pts = [new THREE.Vector3(0, 1, 0)];
  const r = CONFIG.plazaRadius - 2;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 1, Math.sin(a) * r));
  }
  return pts;
}

// 60m・90m の輪の 24 点。建物の敷地の中の点はどうやっても見えないので、
// 輪の上の点を最寄りの道路の中心線へ寄せる（地上で見えうる場所だけを調べる）。
function ringPoints() {
  const { PITCH } = GRID;
  const off = (v) => v - (Math.round(v / PITCH - 0.5) + 0.5) * PITCH;
  const pts = [];
  for (const r of [60, 90]) for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    let x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(off(x)) < Math.abs(off(z))) x -= off(x); else z -= off(z);
    pts.push(new THREE.Vector3(x, 1, z));
  }
  return pts;
}

// 輪の上そのままの点（画角の判定用。全周が入ること）
function rawRingPoints() {
  const pts = [];
  for (const r of [60, 90]) for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return pts;
}

function cameraFor(width, height) {
  const { city } = layoutViews(width, height);
  const cam = createCityCamera();
  fitCityCamera(cam, city.w / city.h);
  cam.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const hit = new THREE.Vector3();
  const occluded = (p) => {
    const dist = cam.position.distanceTo(p);
    const ray = new THREE.Ray(cam.position.clone(), p.clone().sub(cam.position).normalize());
    return boxes.some((b) => ray.intersectBox(b, hit) && cam.position.distanceTo(hit) < dist - 0.5);
  };
  return { cam, frustum, occluded };
}

test('調べる点は 32 個（広場 8、60m・90m の輪 24）', () => {
  expect(plazaPoints().length + ringPoints().length).toBe(32);
  for (const p of plazaPoints()) expect(Math.hypot(p.x, p.z)).toBeLessThan(CONFIG.plazaRadius);
  for (const p of ringPoints()) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(45);
});

for (const [w, h] of [[390, 844], [1280, 720]]) {
  test(`${w}x${h}: 広場と 60m・90m の輪はすべて画角の中`, () => {
    const { frustum } = cameraFor(w, h);
    for (const p of [...plazaPoints(), ...ringPoints(), ...rawRingPoints()]) expect(frustum.containsPoint(p)).toBe(true);
  });

  test(`${w}x${h}: 広場の点はどれも建物に隠れない`, () => {
    const { occluded } = cameraFor(w, h);
    for (const p of plazaPoints()) expect(occluded(p)).toBe(false);
  });

  test(`${w}x${h}: 輪の点の 40% 以上は建物に隠れない（下限の確認）`, () => {
    const { occluded } = cameraFor(w, h);
    const pts = ringPoints();
    const visible = pts.filter((p) => !occluded(p)).length;
    expect(visible / pts.length).toBeGreaterThanOrEqual(0.4);
  });
}
