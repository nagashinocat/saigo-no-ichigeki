import { test, expect } from 'vitest';
import * as THREE from 'three';
import { chooseShot, CINE, pathPoint, chaseLook, sphereWall, leadFor, minLeadFor, createChase, createCinematic } from '../../src/render/cinematic.js';
import { buildEyeCloseup } from '../../src/render/enemyView.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';
import { frontAt, blastDuration } from '../../src/game/blast.js';

const city = generateCity(3);
const shotOf = (amount) => ({ amount, radius: radiusFor(amount), isBig: true });
// 最後の一発の小さいほう（離して放てる最小の量）・中くらい・最大
const SHOTS = [shotOf(CONFIG.power.minRelease), shotOf(60), shotOf(CONFIG.power.max)];
const enemy = (id, angle, dist, state = 'approach') => ({ id, angle, dist, state, deadTime: 0 });
const ARMY = [enemy(1, 0.3, 70), enemy(2, 2.1, 84), enemy(3, 4.0, 3, 'grab'), enemy(4, 5.2, 66)];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const deg = (r) => r * 180 / Math.PI;
const angleDeg = (a, b) => deg(Math.acos(Math.min(1, dot(norm(a), norm(b)))));
const inside = (p, b, m = 0) => Math.abs(p[0] - b.x) < b.w / 2 + m && Math.abs(p[2] - b.z) < b.d / 2 + m && p[1] < b.h + m;
// カメラ cam が look を向いたとき、点 p の横・縦の角度（度）
function viewAngles(cam, look, p) {
  const f = norm(sub(look, cam)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), v = sub(p, cam);
  return { side: Math.abs(deg(Math.atan2(dot(v, r), dot(v, f)))), up: Math.abs(deg(Math.atan2(dot(v, u), dot(v, f)))), ahead: dot(v, f) > 0 };
}

function cases() {
  const out = [];
  for (const shot of SHOTS) for (let seed = 1; seed <= 8; seed++) {
    out.push({ shot, seed, plan: chooseShot({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(seed) }) });
  }
  return out;
}

test('引いていく道は front が届く途中のビル（radius の 0.4〜0.7）の方へ向かい、球がそのビルに届く瞬間、ビルは画面（縦長の全画面でも）に入る', () => {
  for (const { shot, plan } of cases()) {
    const b = city.buildings.find((x) => x.id === plan.targetId);
    expect(b).toBeDefined();
    expect(b.dist).toBeGreaterThanOrEqual(0.4 * shot.radius);
    expect(b.dist).toBeLessThanOrEqual(0.7 * shot.radius);
    const az = plan.path.az, bz = Math.atan2(b.z, b.x);
    expect(Math.abs(Math.atan2(Math.sin(az - bz), Math.cos(az - bz)))).toBeLessThan(0.3);
    // 道は目から後ろへ、上へ（引くほど高い）。主人公は道と反対（カメラから見て向こう）を向く
    expect(pathPoint(plan.path, 0)).toEqual(plan.path.origin);
    for (let x = 0; x < 300; x += 10) expect(pathPoint(plan.path, x + 10)[1]).toBeGreaterThan(pathPoint(plan.path, x)[1]);
    expect(dot(plan.path.forward, sub(pathPoint(plan.path, 10), pathPoint(plan.path, 0)))).toBeLessThan(0);
    // 球がビルに届くとき、カメラは front + lead の距離にいる
    const front = b.dist, cam = pathPoint(plan.path, front + leadFor(front));
    const a = viewAngles(cam, chaseLook(plan.path, front), [b.x, b.h * 0.5, b.z]);
    expect(a.ahead).toBe(true);
    expect(a.up).toBeLessThan(CINE.fitUpDeg);
    expect(a.side).toBeLessThan(CINE.fitSideDeg);
    expect(CINE.fitSideDeg).toBeLessThan(14); // 縦長の全画面（390×844）の横の半画角 約13.5° に収まる
    expect(CINE.fitUpDeg).toBeLessThan(CINE.fovDeg / 2);
  }
});

