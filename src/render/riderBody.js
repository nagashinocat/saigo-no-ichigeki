import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FIELD } from './heroBody.js';
import { RIDER, bikeParts, SUIT, PLATE, DARK, HELM, BOOT, HULL, BELLY, HOUSING } from './hoverBike.js';
import { srgb } from './figureGeo.js';

// 演出の肩越しのカットで大きく映る軍勢の一人（浮遊バイクの乗り手）の体。instanced の軍勢（hoverBike.js）は箱と筒の寄せ集めで、
// 遠くでは読みやすいが、背後から画面の 3 分の 1 を占めると箱に見える。この一人だけは主人公（heroBody.js）と同じやり方で、
// 距離の場を滑らかにつないで Surface Nets で網にする: ヘルメットと首、上着のしわと肩、背中の当て物、握りを持つ手袋、腿とすね・靴。
// バイクの後ろ半分（座席・尾の覆い・尾の輪）も丸く組み直す（ほかはそのまま）。
// 部位の番号・付け根・座り方は instanced の乗り手と同じ（figureGeo の aPart / aPivot / aCol）なので、同じ材質（enemyView の
// FIGURE_VERT）が前かがみ・腕・頭の向き（aPose.z）を同じように動かす。胴・頭・腕は立った兵士の座標で組み、腰の高さへ動かす
// （hoverBike の riderParts と同じ）。脚と座席はバイクの座標で組む。

export const RIDER_BODY = {
  // 格子の間隔（m）: 胴・脚と、頭・手
  detail: {
    high: { body: 0.016, head: 0.0105 },
    mid: { body: 0.021, head: 0.014 },
    low: { body: 0.032, head: 0.022 },
  },
  maxVerts: { low: 8500, mid: 18000, high: 31000 },
};

const { capsule, ellipsoid, roundBox, clip, makeField, meshField } = FIELD;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const [HX, HY, HZ] = RIDER.hip;
const DY = HY - 0.95, DZ = HZ; // 立った兵士の腰（0.95）から、鞍の上の腰へ

// 胴（0）: 胸と腹・骨盤・肩の盛り上がり・背中の当て物（丸い甲羅）・上着のしわ・襟・ベルト
function torsoPrims() {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  add(ellipsoid(V(0, 1.23, 0.01), Q(), [0.185, 0.25, 0.125]), 0.05, SUIT);
  add(ellipsoid(V(0, 1.0, -0.005), Q(), [0.165, 0.115, 0.12]), 0.06, SUIT);
  add(capsule(V(-0.19, 1.425, -0.015), V(0.19, 1.425, -0.015), 0.07, 0.07), 0.07, SUIT);
  for (const s of [1, -1]) add(ellipsoid(V(0.245 * s, 1.395, 0), Q(0, 0, 0.35 * s), [0.085, 0.075, 0.09]), 0.04, PLATE);
  // 背中の当て物: 丸い甲羅（中心に縦の溝の代わりの稜線）
  add(ellipsoid(V(0, 1.27, -0.095), Q(-0.08), [0.14, 0.17, 0.05]), 0.04, PLATE);
  add(capsule(V(0, 1.42, -0.135), V(0, 1.12, -0.14), 0.013, 0.011), 0.015, DARK);
  // 上着のしわ（腰の上の横じわと、脇から背へ斜めのしわ）
  for (const [y, w] of [[1.08, 0.15], [1.115, 0.14]]) add(capsule(V(-w, y, -0.1), V(w, y + 0.005, -0.105), 0.011, 0.011), 0.025, SUIT);
  for (const s of [1, -1]) add(capsule(V(0.17 * s, 1.17, -0.03), V(0.08 * s, 1.07, -0.11), 0.01, 0.01), 0.02, SUIT);
  // 襟（首の後ろを囲む）
  add(capsule(V(-0.075, 1.475, -0.04), V(0.075, 1.475, -0.04), 0.035, 0.035), 0.03, DARK);
  for (const s of [1, -1]) add(capsule(V(0.075 * s, 1.475, -0.04), V(0.07 * s, 1.47, 0.04), 0.03, 0.025), 0.03, DARK);
  // ベルト
  add(roundBox(V(0, 0.98, 0), Q(), [0.175, 0.03, 0.125], 0.025), 0.02, DARK);
  return P;
}

