import { test, expect } from 'vitest';
import * as THREE from 'three';
import { pullbackDistance, wholeFitPullback, wideStartOf, cameraIntent, createCameraFollow, sinceBurstOf, BLAST_CAM } from '../../src/render/blastCamera.js';
import { createCityCamera, fitCityCamera, layoutViews } from '../../src/render/views.js';
import { frontAt, blastDuration, phaseTimes } from '../../src/game/blast.js';
import { sphereFade } from '../../src/render/explosionView.js';
import { CONFIG } from '../../src/config.js';

// 390×844 の上空カメラ（近い位置）
function cityCam(w = 390, h = 844) {
  const { city } = layoutViews(w, h);
  const cam = createCityCamera();
  fitCityCamera(cam, city.w / city.h);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).toArray();
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  return { cam, pos: cam.position.toArray(), dir, tanV, tanH: tanV * cam.aspect };
}
const view = cityCam();
const distAt = (t) => Math.hypot(...view.pos.map((p, i) => p - view.dir[i] * t));

// 地面の上の球の点が、t 下がったカメラの画角にすべて入るか（wholeFitPullback の 13 段 × 48 方位の間の点も調べる）
function domeInView(radius, t, { cam, pos, dir } = view) {
  const c = cam.clone();
  c.position.fromArray(pos).addScaledVector(new THREE.Vector3().fromArray(dir), -t);
  c.updateMatrixWorld();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
  for (let i = 0; i <= 24; i++) for (let j = 0; j < 48; j++) {
    const el = (i / 24) * Math.PI / 2, az = (j / 48) * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(radius);
    if (!fr.containsPoint(p)) return false;
  }
  return true;
}

// 一発を start 秒に放った場合の、時刻 time の game.blasts の一つ（終わっていれば null）
const blastAt = (id, radius, start, time) => {
  const u = time - start;
  if (u < 0 || u >= blastDuration(radius)) return null;
  return { id, radius, front: frontAt(u, radius) };
};

// shots: [{ radius, at }] を dt ずつ進め、毎フレームの { time, t, front } を返す
function simulate(shots, seconds, { dt = 1 / 60, hold = () => false } = {}) {
  const follow = createCameraFollow();
  const out = [];
  for (let i = 1; i * dt <= seconds; i++) {
    const time = i * dt;
    const blasts = shots.map((s, k) => blastAt(k, s.radius, s.at, time)).filter(Boolean);
    const front = blasts.reduce((m, b) => Math.max(m, b.front), 0);
    const t = follow.update(dt, { ...view, blasts, front, hold: hold(time) });
    out.push({ time, t, front, mode: follow.mode });
  }
  return out;
}

test('pullbackDistance: 十分遠ければ 0、近ければ視線と逆へ下がって中心から minDist ちょうどになる', () => {
  expect(pullbackDistance(view.pos, view.dir, 80)).toBe(0); // R1g: 主人公までの距離が約 92m（0.8 倍）になったので 100 → 80
  const t = pullbackDistance(view.pos, view.dir, 600);
  expect(t).toBeGreaterThan(0);
  expect(distAt(t)).toBeCloseTo(600, 6);
});

test('wholeFitPullback: その距離で地面の上の球の全体が画角に入る（余白なしなら、それより 3m 近いと入らない）', () => {
  for (const R of [120, 200, 300, 440]) {
    const t = wholeFitPullback(R, view.pos, view.dir, view.tanV, view.tanH);
    expect(t).toBeGreaterThan(0);
    expect(domeInView(R, t)).toBe(true);
    const tight = wholeFitPullback(R, view.pos, view.dir, view.tanV, view.tanH, 1);
    expect(tight).toBeLessThan(t);
    expect(domeInView(R, tight + 0.01)).toBe(true);
    expect(domeInView(R, tight - 3)).toBe(false);
  }
  // 横長でも
  const wide = cityCam(1280, 720);
  const t = wholeFitPullback(200, wide.pos, wide.dir, wide.tanV, wide.tanH);
  expect(domeInView(200, t, wide)).toBe(true);
});

test('wholeFitPullback: 今の位置で収まる小さな球は 0、大きな球ほど遠い', () => {
  expect(wholeFitPullback(20, view.pos, view.dir, view.tanV, view.tanH)).toBe(0);
  const a = wholeFitPullback(150, view.pos, view.dir, view.tanV, view.tanH);
  const b = wholeFitPullback(300, view.pos, view.dir, view.tanV, view.tanH);
  expect(b).toBeGreaterThan(a);
});

