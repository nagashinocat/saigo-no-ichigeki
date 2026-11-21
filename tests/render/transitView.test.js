import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createCityView } from '../../src/render/cityView.js';
import { createStyle } from '../../src/render/style.js';
import { generateCity } from '../../src/world/cityGen.js';
import { createDestruction } from '../../src/world/destruction.js';
import { createGame } from '../../src/game/game.js';
import { replayTargets } from '../../src/game/replaySim.js';
import { TIERS } from '../../src/render/quality.js';
import { CONFIG } from '../../src/config.js';

// S8: 高架の高速道路と環状線は、ビルと同じように爆発でつぶれ・隠れ、リプレイで元へ戻る。電車は前線に触れると脱線する

const city = generateCity(7);
const mat = (mesh, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m; };
const scaleOf = (mesh, i) => new THREE.Vector3().setFromMatrixScale(mat(mesh, i)).length();
const posOf = (mesh, i) => new THREE.Vector3().setFromMatrixPosition(mat(mesh, i));
const named = (view, name) => { let o = null; view.group.traverse((x) => { if (x.name === name) o = x; }); return o; };

test('高架は 4 つの InstancedMesh（長い骨組み・短い骨組み・光・電車）で描く。区間ごとに骨組みと照明を持つ', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  const t = view.transit;
  for (const n of ['transit-struct', 'transit-struct-short', 'transit-lights', 'train']) expect(named(view, n), n).not.toBeNull();
  for (const s of city.transit.segments) {
    const p = t.segmentParts(s.id);
    expect(p.struct.length).toBeGreaterThanOrEqual(4);
    if (s.line === 'expressway') expect(p.lights.length).toBe(3); // 照明 1 つと縁の光の線 2 本（fix1）
  }
});

test('高速の車の光は流れる: 行く向きの車線は白、戻る向きは赤。時間がたつと位置が進む', () => {
  const view = createCityView(city, createStyle('high'), 'high');
  const L = view.transit.lights;
  const nLamp = 3 * city.transit.segments.filter((s) => s.line === 'expressway').length;
  const cols = new Set();
  const before = posOf(L, nLamp + 3);
  for (let i = nLamp; i < nLamp + 40; i++) { const c = new THREE.Color(); L.getColorAt(i, c); cols.add(c.r > 0.9 && c.g > 0.9 ? 'white' : c.r > 0.9 && c.g < 0.3 ? 'red' : 'other'); }
  view.update(1, {});
  const after = posOf(L, nLamp + 3);
  expect(after.distanceTo(before)).toBeGreaterThan(15);
  // 白と赤の両方（ほかの色はない）
  const all = new Set();
  const n = L.count;
  for (let i = nLamp; i < n; i++) { const c = new THREE.Color(); L.getColorAt(i, c); if (c.r > 0.9 && c.g > 0.9) all.add('white'); else if (c.r > 0.9 && c.g < 0.3) all.add('red'); }
  expect(all.has('white') && all.has('red')).toBe(true);
});

test('つぶす: 区間の骨組みと照明が同じ時刻・同じ速さでつぶれ始め、その上の車の光は消える。ほかの区間はそのまま', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  const t = view.transit;
  const seg = city.transit.segments.find((s) => s.line === 'expressway' && s.dist < 300);
  view.update(2, {});
  view.crushTransit(seg.id, 0.4);
  const crushOf = ({ mesh, index }) => [mesh.geometry.getAttribute('aCrush').getX(index), mesh.geometry.getAttribute('aCrush').getY(index)];
  const parts = t.segmentParts(seg.id).struct;
  expect(new Set(parts.map((p) => p.mesh.name)).size).toBe(2);
  for (const p of parts) { const [at, d] = crushOf(p); expect(at).toBe(2); expect(d).toBeCloseTo(0.4); }
  const lc = t.lights.geometry.getAttribute('aCrush');
  for (const i of t.segmentParts(seg.id).lights) expect(lc.getY(i)).toBeCloseTo(0.4);
  const other = city.transit.segments.find((s) => s.line === 'expressway' && s.id !== seg.id);
  for (const p of t.segmentParts(other.id).struct) expect(crushOf(p)[1]).toBe(0);
  expect(t.isBroken(seg.id)).toBe(true);
  // その区間の上を走る車の光は描かない
  for (let k = 0; k < 30; k++) {
    view.update(0.25, {});
    const nLamp = 3 * city.transit.segments.filter((s) => s.line === 'expressway').length;
    for (let i = nLamp; i < t.lights.count; i++) {
      if (scaleOf(t.lights, i) === 0) continue;
      const p = posOf(t.lights, i);
      if (p.y < 15 || p.y > 19) continue; // 電車の光は除く
      const dx = seg.b[0] - seg.a[0], dz = seg.b[1] - seg.a[1];
      const u = ((p.x - seg.a[0]) * dx + (p.z - seg.a[1]) * dz) / (dx * dx + dz * dz);
      const across = Math.abs((p.x - seg.a[0]) * dz - (p.z - seg.a[1]) * dx) / Math.hypot(dx, dz);
      expect(u > 0.02 && u < 0.98 && across < 8).toBe(false);
    }
  }
});

