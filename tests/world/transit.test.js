import { test, expect } from 'vitest';
import { buildTransit, transitPaths, pointAt, pathDist, segDist, TRANSIT, LANE_HALF } from '../../src/world/transit.js';
import { GRID } from '../../src/world/cityGen.js';
import { CONFIG } from '../../src/config.js';

// S8（持ち主 13:16「高速とか、電車とかも走ってた方がいいよね」）: 高架の高速道路と環状線の道筋・橋脚・橋桁の区間

const R = CONFIG.cityRadius;
const t = buildTransit(R);

test('高速は街を端から端まで横切り、環状線は街を一周する。どちらも広場から plazaKeep m より離れる（上空の画面の通りをふさがない）', () => {
  const { expressway, rail } = transitPaths(R);
  const xs = expressway.pts.map((p) => p[0]);
  expect(Math.min(...xs)).toBeLessThan(-R * 0.85); // 街を端から端まで（fix1: 街の端の手前で終わる）
  expect(Math.max(...xs)).toBeGreaterThan(R * 0.85);
  expect(rail.closed).toBe(true);
  expect(rail.length).toBeGreaterThan(2 * Math.PI * R * TRANSIT.rail.ring * 0.99);
  expect(pathDist(expressway, 0, 0)).toBeGreaterThan(TRANSIT.plazaKeep);
  expect(pathDist(rail, 0, 0)).toBeGreaterThan(TRANSIT.plazaKeep);
  // 上空の画面（広場のまわりの 8 つの街区 ±35 m と、その奥の通り）の手前側（+z）には来ない
  for (const p of [...expressway.pts, ...rail.pts]) if (Math.abs(p[0]) < 60) expect(Math.abs(p[1])).toBeGreaterThan(140);
});

test('pointAt は道筋の長さに沿って進み、輪は回り込む', () => {
  const { rail, expressway } = t.paths;
  const a = pointAt(rail, 10), b = pointAt(rail, 10 + rail.length);
  expect(a.x).toBeCloseTo(b.x, 6); expect(a.z).toBeCloseTo(b.z, 6);
  const p0 = pointAt(expressway, 100), p1 = pointAt(expressway, 101);
  expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeCloseTo(1, 1);
  expect(pathDist(expressway, p0.x, p0.z)).toBeLessThan(1e-6);
});

test('橋桁の区間は道筋をすき間なく覆い（前の区間の終わり = 次の始まり）、id は重ならない。dist は爆心から区間の一番近い点まで', () => {
  for (const line of ['expressway', 'rail']) {
    const segs = t.segments.filter((s) => s.line === line);
    expect(segs.length).toBeGreaterThan(30);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].s0).toBeCloseTo(segs[i - 1].s1, 9);
      expect(segs[i].a[0]).toBeCloseTo(segs[i - 1].b[0], 6);
    }
    for (const s of segs) {
      expect(s.len).toBeGreaterThan(TRANSIT[line].span * 0.4);
      expect(s.len).toBeLessThan(TRANSIT[line].span * 1.7);
      expect(s.dist).toBeCloseTo(segDist(0, 0, s.a, s.b), 9);
      expect(s.dist).toBeLessThanOrEqual(Math.hypot(s.x, s.z));
      expect(s.value).toBeGreaterThan(0);
    }
  }
  expect(new Set(t.segments.map((s) => s.id)).size).toBe(t.segments.length);
  // 環状線は輪: 最後の区間の終わりは最初の区間の始まり
  const r = t.segments.filter((s) => s.line === 'rail');
  expect(r[r.length - 1].b[0]).toBeCloseTo(r[0].a[0], 6);
  expect(r[r.length - 1].b[1]).toBeCloseTo(r[0].a[1], 6);
});

test('fix1: 橋脚の柱は車線（道路の中心線から LANE_HALF m の内、軍勢が飛ぶ所）にかからない（歩道・区画の上か、道をまたぐ門形）', () => {
  const off = (v) => Math.abs(v - (Math.round(v / GRID.PITCH - 0.5) + 0.5) * GRID.PITCH);
  expect(LANE_HALF).toBe(GRID.ROAD / 2 - 0.5);
  let n = 0;
  for (const p of t.pillars) {
    expect(p.legs.length).toBeGreaterThanOrEqual(1);
    for (const [x, z] of p.legs) {
      expect(off(x)).toBeGreaterThanOrEqual(LANE_HALF + p.w / 2);
      expect(off(z)).toBeGreaterThanOrEqual(LANE_HALF + p.w / 2);
      n++;
    }
    expect(t.segments.some((s) => s.id === p.seg)).toBe(true);
  }
  expect(n).toBeGreaterThan(100);
});

test('fix1: 高速は街の内で終わる（最大の一発が全部を飲み、終わったあとの街の外に残らない）', () => {
  for (const p of t.paths.expressway.pts) expect(Math.hypot(...p)).toBeLessThanOrEqual(R - TRANSIT.expressway.endPad + 1e-6);
  for (const s of t.segments) expect(Math.hypot(...s.a) + 1).toBeLessThan(CONFIG.radius.max);
});

test('最大の一発は高架の全部の区間に届く（街の中の区間）', () => {
  for (const s of t.segments) if (s.dist <= R) expect(s.dist).toBeLessThan(CONFIG.radius.max);
});