test('wideStartOf: 前線が半径の 55% に届く時刻（0.6 秒を超えない）。弾けた直後の近い一瞬は残る', () => {
  for (const R of [80, 150, 202, 440]) {
    const w = wideStartOf(R), { creep } = phaseTimes(R);
    expect(w).toBeGreaterThan(0.1);
    expect(w).toBeLessThanOrEqual(BLAST_CAM.wideDelay);
    expect(frontAt(creep + w, R)).toBeCloseTo(Math.min(R * BLAST_CAM.wideFrontFrac, frontAt(creep + BLAST_CAM.wideDelay, R)), 4);
  }
});

test('cameraIntent: 小さな一発は数えない。前線が 55% に届くまでは留まり、そのあと全体へ', () => {
  const w = wideStartOf(150);
  expect(cameraIntent([]).mode).toBe('near');
  expect(cameraIntent([{ radius: 60, sinceBurst: 2 }]).mode).toBe('near');
  expect(cameraIntent([{ radius: 150, sinceBurst: -0.2 }]).mode).toBe('stay');
  expect(cameraIntent([{ radius: 150, sinceBurst: w - 0.01 }]).mode).toBe('stay');
  expect(cameraIntent([{ radius: 150, sinceBurst: w }])).toEqual({ mode: 'wide', radius: 150, waiting: false });
  expect(cameraIntent([{ radius: 150, sinceBurst: 1 }, { radius: 200, sinceBurst: 0.1 }, { radius: 40, sinceBurst: 3 }])).toEqual({ mode: 'wide', radius: 150, waiting: true });
});

test('sinceBurstOf: 弾けた瞬間 0、じわじわ期は負', () => {
  const R = 200, { creep } = phaseTimes(R);
  expect(sinceBurstOf(frontAt(creep * 0.5, R), R)).toBeLessThan(0);
  expect(sinceBurstOf(frontAt(creep + 0.3, R), R)).toBeCloseTo(0.3, 6);
});

test('引く時刻: 前線が 55% に届くまでは近いまま（前線に押される分だけ）、そのあと全体が見える位置へ引く', () => {
  const R = 200, { creep } = phaseTimes(R), end = blastDuration(R);
  const fit = wholeFitPullback(R, view.pos, view.dir, view.tanV, view.tanH);
  const run = simulate([{ radius: R, at: 0 }], end + 4);
  const at = (time) => run.reduce((a, b) => (Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a));
  // 弾けた直後〜引き始め: 球に飲み込まれない最小限（前線 × 1.3、先読みの分）しか下がらない
  for (const r of run.filter((x) => x.time > creep && x.time < creep + wideStartOf(R))) {
    const soon = frontAt(r.time + BLAST_CAM.lookahead, R);
    expect(distAt(r.t)).toBeLessThanOrEqual(Math.max(distAt(0), soon * BLAST_CAM.ratio) + 1);
  }
  expect(at(creep + wideStartOf(R)).t).toBeLessThan(fit * 0.3);
  // 終わってすぐ、全体が見える位置（の 95%）に着いている
  expect(at(end + 0.3).t).toBeGreaterThan(fit * 0.95);
  // 球が消えきるまで保ち、ほとんど戻らない
  expect(at(end + CONFIG.blast.fadeSec - 0.05).t).toBeGreaterThan(at(end + 0.3).t - 5);
  // そのあと近い上空カメラへ戻る
  expect(run.at(-1).t).toBeLessThan(fit * 0.15);
});

test('全体の位置（の 95%）に着くのは、球がまだ濃く見えている間（濃さ 0.6 以上）。球が消えるまで遠めのまま', () => {
  for (const R of [100, 150, 202]) {
    const end = blastDuration(R), fade = CONFIG.blast.fadeSec;
    const fit = wholeFitPullback(R, view.pos, view.dir, view.tanV, view.tanH);
    const run = simulate([{ radius: R, at: 0 }], end + fade + 3);
    const arrive = run.find((r) => r.t >= fit * 0.95);
    expect(arrive, `R=${R}`).toBeTruthy();
    expect(arrive.time < end || sphereFade(arrive.time - end) >= 0.6, `R=${R} arrive ${arrive.time.toFixed(2)} end ${end.toFixed(2)}`).toBe(true);
    // 球が薄く消えていく間（濃さ 0.1 まで）は全体の位置にいる
    for (const r of run.filter((x) => x.time >= arrive.time && x.time >= end && sphereFade(x.time - end) >= 0.1)) {
      expect(r.t).toBeGreaterThan(fit * 0.9);
    }
  }
});

test('球が広がる間ずっと、カメラと中心の距離は front × 1.3 以上（大きな一発でも）', () => {
  for (const R of [120, 205, 440]) {
    const run = simulate([{ radius: R, at: 0 }], blastDuration(R) + 2);
    for (const r of run) expect(distAt(r.t)).toBeGreaterThanOrEqual(r.front * 1.3 - 1e-6);
  }
});