test('隠す: 区間の骨組みと照明が全部消える', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  const t = view.transit;
  const seg = city.transit.segments.find((s) => s.line === 'rail');
  view.hideTransit(seg.id);
  view.update(0.1, {});
  for (const { mesh, index } of t.segmentParts(seg.id).struct) expect(scaleOf(mesh, index)).toBe(0);
  for (const i of t.segmentParts(seg.id).lights) expect(scaleOf(t.lights, i)).toBe(0);
});

test('電車は環状線を回り、最後の一発の前線に触れた車両から脱線して外へ吹き飛び、落ちたら知らせる', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  const t = view.transit;
  const s0 = t.train.s;
  view.update(2, {});
  expect(t.train.s - s0).toBeCloseTo(city.transit.config.rail.speed * 2, 6);
  const r = city.transit.config.rail.ring * CONFIG.cityRadius;
  let ev = view.update(1 / 60, { front: r + 5, radius: CONFIG.radius.max });
  expect(ev.filter((e) => e.kind === 'derail').length).toBe(city.transit.config.rail.cars);
  const car = t.train.cars[0];
  const d0 = Math.hypot(car.x, car.z);
  let landed = 0;
  for (let i = 0; i < 180; i++) { ev = view.update(1 / 60, { front: r + 5, radius: CONFIG.radius.max }); landed += ev.filter((e) => e.kind === 'land').length; }
  expect(landed).toBe(city.transit.config.rail.cars);
  expect(Math.hypot(car.x, car.z)).toBeGreaterThan(d0 + 10); // 外へ
  for (let i = 0; i < t.trainMesh.count; i++) expect(scaleOf(t.trainMesh, i)).toBe(0);
});

test('光の中（前線の内で半径の vaporizeRatio より近い）の電車は溶ける', () => {
  const small = generateCity(7, undefined, { radius: 200 }); // 環状線の半径 100 m
  const view = createCityView(small, createStyle('low'), 'low');
  const ev = view.update(1 / 60, { front: 150, radius: CONFIG.radius.max });
  expect(ev.filter((e) => e.kind === 'vaporize').length).toBe(small.transit.config.rail.cars);
  expect(ev.every((e) => e.target && Number.isFinite(e.target.x) && e.target.w > 5)).toBe(true);
});

test('線路の区間がこわれていると、そこへ入った車両は脱線する', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  const t = view.transit;
  for (const s of city.transit.segments.filter((x) => x.line === 'rail')) view.crushTransit(s.id, 0.3);
  const ev = view.update(1 / 60, {});
  expect(ev.filter((e) => e.kind === 'derail').length).toBe(city.transit.config.rail.cars);
});

