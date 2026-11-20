import { test, expect } from 'vitest';
import * as THREE from 'three';
import { planBlackholeCamera, BH_CAMERA } from '../../src/render/blackholePlan.js';
import { generateCity } from '../../src/world/cityGen.js';
import { createStyle } from '../../src/render/style.js';

const sunDir = createStyle('low').sunDir;
const ndc = (cam, p) => new THREE.Vector3(...p).project(cam);
const camOf = (plan, aspect) => {
  const cam = new THREE.PerspectiveCamera(plan.fov, aspect, 1, 6000);
  cam.position.fromArray(plan.pos);
  cam.lookAt(new THREE.Vector3().fromArray(plan.look));
  cam.updateMatrixWorld();
  return cam;
};

for (const seed of [3, 7, 11]) {
  const city = generateCity(seed);
  for (const aspect of [390 / 844, 0.75, 1280 / 720, 2.2]) {
    test(`黒い球（主人公）は画面の下寄りの中、夕日はその上の画面の中。カメラはビルの上（seed ${seed}, 縦横比 ${aspect.toFixed(2)}）`, () => {
      const plan = planBlackholeCamera({ aspect, sunDir, buildings: city.buildings });
      expect([...plan.pos, ...plan.look, plan.fov].every(Number.isFinite)).toBe(true);
      const cam = camOf(plan, aspect);
      const hero = ndc(cam, BH_CAMERA.hero);
      expect(Math.abs(hero.x)).toBeLessThan(0.2);
      expect(hero.y).toBeLessThan(0);
      expect(hero.y).toBeGreaterThan(-0.6);
      const sun = ndc(cam, sunDir.clone().multiplyScalar(3000).add(cam.position).toArray());
      expect(sun.z).toBeLessThan(1);
      expect(Math.abs(sun.x)).toBeLessThan(0.85);
      expect(sun.y).toBeLessThan(0.9);
      expect(sun.y).toBeGreaterThan(hero.y + 0.5);
      // 地平線も画面の中（主人公より上、夕日より下）
      const dir = new THREE.Vector3(...plan.look).sub(cam.position).setY(0).normalize();
      const horizon = ndc(cam, cam.position.clone().addScaledVector(dir, 3000).setY(0).toArray());
      expect(horizon.y).toBeGreaterThan(hero.y);
      expect(horizon.y).toBeLessThan(sun.y);
      // カメラの近くのビルより上にいる
      for (const b of city.buildings) {
        const inside = Math.abs(plan.pos[0] - b.x) < b.w / 2 + 15 && Math.abs(plan.pos[2] - b.z) < b.d / 2 + 15;
        if (inside) expect(plan.pos[1]).toBeGreaterThan(b.h + 5);
      }
      expect(plan.fov).toBeLessThanOrEqual(BH_CAMERA.maxFov);
      // 手前のビルが視線をふさがない（主人公の手前 sightTo m まで、視線は屋上より上を通る）
      const from = new THREE.Vector3(...plan.pos), to = new THREE.Vector3(...BH_CAMERA.hero);
      const L = Math.hypot(from.x, from.z);
      for (let s = 0; s < 1 - BH_CAMERA.sightTo / L; s += 0.01) {
        const p = from.clone().lerp(to, s);
        for (const b of city.buildings) {
          if (Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.z - b.z) < b.d / 2) expect(p.y).toBeGreaterThan(b.h);
        }
      }
    });
  }
}