test('カメラは地面より上を通り、ビルの中を通らない（目の一拍の位置も、追われて引く道も）', () => {
  for (const { shot, plan } of cases()) {
    expect(plan.camPos[1]).toBeGreaterThan(1);
    const end = shot.radius + leadFor(shot.radius);
    const bad = [];
    for (let s = 1; s <= end; s += 2) {
      const p = pathPoint(plan.path, s);
      if (p[1] <= 1 || city.buildings.some((b) => inside(p, b, CINE.clearance - 0.01))) bad.push(s);
    }
    expect(bad).toEqual([]);
    expect(plan.camPos).toEqual(pathPoint(plan.path, CINE.beatDist[plan.reflector.type]));
  }
});

test('近くに生きた軍勢がいれば reflector.enemyId はその一人、いなければ null で type は glass', () => {
  const shot = SHOTS[1];
  const one = [enemy(1, 0.3, 70, 'dead'), enemy(7, 1.0, 75), enemy(2, 2.0, 3, 'dead')];
  for (let seed = 1; seed <= 10; seed++) {
    const p = chooseShot({ shot, buildings: city.buildings, enemies: one, rng: createRng(seed) });
    expect(p.reflector.enemyId).toBe(7);
    expect(['glass', 'visor', 'puddle']).toContain(p.reflector.type);
    const many = chooseShot({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(seed) });
    expect([1, 2, 3, 4]).toContain(many.reflector.enemyId);
  }
  for (const list of [[], [enemy(1, 0.3, 70, 'dead'), enemy(2, 2.0, 3, 'dead')]]) {
    for (let seed = 1; seed <= 10; seed++) {
      const p = chooseShot({ shot, buildings: city.buildings, enemies: list, rng: createRng(seed) });
      expect(p.reflector.enemyId).toBeNull();
      expect(p.reflector.type).toBe('glass');
    }
  }
  // 映るものは一拍のカメラの前（glass/visor は宙、puddle は地面）
  for (const { plan } of cases()) {
    const r = plan.reflector;
    const d = Math.hypot(...sub(r.pos, plan.camPos));
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(8);
    expect(angleDeg(sub(r.pos, plan.camPos), sub(plan.lookAt, plan.camPos))).toBeLessThan(80);
    if (r.type === 'puddle') expect(r.pos[1]).toBeLessThan(0.2);
  }
});

test('同じシードで同じ結果、シードを変えると type や角度が変わる', () => {
  const shot = SHOTS[2];
  const run = (seed) => chooseShot({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(seed) });
  expect(run(5)).toEqual(run(5));
  const types = new Set(), angles = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const p = run(seed);
    types.add(p.reflector.type);
    angles.add(Math.round(p.path.az * 10));
  }
  expect(types.size).toBeGreaterThanOrEqual(2);
  expect(angles.size).toBeGreaterThanOrEqual(4);
});

test('残っているビルが輪の中になくても、輪の中の一点の方へ引く', () => {
  const shot = SHOTS[0];
  const p = chooseShot({ shot, buildings: [], enemies: [], rng: createRng(2) });
  expect(p.targetId).toBeNull();
  const d = Math.hypot(p.target.x, p.target.z);
  expect(d).toBeGreaterThanOrEqual(0.4 * shot.radius);
  expect(d).toBeLessThanOrEqual(0.7 * shot.radius);
  expect(p.camPos[1]).toBeGreaterThan(1);
});

test('追われて引くカメラ: 生きた front を読み、常に front + minLead より先にいて、戻らず、front が急に速くなるとカメラも速くなる', () => {
  const chase = createChase(30);
  const dt = 1 / 60;
  let front = 0, prev = 30, slowV = 0, fastV = 0;
  for (let i = 0; i < 240; i++) {
    const speed = i < 120 ? 25 : 320; // じわじわ → 一気に
    front += speed * dt;
    const s = chase.update(dt, front);
    expect(s).toBeGreaterThanOrEqual(front + minLeadFor(front) - 1e-9);
    expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
    if (i === 110) slowV = (s - prev) / dt;
    if (i === 200) fastV = (s - prev) / dt;
    prev = s;
  }
  expect(fastV).toBeGreaterThan(slowV * 4);
  expect(fastV).toBeGreaterThan(300);
  // 大きな dt でも front を追い越されない
  const c2 = createChase(10);
  expect(c2.update(0.5, 200)).toBeGreaterThanOrEqual(200 + minLeadFor(200));
});

