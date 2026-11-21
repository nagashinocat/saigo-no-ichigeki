import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createCityView, REGIONS } from '../../src/render/cityView.js';
import { createCityCamera, fitCityCamera } from '../../src/render/views.js';
import { CONFIG } from '../../src/config.js';
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

test('restore のあと同じフレームで隠す・つぶすと、部分の送り（updateRanges）に戻した全体も含める（リプレイで飾りが GPU 上で消えたままになった不具合）', () => {
  const view = createCityView(city, createStyle('high'), 'high');
  const snap = view.snapshot();
  view.update(1, {});
  for (const b of city.buildings.slice(0, 40)) view.hideBuilding(b.id);
  view.restore(snap);
  // 描く前（GPU へ送る前）に、別のビルが光に溶け、別のビルがつぶれ始めた
  view.hideBuilding(city.buildings[50].id);
  view.crushBuilding(city.buildings[51].id, 0.4);
  // three は updateRanges が空なら全体を、あればその範囲だけを送る。範囲があるなら、全体を覆っていること
  view.group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    for (const a of [o.instanceMatrix, ...Object.values(o.geometry.attributes).filter((x) => x.isInstancedBufferAttribute)]) {
      if (a.updateRanges.length === 0) continue;
      expect(a.updateRanges.some((r) => r.start === 0 && r.count >= a.array.length), o.name).toBe(true);
    }
  });
});

// S7 fix 1: 軽くする
test('fix1: 壁と道の細かい飾り（clutter-wall）は mid / low の上空の画面では描かず、近いカメラでは描く。high はいつも描く', () => {
  const wallOf = (v) => { let m = null; v.group.traverse((o) => { if (o.name === 'clutter-wall') m = o; }); return m; };
  const mid = createCityView(city, createStyle('mid'), 'mid'), high = createCityView(city, createStyle('high'), 'high');
  expect(wallOf(mid).visible).toBe(false);
  expect(wallOf(high).visible).toBe(true);
  mid.setCloseView(true); expect(wallOf(mid).visible).toBe(true);
  mid.setCloseView(false); expect(wallOf(mid).visible).toBe(false);
  high.setTier('mid'); expect(wallOf(high).visible).toBe(false);
  // 見えない面を省いた箱: 屋上の飾りは底なし（10 三角形）、壁の飾りは底と裏なし（8 三角形）
  let roof = null; mid.group.traverse((o) => { if (o.name === 'clutter-boxes') roof = o; });
  expect(roof.geometry.index.count / 3).toBe(10);
  expect(wallOf(mid).geometry.index.count / 3).toBe(8);
});

test('fix1: 段が下がると、飾りは間引きの値の小さい順に残して数（count）を減らす。減ったぶんは描かない', () => {
  const view = createCityView(city, createStyle('high'), 'high');
  const meshes = {}; view.group.traverse((o) => { if (o.isInstancedMesh) meshes[o.name] = o; });
  const hi = Object.fromEntries(['neon-signs', 'neon-pools', 'clutter-boxes', 'clutter-wall', 'clutter-tanks'].map((n) => [n, meshes[n].count]));
  view.setTier('mid');
  const mid = Object.fromEntries(Object.keys(hi).map((n) => [n, meshes[n].count]));
  expect(mid['neon-signs'] / hi['neon-signs']).toBeGreaterThan(0.68); expect(mid['neon-signs'] / hi['neon-signs']).toBeLessThan(0.82);
  expect(mid['clutter-boxes'] / hi['clutter-boxes']).toBeLessThan(0.72);
  view.setTier('low');
  expect(meshes['neon-signs'].count / hi['neon-signs']).toBeLessThan(0.56);
  // low の段で作ったときと同じ数
  const low = createCityView(city, createStyle('low'), 'low');
  const lowMeshes = {}; low.group.traverse((o) => { if (o.isInstancedMesh) lowMeshes[o.name] = o; });
  for (const n of Object.keys(hi)) expect(meshes[n].count).toBe(lowMeshes[n].count);
});

