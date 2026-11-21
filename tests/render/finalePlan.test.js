import { test, expect } from 'vitest';
import { planFinale, planRetreat, PLAN, RIDER_MAX_ANG, retreatPoint, segHitsBox, retreatMargin } from '../../src/render/finalePlan.js';
import { FINALE } from '../../src/render/finaleTimeline.js';
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

// 絵コンテ 2（持ち主 2026-11-21 09:40）: 軍勢の一人（浮遊バイクの乗り手）の背後・肩越しのカメラ
const horiz = (p) => Math.hypot(p[0], p[2]);
const farDist = (b) => Math.hypot(Math.abs(b.x) + b.w / 2, Math.abs(b.z) + b.d / 2);

test('乗り手の場所: 光の壁が届く範囲（半径の riderFrac 以内）で、地面から浮き、ビルの外にいて、爆心（光の壁）の方を向く', () => {
  for (const { city, shot, plan } of cases()) {
    const r = plan.rider;
    const d = horiz(r.pos);
    expect(d).toBeGreaterThanOrEqual(PLAN.riderRange[0] - 1e-9);
    expect(d).toBeLessThanOrEqual(Math.min(PLAN.riderRange[1], shot.radius * PLAN.riderFrac) + 1e-9);
    expect(r.pos[1]).toBeGreaterThan(1.5);
    expect(city.buildings.filter((o) => inside(r.pos, o, PLAN.riderClear)).map((o) => o.id)).toEqual([]);
    // バイクの前（+z を yaw で回した向き）が爆心の方（faceOff だけそれた向き）を向く
    const f = [Math.sin(r.yaw), Math.cos(r.yaw)];
    expect(f[0]).toBeCloseTo(r.fwd[0], 9); expect(f[1]).toBeCloseTo(r.fwd[2], 9);
    expect(f[0] * -r.pos[0] / d + f[1] * -r.pos[2] / d).toBeCloseTo(Math.cos(PLAN.faceOff), 6);
    expect(r.out[0]).toBeCloseTo(r.pos[0] / d, 9); expect(r.out[2]).toBeCloseTo(r.pos[2] / d, 9);
    // 一拍のはじめの前線は乗り手の riderGap + crawl m 手前
    expect(plan.hitDist).toBeCloseTo(d - FINALE.riderGap - FINALE.crawl, 6);
    expect(plan.riderDist).toBeCloseTo(Math.hypot(d, r.pos[1] + 1), 6);
  }
});

test('カメラは乗り手の背後・肩越し（乗り手の向きの後ろに camBack m、横に camSide m、頭より少し上）で、ビルの外。乗り手の頭と、その向こうの光の壁を見通せる。ガラス片が来ると同じ肩の側の頭の後ろへ寄り（そこで飲まれる）、ガラス片は顔の前で頭より遠い', () => {
  for (const { city, plan } of cases()) {
    const r = plan.rider, c = plan.camPos, d = horiz(r.pos);
    const out = [r.pos[0] / d, r.pos[2] / d], back = [-r.fwd[0], -r.fwd[2]], right = [-r.fwd[2], r.fwd[0]];
    const rel = [c[0] - r.pos[0], c[2] - r.pos[2]];
    expect(rel[0] * back[0] + rel[1] * back[1]).toBeCloseTo(PLAN.camBack, 6);
    expect(Math.abs(rel[0] * right[0] + rel[1] * right[1])).toBeCloseTo(PLAN.camSide, 6);
    expect(c[1] - r.pos[1]).toBeCloseTo(PLAN.camY, 6);
    expect(city.buildings.filter((o) => inside(c, o, PLAN.camClear - 0.01)).map((o) => o.id)).toEqual([]);
    // ガラス片が来ると寄る肩越し（頭の後ろ・肩の上、同じ側）。カメラはそこで止まって飲まれるので、camDist はそこまで
    const cn = plan.camNear, g = plan.glass, h = plan.rider.head;
    const relN = [cn[0] - h[0], cn[2] - h[2]], relG = [g[0] - h[0], g[2] - h[2]];
    expect(relN[0] * back[0] + relN[1] * back[1]).toBeCloseTo(PLAN.near.back, 6);
    expect(relN[0] * right[0] + relN[1] * right[1]).toBeCloseTo(PLAN.near.side * plan.rider.side, 6);
    expect(Math.sign(rel[0] * right[0] + rel[1] * right[1])).toBe(plan.rider.side); // 始めと同じ肩の側
    // 目が合ったあと、始めの方へ backOut だけ戻った所（camEnd）で飲まれる: camDist はそこまで
    expect(plan.camEnd.map((v, i) => +(v - (cn[i] + (c[i] - cn[i]) * PLAN.backOut)).toFixed(9))).toEqual([0, 0, 0]);
    expect(plan.camDist).toBeCloseTo(Math.hypot(...plan.camEnd), 6);
    expect(plan.camDist).toBeLessThan(Math.hypot(...c));
    expect(city.buildings.filter((o) => inside(cn, o, PLAN.camClear - 0.01)).map((o) => o.id)).toEqual([]);
    // 目が映るガラス片は乗り手の顔の前（光の壁の側）で、寄ったカメラから見て頭より遠い。ビルの外で、カメラから見通せる
    expect(-(relG[0] * back[0] + relG[1] * back[1])).toBeCloseTo(PLAN.glass.fwd, 6);
    expect(Math.hypot(g[0] - cn[0], g[1] - cn[1], g[2] - cn[2])).toBeGreaterThan(Math.hypot(h[0] - cn[0], h[1] - cn[1], h[2] - cn[2]) + 0.8);
    expect(city.buildings.filter((o) => inside(g, o, 0.49) || segHitsBox(cn, g, o, 0.19)).map((o) => o.id)).toEqual([]);
    // 見通し: 乗り手の頭・見る先・その向こうの光の壁（一拍の前線）を、まだ飲まれていないビルがふさがない
    const head = [r.pos[0], r.pos[1] + 1.55, r.pos[2]];
    const wall = plan.hitDist + FINALE.crawl;
    // 頭の向こう（画面の真ん中の列）の光の壁: カメラから乗り手の頭を通って光の壁まで
    const toHead = [head[0] - c[0], head[1] - c[1], head[2] - c[2]];
    const n = Math.hypot(...toHead);
    const pts = [head, plan.look, ...[1.5, 3, 4.5, 6].map((k) => c.map((v, i) => v + toHead[i] / n * (n + k)))];
    for (const q of pts) expect(city.buildings.filter((o) => farDist(o) > wall - 0.5 && segHitsBox(c, q, o, 0.2)).map((o) => o.id)).toEqual([]);
    // 見る先は乗り手の向こう（爆心の方）
    expect(horiz(plan.look)).toBeLessThan(d);
    expect(out[0] * -r.fwd[0] + out[1] * -r.fwd[2]).toBeGreaterThan(0.5);
  }
});