test('追われて引くカメラ: 実際の爆発曲線（じわじわ → 弾ける）でも飲まれず、追う時間は chaseMaxSec に収まる', () => {
  const R = CONFIG.radius.max, dur = blastDuration(R);
  expect(dur).toBeLessThan(CINE.chaseMaxSec);
  const chase = createChase(30), dt = 1 / 60;
  let prev = 30, creepEnd = 0;
  for (let t = dt; t <= dur + 1e-9; t += dt) {
    const front = frontAt(t, R), s = chase.update(dt, front);
    expect(s).toBeGreaterThanOrEqual(front + minLeadFor(front) - 1e-9);
    expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
    if (t < CONFIG.blast.creepSec) creepEnd = s - 30; // じわじわ期はほとんど引かない
    prev = s;
  }
  expect(creepEnd).toBeLessThan(40);
  expect(prev).toBeGreaterThan(R); // 最後には球の外
});

// 線分 a→c がビルの箱を通るか
function segHits(a, c, b) {
  const lo = [b.x - b.w / 2, 0, b.z - b.d / 2], hi = [b.x + b.w / 2, b.h, b.z + b.d / 2];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = c[i] - a[i];
    if (Math.abs(d) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return false; continue; }
    let u = (lo[i] - a[i]) / d, v = (hi[i] - a[i]) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}

test('追われ始め（front が狙うビルに届くまで）は、カメラから迫る球の壁への見通しを、まだ飲み込まれていないビルがふさがない', () => {
  for (const { plan } of cases()) {
    const b = city.buildings.find((x) => x.id === plan.targetId);
    for (const front of CINE.losFronts.map((k) => k * b.dist)) {
      const cam = pathPoint(plan.path, front + leadFor(front)), wall = sphereWall(plan.path, front);
      const blockers = city.buildings.filter((o) => o.dist > front * 1.05 && o !== b && segHits(cam, wall, o));
      expect(blockers.map((o) => o.id)).toEqual([]);
    }
  }
});

// createCinematic の進み方（描画の部品は小さな身代わり）
function makeCinematic() {
  const cityCamera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 6000);
  cityCamera.position.set(0, 175, 160);
  cityCamera.lookAt(0, 0, 0);
  cityCamera.userData.baseQuat = cityCamera.quaternion.clone();
  // 全体が見える位置: 半径に比例して視線と逆へ下がる（身代わり）
  const views = { size: { w: 1280, h: 720 }, cityCamera, wideCalls: [],
    widePosition(radius, aspect, out) { views.wideCalls.push({ radius, aspect }); return out.set(0, 175 + radius, 160 + radius); } };
  const enemyView = { setHeroYaw() {}, eyeCloseup: (id) => buildEyeCloseup(id) };
  const explosionView = { screen: { flash: 0.3, time: 0, heat: null } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {} };
  const cin = createCinematic(views, enemyView, explosionView, { renderer, scene: new THREE.Scene() });
  const plan = chooseShot({ shot: SHOTS[1], buildings: city.buildings, enemies: ARMY, rng: createRng(3) });
  return { cin, plan, views };
}
const advance = (cin, sec, blasts = [], dt = 1 / 60) => { for (let t = 0; t < sec - 1e-9; t += dt) cin.update(dt, blasts); };