test('動き出しはなめらか: 引き始める最初のフレームはほとんど動かず、どのフレームも跳ばない', () => {
  const R = 205;
  const run = simulate([{ radius: R, at: 0 }], blastDuration(R) + 10);
  const steps = run.slice(1).map((r, i) => r.t - run[i].t);
  const first = steps.findIndex((s) => s > 1e-9);
  const maxOut = Math.max(...steps);
  expect(steps[first]).toBeLessThan(maxOut * 0.2);
  // 戻るときも一フレームで大きく跳ばない
  expect(Math.min(...steps)).toBeGreaterThan(-8);
  expect(run.at(-1).t).toBeLessThan(0.5);
});

test('小さな一発（半径 60m 以下）ではカメラは動かない（連打しても）', () => {
  const shots = Array.from({ length: 12 }, (_, k) => ({ radius: 30 + (k % 4) * 10, at: k * 0.35 }));
  for (const r of simulate(shots, 7)) expect(r.t).toBe(0);
});

test('じわじわ期はカメラが動かない', () => {
  const R = 205, { creep } = phaseTimes(R);
  const run = simulate([{ radius: R, at: 0 }], creep);
  for (const r of run) expect(r.t).toBeLessThan(1);
});

// 下がる向きが変わった回数（小さな揺れは数えない）
function reversals(run, eps = 0.05) {
  let n = 0, sign = 0;
  for (let i = 1; i < run.length; i++) {
    const d = run[i].t - run[i - 1].t;
    if (Math.abs(d) < eps) continue;
    const s = Math.sign(d);
    if (sign !== 0 && s !== sign) n++;
    sign = s;
  }
  return n;
}

test('連打で跳ばない: 戻る途中に次の一発が来たら、その場で止まってから続ける（近くまで戻ってまた引くことはない）', () => {
  const R = 150, end = blastDuration(R);
  // 一発目が終わって保ち、戻り始めた頃に二発目
  const second = end + BLAST_CAM.holdSec + 0.4;
  const run = simulate([{ radius: R, at: 0 }, { radius: R, at: second }], second + end + 6);
  const before = run.find((r) => r.time >= second).t;
  expect(before).toBeGreaterThan(20); // まだ戻りきっていない
  // 二発目が引き始めるまでの間、カメラはその場から大きく戻らない
  const { creep } = phaseTimes(R);
  const during = run.filter((r) => r.time >= second && r.time < second + creep + wideStartOf(R));
  expect(Math.min(...during.map((r) => r.t))).toBeGreaterThan(before * 0.6);
  // 行って・戻って・行って・戻る より多く向きが変わらない
  expect(reversals(run)).toBeLessThanOrEqual(3);
  const steps = run.slice(1).map((r, i) => Math.abs(r.t - run[i].t));
  expect(Math.max(...steps)).toBeLessThan(12);
});

test('連打で跳ばない: 中くらいの一発を 0.5 秒ごとに 10 発撃っても、引いたまま保ち、行ったり来たりしない', () => {
  const shots = Array.from({ length: 10 }, (_, k) => ({ radius: 100 + (k % 3) * 40, at: k * 0.5 }));
  const run = simulate(shots, 14);
  expect(reversals(run)).toBeLessThanOrEqual(2);
  expect(run.at(-1).t).toBeLessThan(1);
});

test('hold の間は、終わった一発の「保つ」時間が進まない（遠めのまま）', () => {
  const R = 205, end = blastDuration(R);
  const run = simulate([{ radius: R, at: 0 }], end + 4, { hold: (time) => time < end + 3 });
  const fit = wholeFitPullback(R, view.pos, view.dir, view.tanV, view.tanH);
  const r = run.find((x) => x.time >= end + 2.9);
  expect(r.t).toBeGreaterThan(fit * 0.95);
  expect(r.mode).toBe('wide');
});

// 持ち主 2026-11-23 08:41: その場のリトライ。最後の一発で下がった上空カメラ（覚えた一発・ばねの速さ・ねらい）は reset で、
// 読み直したページの新しい createCameraFollow と同じ姿へ戻る（次の一回の最初のフレームから、いつもの近さ）
test('createCameraFollow.reset: 大きな一発で下がったあとでも、新しく作ったものと同じ答えに戻る', () => {
  const dt = 1 / 30;
  const follow = createCameraFollow();
  for (let i = 1; i * dt <= 6; i++) {
    const b = blastAt(0, CONFIG.radius.max, 0.5, i * dt);
    follow.update(dt, { ...view, blasts: b ? [b] : [], front: b?.front ?? 0 });
  }
  expect(follow.t).toBeGreaterThan(50);
  follow.reset();
  expect(follow.t).toBe(0);
  const fresh = createCameraFollow();
  for (let i = 0; i < 30; i++) expect(follow.update(dt, { ...view })).toBe(fresh.update(dt, { ...view }));
  expect(follow.mode).toBe(fresh.mode);
});
