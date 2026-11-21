import { test, expect } from 'vitest';
import { planReplay, REPLAY_PLAN } from '../../src/render/replayPlan.js';
import { generateCity, GRID } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { CONFIG } from '../../src/config.js';

const RADII = [radiusFor(CONFIG.power.minRelease), radiusFor(50), CONFIG.radius.max];

test('street: 爆心へ向かう通りの真ん中、ビルの外、人の目の高さ。爆心の方を向く', () => {
  for (const seed of [3, 7, 11]) {
    const { buildings } = generateCity(seed);
    for (const radius of RADII) {
      const { street } = planReplay({ radius, buildings });
      const [x, y, z] = street.pos;
      expect(y).toBe(REPLAY_PLAN.eye);
      // どちらかの座標が通りの真ん中（区画の中心の線から PITCH/2）
      const onRoad = [x, z].some((v) => Math.abs(Math.abs(v) - GRID.PITCH / 2) < 1e-9);
      expect(onRoad).toBe(true);
      for (const b of buildings) expect(Math.abs(x - b.x) < b.w / 2 + 1.5 && Math.abs(z - b.z) < b.d / 2 + 1.5).toBe(false);
      expect(street.dist).toBeGreaterThanOrEqual(REPLAY_PLAN.streetMin - 1);
      expect(street.dist).toBeLessThanOrEqual(REPLAY_PLAN.streetMax + GRID.PITCH);
      // 向き: 爆心へ近づく
      const nx = x + street.dir[0] * 10, nz = z + street.dir[1] * 10;
      expect(Math.hypot(nx, nz)).toBeLessThan(street.dist);
    }
  }
});

test('side: 前線に沿う道の上の屋根より高く、street と違う向き。同じ街なら同じ答え', () => {
  const { buildings } = generateCity(7);
  for (const radius of RADII) {
    const p = planReplay({ radius, buildings, heroYaw: 0.4 });
    expect(Math.abs(p.side.az - p.street.az)).toBeGreaterThan(0.5);
    const ux = Math.cos(p.side.az), uz = Math.sin(p.side.az);
    // カメラが通る半径の範囲（前線に沿って r0 から r1 まで）の屋根より高い。S7 で街の奥に目印の超高層（200m 超）が立ったので、
    // 通らない奥のビルは見ない（前の箱だけの街では、奥のビルはどれもカメラより低かった）
    const r0 = Math.max(10, Math.min(radius * 0.8, p.street.dist - 3)), r1 = radius * 1.05 + 40;
    for (const b of buildings) {
      const t = b.x * ux + b.z * uz, across = Math.abs(-b.x * uz + b.z * ux), r = Math.hypot(b.x, b.z);
      if (t > 0 && across < REPLAY_PLAN.sideClear && r >= r0 - 20 && r <= r1 + 20) expect(p.side.height).toBeGreaterThan(b.h);
    }
    expect(planReplay({ radius, buildings, heroYaw: 0.4 })).toEqual(p);
    expect(p.hero.az).toBeCloseTo(0.4 + REPLAY_PLAN.heroAz, 9);
  }
});