// 頭（1）: 覆面の頭と首、つばと後ろの縁のあるヘルメット、てっぺんの浅い稜線
function headPrims() {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  add(capsule(V(0, 1.45, -0.01), V(0, 1.6, 0.0), 0.052, 0.056), 0.03, DARK);
  add(ellipsoid(V(0, 1.63, 0.012), Q(), [0.1, 0.118, 0.11]), 0.03, DARK);
  add(clip(ellipsoid(V(0, 1.7, -0.008), Q(-0.12), [0.138, 0.118, 0.155]), V(0, 1.625, 0), V(0, -1, 0)), 0.015, HELM);
  add(capsule(V(-0.12, 1.64, -0.07), V(0.12, 1.64, -0.07), 0.018, 0.018), 0.03, HELM); // 後ろの縁
  add(roundBox(V(0, 1.668, 0.125), Q(0.15), [0.115, 0.011, 0.038], 0.01), 0.02, HELM); // つば
  add(capsule(V(0, 1.815, 0.05), V(0, 1.79, -0.12), 0.016, 0.014), 0.02, HELM); // 稜線
  return P;
}

// 腕（2 左 +x / 3 右 −x）: 肩から下へ（材質が肩を付け根に握りへ回す）。肘をわずかに曲げ、手袋は握りを包む形
function armPrims(s) {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  const x = 0.27 * s;
  add(capsule(V(x, 1.41, 0), V(x + 0.012 * s, 1.15, 0.035), 0.062, 0.05), 0.04, SUIT);
  add(capsule(V(x + 0.012 * s, 1.15, 0.035), V(x, 0.9, 0.06), 0.048, 0.04), 0.04, SUIT);
  add(ellipsoid(V(x + 0.01 * s, 1.15, 0.03), Q(), [0.055, 0.045, 0.05]), 0.03, SUIT); // 肘
  add(capsule(V(x, 0.92, 0.06), V(x, 0.88, 0.065), 0.046, 0.046), 0.02, DARK); // 手首の袖口
  add(ellipsoid(V(x, 0.84, 0.045), Q(0.2), [0.044, 0.058, 0.05]), 0.02, DARK); // 手のひら
  add(capsule(V(x - 0.035 * s, 0.81, 0.08), V(x + 0.035 * s, 0.81, 0.08), 0.022, 0.022), 0.02, DARK); // 握った指
  return P;
}

// 脚（4、バイクの座標）: 腿は腰から前へ、すねは足の板へ。膝の当て物と靴
function legPrims() {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  for (const s of [1, -1]) {
    add(capsule(V(0.13 * s, HY - 0.02, HZ + 0.06), V(0.17 * s, 0.74, 0.12), 0.092, 0.074), 0.05, SUIT);
    add(ellipsoid(V(0.175 * s, 0.74, 0.14), Q(), [0.065, 0.06, 0.06]), 0.03, PLATE);
    add(capsule(V(0.18 * s, 0.72, 0.13), V(0.23 * s, 0.48, 0.1), 0.068, 0.055), 0.04, SUIT);
    add(roundBox(V(0.24 * s, 0.45, 0.14), Q(), [0.058, 0.05, 0.12], 0.03), 0.03, BOOT);
  }
  return P;
}

// 座席と尾の覆い（7、バイクの座標）: 丸い鞍と柱、車体の後ろ半分にかぶさる丸い覆い
function seatPrims() {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  add(roundBox(V(0, 0.705, -0.33), Q(), [0.14, 0.04, 0.24], 0.04), 0.03, BELLY);
  add(capsule(V(0, 0.45, -0.32), V(0, 0.66, -0.32), 0.07, 0.065), 0.04, HOUSING);
  add(clip(ellipsoid(V(0, 0.34, -0.7), Q(), [0.3, 0.085, 0.46]), V(0, 0.3, 0), V(0, -1, 0)), 0.04, HULL);
  return P;
}

