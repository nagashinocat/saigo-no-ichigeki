import { test, expect } from 'vitest';
import * as THREE from 'three';
import { dressCity, NEON, STREET_CLEAR, OVERHANG, PLAZA_KEEP, DENSITY, CLUTTER_DENSITY, DRESS_DIST } from '../../src/render/cityDress.js';
import { CONFIG } from '../../src/config.js';
import { pathDist, TRANSIT } from '../../src/world/transit.js';
import { buildSignAtlas, layout, ATLAS_SIZE } from '../../src/render/signAtlas.js';
import { generateCity, GRID } from '../../src/world/cityGen.js';
import { DUSK } from '../../src/render/style.js';

// S7: 看板・ネオン・屋上や壁の飾り（中国寄りと日本のネオン街の混ざった街）

const city = generateCity(7);
const full = dressCity(city, { density: DENSITY.high });

const hueOf = ([r, g, b]) => { const c = new THREE.Color(r, g, b); const hsl = {}; c.getHSL(hsl); return hsl.h * 360; };
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

test('ネオンの色はバイクの緑（推進の光 thrust / thrustLow）から色相で 35° 以上離れ、緑が勝つ色はない', () => {
  const greens = [DUSK.thrust, DUSK.thrustLow].map((c) => hueOf([c.r, c.g, c.b]));
  const colors = [...Object.values(NEON), ...full.signs.map((s) => s.color), ...full.pools.map((p) => p.color)];
  for (const c of colors) {
    for (const g of greens) expect(hueDist(hueOf(c), g)).toBeGreaterThanOrEqual(35);
    expect(c[1] > c[0] && c[1] > c[2]).toBe(false);
  }
  // マゼンタ・シアン・琥珀・赤・紫・暖かい白がそろう
  expect(Object.keys(NEON)).toEqual(expect.arrayContaining(['magenta', 'cyan', 'amber', 'red', 'violet', 'warmWhite']));
});

test('二つの看板の文化: 張り出し看板（中国寄り）と、角の縦看板・提灯・屋上の大看板（日本のネオン街）がどれもある', () => {
  const by = (t) => full.signs.filter((s) => s.type === t).length;
  for (const t of ['cantilever', 'band', 'blade', 'lantern', 'billboard', 'shop', 'strip']) expect(by(t), t).toBeGreaterThan(t === 'billboard' ? 8 : 30);
  expect(full.tanks.length).toBeGreaterThan(50);
  expect(full.boxes.length).toBeGreaterThan(3000);
  expect(full.pools.length).toBeGreaterThan(100);
  // ちらつく看板がある（全部ではない）
  const fl = full.signs.filter((s) => s.flicker > 0).length;
  expect(fl).toBeGreaterThan(50);
  expect(fl).toBeLessThan(full.signs.length * 0.5);
});

test('同じ街なら同じ飾り。どの飾りも街のビルに属する', () => {
  expect(dressCity(city, { density: 1 })).toEqual(full);
  const ids = new Set(city.buildings.map((b) => b.id));
  for (const list of Object.values(full)) for (const x of list) expect(ids.has(x.bid)).toBe(true);
});

test('画質の段で数を間引く: 看板は mid で約 75%、low で約半分。細かい飾りは mid 約 6 割、low 約 4 割', () => {
  const at = (t) => dressCity(city, { density: DENSITY[t], clutter: CLUTTER_DENSITY[t] });
  const hi = at('high'), mid = at('mid'), low = at('low');
  const ratio = (o, k) => o[k].length / hi[k].length;
  expect(ratio(mid, 'signs')).toBeGreaterThan(0.68); expect(ratio(mid, 'signs')).toBeLessThan(0.82);
  // S8: 遠い地区の縦看板・ネオン管は、どの段でも roll < FAR_KEEP（0.4）だけ。low でもその分は減らないので、上限を 0.56 → 0.6
  expect(ratio(low, 'signs')).toBeGreaterThan(0.44); expect(ratio(low, 'signs')).toBeLessThan(0.6);
  expect(ratio(mid, 'boxes')).toBeGreaterThan(0.5); expect(ratio(mid, 'boxes')).toBeLessThan(0.72);
  expect(ratio(low, 'boxes')).toBeGreaterThan(0.3); expect(ratio(low, 'boxes')).toBeLessThan(0.5);
});