test('fix1: ビルは遊んでいる間は粗い箱、最後の一発から細かい箱（同じつぶれ・屋根の形の値を使う）', () => {
  const view = createCityView(city, createStyle('high'), 'high');
  // S8: ビルは種類と地区ごとの InstancedMesh（'tower:0' は中心の地区）
  const m = view.meshes['tower:0'];
  const coarse = m.geometry;
  expect(view.detail).toBe('coarse');
  view.setDetail('fine');
  expect(m.geometry).not.toBe(coarse);
  expect(m.geometry.index.count).toBeGreaterThan(coarse.index.count * 4);
  expect(m.geometry.getAttribute('aCrush')).toBe(coarse.getAttribute('aCrush'));
  expect(m.geometry.getAttribute('aShape')).toBe(coarse.getAttribute('aShape'));
  let outline = null; view.group.traverse((o) => { if (o.name === 'outline-tower') outline = o; });
  expect(outline.geometry).toBe(m.geometry);
  // 低い家（20m 未満）は細かくしても縦は 3 段まで
  view.setDetail('fine');
  const house = view.meshes['house:0'].geometry;
  const ys = new Set(); const pos = house.attributes.position;
  for (let i = 0; i < pos.count; i++) ys.add(pos.getY(i).toFixed(4));
  expect(ys.size).toBeLessThanOrEqual(4);
});

test('fix1: 飾りの乱数は街の種を使う（別の街なら別の並び）', () => {
  const a = createCityView(generateCity(7), createStyle('low'), 'low'), b = createCityView(generateCity(8), createStyle('low'), 'low');
  expect(generateCity(7).seed).toBe(7);
  expect(a.dressCounts).not.toEqual(b.dressCounts);
});

// ---- S8: 地区ごとの描画 ----
test('S8: ビルは種類と地区（中心の円と外の扇）ごとの InstancedMesh。外の地区は境界の球を持ち、画面の外なら描かない。球はその地区のビルを全部含み、最後の一発からは押されて外へ動くビルの範囲まで広がる', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  const R = CONFIG.cityRadius;
  const keys = Object.keys(view.meshes);
  expect(keys.filter((k) => k.endsWith(':0')).length).toBe(3);
  expect(keys.length).toBeGreaterThan(6);
  const inSphere = (s, p) => s.center.distanceTo(p) <= s.radius + 1e-6;
  for (const b of city.buildings) {
    const { mesh } = view.getBuildingParts(b.id).parts[0];
    const region = Number(mesh.name.match(/-s(\d+)$/)?.[1] ?? 0);
    expect(region === 0).toBe(b.dist < REGIONS.innerFrac * R);
    if (region === 0) { expect(mesh.frustumCulled).toBe(false); continue; }
    expect(mesh.frustumCulled).toBe(true);
    for (const y of [0, b.h]) expect(inSphere(mesh.boundingSphere, new THREE.Vector3(b.x, y, b.z))).toBe(true);
  }
  view.setDetail('fine');
  for (const m of Object.values(view.meshes)) {
    if (!m.frustumCulled) continue;
    // 爆心から外へ、最大の半径まで押されたビル（同じ向き）も球の内
    const sample = city.buildings.find((b) => view.getBuildingParts(b.id).parts[0].mesh === m);
    const dir = new THREE.Vector3(sample.x, 0, sample.z).normalize();
    expect(inSphere(m.boundingSphere, dir.multiplyScalar(CONFIG.radius.max))).toBe(true);
  }
  view.setDetail('coarse');
});

test('S8: 上空の画面では、外の地区のうち画面に入るものだけを描く（後ろ・横の扇は描かない）', () => {
  const view = createCityView(city, createStyle('mid'), 'mid');
  const cam = createCityCamera();
  fitCityCamera(cam, 390 / (844 * 0.65));
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const outer = Object.values(view.meshes).filter((m) => m.frustumCulled);
  const drawn = outer.filter((m) => frustum.intersectsSphere(m.boundingSphere));
  expect(drawn.length).toBeLessThan(outer.length / 2);
  expect(drawn.length).toBeGreaterThan(0); // 奥（-z）の扇は描く
});
