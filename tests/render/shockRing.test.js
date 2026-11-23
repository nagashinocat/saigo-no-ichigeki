import { test, expect } from 'vitest';
import * as THREE from 'three';
import { shockRingLook, createShockRing, SHOCK_RING } from '../../src/render/shockRing.js';
import { CONFIG } from '../../src/config.js';

// 持ち主 2026-11-24「払うを強く」: 払った瞬間、地面に衝撃波の輪が前線（puff.radius）から衝撃波の半径（puff.shock.radius）まで一気に広がり、薄れて消える
const S = CONFIG.puff.shock;
test('2026-11-24: 衝撃波の輪は sec 秒で shock.radius まで広がり（速く始まって緩む）、明るく出て消える。始まりは前線の大きさ', () => {
  const a = shockRingLook(0, S.radius);
  expect(a.visible).toBe(true);
  expect(a.radius).toBeCloseTo(CONFIG.puff.radius * SHOCK_RING.from, 6);
  expect(a.alpha).toBeGreaterThan(0.8);
  const mid = shockRingLook(SHOCK_RING.sec / 2, S.radius);
  expect(mid.radius).toBeGreaterThan((a.radius + S.radius) / 2); // 速く始まる
  const end = shockRingLook(SHOCK_RING.sec, S.radius);
  expect(end.radius).toBeCloseTo(S.radius, 6);
  expect(end.alpha).toBeLessThan(0.05);
  expect(shockRingLook(SHOCK_RING.sec + 0.01, S.radius).visible).toBe(false);
  expect(SHOCK_RING.sec).toBeGreaterThanOrEqual(0.3); expect(SHOCK_RING.sec).toBeLessThanOrEqual(0.8);
  for (let t = 0; t < SHOCK_RING.sec; t += 0.05) expect(shockRingLook(t, S.radius).width).toBeGreaterThan(1); // 太い帯（守りの輪 0.35 m より太い）
});

test('2026-11-24: 衝撃波の輪の網: begin で払った所に出て、update で広がり、終われば隠れる。reset で消える', () => {
  const scene = new THREE.Scene();
  const ring = createShockRing(scene);
  expect(ring.mesh.visible).toBe(false);
  ring.begin({ x: 5, z: -3 }, S.radius);
  ring.update(0.05);
  expect(ring.mesh.visible).toBe(true);
  expect(ring.mesh.position.x).toBe(5); expect(ring.mesh.position.z).toBe(-3);
  const outer = () => { ring.mesh.geometry.computeBoundingSphere(); return ring.mesh.geometry.boundingSphere.radius; };
  const r1 = outer();
  ring.update(0.1);
  expect(outer()).toBeGreaterThan(r1);
  ring.update(1);
  expect(ring.mesh.visible).toBe(false);
  ring.begin({ x: 0, z: 0 }, S.radius); ring.update(0.01); ring.reset();
  expect(ring.mesh.visible).toBe(false);
});