// 飾りの水平の外形の点（回した箱の 4 隅、線は両端と途中）と下端の高さ
function footprint(x) {
  if (x.a) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([x.a[0] + (x.b[0] - x.a[0]) * t, x.a[1] + (x.b[1] - x.a[1]) * t - x.t / 2, x.a[2] + (x.b[2] - x.a[2]) * t]); }
    return pts;
  }
  const c = Math.cos(x.ry ?? 0), s = Math.sin(x.ry ?? 0), hw = x.w / 2, hd = (x.d ?? x.t) / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [x.x + lx * c + lz * s, x.y, x.z - lx * s + lz * c]);
}
const outside = (v) => { const q = Math.abs(v - Math.round(v / GRID.PITCH) * GRID.PITCH); return q - GRID.BLOCK / 2; };

test('道路の格子はあいている: 道へ出るものは高さ 5m 以上、歩道の縁から 1.6m まで（電線だけは細く高く道をまたぐ）', () => {
  for (const x of [...full.boxes, ...full.signs]) {
    for (const [px, py, pz] of footprint(x)) {
      const o = Math.max(outside(px), outside(pz));
      if (o <= 1e-6) continue;
      expect(py, JSON.stringify(x)).toBeGreaterThanOrEqual(STREET_CLEAR - 1e-6);
      if (!x.a || x.t > 0.2) expect(o, JSON.stringify(x)).toBeLessThanOrEqual(OVERHANG + 1e-6);
    }
  }
});

test('広場のまわり（42m 未満）のビルには、張り出し看板・道をまたぐ電線を置かない（屋上の大看板は 24m より外なら置く）', () => {
  const near = new Set(city.buildings.filter((b) => b.dist < PLAZA_KEEP).map((b) => b.id));
  const inner = new Set(city.buildings.filter((b) => b.dist <= 24).map((b) => b.id));
  for (const s of full.signs) if (near.has(s.bid)) expect(s.type).not.toBe('cantilever');
  for (const s of full.signs) if (inner.has(s.bid)) expect(s.type).not.toBe('billboard');
  // 線（電線・腕・竿・支え）は区画の内に収まる（道をまたがない）
  for (const x of full.boxes) if (near.has(x.bid) && x.a) for (const [px, , pz] of footprint(x)) expect(Math.max(outside(px), outside(pz))).toBeLessThanOrEqual(1e-6);
});

test('看板の絵柄のアトラス: タイルはアトラスの内で重ならず、どのタイルにも光る線が描かれている', () => {
  const L = layout();
  const rects = Object.values(L).flat().map((t) => t.px);
  for (const [x, y, w, h] of rects) { expect(x + w).toBeLessThanOrEqual(ATLAS_SIZE); expect(y + h).toBeLessThanOrEqual(ATLAS_SIZE); }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    expect(a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]).toBe(false);
  }
  const atlas = buildSignAtlas();
  expect(atlas.data.length).toBe(ATLAS_SIZE * ATLAS_SIZE * 2);
  for (const [x, y, w, h] of rects) {
    let core = 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) core += atlas.data[(yy * ATLAS_SIZE + xx) * 2] > 200;
    expect(core).toBeGreaterThan(w * h * 0.02);
  }
  expect(buildSignAtlas().data).toEqual(atlas.data);
});

// S7 fix 1
test('fix1: 縦に長い箱（角のネオン管・配管・塔の先）は 12m ごとに分かれ、球の線に沿って曲がれる', () => {
  for (const x of full.boxes) if (!x.a) expect(x.h).toBeLessThanOrEqual(12 + 1e-6);
  for (const s of full.signs) if (s.type === 'strip') expect(s.h).toBeLessThanOrEqual(12 + 1e-6);
});

// S8: 遠さの境目は街の半径に対する割合（DRESS_DIST.fine × R。S7 の 420 m の街では 300 m だった）
test('fix1: 壁と道の細かい飾りは layer "wall"。霞の中（DRESS_DIST.fine × 街の半径より遠いビル）にはエアコン・配管・物干しを置かない', () => {
  const dist = new Map(city.buildings.map((b) => [b.id, b.dist]));
  const wall = full.boxes.filter((x) => x.layer === 'wall');
  expect(wall.length).toBeGreaterThan(2000);
  for (const x of wall) {
    const tiny = !x.a && (x.w <= 0.9 && x.h <= 0.72 || x.w <= 0.3); // エアコン・洗濯物・配管
    if (tiny || (x.a && x.t < 0.1)) expect(dist.get(x.bid)).toBeLessThan(DRESS_DIST.fine * CONFIG.cityRadius);
  }
  // 屋上・区画の飾りは 'roof'
  expect(full.boxes.filter((x) => x.layer === 'roof').length).toBeGreaterThan(2000);
});

test('fix1: 間引きの値 roll: 密度 d の飾りは、roll < d のものとちょうど同じ（段が下がったら roll の順に減らせる）', () => {
  const mid = dressCity(city, { density: DENSITY.mid, clutter: CLUTTER_DENSITY.mid });
  expect(mid.signs).toEqual(full.signs.filter((s) => s.roll < DENSITY.mid));
  expect(mid.boxes).toEqual(full.boxes.filter((s) => s.roll < CLUTTER_DENSITY.mid));
});

