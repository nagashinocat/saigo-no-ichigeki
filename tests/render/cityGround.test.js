import { test, expect } from 'vitest';
import { radialGround, PILLAR_RINGS } from '../../src/render/cityView.js';
import { PILLAR } from '../../src/render/sphereDeform.js';

test('地面のメッシュには、主人公の柱の角になる輪（上の縁・側面・穴の底）がどの画質にもある', () => {
  expect(PILLAR_RINGS[0]).toBe(PILLAR.radius);
  expect(PILLAR_RINGS[PILLAR_RINGS.length - 1]).toBe(PILLAR.radius + PILLAR.wall);
  for (const tier of ['high', 'mid', 'low']) {
    const { geo } = radialGround(tier);
    const pos = geo.getAttribute('position');
    const radii = new Set();
    for (let i = 1; i < pos.count; i++) radii.add(Math.hypot(pos.getX(i), pos.getZ(i)).toFixed(3));
    for (const r of PILLAR_RINGS) expect(radii.has(r.toFixed(3))).toBe(true);
    // 輪は内から外へ順に並ぶ（三角形が裏返らない）
    const ringR = (i) => Math.hypot(pos.getX(i), pos.getZ(i));
    let seg = 0;
    while (Math.abs(ringR(1 + seg) - ringR(1)) < 1e-4) seg++;
    expect((pos.count - 1) % seg).toBe(0);
    let prev = 0;
    for (let k = 0; k < (pos.count - 1) / seg; k++) {
      const r = Math.hypot(pos.getX(1 + k * seg), pos.getZ(1 + k * seg));
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  }
});
