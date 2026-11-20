import { test, expect } from 'vitest';
import { chooseShot, CINE, pathPoint, chaseLook, leadFor, minLeadFor, createChase } from '../../src/render/cinematic.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

const city = generateCity(3);
const shotOf = (amount) => ({ amount, radius: radiusFor(amount), isBig: true });
const SHOTS = [shotOf(CONFIG.charge.maxDraw * CONFIG.bigShotRatio), shotOf(60), shotOf(CONFIG.charge.maxDraw)];
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
      if (p[1] <= 1 || city.buildings.some((b) => inside(p, b, 1))) bad.push(s);
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