test('fix1: 広場の近く（60m 未満）のネオン管は暖かい白を使わず、暗めで、縁を一周させない', () => {
  const near = new Set(city.buildings.filter((b) => b.dist < 60).map((b) => b.id));
  const strips = full.signs.filter((s) => s.type === 'strip' && near.has(s.bid));
  expect(strips.length).toBeGreaterThan(0);
  for (const s of strips) { expect(s.color).not.toEqual(NEON.warmWhite); expect(s.gain).toBeLessThan(0.7); }
  const perBuilding = new Map();
  for (const s of strips) if (s.h < 1) perBuilding.set(s.bid, (perBuilding.get(s.bid) ?? 0) + 1);
  for (const [bid, n] of perBuilding) {
    const parts = city.buildings.find((b) => b.id === bid).parts.length;
    expect(n).toBeLessThanOrEqual(2 * parts);
  }
});

test('fix1: 看板の表と裏は、外から見てどちらも左から右へ読める（BoxGeometry の ±z 面の u は見る人の右へ増える）', () => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const pos = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
  for (const nz of [1, -1]) {
    // 外から見る人の右: (-法線) × 上
    const right = new THREE.Vector3(0, 0, -nz).cross(new THREE.Vector3(0, 1, 0));
    const vs = [];
    for (let i = 0; i < pos.count; i++) if (Math.round(n.getZ(i)) === nz) vs.push([pos.getX(i) * right.x, uv.getX(i)]);
    const lo = vs.reduce((a, b) => (b[0] < a[0] ? b : a)), hi = vs.reduce((a, b) => (b[0] > a[0] ? b : a));
    expect(hi[1]).toBeGreaterThan(lo[1]);
  }
});

// ---- S8: 遠い地区は安く、高架の通り道は空ける ----
test('S8: 霞の始まり（DRESS_DIST.roof × R）より遠いビルには屋上の小さな飾り（空調・小屋・給水塔・アンテナ）を置かない。遠い地区（DRESS_DIST.far × R より外）は遠くから読める光（屋上の大看板・角の縦看板・ネオン管）だけ', () => {
  const R = CONFIG.cityRadius;
  const byId = new Map(city.buildings.map((b) => [b.id, b]));
  for (const x of full.boxes) {
    const b = byId.get(x.bid);
    if (b.arch === 'landmark') continue; // 目印の塔の先はいつも
    if (b.dist >= DRESS_DIST.roof * R && x.layer === 'roof' && !x.a && x.y > 0.01) {
      // 屋上の上の箱は、屋上の大看板の骨組み（柱・横の梁）だけ
      expect(x.w <= 0.26 || x.h <= 0.19, JSON.stringify(x)).toBe(true);
    }
  }
  for (const t of full.tanks) expect(byId.get(t.bid).dist).toBeLessThan(DRESS_DIST.roof * R);
  const farTypes = new Set(full.signs.filter((s) => byId.get(s.bid).dist >= DRESS_DIST.far * R).map((s) => s.type));
  for (const t of farTypes) expect(['billboard', 'blade', 'strip']).toContain(t);
  expect(farTypes.has('billboard') || farTypes.has('strip')).toBe(true);
  for (const p of full.pools) expect(byId.get(p.bid).dist).toBeLessThan(DRESS_DIST.far * R);
  // 遠い地区は面積あたりの看板の数が近くより少ない
  const per = (lo, hi) => full.signs.filter((s) => { const d = byId.get(s.bid).dist; return d >= lo && d < hi; }).length / (Math.PI * (hi * hi - lo * lo));
  expect(per(DRESS_DIST.far * R, R)).toBeLessThan(per(60, DRESS_DIST.fine * R) * 0.5);
});

test('S8: 高架の通り道（高速・環状線の帯）には飾りを置かない（張り出し看板や電線が橋桁・電車を突き抜けない）', () => {
  const { expressway, rail } = city.transit.paths;
  const inC = (x, z) => pathDist(expressway, x, z) < TRANSIT.expressway.half || pathDist(rail, x, z) < TRANSIT.rail.half;
  for (const x of full.boxes) {
    if (x.a) { expect(inC(x.a[0], x.a[2]) || inC(x.b[0], x.b[2])).toBe(false); } else expect(inC(x.x, x.z)).toBe(false);
  }
  for (const k of ['signs', 'pools', 'tanks']) for (const x of full[k]) expect(inC(x.x, x.z)).toBe(false);
});