const boxOf = (prims) => { const b = new THREE.Box3(); for (const { d } of prims) b.union(d.box); return b; };

// 距離の場の網を、figure の材質の形へ（色は最も近い部品、部位と付け根は一つ）。shift: 立った兵士の座標から鞍の上へ
function fieldPart(prims, h, id, pivot, shift) {
  const box = boxOf(prims);
  const m = meshField(makeField(prims, box, 0.06, 0.1), box, h);
  const n = m.positions.length / 3;
  const cols = prims.map((p) => srgb(p.tag)), fs = prims.map((p) => p.d);
  const col = new Float32Array(n * 3), piv = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
    let best = Infinity, c = cols[0];
    for (let j = 0; j < fs.length; j++) { const d = fs[j](x, y, z); if (d < best) { best = d; c = cols[j]; } }
    col.set([c.r, c.g, c.b], i * 3);
    piv.set(pivot, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
  g.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  if (shift) g.translate(...shift);
  return g;
}

// 組み立ての本体。部位（胴・頭・腕・脚・車体）ごとに yield する（手の空いた時間に少しずつ組み立てられる）
function* buildSteps(detail) {
  let ms = 0, t0 = performance.now();
  const pause = function* () { ms += performance.now() - t0; yield; t0 = performance.now(); };
  const D = RIDER_BODY.detail[detail];
  const up = [0, DY, DZ];
  const piv = (p) => [p[0] + HX, p[1] + DY, p[2] + DZ];
  const parts = [];
  parts.push(fieldPart(torsoPrims(), D.body, 0, piv([0, 0.95, 0]), up));
  yield* pause();
  parts.push(fieldPart(headPrims(), D.head, 1, piv([0, 1.5, 0]), up));
  yield* pause();
  parts.push(fieldPart(armPrims(1), D.head * 1.2, 2, piv([0.27, 1.42, 0]), up));
  parts.push(fieldPart(armPrims(-1), D.head * 1.2, 3, piv([-0.27, 1.42, 0]), up));
  yield* pause();
  parts.push(fieldPart(legPrims(), D.body, 4, [0, 0, 0], null));
  yield* pause();
  parts.push(fieldPart(seatPrims(), D.body, 7, [0, 0, 0], null));
  for (const g of bikeParts({ focus: true })) parts.push(g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]));
  const geometry = mergeGeometries(parts.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aPart', 'aPivot', 'aCol'].includes(k)) g.deleteAttribute(k);
    return g;
  }));
  geometry.computeBoundingSphere();
  ms += performance.now() - t0;
  return { geometry, detail, buildMs: ms };
}

const cache = new Map(), pending = new Map();
const detailOf = (d) => (RIDER_BODY.detail[d] ? d : 'mid');

// 少しずつ組み立てる（heroBody の createHeroBodyBuilder と同じ使い方）。step() は区切り 1 つぶん進めて、できあがったら true。
// finish() は残りを一度に進めて体を返す。同じ細かさはもう組み立てない（fresh: true なら、覚えたものを使わず組み立て直す。確かめ用）
export function createRiderBodyBuilder({ detail = 'mid', fresh = false } = {}) {
  const d = detailOf(detail);
  let gen = null, own = null;
  if (fresh) gen = buildSteps(d);
  else if (!cache.has(d) && !pending.has(d)) pending.set(d, buildSteps(d));
  const step = () => {
    if (fresh) {
      if (own) return true;
      const r = gen.next();
      if (r.done) own = r.value;
      return r.done;
    }
    if (cache.has(d)) return true;
    const r = pending.get(d).next();
    if (!r.done) return false;
    cache.set(d, r.value);
    pending.delete(d);
    return true;
  };
  return {
    step,
    get done() { return fresh ? !!own : cache.has(d); },
    get body() { return fresh ? own : cache.get(d) ?? null; },
    finish() { while (!step()); return fresh ? own : cache.get(d); },
  };
}

export function buildRiderBody({ detail = 'mid' } = {}) {
  return createRiderBodyBuilder({ detail }).finish();
}