test('createCinematic: 手の画面 → 真っ白 → 全画面で止まった時間 → 動き出し → 追う → 上空へなじんで終わる', () => {
  const { cin, plan } = makeCinematic();
  expect(cin.active).toBe(false);
  expect(cin.fullscreen).toBe(false);
  expect(cin.worldScale).toBe(1);
  cin.play(plan, SHOTS[1]);
  expect(cin.active).toBe(true);
  expect(cin.frozen).toBe(true);
  advance(cin, 0.1);
  expect(cin.fullscreen).toBe(false); // 両手が組み合わさる間は2画面
  expect(cin.white).toBe(false);
  expect(cin.worldScale).toBe(0);
  advance(cin, 0.2); // 0.3 s
  expect(cin.white).toBe(true);
  expect(cin.fullscreen).toBe(true);
  advance(cin, 0.3); // 0.6 s
  expect(cin.white).toBe(false);
  expect(cin.fullscreen).toBe(true);
  expect(cin.worldScale).toBe(0);
  expect(cin.screen.flash).toBeLessThan(0.05);
  advance(cin, CONFIG.cinematic.freezeSec - 0.6); // 一拍が終わり、世界が動き出している
  expect(cin.worldScale).toBeCloseTo(1, 5);
  cin.end();
  expect(cin.frozen).toBe(false);
  expect(cin.fullscreen).toBe(true);
  expect(cin.screen.flash).toBe(0.3); // 追う間は本爆発の閃光
  const blast = { id: 9, shot: SHOTS[1], front: 0 };
  for (let i = 0; i < 60; i++) { blast.front += 3; cin.update(1 / 60, [blast]); }
  expect(cin.phase).toBe('chase');
  // カメラは front より先（目から引いた横の距離が front + minLead 以上）
  const p = cin.camera.position;
  expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(blast.front + minLeadFor(blast.front) - 1e-6);
  advance(cin, 0.1, []); // 追っていた一発が終わる
  expect(cin.phase).toBe('settle');
  advance(cin, 2);
  expect(cin.active).toBe(false);
  expect(cin.fullscreen).toBe(false);
});

test('createCinematic: 追われて引いた最後に、球の全体が見える上空の構図へなじみ、そこで一度止まってから終わる', () => {
  const { cin, plan, views } = makeCinematic();
  const R = SHOTS[1].radius;
  cin.play(plan, SHOTS[1]);
  advance(cin, CONFIG.cinematic.freezeSec);
  cin.end();
  advance(cin, 0.1, [{ id: 1, shot: SHOTS[1], front: R * (CINE.wideFrontFrac - 0.02) }]);
  expect(cin.phase).toBe('chase');
  // 球が消える前に全体の構図へ着くよう、前線が最後の半径の手前まで来たら引くのをやめてなじみ始める
  advance(cin, 0.1, [{ id: 1, shot: SHOTS[1], front: R * CINE.wideFrontFrac }]);
  expect(cin.phase).toBe('settle');
  advance(cin, 1.15);
  expect(cin.phase).toBe('hold');
  expect(cin.fullscreen).toBe(true);
  const wide = new THREE.Vector3(0, 175 + R, 160 + R);
  expect(cin.camera.position.distanceTo(wide)).toBeLessThan(1e-6);
  expect(cin.camera.quaternion.angleTo(views.cityCamera.userData.baseQuat)).toBeLessThan(1e-4);
  expect(cin.camera.fov).toBeCloseTo(views.cityCamera.fov, 6);
  // 全体は全画面の縦横比で収める
  expect(views.wideCalls.at(-1)).toEqual({ radius: R, aspect: 1280 / 720 });
  const p = cin.camera.position.clone();
  advance(cin, 0.3);
  expect(cin.phase).toBe('hold');
  expect(cin.camera.position.distanceTo(p)).toBeLessThan(1e-6); // 止まっている
  advance(cin, 0.3);
  expect(cin.active).toBe(false);
});

test('createCinematic: 追う一発が見つからないままでも、決まった時間で上空へ戻る', () => {
  const { cin, plan } = makeCinematic();
  cin.play(plan, SHOTS[1]);
  advance(cin, CONFIG.cinematic.freezeSec);
  cin.end();
  advance(cin, CINE.chaseMaxSec - 0.1);
  expect(cin.phase).toBe('chase');
  advance(cin, 0.2);
  expect(cin.phase).toBe('settle');
  advance(cin, 2);
  expect(cin.active).toBe(false);
});

test('主人公は浮いている: 穴が深くなっても、演出の目の高さは変わらない', () => {
  const shot = SHOTS[0];
  const flat = chooseShot({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3) });
  const pit = chooseShot({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), crater: 300 });
  expect(flat.path.origin[1]).toBe(CINE.eyeY);
  expect(pit.path.origin[1]).toBe(CINE.eyeY);
});
