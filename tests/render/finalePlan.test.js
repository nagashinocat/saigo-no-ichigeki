import { test, expect } from 'vitest';
import { planFinale, planRetreat, pickLead, PLAN, retreatPoint, segHitsBox, retreatMargin, nearDist } from '../../src/render/finalePlan.js';
import { createTimeline } from '../../src/render/finaleTimeline.js';
import { phaseTimes, frontAt } from '../../src/game/blast.js';
import { facadeWindows } from '../../src/render/facadeWindows.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

const shotOf = (amount) => ({ amount, radius: radiusFor(amount), isBig: true });
const SHOTS = [shotOf(CONFIG.power.minRelease), shotOf(60), shotOf(CONFIG.power.max)];
const enemy = (id, angle, dist, state = 'approach') => ({ id, angle, dist, state, deadTime: 0 });
// 主人公を狙う者と、街を見回る者（S8、patrol。爆心から 88〜680 m）
const patrol = (id, angle, dist, state = 'search') => ({ ...enemy(id, angle, dist, state), patrol: true });
const ARMY = [enemy(1, 0.3, 40), enemy(2, 2.1, 30), enemy(3, 4.0, 3, 'grab'), enemy(4, 5.2, 55), enemy(5, 1.0, 20, 'dead'),
  patrol(11, 0.8, 120), patrol(12, 2.6, 210), patrol(13, 4.4, 330), patrol(14, 5.9, 410), patrol(15, 1.7, 520, 'dead')];
const lead = (r) => 20 + 0.6 * r;
const inside = (p, b, m = 0) => Math.abs(p[0] - b.x) < b.w / 2 + m && Math.abs(p[2] - b.z) < b.d / 2 + m && p[1] < b.h + m;

function cases(seeds = [3, 7, 11]) {
  const out = [];
  for (const seed of seeds) {
    const city = generateCity(seed);
    for (const shot of SHOTS) for (let r = 1; r <= 6; r++) {
      out.push({ city, shot, plan: planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(r), lead: lead(shot.radius) }) });
    }
  }
  return out;
}

// R0b（持ち主 22:15）: 遠くの軍勢（見回る者）の後ろから、地平の爆心を見る
const horiz = (p) => Math.hypot(p[0], p[2]);
const f0Of = (R) => frontAt(phaseTimes(R).creep, R);

test('撮る一人の選び方: 帯（半径の band）の中の生きた見回る者から。いなければ帯にいちばん近い見回る者、それもいなければ生きた誰か、誰もいなければ null', () => {
  const R = radiusFor(CONFIG.power.max);
  const [a, b] = PLAN.band.map((k) => k * R);
  for (let s = 1; s <= 8; s++) {
    const e = pickLead(ARMY, R, createRng(s));
    expect(e.patrol).toBe(true);
    expect(e.dist).toBeGreaterThanOrEqual(a);
    expect(e.dist).toBeLessThanOrEqual(b);
    expect(e.state).not.toBe('dead');
  }
  // 小さな一発: 帯（44〜69 m）に見回る者はいない → 帯にいちばん近い見回る者（120 m）
  expect(pickLead(ARMY, radiusFor(CONFIG.power.minRelease), createRng(1)).id).toBe(11);
  // 見回る者がいない → 帯にいちばん近い生きた者
  expect(pickLead(ARMY.filter((e) => !e.patrol), R, createRng(1)).id).toBe(4);
  expect(pickLead([enemy(9, 0, 10, 'dead')], R, createRng(1))).toBeNull();
});

test('乗り手の列: 撮る一人（いちばん手前）は帯の中の距離で、少なくとも minRiders 人。全員がじわじわ期の光の外（弾けてから飲まれる）・半径の 0.7 より内、ビルの外にいて、爆心を向く', () => {
  for (const { city, shot, plan } of cases()) {
    const R = shot.radius, f0 = f0Of(R);
    expect(plan.riders.length).toBeGreaterThanOrEqual(PLAN.minRiders);
    expect(plan.riders[0].id).toBe(plan.riderId);
    expect(plan.rider.pos).toEqual(plan.riders[0].pos);
    const d0 = horiz(plan.rider.pos);
    expect(d0).toBeGreaterThanOrEqual(PLAN.band[0] * R - 1e-6);
    expect(d0).toBeLessThanOrEqual(PLAN.band[1] * R + 1e-6);
    for (const r of plan.riders) {
      const d3 = Math.hypot(...r.pos);
      expect(d3).toBeGreaterThan(f0 + 3);
      expect(d3).toBeLessThan(0.7 * R);
      expect(horiz(r.pos)).toBeLessThanOrEqual(d0 + 1e-6); // 撮る一人がいちばん手前（カメラの側）
      expect(r.pos[1]).toBeGreaterThan(1.5);
      expect(city.buildings.filter((o) => inside(r.pos, o, PLAN.riderClear - 0.01)).map((o) => o.id)).toEqual([]);
      // バイクの前（+z を yaw で回した向き）が爆心の方
      const f = [Math.sin(r.yaw), Math.cos(r.yaw)], d = horiz(r.pos);
      expect(f[0] * -r.pos[0] / d + f[1] * -r.pos[2] / d).toBeGreaterThan(0.97);
    }
    expect(plan.riderDist).toBeCloseTo(Math.hypot(...plan.rider.pos), 6);
    expect(plan.firstDist).toBeCloseTo(Math.min(...plan.riders.map((r) => Math.hypot(...r.pos))), 6);
  }
});

