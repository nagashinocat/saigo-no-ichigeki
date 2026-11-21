import { test, expect } from 'vitest';
import * as THREE from 'three';
import { planReplay, REPLAY_PLAN, aftermathView, AFTERMATH } from '../../src/render/replayPlan.js';
import { generateCity, GRID } from '../../src/world/cityGen.js';
import { segHitsBox } from '../../src/render/finalePlan.js';
import { phaseTimes, frontAt } from '../../src/game/blast.js';
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

test('R0b fix2 street: 人の目から爆心の光（じわじわ期の前線の seeH 倍の高さ）がビルにふさがれない（通りの突き当たりのビルがスローでふくらむ光の玉を隠さない）', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { buildings } = generateCity(seed);
    for (const radius of RADII) {
      const { street } = planReplay({ radius, buildings });
      const glow = [0, REPLAY_PLAN.seeH * frontAt(phaseTimes(radius).creep, radius), 0];
      expect(street.sees).toBe(true);
      expect(buildings.filter((b) => segHitsBox(street.pos, glow, b, 0)).map((b) => b.id), `seed ${seed} r=${radius.toFixed(0)}`).toEqual([]);
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

// S9: 撃退失敗のあと、生き残った軍勢を見せる引きの絵（リプレイの最後の絵と、結果の後ろ）

test('S9: 撃退失敗の引きの絵は、爆心と生き残り全員を画面の内に収め、斜め上から見下ろす', () => {
  const cases = [
    [{ x: 600, z: 40 }, { x: -20, z: -660 }, { x: 300, z: 520 }],
    [{ x: -640, z: 10 }],
    [{ x: 15, z: 30 }, { x: 680, z: 0 }],
  ];
  for (const aspect of [390 / 844, 16 / 9]) {
    for (const survivors of cases) {
      const v = aftermathView({ survivors, aspect, az: 0.7 });
      const cam = new THREE.PerspectiveCamera(v.fov, aspect, 1, 9000);
      cam.position.fromArray(v.pos);
      cam.lookAt(new THREE.Vector3().fromArray(v.look));
      cam.updateMatrixWorld();
      for (const s of [...survivors, { x: 0, z: 0 }]) {
        const p = new THREE.Vector3(s.x, 3, s.z).project(cam);
        expect(Math.abs(p.x), `${aspect} ${s.x},${s.z}`).toBeLessThan(0.92);
        // fix1: 結果の文字（上）とボタン（下）の間の帯に収める（黒い帯の内）
        expect(p.y).toBeLessThan(AFTERMATH.fitTop + 0.02);
        expect(p.y).toBeGreaterThan(AFTERMATH.fitBot - 0.02);
        expect(p.z).toBeLessThan(1);
      }
      // 爆心と生き残りの縦の広がりは、帯の真ん中（画面の真ん中より下。上には撃退失敗の見出しが乗る）
      const ys = [...survivors, { x: 0, z: 0 }].map((q) => new THREE.Vector3(q.x, 3, q.z).project(cam).y);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo((AFTERMATH.fitTop + AFTERMATH.fitBot) / 2, 2);
      expect((AFTERMATH.fitTop + AFTERMATH.fitBot) / 2).toBeLessThan(-0.1);
      // 見下ろす（真上ではなく斜め）
      const dy = v.pos[1] - v.look[1], dh = Math.hypot(v.pos[0] - v.look[0], v.pos[2] - v.look[2]);
      expect(Math.atan2(dy, dh)).toBeGreaterThan(0.6);
      expect(Math.atan2(dy, dh)).toBeLessThan(1.35);
      expect(Math.hypot(...v.pos)).toBeLessThan(8000); // カメラの遠い面の内
    }
  }
});

test('持ち主 23:01: 引きの絵は、爆発の穴の縁（半径の ring 倍の輪）も帯に収め、横に余白を残す（穴を見ないときより遠くから）', () => {
  const R = CONFIG.radius.max;
  for (const aspect of [390 / 844, 16 / 9]) {
    for (const survivors of [[{ x: 600, z: 40 }], [{ x: -20, z: -740 }, { x: 760, z: 30 }]]) {
      const v = aftermathView({ survivors, aspect, az: 0.7, radius: R });
      const cam = new THREE.PerspectiveCamera(v.fov, aspect, 1, 9000);
      cam.position.fromArray(v.pos);
      cam.lookAt(new THREE.Vector3().fromArray(v.look));
      cam.updateMatrixWorld();
      for (let k = 0; k < 24; k++) {
        const a = k / 24 * 2 * Math.PI;
        const p = new THREE.Vector3(Math.cos(a) * R, 3, Math.sin(a) * R).project(cam);
        expect(Math.abs(p.x)).toBeLessThan(AFTERMATH.fitX + 0.02);
        expect(p.y).toBeLessThan(AFTERMATH.fitTop + 0.03);
        expect(p.y).toBeGreaterThan(AFTERMATH.fitBot - 0.03);
      }
      const plain = aftermathView({ survivors, aspect, az: 0.7 });
      expect(Math.hypot(...v.pos)).toBeGreaterThanOrEqual(Math.hypot(...plain.pos) - 1e-6);
    }
  }
});
