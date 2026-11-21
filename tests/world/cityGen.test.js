import { test, expect } from 'vitest';
import { generateCity } from '../../src/world/cityGen.js';
import { pathDist, TRANSIT } from '../../src/world/transit.js';
import { CONFIG } from '../../src/config.js';

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

test('同じシードで同じ街', () => expect(generateCity(1)).toEqual(generateCity(1)));

test('建物は広場の外、街の半径の内', () => {
  for (const b of generateCity(1).buildings) {
    expect(b.dist).toBeGreaterThan(12 + Math.max(b.w, b.d) / 2);
    expect(b.dist).toBeLessThanOrEqual(CONFIG.cityRadius); // S8: 420 → 680 m
    expect(b.dist).toBeCloseTo(Math.hypot(b.x, b.z));
  }
});

test('建物どうしが重ならない', () => {
  const bs = generateCity(2).buildings;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j];
    const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
    expect(overlap).toBe(false);
  }
});

// S8: 街を 420 → 680 m に広げた（面積 約 2.6 倍）ので、建物数の範囲も広げた（前は 400〜900）
test('建物数は 1300〜2200、外側ほど低くなる傾向', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const { buildings } = generateCity(seed);
    expect(buildings.length).toBeGreaterThanOrEqual(1300);
    expect(buildings.length).toBeLessThanOrEqual(2200);
    const s = [...buildings].sort((a, b) => a.dist - b.dist);
    const n = Math.floor(s.length / 3);
    expect(avg(s.slice(0, n).map((b) => b.h))).toBeGreaterThan(avg(s.slice(-n).map((b) => b.h)));
  }
});

test('value は h*w*d に比例し tower が最も高い', () => {
  const { buildings } = generateCity(1);
  const rate = (b) => b.value / (b.w * b.h * b.d);
  const byKind = { tower: [], office: [], house: [] };
  for (const b of buildings) {
    byKind[b.kind].push(b);
    const expected = b.h >= 60 ? 'tower' : b.h >= 20 ? 'office' : 'house';
    expect(b.kind).toBe(expected);
  }
  for (const k of Object.keys(byKind)) {
    expect(byKind[k].length).toBeGreaterThan(0);
    const r = byKind[k].map(rate);
    for (const x of r) expect(x).toBeCloseTo(r[0]);
  }
  expect(rate(byKind.tower[0])).toBeGreaterThan(rate(byKind.office[0]));
  expect(rate(byKind.office[0])).toBeGreaterThan(rate(byKind.house[0]));
  expect(Math.max(...buildings.map((b) => b.value))).toBe(Math.max(...byKind.tower.map((b) => b.value)));
});

test('props は半径内・広場の外で、建物と重ならない', () => {
  const { buildings, props } = generateCity(1);
  expect(props.length).toBeGreaterThan(0);
  for (const p of props) {
    expect(['car', 'lamp', 'sign']).toContain(p.kind);
    expect(p.dist).toBeGreaterThan(CONFIG.plazaRadius);
    expect(p.dist).toBeLessThanOrEqual(CONFIG.cityRadius);
    for (const b of buildings) {
      const inside = Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.z - b.z) < b.d / 2;
      expect(inside).toBe(false);
    }
  }
});

test('広場の近く（中心から 100m 未満）の建物は高さ 35m 以下（上空から広場が隠れない）', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const near = generateCity(seed).buildings.filter((b) => b.dist < 100);
    expect(near.length).toBeGreaterThan(0);
    for (const b of near) expect(b.h).toBeLessThanOrEqual(35);
  }
});

test('広場のまわりの建物は高さがばらつき、広場に面する最初の一周（中心から 40m 未満）は 22m 以下で、その外より低め', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const bs = generateCity(seed).buildings;
    const ring1 = bs.filter((b) => b.dist < 40), ring2 = bs.filter((b) => b.dist >= 50 && b.dist < 100);
    for (const b of ring1) expect(b.h).toBeLessThanOrEqual(22);
    expect(avg(ring1.map((b) => b.h))).toBeLessThan(avg(ring2.map((b) => b.h)));
    const near = bs.filter((b) => b.dist < 100).map((b) => Math.round(b.h));
    expect(new Set(near).size).toBeGreaterThanOrEqual(6); // 同じ高さが並ばない
  }
});

