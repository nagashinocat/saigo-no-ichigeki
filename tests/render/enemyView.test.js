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