test('リプレイの snapshot / restore: 橋桁のつぶれ・隠し・電車の位置と脱線が、写した時の姿へ戻る', () => {
  const view = createCityView(city, createStyle('high'), 'high');
  const t = view.transit;
  view.update(3, {});
  const snap = view.snapshot();
  const sAt = t.train.s;
  const meshes = [t.struct, t.structShort];
  const crush0 = meshes.map((m) => m.geometry.getAttribute('aCrush').array.slice());
  const mat0 = meshes.map((m) => m.instanceMatrix.array.slice());
  const segs = city.transit.segments.slice(0, 20);
  for (const s of segs.slice(0, 10)) view.crushTransit(s.id, 0.3);
  for (const s of segs.slice(10)) view.hideTransit(s.id);
  view.update(1 / 60, { front: 400, radius: CONFIG.radius.max });
  for (let i = 0; i < 60; i++) view.update(1 / 30, { front: 400, radius: CONFIG.radius.max });
  expect(t.train.cars.some((c) => c.state !== 'run')).toBe(true);
  view.restore(snap);
  meshes.forEach((m, k) => {
    expect(Array.from(m.geometry.getAttribute('aCrush').array)).toEqual(Array.from(crush0[k]));
    expect(Array.from(m.instanceMatrix.array)).toEqual(Array.from(mat0[k]));
  });
  expect(t.train.s).toBeCloseTo(sAt, 9);
  expect(t.train.cars.every((c) => c.state === 'run')).toBe(true);
  for (const s of segs) expect(t.isBroken(s.id)).toBe(false);
  // 戻したあと同じフレームでつぶしても、戻した全体を GPU へ送る（S7 fix 1 と同じ）
  view.crushTransit(segs[0].id, 0.3);
  const a = t.struct.geometry.getAttribute('aCrush');
  expect(a.updateRanges.some((r) => r.start === 0 && r.count >= a.array.length)).toBe(true);
});

test('壊れていく: 橋桁の区間はゲームの命中の表に入り、destruction がつぶしてから隠して破片にする', () => {
  const game = createGame({ seed: 7 });
  const tg = replayTargets(game.city).filter((x) => x.id[0] === 'x' || x.id[0] === 'r');
  expect(tg.length).toBe(game.city.transit.segments.length);
  const log = { crushed: [], hidden: [] };
  const cityView = { crushTransit: (id, d) => log.crushed.push([id, d]), hideTransit: (id) => log.hidden.push(id), getBuildingColor: () => [1, 1, 1], hideBuilding() {}, crushBuilding() {} };
  const d = createDestruction({ cityView, getTier: () => TIERS.mid, seed: 3 });
  const seg = game.city.transit.segments[5];
  d.onHit({ hit: { id: seg.id, kind: 'push' }, target: seg });
  expect(log.crushed[0][0]).toBe(seg.id);
  expect(log.hidden).toEqual([]);
  for (let i = 0; i < 60; i++) d.update(1 / 60, [seg.dist + 30]);
  expect(log.hidden).toEqual([seg.id]);
});

test('fix1: リプレイは毎回同じ: 放った瞬間へ戻すと、脱線の吹き飛び方も同じになる', () => {
  const view = createCityView(city, createStyle('low'), 'low');
  const t = view.transit;
  view.update(2, {});
  const snap = view.snapshot();
  const run = () => {
    view.restore(snap);
    const r = city.transit.config.rail.ring * CONFIG.cityRadius;
    for (let i = 0; i < 30; i++) view.update(1 / 30, { front: r + 5, radius: CONFIG.radius.max });
    return t.train.cars.map((c) => [+(c.x ?? 0).toFixed(6), +(c.y ?? 0).toFixed(6), c.state]);
  };
  expect(run()).toEqual(run());
});

test('fix1: 環状線のつなぎ目（最初の橋脚より手前）を走る車両も、正しい区間（最後の区間）で確かめる', () => {
  const view = createCityView(city, createStyle('low'), 'low');
  const rs = city.transit.segments.filter((s) => s.line === 'rail');
  const last = rs[rs.length - 1];
  if (rs[0].s0 > 0.5) {
    view.crushTransit(last.id, 0.3);
    // 車両を最初の橋脚の手前に置く
    view.transit.train.s = rs[0].s0 * 0.5 + city.transit.config.rail.carLen / 2;
    const ev = view.update(1 / 60, {});
    expect(ev.some((e) => e.kind === 'derail' && e.target.id === 't0')).toBe(true);
  }
});
