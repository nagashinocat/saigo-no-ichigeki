import { test, expect } from 'vitest';
import * as THREE from 'three';
import { hazeLook, createHazeDome, HAZE_DOME } from '../../src/render/hazeDome.js';
import { CONFIG } from '../../src/config.js';

// Fix round 2（まとめ役の裁定）: 閃光の残り（haze）の間、その範囲（払った所から hazeR m）の地面に、薄い光のドームを出して安全な所を見せる。
// 終わりが近づくと脈打って薄れ、終われば消える。網は 1 つ、光源なし
const T = CONFIG.puff.shock.hazeSec;
test('Fix round 2: ドームは閃光の残りの間だけ。出始めは薄く立ち上がり、残り warnSec 秒からは脈打ちながら薄れ、終われば消える', () => {
  expect(hazeLook(null).visible).toBe(false);
  expect(hazeLook({ left: 0, total: T }).visible).toBe(false);
  const start = hazeLook({ left: T, total: T }, 0);
  expect(start.visible).toBe(true);
  const mid = hazeLook({ left: T / 2, total: T }, 0);
  expect(mid.alpha).toBeGreaterThan(0.1);
  expect(mid.alpha).toBeLessThanOrEqual(HAZE_DOME.alpha + 1e-9); // 薄い
  // 終わりの近く: 脈打つ（時刻で明るさが変わる）、そして尽きるほど薄い
  const a = hazeLook({ left: 1, total: T }, 0).alpha, b = hazeLook({ left: 1, total: T }, 0.25 / HAZE_DOME.blinkHz).alpha;
  expect(Math.abs(a - b)).toBeGreaterThan(0.02);
  expect(hazeLook({ left: 0.1, total: T }, 0).alpha).toBeLessThan(mid.alpha);
  expect(HAZE_DOME.warnSec).toBeGreaterThanOrEqual(1.5);
});

test('Fix round 2: ドームの網は 1 つ（光源なし・深さを書かない）。閃光の所と半径に置き、尽きれば隠す', () => {
  const scene = new THREE.Scene();
  const d = createHazeDome(scene);
  expect(scene.children.filter((o) => o.isMesh)).toHaveLength(1);
  expect(scene.children.some((o) => o.isLight)).toBe(false);
  expect(d.mesh.material.depthWrite).toBe(false);
  d.update(1 / 60, { x: 10, z: -4, r: 90, left: 5, total: T });
  expect(d.mesh.visible).toBe(true);
  expect(d.mesh.position.x).toBe(10); expect(d.mesh.position.z).toBe(-4);
  expect(d.mesh.scale.x).toBeCloseTo(90, 6); expect(d.mesh.scale.z).toBeCloseTo(90, 6);
  d.update(1 / 60, null);
  expect(d.mesh.visible).toBe(false);
});
