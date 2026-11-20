import { test, expect } from 'vitest';
import { generateCity } from '../../src/world/cityGen.js';
import { CONFIG } from '../../src/config.js';

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

test('同じシードで同じ街', () => expect(generateCity(1)).toEqual(generateCity(1)));

test('建物は広場の外、街の半径の内', () => {
  for (const b of generateCity(1).buildings) {
    expect(b.dist).toBeGreaterThan(12 + Math.max(b.w, b.d) / 2);
    expect(b.dist).toBeLessThanOrEqual(420);
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

test('建物数は 400〜900、外側ほど低くなる傾向', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const { buildings } = generateCity(seed);
    expect(buildings.length).toBeGreaterThanOrEqual(400);
    expect(buildings.length).toBeLessThanOrEqual(900);
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
