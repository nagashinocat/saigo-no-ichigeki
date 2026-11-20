import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createEnemyView } from '../../src/render/enemyView.js';

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
