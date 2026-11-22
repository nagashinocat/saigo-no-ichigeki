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

// R1b（持ち主 08:24「リプレイの爆発の横からカメラで追うところだけど、もう少し離れた状態で全体見れた方がかっこいいかな」）:
// side のカットは、ずっと引いた所から全体（光の球・穴の縁・街の端）を見せたまま横へ流れる、大きな引きの移動撮影
test('R1b side: 縦長でも横長でも、カットの始めから終わりまで光の球・穴の縁・その外の街の縁（このカットで前線が届く半径 sideEnd まで）が画面（黒い帯の内）に収まる', async () => {
  const { sideWideView, sideWidePose, SIDE_WIDE } = await import('../../src/render/replayPlan.js');
  const { REPLAY } = await import('../../src/render/replayTimeline.js');
  const { replayBars } = await import('../../src/render/replay.js');
  const cam = new THREE.PerspectiveCamera();
  for (const aspect of [390 / 844, 360 / 640, 16 / 9, 844 / 390]) {
    const bars = replayBars(aspect);
    for (const radius of RADII) {
      const view = sideWideView({ radius, aspect, bars });
      const fx = SIDE_WIDE.fitX + 0.02, fy = (1 - 2 * bars) * SIDE_WIDE.fitY + 0.02;
      const reach = radius * REPLAY.sideEnd; // カットの終わりの前線（それより大きい球はこのカットに映らない）
      const frame = reach * SIDE_WIDE.ring;
      expect(SIDE_WIDE.ring).toBeGreaterThan(1.02); // 穴の外の街も少し見える
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        const p = sidePose(sideWidePose, view, u);
        cam.fov = view.fov; cam.aspect = aspect; cam.near = 1; cam.far = 20000; cam.updateProjectionMatrix();
        cam.position.fromArray(p.pos); cam.up.set(0, 1, 0); cam.lookAt(new THREE.Vector3().fromArray(p.look)); cam.updateMatrixWorld();
        const pts = [];
        for (let k = 0; k < 24; k++) {
          const a = k / 24 * Math.PI * 2;
          pts.push([Math.cos(a) * frame, 0, Math.sin(a) * frame]); // 穴の外の街の縁
          pts.push([Math.cos(a) * reach, 0, Math.sin(a) * reach]); // 穴の縁
          for (const el of [0.3, 0.8, 1.3]) pts.push([Math.cos(a) * Math.cos(el) * reach, Math.sin(el) * reach, Math.sin(a) * Math.cos(el) * reach]); // 光の球
        }
        pts.push([0, reach, 0]);
        for (const q of pts) {
          const v = new THREE.Vector3(...q).project(cam);
          expect(Math.abs(v.x), `${aspect.toFixed(2)} r${radius.toFixed(0)} u${u}`).toBeLessThanOrEqual(fx);
          expect(Math.abs(v.y), `${aspect.toFixed(2)} r${radius.toFixed(0)} u${u}`).toBeLessThanOrEqual(fy);
        }
      }
    }
  }
});

function sidePose(fn, view, u) { return fn(view, { u, az: 0.4, look: 1 }); }

test('R1b fix1 side: 前（前線のすぐ外 F + 32 + 0.1F m）の約 1.5〜2 倍（「もう少し離れた」）で、カットの間に横へ大きく流れる', async () => {
  const { sideWideView, sideWidePose } = await import('../../src/render/replayPlan.js');
  const { REPLAY } = await import('../../src/render/replayTimeline.js');
  const { replayBars } = await import('../../src/render/replay.js');
  for (const aspect of [390 / 844, 360 / 640, 16 / 9, 844 / 390]) {
    for (const radius of RADII) {
      const view = sideWideView({ radius, aspect, bars: replayBars(aspect) });
      const a = sideWidePose(view, { u: 0, az: 0.4, look: 1 }), b = sideWidePose(view, { u: 1, az: 0.4, look: 1 });
      const d = Math.hypot(a.pos[0], a.pos[2]);
      const F = radius * REPLAY.sideEnd, old = F + 32 + 0.1 * F; // 前の横のカットの、カットの終わりの距離
      const end = Math.hypot(b.pos[0], b.pos[2]);
      expect(end, `${aspect.toFixed(2)} r${radius.toFixed(0)}`).toBeGreaterThan(1.3 * old);
      expect(end, `${aspect.toFixed(2)} r${radius.toFixed(0)}`).toBeLessThan(2.3 * old);
      const az0 = Math.atan2(a.pos[2], a.pos[0]), az1 = Math.atan2(b.pos[2], b.pos[0]);
      expect(Math.abs(az1 - az0)).toBeGreaterThan(0.3);
      // look の向きへ回る
      expect(az1 - az0).toBeGreaterThan(0);
      expect(sideWidePose(view, { u: 1, az: 0.4, look: -1 }).pos[2]).toBeLessThan(a.pos[2]);
      // 斜め上から（穴が見える）
      expect(a.pos[1] / d).toBeGreaterThan(0.25);
      expect(d).toBeGreaterThan(end); // ゆっくり寄る
    }
  }
});
