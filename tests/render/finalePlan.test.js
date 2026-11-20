import { test, expect } from 'vitest';
import { planFinale, PLAN, retreatPoint, nearDist, segHitsBox, retreatMargin } from '../../src/render/finalePlan.js';
import { facadeWindows } from '../../src/render/facadeWindows.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

const shotOf = (amount) => ({ amount, radius: radiusFor(amount), isBig: true });
const SHOTS = [shotOf(CONFIG.power.minRelease), shotOf(60), shotOf(CONFIG.power.max)];
const enemy = (id, angle, dist, state = 'approach') => ({ id, angle, dist, state, deadTime: 0 });
const ARMY = [enemy(1, 0.3, 40), enemy(2, 2.1, 30), enemy(3, 4.0, 3, 'grab'), enemy(4, 5.2, 55), enemy(5, 1.0, 20, 'dead')];
const lead = (r) => 20 + 0.6 * r;
const inside = (p, b, m = 0) => Math.abs(p[0] - b.x) < b.w / 2 + m && Math.abs(p[2] - b.z) < b.d / 2 + m && p[1] < b.h + m;

function cases() {
  const out = [];
  for (const seed of [3, 7, 11]) {
    const city = generateCity(seed);
    for (const shot of SHOTS) for (let r = 1; r <= 6; r++) {
      out.push({ city, shot, plan: planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(r), lead: lead(shot.radius) }) });
    }
  }
  return out;
}

test('カメラは広場を囲むビルの横の壁に沿った通りの、ビルより外側（ビルの外・地面の上）にいて、壁と広場の中心（迫る光の壁）を見通せる', () => {
  for (const { city, plan } of cases()) {
    const b = city.buildings.find((x) => x.id === plan.buildingId);
    expect(b).toBeDefined();
    expect(b.dist).toBeLessThanOrEqual(PLAN.innerDist);
    const p = plan.camPos;
    expect(p[1]).toBeGreaterThan(1);
    expect(city.buildings.filter((o) => inside(p, o, PLAN.clearance - 0.01))).toEqual([]);
    // カメラは窓の並ぶ壁の外側（法線の向き）で、爆心よりビルの向こう
    const n = plan.normal;
    const half = Math.abs(n[0]) > 0.5 ? b.w / 2 : b.d / 2;
    expect((p[0] - b.x) * n[0] + (p[2] - b.z) * n[2]).toBeGreaterThan(half + 2);
    expect(Math.hypot(p[0], p[2])).toBeGreaterThan(b.dist);
    // 見る先・広場の中心（迫る光の壁）への見通しを、ビルがふさがない
    for (const q of [plan.look, [0, PLAN.centerY, 0]]) {
      expect(city.buildings.filter((o) => segHitsBox(p, q, o)).map((o) => o.id)).toEqual([]);
    }
    // 前線がビルに届く距離は、ビルの中心より近い
    expect(plan.hitDist).toBeCloseTo(nearDist(b), 9);
    expect(plan.hitDist).toBeLessThan(b.dist);
  }
});

test('目が映る一人は、生きた軍勢の中から選ばれ、ビルはその一人の向きにある', () => {
  for (const { plan } of cases()) {
    expect([1, 2, 3, 4]).toContain(plan.riderId);
    const e = ARMY.find((x) => x.id === plan.riderId);
    const a = Math.atan2(plan.building.z, plan.building.x);
    expect(Math.abs(Math.atan2(Math.sin(a - e.angle), Math.cos(a - e.angle)))).toBeLessThan(1.2);
  }
  const city = generateCity(3);
  const p = planFinale({ shot: SHOTS[1], buildings: city.buildings, enemies: [], rng: createRng(1) });
  expect(p.riderId).toBeNull();
  expect(p.buildingId).not.toBeNull();
});

test('窓: 選んだ壁の上に並び、カメラの方を向いた壁のもの。ガラス片はカメラの前 1.5〜4 m', () => {
  for (const { plan } of cases()) {
    const b = plan.building, n = plan.normal;
    expect(plan.windows.length).toBeGreaterThan(0);
    for (const w of plan.windows) {
      const c = w.center;
      // 壁の面の上
      const off = (c[0] - b.x) * n[0] + (c[2] - b.z) * n[2];
      expect(off).toBeCloseTo(Math.abs(n[0]) > 0.5 ? b.w / 2 : b.d / 2, 6);
      const across = Math.abs((c[0] - b.x) * -n[2] + (c[2] - b.z) * n[0]);
      expect(across).toBeLessThan((Math.abs(n[0]) > 0.5 ? b.d : b.w) / 2);
      expect(c[1]).toBeGreaterThan(0);
      expect(c[1]).toBeLessThan(b.h);
      expect(w.w).toBeGreaterThan(0);
      expect(w.h).toBeGreaterThan(0);
    }
    const d = Math.hypot(...plan.shardPos.map((v, i) => v - plan.camPos[i]));
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(4);
  }
});

test('逃げる道: カメラの位置から始まり、ビルを通らず、地面より上で、爆心から離れていく（その一発の半径 + 先を行く距離まで）', () => {
  for (const { city, shot, plan } of cases()) {
    const path = plan.retreat;
    expect(retreatPoint(path, 0)).toEqual(plan.camPos);
    const end = shot.radius + lead(shot.radius);
    let prevR = -Infinity;
    for (let x = 0.5; x <= end; x += 1) {
      const p = retreatPoint(path, x);
      expect(p[1]).toBeGreaterThan(1);
      expect(city.buildings.filter((o) => inside(p, o, retreatMargin(path, x) - 0.3)).map((o) => o.id)).toEqual([]);
      const r = Math.hypot(p[0], p[1], p[2]);
      if (x > 6) expect(r).toBeGreaterThan(prevR);
      prevR = r;
    }
    // 道はふつう低く（街の上を引く）、まっすぐ上へ逃げるだけの道にはならない
    expect(path.rise).toBeLessThan(150);
  }
});

test('同じシードで同じ結果。ビルが一つもなくても撮れる', () => {
  const city = generateCity(7);
  const run = (s) => planFinale({ shot: SHOTS[2], buildings: city.buildings, enemies: ARMY, rng: createRng(s) });
  expect(run(4)).toEqual(run(4));
  const p = planFinale({ shot: SHOTS[0], buildings: [], enemies: [], rng: createRng(2) });
  expect(p.building).toBeNull();
  expect(p.windows).toEqual([]);
  expect(p.camPos[1]).toBeGreaterThan(1);
  expect(Number.isFinite(p.hitDist)).toBe(true);
});

test('facadeWindows: 窓は壁の幅と高さの内側に、重ならずに並ぶ', () => {
  const b = { x: 10, z: -30, w: 14, d: 12, h: 20, kind: 'office' };
  for (const n of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const ws = facadeWindows(b, n);
    expect(ws.length).toBeGreaterThan(4);
    const faceW = Math.abs(n[0]) > 0.5 ? b.d : b.w;
    for (const w of ws) {
      const u = Math.abs(n[0]) > 0.5 ? w.center[2] - b.z : w.center[0] - b.x;
      expect(Math.abs(u) + w.w / 2).toBeLessThan(faceW / 2);
      expect(w.center[1] + w.h / 2).toBeLessThan(b.h);
    }
  }
});