test('時間が戻ってから追うカットまでに光の壁が触れるビルは、カメラから sweptClear m、カメラから乗り手の頭への線から sweptLine m より離れている（押されてゆがむ壁がレンズの前をふさがない）', () => {
  const near = (b) => Math.hypot(Math.max(0, Math.abs(b.x) - b.w / 2), Math.max(0, Math.abs(b.z) - b.d / 2));
  for (const { city, plan } of cases()) {
    const head = [plan.rider.pos[0], plan.rider.pos[1] + 1.55, plan.rider.pos[2]];
    // 始めのカメラと、寄って飲まれるカメラのどちらからも
    for (const c of [plan.camPos, plan.camNear, plan.camEnd]) {
      for (const o of city.buildings.filter((b) => near(b) < Math.hypot(...c) + FINALE.passBeyond)) {
        expect(Math.hypot(Math.max(0, Math.abs(c[0] - o.x) - o.w / 2), Math.max(0, Math.abs(c[2] - o.z) - o.d / 2)), `building ${o.id}`).toBeGreaterThanOrEqual(PLAN.sweptClear);
        expect(segHitsBox(c, head, o, PLAN.sweptLine), `building ${o.id}`).toBe(false);
      }
    }
  }
});

test('目が映る一人は、生きた軍勢の中から、乗り手の場所の向き（RIDER_MAX_ANG 以内）にいる者のうち乗り手の場所にいちばん近い一人', () => {
  const pos = (e) => [Math.cos(e.angle) * e.dist, Math.sin(e.angle) * e.dist];
  for (const { plan } of cases()) {
    expect([1, 2, 3, 4]).toContain(plan.riderId);
    const a = Math.atan2(plan.rider.pos[2], plan.rider.pos[0]);
    const near = (e) => e.state !== 'dead' && Math.abs(Math.atan2(Math.sin(e.angle - a), Math.cos(e.angle - a))) < RIDER_MAX_ANG;
    const d = (e) => { const p = pos(e); return Math.hypot(p[0] - plan.rider.pos[0], p[1] - plan.rider.pos[2]); };
    const best = ARMY.filter(near).sort((x, y) => d(x) - d(y))[0];
    if (best) expect(plan.riderId).toBe(best.id);
  }
  const city = generateCity(3);
  const p = planFinale({ shot: SHOTS[1], buildings: city.buildings, enemies: [], rng: createRng(1) });
  expect(p.riderId).toBeNull();
  expect(p.rider.pos.every(Number.isFinite)).toBe(true); // 軍勢がいなくても、名もない乗り手の背後から撮る
});

test('ほかの軍勢がカメラのすぐ前・乗り手のすぐそばにいない', () => {
  for (const { plan } of cases()) {
    for (const e of ARMY.filter((x) => x.state !== 'dead' && x.id !== plan.riderId)) {
      const p = [Math.cos(e.angle) * e.dist, 3, Math.sin(e.angle) * e.dist];
      expect(Math.hypot(p[0] - plan.camPos[0], p[2] - plan.camPos[2])).toBeGreaterThan(PLAN.othersClear - 1e-9);
      expect(Math.hypot(p[0] - plan.rider.pos[0], p[2] - plan.rider.pos[2])).toBeGreaterThan(PLAN.othersClear - 1e-9);
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
