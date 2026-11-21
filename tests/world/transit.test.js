import { test, expect } from 'vitest';
import { buildTransit, transitPaths, pointAt, pathDist, segDist, TRANSIT } from '../../src/world/transit.js';
import { GRID } from '../../src/world/cityGen.js';
import { CONFIG } from '../../src/config.js';

// S8（持ち主 13:16「高速とか、電車とかも走ってた方がいいよね」）: 高架の高速道路と環状線の道筋・橋脚・橋桁の区間

const R = CONFIG.cityRadius;
const t = buildTransit(R);

test('高速は街を端から端まで横切り、環状線は街を一周する。どちらも広場から plazaKeep m より離れる（上空の画面の通りをふさがない）', () => {
  const { expressway, rail } = transitPaths(R);
  const xs = expressway.pts.map((p) => p[0]);
  expect(Math.min(...xs)).toBeLessThan(-R);
  expect(Math.max(...xs)).toBeGreaterThan(R);
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

test('橋脚はたいてい道路（軍勢が飛ぶ道）の外の区画に立つ', () => {
  const off = (v) => Math.abs(v - (Math.round(v / GRID.PITCH - 0.5) + 0.5) * GRID.PITCH);
  const onRoad = t.pillars.filter((p) => off(p.x) < GRID.ROAD / 2 + 1.2 || off(p.z) < GRID.ROAD / 2 + 1.2);
  expect(onRoad.length / t.pillars.length).toBeLessThan(0.15); // 道筋が道路に沿って斜めに曲がる所だけは道路に立つ
  for (const p of t.pillars) expect(t.segments.some((s) => s.id === p.seg)).toBe(true);
});

test('最大の一発は高架の全部の区間に届く（街の中の区間）', () => {
  for (const s of t.segments) if (s.dist <= R) expect(s.dist).toBeLessThan(CONFIG.radius.max);
});