// S7（持ち主 2026-11-21 13:13 / 13:16）: ビルの形の幅（細い塔・段々・横長・低い商店の並び・斜めの屋根・目印の超高層）
import { GRID, ARCHETYPES } from '../../src/world/cityGen.js';

const lotOf = (b) => [Math.round(b.x / GRID.PITCH) * GRID.PITCH, Math.round(b.z / GRID.PITCH) * GRID.PITCH];

// S8: 広い街では目印の超高層を 2〜4 → 3〜5 本に
test('S7: どのシードでも形の種類がそろい、目印の超高層が 3〜5 本', () => {
  for (const seed of [1, 2, 3, 7, 42]) {
    const bs = generateCity(seed).buildings;
    const count = Object.fromEntries(ARCHETYPES.map((a) => [a, bs.filter((b) => b.arch === a).length]));
    for (const a of ARCHETYPES) if (a !== 'landmark') expect(count[a], `${seed} ${a}`).toBeGreaterThanOrEqual(15);
    expect(count.landmark).toBeGreaterThanOrEqual(3);
    expect(count.landmark).toBeLessThanOrEqual(5);
    const lm = bs.filter((b) => b.arch === 'landmark');
    const others = bs.filter((b) => b.arch !== 'landmark');
    for (const b of lm) expect(b.h).toBeGreaterThan(1.3 * Math.max(...others.map((o) => o.h)));
  }
});

test('S7: 高さにはっきりした差（標準偏差 / 平均 > 0.35）、遠くでも低いビルの隣に高いビル', () => {
  for (const seed of [1, 2, 3, 7, 42]) {
    const bs = generateCity(seed).buildings;
    const h = bs.map((b) => b.h), m = avg(h);
    const sd = Math.sqrt(avg(h.map((x) => (x - m) ** 2)));
    expect(sd / m).toBeGreaterThan(0.35);
    // 広場から 120〜300m の帯でも、ばらつきが大きい（同じ高さの箱が並ばない）
    const band = bs.filter((b) => b.dist > 120 && b.dist < 300 && b.arch !== 'landmark').map((b) => b.h);
    const bm = avg(band);
    expect(Math.sqrt(avg(band.map((x) => (x - bm) ** 2))) / bm).toBeGreaterThan(0.45);
    expect(band.filter((x) => x < 15).length).toBeGreaterThan(10);
    expect(band.filter((x) => x > 60).length).toBeGreaterThan(10);
  }
});

test('S7: 足元は区画（道路の内側）に収まり、道路の格子はあいたまま。部品は建物の箱の内に収まる', () => {
  const { BLOCK } = GRID;
  for (const seed of [1, 7, 42]) {
    for (const b of generateCity(seed).buildings) {
      const [cx, cz] = lotOf(b);
      expect(Math.abs(b.x - cx) + b.w / 2).toBeLessThanOrEqual(BLOCK / 2 + 1e-6);
      expect(Math.abs(b.z - cz) + b.d / 2).toBeLessThanOrEqual(BLOCK / 2 + 1e-6);
      expect(b.parts.length).toBeGreaterThanOrEqual(1);
      let top = 0;
      for (const p of b.parts) {
        expect(Math.abs(p.x) + p.w / 2).toBeLessThanOrEqual(b.w / 2 + 1e-6);
        expect(Math.abs(p.z) + p.d / 2).toBeLessThanOrEqual(b.d / 2 + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.h).toBeGreaterThan(0);
        top = Math.max(top, p.y + p.h);
      }
      expect(top).toBeCloseTo(b.h, 6);
      expect(b.parts.some((p) => p.y === 0)).toBe(true); // 地面に立つ
    }
  }
});