test('乗り手の顔ぶれ: 撮る一人は選んだ見回る者、ほかはその場所に近い生きた者（重ならない）。軍勢がいなければ名もない乗り手', () => {
  for (const { plan } of cases()) {
    const ids = plan.riders.map((r) => r.id).filter((x) => x !== null);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(ARMY.find((e) => e.id === id).state).not.toBe('dead');
  }
  const p = planFinale({ shot: SHOTS[1], buildings: generateCity(3).buildings, enemies: [], rng: createRng(1) });
  expect(p.riderId).toBeNull();
  expect(p.riders.length).toBeGreaterThanOrEqual(PLAN.minRiders);
  expect(p.rider.pos.every(Number.isFinite)).toBe(true);
});

test('最大の一発: 撮る一人は爆心から数百 m（250 m 以上）の見回る者', () => {
  for (const { shot, plan } of cases()) {
    if (shot.amount !== CONFIG.power.max) continue;
    expect(horiz(plan.rider.pos)).toBeGreaterThan(250);
    expect(ARMY.find((e) => e.id === plan.riderId).patrol).toBe(true);
  }
});

test('カメラ: 撮る一人の後ろ（爆心から離れた側）でビルの外。爆心の光（じわじわ期の光の玉の下の方から上まで）と、乗り手の一人ひとりを見通せる。見る先は爆心', () => {
  for (const { city, shot, plan } of cases()) {
    const R = shot.radius, f0 = f0Of(R), c = plan.camPos;
    expect(horiz(c)).toBeGreaterThan(horiz(plan.rider.pos) + PLAN.camBack - 1);
    expect(c[1]).toBeGreaterThan(plan.rider.pos[1]);
    expect(city.buildings.filter((o) => inside(c, o, PLAN.camClear - 0.01)).map((o) => o.id)).toEqual([]);
    for (const g of PLAN.glow) {
      expect(city.buildings.filter((o) => nearDist(o) > f0 * PLAN.glowIgnore && segHitsBox(c, [0, g * f0, 0], o, 0.5)).map((o) => o.id)).toEqual([]);
    }
    expect(PLAN.glow[0]).toBeLessThanOrEqual(0.35); // スローの初めの小さな光の玉から見える
    for (const r of plan.riders) {
      expect(city.buildings.filter((o) => segHitsBox(c, [r.pos[0], r.pos[1] + 1.2, r.pos[2]], o, 0.29)).map((o) => o.id), `rider ${r.id}`).toEqual([]);
    }
    expect(horiz(plan.look)).toBeLessThan(1e-9);
    expect(plan.camDist).toBeCloseTo(Math.hypot(...c), 6);
    // カメラは高すぎない（街の上を見下ろす屋上の並みまで）
    expect(c[1]).toBeLessThan(PLAN.maxLift * R + PLAN.hover + PLAN.camUp + 1e-6);
    // 時刻表に渡すと、乗り手 → カメラの順に飲まれ、どちらも弾けたあと
    const tl = createTimeline({ radius: R, riderDist: plan.riderDist, firstDist: plan.firstDist, camDist: plan.camDist });
    expect(tl.riderDist).toBeCloseTo(plan.riderDist, 6);
    expect(tl.camDist).toBeCloseTo(plan.camDist, 6);
  }
});

test('ほかの軍勢（実際の場所で描かれる者）はカメラのすぐそばにいない', () => {
  for (const { plan } of cases()) {
    const ids = new Set(plan.riders.map((r) => r.id));
    for (const e of ARMY.filter((x) => x.state !== 'dead' && !ids.has(x.id))) {
      const p = [Math.cos(e.angle) * e.dist, 3, Math.sin(e.angle) * e.dist];
      expect(Math.hypot(p[0] - plan.camPos[0], p[2] - plan.camPos[2])).toBeGreaterThan(PLAN.othersClear - 1e-9);
    }
  }
});

test('逃げる道を後回しにできる: retreat: false なら null で、あとの planRetreat は同じ道を返す', () => {
  for (const seed of [3, 7]) {
    const city = generateCity(seed);
    for (const shot of SHOTS) {
      const args = { shot, buildings: city.buildings, enemies: ARMY, lead: lead(shot.radius) };
      const full = planFinale({ ...args, rng: createRng(5) });
      const lazy = planFinale({ ...args, rng: createRng(5), retreat: false });
      expect(lazy.retreat).toBeNull();
      expect({ ...lazy, retreat: full.retreat }).toEqual(full);
      expect(planRetreat(lazy, { buildings: city.buildings, radius: shot.radius, lead: lead(shot.radius) })).toEqual(full.retreat);
    }
  }
});

// 種ごとに分ける（3 つの種をまとめると、全部のテストを並べて走らせたときに 5 秒の時間切れになることがあった。確かめる中身は同じ）
test.each([3, 7, 11])('逃げる道（種 %i）: カメラの位置から始まり、ビルを通らず、地面より上で、爆心から離れていく（その一発の半径 + 先を行く距離まで）', (seed) => {
  for (const { city, shot, plan } of cases([seed])) {
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
  expect(p.camPos[1]).toBeGreaterThan(1);
  expect(p.rider.pos[1]).toBeGreaterThan(1);
  expect(p.riders.length).toBeGreaterThanOrEqual(PLAN.minRiders);
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
