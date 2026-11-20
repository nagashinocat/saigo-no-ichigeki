import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createCityCamera, fitCityCamera, layoutViews } from '../../src/render/views.js';
import { generateCity, GRID } from '../../src/world/cityGen.js';
import { CONFIG } from '../../src/config.js';

// 上空カメラは近い: 広場を囲む最初の一周の 8 つの街区がしっかり入り、その外側は切れるくらい。
// 軍勢はどの向きから湧いても、すぐ画面に入る。
const SEEDS = [1, 2, 3, 42, 999];
const { PITCH, BLOCK, ROAD } = GRID;
const INNER = PITCH + BLOCK / 2;          // 最初の一周の街区の外の端（35m）
const OUTER_IN = 2 * PITCH - BLOCK / 2;   // 外の一周の街区の内の端（43m）
const OUTER_OUT = 2 * PITCH + BLOCK / 2;  // 外の一周の街区の外の端（61m）

const cities = new Map(SEEDS.map((s) => [s, generateCity(s).buildings]));
// 最初の一周の街区（中心が格子の ±1 以内）にある建物
const firstRing = (seed) => cities.get(seed).filter((b) => Math.max(Math.abs(b.x), Math.abs(b.z)) < PITCH + BLOCK / 2);
const boxesOf = (seed) => cities.get(seed).map((b) => new THREE.Box3(
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

// 最初の一周の 8 つの街区の地面の角と辺の中点（±35m の正方形）
function innerSquare() {
  const pts = [];
  for (const x of [-INNER, 0, INNER]) for (const z of [-INNER, 0, INNER]) if (x || z) pts.push(new THREE.Vector3(x, 0, z));
  return pts;
}

// 建物の屋上と足元の角 8 点
function corners(b) {
  const pts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, b.h]) pts.push(new THREE.Vector3(b.x + sx * b.w / 2, y, b.z + sz * b.d / 2));
  return pts;
}

// 湧く距離 r の輪の 24 点。建物の敷地の中の点はどうやっても見えないので、
// 輪の上の点を最寄りの道路の中心線へ寄せる（地上で見えうる場所だけを調べる）。
function spawnRoadPoints() {
  const off = (v) => v - (Math.round(v / PITCH - 0.5) + 0.5) * PITCH;
  const pts = [];
  for (const r of CONFIG.enemy.spawnDist) for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    let x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(off(x)) < Math.abs(off(z))) x -= off(x); else z -= off(z);
    pts.push(new THREE.Vector3(x, 1, z));
  }
  return pts;
}

function cameraFor(width, height) {
  const { city, hud } = layoutViews(width, height);
  const cam = createCityCamera();
  fitCityCamera(cam, city.w / city.h);
  cam.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const hit = new THREE.Vector3();
  const occluded = (p, boxes) => {
    const dist = cam.position.distanceTo(p);
    const ray = new THREE.Ray(cam.position.clone(), p.clone().sub(cam.position).normalize());
    return boxes.some((b) => ray.intersectBox(b, hit) && cam.position.distanceTo(hit) < dist - 0.5);
  };
  const ndc = (p) => p.clone().project(cam);
  // HUD の帯（街の画面の上端）の下端の NDC
  const hudBottom = 1 - 2 * (hud.h / city.h);
  return { cam, city, frustum, occluded, ndc, hudBottom };
}

test('調べる点: 広場 8、最初の一周の正方形 8、湧く輪 24。どのシードでも最初の一周に建物がある', () => {
  expect(plazaPoints().length + innerSquare().length + spawnRoadPoints().length).toBe(40);
  for (const p of plazaPoints()) expect(Math.hypot(p.x, p.z)).toBeLessThan(CONFIG.plazaRadius);
  expect(INNER).toBe(35);
  expect(OUTER_IN).toBe(43);
  for (const s of SEEDS) expect(firstRing(s).length).toBeGreaterThanOrEqual(5);
  expect(ROAD).toBe(8);
});

