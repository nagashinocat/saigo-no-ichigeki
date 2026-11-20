import { test, expect } from 'vitest';
import { radialGround } from '../../src/render/cityView.js';

test('地面のメッシュの輪は、どの画質でも内から外へ順に並ぶ（三角形が裏返らない）', () => {
  for (const tier of ['high', 'mid', 'low']) {
    const { geo } = radialGround(tier);
    const pos = geo.getAttribute('position');
    const ringR = (i) => Math.hypot(pos.getX(i), pos.getZ(i));
    let seg = 0;
    while (Math.abs(ringR(1 + seg) - ringR(1)) < 1e-4) seg++;
    expect((pos.count - 1) % seg).toBe(0);
    let prev = 0;
    for (let k = 0; k < (pos.count - 1) / seg; k++) {
      const r = ringR(1 + k * seg);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  }
});
