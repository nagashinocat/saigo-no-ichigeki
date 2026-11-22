import { test, expect } from 'vitest';
import * as THREE from 'three';
import { buildConeGeometry, createHeadlights, CONE } from '../../src/render/headlights.js';
import { TRAIL } from '../../src/render/enemyView.js';
import { STREAK, createDashStreak } from '../../src/render/dashStreak.js';
import { CONFIG } from '../../src/config.js';

// M2: 前方ライトの光の扇（見つける扇と同じ形）・知らせの輪・吸う者の輪。乗り手ごとの光源は使わず、網は 2 つだけ
test('M2: 光の扇の形は見つける扇と同じ（半分の角 spotHalfAngle、向きは +z）', () => {
  const g = buildConeGeometry(CONFIG.enemy.spotHalfAngle);
  const p = g.getAttribute('position');
  let maxAng = 0;
  for (let i = 1; i < p.count; i++) { maxAng = Math.max(maxAng, Math.abs(Math.atan2(p.getX(i), p.getZ(i)))); expect(Math.hypot(p.getX(i), p.getZ(i))).toBeCloseTo(1, 6); }
  expect(maxAng).toBeCloseTo(CONFIG.enemy.spotHalfAngle, 6);
});

test('M2: 扇は近くの探す・追う者だけ、知らせの輪は光った者だけ、吸う者には脈打つ輪。網は 2 つ（光源なし）', () => {
  const group = new THREE.Group();
  const hl = createHeadlights(group, { capacity: 20 });
  expect(group.children.length).toBe(2);
  expect(group.children.every((m) => m.isInstancedMesh)).toBe(true);
  hl.begin(0, 500, 1);
  const H = { x: 0, z: 0 };
  const b = (x, z) => ({ x, z, yaw: 0, keep: 1 });
  hl.add({ state: 'search' }, b(10, 0), 0, H);
  hl.add({ state: 'chase', callT: 0.1 }, b(20, 0), 0, H); // 光った
  hl.add({ state: 'grab' }, b(1, 0), 0, H); // 掴む者は扇なし
  hl.add({ state: 'search' }, b(CONE.near + 10, 0), 0, H); // 遠い
  hl.add({ state: 'search', kind: 'drainer' }, b(-10, 0), 0, H);
  hl.add({ state: 'dead' }, b(5, 5), 0, H);
  hl.end();
  expect(hl.cones.count).toBe(3);
  expect(hl.rings.count).toBe(2); // 知らせの輪 1 + 吸う者の輪 1
});

test('M2（R1 の見直しの持ち越し）: 重い者の尾は太い・吸う者の輪は 2 Hz で画面 8 px 以上', async () => {
  expect(TRAIL.heavyWidth).toBeGreaterThanOrEqual(1.6);
  const { KIND_RING } = await import('../../src/render/headlights.js');
  expect(KIND_RING.hz).toBe(2);
  expect(KIND_RING.minPx).toBeGreaterThanOrEqual(8);
});

test('M2: 隠れるの滑り込みは光の筋を残し（fadeSec で消える）、物陰ではしゃがむ', () => {
  const scene = new THREE.Scene();
  const ds = createDashStreak(scene);
  const hero = { x: 0, z: 0, dashing: 0.2, dashFrom: { x: -10, z: 0 }, hidden: true };
  ds.update(hero, 1 / 30);
  expect(ds.group.visible).toBe(true);
  hero.dashing = null;
  let k = 0;
  for (let t = 0; t < STREAK.fadeSec + 0.1; t += 1 / 30) k = ds.update(hero, 1 / 30);
  expect(ds.group.visible).toBe(false);
  expect(k).toBeGreaterThan(0.9);
  hero.hidden = false;
  for (let t = 0; t < 1; t += 1 / 30) k = ds.update(hero, 1 / 30);
  expect(k).toBeLessThan(0.01);
});