for (const [w, h] of [[390, 844], [1280, 720]]) {
  test(`${w}x${h}: 広場と最初の一周の 8 つの街区（地面と、どの建物の屋上も）が画角の中、HUD より下`, () => {
    const { frustum, ndc, hudBottom } = cameraFor(w, h);
    const pts = [...plazaPoints(), ...innerSquare()];
    for (const s of SEEDS) for (const b of firstRing(s)) pts.push(...corners(b));
    for (const p of pts) {
      expect(frustum.containsPoint(p)).toBe(true);
      const q = ndc(p);
      expect(q.y, `${p.toArray()}`).toBeLessThan(hudBottom);
      expect(Math.abs(q.x)).toBeLessThan(0.97);
      expect(q.y).toBeGreaterThan(-0.97);
    }
  });

  test(`${w}x${h}: 広場の点はどれも建物に隠れない（どのシードでも）`, () => {
    const { occluded } = cameraFor(w, h);
    for (const s of SEEDS) {
      const boxes = boxesOf(s);
      for (const p of plazaPoints()) expect(occluded(p, boxes), `seed ${s} ${p.toArray()}`).toBe(false);
    }
  });

  test(`${w}x${h}: 軍勢はどの向きから来ても、最初の一周の外の端（35m）までに画角に入る`, () => {
    const { frustum } = cameraFor(w, h);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      expect(frustum.containsPoint(new THREE.Vector3(Math.cos(a) * INNER, 1, Math.sin(a) * INNER)), `angle ${i * 5}`).toBe(true);
    }
  });

  test(`${w}x${h}: 湧く輪の上の道路の点の 40% 以上は、画角の中で建物に隠れない（下限の確認）`, () => {
    const { frustum, occluded } = cameraFor(w, h);
    const boxes = boxesOf(1);
    const pts = spawnRoadPoints();
    const visible = pts.filter((p) => frustum.containsPoint(p) && !occluded(p, boxes)).length;
    expect(visible / pts.length).toBeGreaterThanOrEqual(0.4);
  });

  test(`${w}x${h}: 主人公（1.8m）の見かけの大きさは、大きく描く前で 6px 以上（前の遠いカメラの 3 倍ほど）`, () => {
    const { cam, city } = cameraFor(w, h);
    const pxPerRad = (city.h / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2); // main.js の pointScale と同じ（DPR 1）
    const px = (1.8 * pxPerRad) / cam.position.distanceTo(new THREE.Vector3(0, 0.9, 0));
    expect(px).toBeGreaterThanOrEqual(6);
  });
}

test('390x844: 寄っている: 最初の一周が画面の横幅の大半を占め、その外の一周は左右と手前で切れる。湧いて 3 秒で画角に入る', () => {
  const { frustum, ndc } = cameraFor(390, 844);
  // 広場の高さの行で、最初の一周の外の端は画面の横の 60% より外（手前の行は遠近でもっと広い）
  expect(Math.abs(ndc(new THREE.Vector3(INNER, 0, 0)).x)).toBeGreaterThan(0.6);
  // 外の一周は、内の端は見えても外の端は左右・手前で画面の外
  for (const p of [[OUTER_OUT, 0, 0], [-OUTER_OUT, 0, 0], [0, 0, OUTER_OUT]]) {
    expect(frustum.containsPoint(new THREE.Vector3(...p)), `${p}`).toBe(false);
  }
  for (const p of [[OUTER_IN, 0, 0], [-OUTER_IN, 0, 0]]) expect(frustum.containsPoint(new THREE.Vector3(...p)), `${p}`).toBe(true);
  // 縦画面（主）では、一番遠くに湧いた者も 3 秒歩けば画角に入る（画面の端のすぐ外に湧く）
  const { spawnDist, speed } = CONFIG.enemy;
  const r = spawnDist[1] - speed * 3;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    expect(frustum.containsPoint(new THREE.Vector3(Math.cos(a) * r, 1, Math.sin(a) * r)), `angle ${i * 5}`).toBe(true);
  }
});
