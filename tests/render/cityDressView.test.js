import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createCityView } from '../../src/render/cityView.js';
import { createStyle } from '../../src/render/style.js';
import { generateCity } from '../../src/world/cityGen.js';

// S7: 形の部品・飾り・看板は、つぶす・隠す・一時的に隠す・リプレイで戻す、のどれでもビルと一緒に動く

const city = generateCity(7);
const det = ({ mesh, index }) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(index, m); return m.determinant(); };
const crushOf = ({ mesh, index }) => { const a = mesh.geometry.getAttribute('aCrush'); return a ? [a.getX(index), a.getY(index)] : null; };
// 部品が 2 つ以上あり、看板と屋上の飾りを持つビル
function richBuilding(view) {
  for (const b of city.buildings) {
    const e = view.getBuildingParts(b.id);
    const names = new Set(e.extras.map((x) => x.mesh.name));
    if (e.parts.length >= 2 && names.has('neon-signs') && names.has('clutter-boxes')) return { b, e };
  }
  throw new Error('no rich building');
}

test('1 棟は形の部品の数だけインスタンスを持ち、段の部品は地面から浮いて置かれる。屋根の形（aShape）も書く', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  let total = 0;
  for (const b of city.buildings) {
    const e = view.getBuildingParts(b.id);
    expect(e.parts.length).toBe(b.parts.length);
    total += e.parts.length;
    b.parts.forEach((p, i) => {
      const { mesh, index } = e.parts[i];
      const m = new THREE.Matrix4(); mesh.getMatrixAt(index, m);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      expect(pos.y).toBeCloseTo(p.y, 3);
      expect(mesh.geometry.getAttribute('aShape').getX(index)).toBe(p.shape[0]);
    });
  }
  expect(Object.values(view.meshes).reduce((a, m) => a + m.count, 0)).toBe(total);
  const shaped = city.buildings.flatMap((b) => b.parts).filter((p) => p.shape[0] > 0).length;
  expect(shaped).toBeGreaterThan(50);
});

test('つぶす: 部品と飾り・看板・光の溜まりが同じ時刻・同じ速さでつぶれ始める（一つのビルとして）。航空灯は隠す', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  const { b, e } = richBuilding(view);
  view.update(0.7, {});
  view.crushBuilding(b.id, 0.4);
  for (const p of e.parts) expect(crushOf(p)[0]).toBeCloseTo(0.7, 6), expect(crushOf(p)[1]).toBeCloseTo(0.4, 6);
  for (const x of e.extras) {
    const c = crushOf(x);
    if (c) { expect(c[0]).toBeCloseTo(0.7, 6); expect(c[1]).toBeCloseTo(0.4, 6); expect(det(x)).not.toBe(0); }
    else expect(det(x)).toBe(0);
  }
  // 隣のビルには触れない
  const other = view.getBuildingParts(city.buildings.find((o) => o.id !== b.id).id);
  for (const x of [...other.parts, ...other.extras]) if (crushOf(x)) expect(crushOf(x)[1]).toBe(0);
});

test('隠す（光に溶けた・つぶれきった）: 部品も飾りも看板も全部消える', () => {
  const view = createCityView(city, createStyle('low'), 'low');
  const { b, e } = richBuilding(view);
  view.hideBuilding(b.id);
  for (const x of [...e.parts, ...e.extras]) expect(det(x)).toBe(0);
});

test('一時的に隠して戻す（肩越しのカット）: 部品も飾りも元へ。その間につぶれ始めたら、つぶれ方を持つ飾りは戻す', () => {
  const view = createCityView(city, createStyle('high'), 'high');
  const { b, e } = richBuilding(view);
  const before = [...e.parts, ...e.extras].map((x) => x.mesh.instanceMatrix.array.slice(x.index * 16, x.index * 16 + 16));
  view.veilBuilding(b.id, true);
  for (const x of [...e.parts, ...e.extras]) expect(det(x)).toBe(0);
  view.crushBuilding(b.id, 0.4);
  view.veilBuilding(b.id, false);
  [...e.parts, ...e.extras].forEach((x, i) => {
    const now = x.mesh.instanceMatrix.array.slice(x.index * 16, x.index * 16 + 16);
    if (x.mesh.geometry.getAttribute('aCrush')) expect(Array.from(now)).toEqual(Array.from(before[i]));
    else expect(det(x)).toBe(0);
  });
});

test('リプレイの snapshot / restore: 部品・飾り・看板・光の溜まりのつぶれと隠しが元へ戻る', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  const { b, e } = richBuilding(view);
  const snap = view.snapshot();
  const all = [...e.parts, ...e.extras];
  const before = all.map((x) => [det(x), crushOf(x)]);
  view.update(1, {});
  view.crushBuilding(b.id, 0.3);
  view.hideBuilding(city.buildings[3].id);
  view.restore(snap);
  all.forEach((x, i) => { expect(det(x)).toBe(before[i][0]); expect(crushOf(x)).toEqual(before[i][1]); });
  for (const x of [...view.getBuildingParts(city.buildings[3].id).parts, ...view.getBuildingParts(city.buildings[3].id).extras]) expect(det(x)).not.toBe(0);
});

test('飾りは種類ごとに 1 つの InstancedMesh（描画の回数を増やしすぎない）。low は high のおよそ半分の数', () => {
  const names = (v) => { const out = []; v.group.traverse((o) => { if (o.isInstancedMesh) out.push(o.name); }); return out; };
  const hi = createCityView(city, createStyle('high'), 'high'), lo = createCityView(city, createStyle('low'), 'low');
  for (const n of ['clutter-boxes', 'clutter-tanks', 'neon-signs', 'neon-pools']) expect(names(hi).filter((x) => x === n).length).toBe(1);
  expect(lo.dressCounts.signs / hi.dressCounts.signs).toBeGreaterThan(0.44);
  expect(lo.dressCounts.signs / hi.dressCounts.signs).toBeLessThan(0.56);
  expect(lo.dressCounts.boxes / hi.dressCounts.boxes).toBeLessThan(0.5);
  // 看板の明るさ・ちらつき: low は bloom がないので控えめで、ちらつかない
  const sh = createStyle('high'), sl = createStyle('low');
  expect(sl.uniforms.uSignFlicker.value).toBe(0);
  expect(sh.uniforms.uSignFlicker.value).toBe(1);
  expect(sl.uniforms.uSignGain.value).toBeLessThan(sh.uniforms.uSignGain.value);
  sh.setSignTier('low');
  expect(sh.uniforms.uSignFlicker.value).toBe(0);
});
