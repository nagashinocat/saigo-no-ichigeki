import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createReachRing, ringWidthM, groundCorners, ringOffscreen, REACH_RING } from '../../src/render/reachRing.js';
import { createCityCamera, fitCityCamera } from '../../src/render/views.js';
import { radiusFor } from '../../src/game/charge.js';

// R2（spec §15 届く範囲の輪）: 上空の画面だけに、主人公のまわりの地面に今の一撃の届く範囲の細い輪。軍勢をまたいだら脈打つ。
// 輪が画面の外へ出たら（画面の四隅の地面がみな輪の内）画面の縁の光で知らせる。網は 1 つ（光源なし、帯の頂点だけ）
const cam = () => { const c = createCityCamera(); fitCityCamera(c, 390 / 560); c.position.set(0, 80, 45); c.lookAt(0, 0, 0); c.updateMatrixWorld(); return c; };

test('R2: 輪は 1 つの網。半径（uR）は渡した radiusFor(力) そのもので、中心は主人公', () => {
  const scene = new THREE.Scene();
  const ring = createReachRing(scene);
  expect(scene.children.length).toBe(1);
  expect(ring.mesh.isMesh).toBe(true);
  // 上から見ても下から見ても描く（帯の向きで裏として捨てられ、輪が映らなかった）。ビルに隠れない
  expect(ring.mesh.material.side).toBe(THREE.DoubleSide);
  expect(ring.mesh.material.depthTest).toBe(false);
  const c = cam();
  const r = radiusFor(30);
  ring.update({ hero: { x: 12, z: -7 }, radius: r, left: 5, visible: true, dt: 1 / 60, camera: c, viewPx: 560 });
  expect(ring.mesh.material.uniforms.uR.value).toBe(r);
  expect(ring.mesh.position.x).toBe(12);
  expect(ring.mesh.position.z).toBe(-7);
  expect(ring.mesh.visible).toBe(true);
  ring.update({ hero: { x: 0, z: 0 }, radius: r, left: 5, visible: false, dt: 1 / 60, camera: c, viewPx: 560 });
  expect(ring.mesh.visible).toBe(false);
});

test('R2: 輪の太さは画面で一定の px（カメラから遠いほど m で太く）', () => {
  const w1 = ringWidthM(100, 46, 560, REACH_RING.px), w2 = ringWidthM(200, 46, 560, REACH_RING.px);
  expect(w2).toBeCloseTo(2 * w1, 9);
  // 100 m 先で 1 px は 2·100·tan(23°)/560 m
  expect(ringWidthM(100, 46, 560, 1)).toBeCloseTo(2 * 100 * Math.tan(23 * Math.PI / 180) / 560, 9);
  expect(REACH_RING.px).toBeGreaterThanOrEqual(2);
  expect(REACH_RING.px).toBeLessThanOrEqual(4); // 細い輪
});

test('R2: 軍勢をまたいだ（届かない数が減った）ら脈打ち、ゆっくり消える。増えたときは脈打たない', () => {
  const ring = createReachRing(new THREE.Scene());
  const c = cam();
  const u = (left, dt = 1 / 60) => ring.update({ hero: { x: 0, z: 0 }, radius: 50, left, visible: true, dt, camera: c, viewPx: 560 });
  expect(u(10).pulse).toBe(0);
  expect(u(10).pulse).toBe(0);
  expect(u(9).pulse).toBe(1);
  const later = u(9, 0.2).pulse;
  expect(later).toBeGreaterThan(0);
  expect(later).toBeLessThan(1);
  expect(u(9, REACH_RING.pulseSec).pulse).toBe(0);
  expect(u(12).pulse).toBe(0); // 新しく湧いた・離れた
  expect(ring.mesh.material.uniforms.uPulse.value).toBe(0);
  u(11);
  expect(ring.mesh.material.uniforms.uPulse.value).toBe(1);
});

test('R2: 0 体（今なら全滅できる）で色が変わる', () => {
  const ring = createReachRing(new THREE.Scene());
  const c = cam();
  const st = ring.update({ hero: { x: 0, z: 0 }, radius: 50, left: 3, visible: true, dt: 0, camera: c, viewPx: 560 });
  const amber = ring.mesh.material.uniforms.uColor.value.clone();
  expect(st.ready).toBe(false);
  const st2 = ring.update({ hero: { x: 0, z: 0 }, radius: 700, left: 0, visible: true, dt: 0, camera: c, viewPx: 560 });
  expect(st2.ready).toBe(true);
  expect(ring.mesh.material.uniforms.uColor.value.equals(amber)).toBe(false);
});

test('R2: 画面の四隅の地面（groundCorners）と、輪が画面の外（四隅がみな輪の内）かどうか', () => {
  const c = cam();
  const k = groundCorners(c);
  expect(k.length).toBe(4);
  for (const p of k) expect(Math.abs(p.y)).toBeLessThan(1e-6);
  const far = Math.max(...k.map((p) => Math.hypot(p.x, p.z)));
  expect(ringOffscreen(far + 1, { x: 0, z: 0 }, k)).toBe(true);
  expect(ringOffscreen(far - 1, { x: 0, z: 0 }, k)).toBe(false);
  expect(ringOffscreen(10, { x: 0, z: 0 }, k)).toBe(false);
  const ring = createReachRing(new THREE.Scene());
  expect(ring.update({ hero: { x: 0, z: 0 }, radius: radiusFor(95), left: 4, visible: true, dt: 0, camera: c, viewPx: 560 }).offscreen).toBe(true);
  expect(ring.update({ hero: { x: 0, z: 0 }, radius: 20, left: 4, visible: true, dt: 0, camera: c, viewPx: 560 }).offscreen).toBe(false);
  // 見せないときは縁の光も出さない
  expect(ring.update({ hero: { x: 0, z: 0 }, radius: radiusFor(95), left: 4, visible: false, dt: 0, camera: c, viewPx: 560 }).offscreen).toBe(false);
});