test('S7: 広場の近く（見つける距離の内）の建物の足元は前と同じ（見通しと釣り合いを変えない）', () => {
  // 前の街（S6 まで）の足元: 乱数の引き方は変えず、形の種類は別の乱数で決める
  const near = generateCity(7).buildings.filter((b) => b.dist < 60);
  expect(near.length).toBeGreaterThan(0);
  const base = generateCity(7, undefined, { variety: false }).buildings;
  expect(near.length).toBe(base.filter((b) => b.dist < 60).length);
  for (const b of near) {
    const o = base.find((x) => Math.hypot(x.x - b.x, x.z - b.z) < 1e-9); // 外であいた区画を埋めるので番号はずれる
    expect([b.x, b.z, b.w, b.d]).toEqual([o.x, o.z, o.w, o.d]);
  }
});

test('S7: 街の広さと区画の数は引数で変えられる（後の大きな街・高架の通り道のため）', () => {
  const small = generateCity(5, undefined, { radius: 200 });
  expect(Math.max(...small.buildings.map((b) => b.dist))).toBeLessThanOrEqual(200);
  // S8: 既定の街が 680 m になったので、大きな街は 900 m で確かめる
  const big = generateCity(5, undefined, { radius: 900 });
  expect(big.buildings.length).toBeGreaterThan(generateCity(5).buildings.length);
  expect(Math.max(...big.buildings.map((b) => b.dist))).toBeGreaterThan(820);
  // 通り道の予約: その帯にかかる区画には建物を置かない
  const res = generateCity(5, undefined, { corridors: [{ axis: 'z', at: 6.5 * GRID.PITCH, half: GRID.PITCH / 2 }] });
  for (const b of res.buildings) expect(Math.abs(b.x - 6.5 * GRID.PITCH)).toBeGreaterThan(GRID.PITCH / 2 - b.w / 2 - 1e-6);
  expect(res.buildings.length).toBeLessThan(generateCity(5).buildings.length);
});

// ---- S8: 広い街・高架の通り道 ----
test('S8: 街を広げても、広場のまわり（S7 までの街の範囲の内）の足元は前の大きさの街と同じ（見通しと釣り合いを変えない）', () => {
  for (const seed of [3, 7]) {
    const old = generateCity(seed, undefined, { radius: 420, transit: false }).buildings.filter((b) => b.dist < 100);
    const now = generateCity(seed).buildings.filter((b) => b.dist < 100);
    expect(now.length).toBe(old.length);
    for (const b of now) {
      const o = old.find((x) => Math.hypot(x.x - b.x, x.z - b.z) < 1e-9);
      expect([b.x, b.z, b.w, b.d]).toEqual([o.x, o.z, o.w, o.d]);
    }
  }
});

test('S8: 高架の通り道（高速と環状線の帯）には建物の足元も道路沿いの小物も置かない', () => {
  const city = generateCity(7);
  const { expressway, rail } = city.transit.paths;
  for (const b of city.buildings) {
    expect(pathDist(expressway, b.x, b.z)).toBeGreaterThan(TRANSIT.expressway.half);
    expect(pathDist(rail, b.x, b.z)).toBeGreaterThan(TRANSIT.rail.half);
    // 足元の四角の角も帯の外
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
      expect(pathDist(expressway, b.x + sx * b.w, b.z + sz * b.d)).toBeGreaterThan(TRANSIT.expressway.half - 1e-6);
      expect(pathDist(rail, b.x + sx * b.w, b.z + sz * b.d)).toBeGreaterThan(TRANSIT.rail.half - 1e-6);
    }
  }
  for (const p of city.props) {
    expect(pathDist(expressway, p.x, p.z)).toBeGreaterThan(TRANSIT.expressway.half);
    expect(pathDist(rail, p.x, p.z)).toBeGreaterThan(TRANSIT.rail.half);
  }
});
