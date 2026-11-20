import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../rng.js';
import { GRID } from '../world/cityGen.js';
import { CONFIG } from '../config.js';
import { packFronts, PILLAR } from './sphereDeform.js';

// 街の見た目: 地面、ビル（種類ごとに InstancedMesh）、屋上の設備、道路沿いの車・街灯・看板。
// 壊れたビルや props は、インスタンスの拡大率を0にして隠す。
// 爆発の球に沿ったゆがみ（ビルが球の面へ押し付けられてつぶれる・地面が球の形にえぐれる）は style.js のシェーダーが描く。

const KINDS = ['house', 'office', 'tower'];
const CAR_COLORS = ['#f4f4f2', '#c9ccd2', '#26282e', '#b8322e', '#2f5d9e', '#e8b93a', '#5f7f6a', '#8d8f94'];
const SIGN_COLORS = ['#ff5f7a', '#4fd6ff', '#ffd25a', '#7dff9a', '#ff9a3c', '#c99bff'];

const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
// ビルの箱は、球の線に沿って曲がれるよう細かく分ける（縦を多めに）
const BUILDING_SEGMENTS = { high: [4, 14, 4], mid: [3, 10, 3], low: [2, 6, 2] };
// 地面: 中心が細かい放射状のメッシュ（えぐれの縁がなめらかな円になるように）。街の外は粗く地平まで
const GROUND_RINGS = { high: [190, 320], mid: [140, 240], low: [90, 160] };
const GROUND_FINE_R = CONFIG.cityRadius + 150;
const GROUND_FAR_R = 8000, GROUND_FAR_RINGS = 30;
// 主人公の柱の上の縁の角を作る輪: 縁（法線は上）とそのすぐ外（塔の斜面の法線）
const EDGE = 0.02;
export const PILLAR_RINGS = [PILLAR.radius, PILLAR.radius + EDGE];

function radialGround(tier) {
  const [rings, seg] = GROUND_RINGS[tier] ?? GROUND_RINGS.mid;
  const step = GROUND_FINE_R / rings;
  const radii = [...PILLAR_RINGS];
  for (let i = 1; i <= rings; i++) {
    const r = i * step;
    if (PILLAR_RINGS.every((p) => Math.abs(p - r) > 0.1)) radii.push(r); // 柱の輪に近すぎる輪は省く
  }
  radii.sort((a, b) => a - b);
  for (let i = 1; i <= GROUND_FAR_RINGS; i++) radii.push(GROUND_FINE_R * (GROUND_FAR_R / GROUND_FINE_R) ** (i / GROUND_FAR_RINGS));
  const pos = new Float32Array((1 + radii.length * seg) * 3);
  let k = 3;
  for (const r of radii) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos[k++] = Math.cos(a) * r; pos[k++] = 0; pos[k++] = Math.sin(a) * r;
    }
  }
  const idx = [];
  const v = (ring, j) => 1 + ring * seg + (j % seg);
  for (let j = 0; j < seg; j++) idx.push(0, v(0, j + 1), v(0, j));
  for (let i = 0; i + 1 < radii.length; i++) {
    for (let j = 0; j < seg; j++) {
      const a = v(i, j), b = v(i, j + 1), c = v(i + 1, j), d = v(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return { geo, step };
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

function boxMatrix(x, y, z, w, h, d, rotY = 0) {
  _q.setFromAxisAngle(UP, rotY);
  return _m.compose(_p.set(x, y, z), _q, _s.set(w, h, d));
}

function instanced(geo, mat, count, { cast = false, receive = false } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  mesh.count = count;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.frustumCulled = false; // 街全体が常に画面に入るので、毎フレームの境界計算を省く
  return mesh;
}

// 道路の中心線からの位置。道路は区画の間（(k + 0.5) * PITCH）を通る。
function roadInfo(x, z) {
  const { PITCH, ROAD } = GRID;
  const off = (v) => v - (Math.round(v / PITCH - 0.5) + 0.5) * PITCH;
  const ox = off(x), oz = off(z);
  const alongZ = Math.abs(ox) <= ROAD / 2 + 0.01 && Math.abs(ox) <= Math.abs(oz);
  return alongZ ? { alongZ: true, offset: ox, center: x - ox } : { alongZ: false, offset: oz, center: z - oz };
}

export { radialGround };

export function createCityView(city, style, tier) {
  const group = new THREE.Group();
  group.name = 'cityView';
  const shadows = style.shadows;
  const rng = createRng(0x5eed + city.buildings.length);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // 地面（地平まで届く広さ。えぐれの縁がなめらかな円になるよう中心を細かく分ける）
  const groundGeo = radialGround(tier);
  const ground = new THREE.Mesh(groundGeo.geo, style.ground);
  ground.receiveShadow = shadows;
  ground.frustumCulled = false; // えぐれで頂点が下がるので、元の平らな境界では判定しない
  group.add(ground);
  const u = style.uniforms;
  u.uRingStep.value = groundGeo.step;

  // ビル（種類ごとに箱の形を持ち、つぶれ始めた時刻をインスタンスごとの aCrush に書く）
  const segs = BUILDING_SEGMENTS[tier] ?? BUILDING_SEGMENTS.mid;
  const byId = new Map(); // building id -> { mesh, index, extras: [{mesh, index}] }
  const meshes = {};
  const color = new THREE.Color();
  for (const kind of KINDS) {
    const list = city.buildings.filter((b) => b.kind === kind);
    const geo = new THREE.BoxGeometry(1, 1, 1, ...segs).translate(0, 0.5, 0);
    const crush = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 2), 2);
    geo.setAttribute('aCrush', crush);
    const mesh = instanced(geo, style.building(kind), list.length, { cast: shadows, receive: shadows });
    if (style.buildingDepth) mesh.customDepthMaterial = style.buildingDepth;
    mesh.name = 'buildings-' + kind;
    list.forEach((b, i) => {
      mesh.setMatrixAt(i, boxMatrix(b.x, 0, b.z, b.w, b.h, b.d));
      color.set(pick(style.kindColors[kind])).multiplyScalar(0.92 + 0.12 * rng());
      mesh.setColorAt(i, color);
      byId.set(b.id, { mesh, index: i, extras: [] });
    });
    meshes[kind] = mesh;
    group.add(mesh);
    if (style.outline) {
      const line = instanced(geo, style.outline, list.length);
      line.instanceMatrix = mesh.instanceMatrix; // 同じ行列を使うので、隠すと線も消える
      line.name = 'outline-' + kind;
      group.add(line);
    }
    if (style.planarShadow) {
      const sh = instanced(geo, style.planarShadow, list.length);
      sh.instanceMatrix = mesh.instanceMatrix;
      sh.renderOrder = 1;
      sh.name = 'planarShadow-' + kind;
      group.add(sh);
    }
  }

  const geo = unitBox();

  // 屋上の設備（空調・塔屋・高層の赤い航空灯）
  const roofSpecs = [], beaconSpecs = [];
  for (const b of city.buildings) {
    if (b.kind === 'house') continue;
    const n = b.kind === 'tower' ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const big = k === 0 && b.kind === 'tower';
      const w = big ? b.w * (0.3 + 0.2 * rng()) : 1.5 + 2.5 * rng();
      const d = big ? b.d * (0.3 + 0.2 * rng()) : 1.5 + 2.5 * rng();
      const h = big ? 4 + 4 * rng() : 1.2 + 2 * rng();
      const x = b.x + (rng() - 0.5) * Math.max(0, b.w - w - 2);
      const z = b.z + (rng() - 0.5) * Math.max(0, b.d - d - 2);
      roofSpecs.push({ id: b.id, x, y: b.h, z, w, h, d });
    }
    if (b.h > 85) beaconSpecs.push({ id: b.id, x: b.x + b.w * 0.42, y: b.h, z: b.z + b.d * 0.42 });
  }
  const roofMesh = instanced(geo, style.props.roofBox, roofSpecs.length, { cast: shadows, receive: shadows });
  roofSpecs.forEach((r, i) => {
    roofMesh.setMatrixAt(i, boxMatrix(r.x, r.y, r.z, r.w, r.h, r.d));
    byId.get(r.id).extras.push({ mesh: roofMesh, index: i });
  });
  const beaconMesh = instanced(new THREE.SphereGeometry(0.7, 8, 6).translate(0, 1.2, 0), style.props.beacon, beaconSpecs.length);
  beaconSpecs.forEach((r, i) => {
    beaconMesh.setMatrixAt(i, boxMatrix(r.x, r.y, r.z, 1, 1, 1));
    byId.get(r.id).extras.push({ mesh: beaconMesh, index: i });
  });
  group.add(roofMesh, beaconMesh);

  // 道路沿いの props
  const cars = city.props.filter((p) => p.kind === 'car');
  const lamps = city.props.filter((p) => p.kind === 'lamp');
  const signs = city.props.filter((p) => p.kind === 'sign');
  const propParts = new Map(); // prop id -> [{mesh, index}]
  const addPart = (id, mesh, index) => (propParts.get(id) ?? propParts.set(id, []).get(id)).push({ mesh, index });

  const carGeo = mergeGeometries([
    new THREE.BoxGeometry(4.3, 1.0, 1.85).translate(0, 0.75, 0),
    new THREE.BoxGeometry(2.3, 0.75, 1.65).translate(-0.25, 1.62, 0),
  ]);
  const carMesh = instanced(carGeo, style.props.body, cars.length, { cast: shadows, receive: shadows });
  cars.forEach((c, i) => {
    const r = roadInfo(c.x, c.z);
    const lane = (r.offset >= 0 ? 1 : -1) * 2.0; // 中央線をまたがないよう車線へ寄せる
    const x = r.alongZ ? r.center + lane : c.x, z = r.alongZ ? c.z : r.center + lane;
    carMesh.setMatrixAt(i, boxMatrix(x, 0, z, 1, 1, 1, r.alongZ ? Math.PI / 2 : 0));
    carMesh.setColorAt(i, color.set(pick(CAR_COLORS)));
    addPart('p' + c.id, carMesh, i);
  });

  const poleGeo = mergeGeometries([
    new THREE.BoxGeometry(0.22, 7, 0.22).translate(0, 3.5, 0),
    new THREE.BoxGeometry(1.6, 0.16, 0.16).translate(0.7, 6.95, 0),
  ]);
  const signPoleGeo = mergeGeometries([
    new THREE.BoxGeometry(0.2, 4.2, 0.2).translate(-1.0, 2.1, 0),
    new THREE.BoxGeometry(0.2, 4.2, 0.2).translate(1.0, 2.1, 0),
  ]);
  const poles = instanced(poleGeo, style.props.metal, lamps.length, { cast: shadows });
  const heads = instanced(new THREE.BoxGeometry(0.9, 0.22, 0.45).translate(1.35, 6.85, 0), style.props.lampHead, lamps.length);
  const signPoles = instanced(signPoleGeo, style.props.metal, signs.length, { cast: shadows });
  const panels = instanced(new THREE.BoxGeometry(3.0, 1.7, 0.3).translate(0, 5.0, 0), style.props.signPanel, signs.length);
  const curbPlace = (p) => {
    // 街灯と看板は歩道の縁に立て、道路の側へ向ける
    const r = roadInfo(p.x, p.z), side = r.offset >= 0 ? 1 : -1, e = GRID.ROAD / 2 + 0.6;
    const x = r.alongZ ? r.center + side * e : p.x, z = r.alongZ ? p.z : r.center + side * e;
    const rot = r.alongZ ? (side > 0 ? Math.PI : 0) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    return { x, z, rot };
  };
  lamps.forEach((l, i) => {
    const { x, z, rot } = curbPlace(l);
    poles.setMatrixAt(i, boxMatrix(x, 0, z, 1, 1, 1, rot));
    heads.setMatrixAt(i, _m);
    addPart('p' + l.id, poles, i);
    addPart('p' + l.id, heads, i);
  });
  signs.forEach((s, i) => {
    const { x, z, rot } = curbPlace(s);
    signPoles.setMatrixAt(i, boxMatrix(x, 0, z, 1, 1, 1, rot + Math.PI / 2));
    panels.setMatrixAt(i, _m);
    panels.setColorAt(i, color.set(pick(SIGN_COLORS)).multiplyScalar(1.3));
    addPart('p' + s.id, signPoles, i);
    addPart('p' + s.id, panels, i);
  });
  group.add(carMesh, poles, heads, signPoles, panels);

  const hide = ({ mesh, index }) => {
    mesh.setMatrixAt(index, ZERO);
    mesh.instanceMatrix.needsUpdate = true;
  };
  let time = 0;

  return {
    group,
    tier,
    meshes,
    // Task 8 の破片が、そのビルの色や位置を引き継ぐために使う
    getBuildingMesh(id) {
      const e = byId.get(id);
      return e ? { mesh: e.mesh, index: e.index } : null;
    },
    getBuildingColor(id) {
      const e = byId.get(id);
      if (!e) return null;
      const c = new THREE.Color();
      e.mesh.getColorAt(e.index, c);
      return [c.r, c.g, c.b];
    },
    // 爆発の球に沿ったゆがみを進める。fronts: [えぐれの半径, ...今の球の半径]（createFrontTracker）、
    // heat: 球の明るさ（0〜1。押し付けられた面と穴の割れ目が光る）、ember: 熾火の残り（0〜1）
    update(dt, { fronts = [], heat = 0, ember = 0 } = {}) {
      time += dt;
      u.uTime.value = time;
      u.uFrontCount.value = packFronts(fronts, u.uFronts.value);
      u.uCrater.value = u.uFronts.value[0];
      u.uHeat.value = heat;
      u.uEmber.value = ember;
    },
    // 球の表面が通ったビル: 屋上の設備はすぐ隠し、ビルは delay 秒かけて球の線に沿ってつぶれていく（隠すのは hideBuilding）
    crushBuilding(id, delay) {
      const e = byId.get(id);
      if (!e) return;
      const attr = e.mesh.geometry.getAttribute('aCrush');
      attr.setXY(e.index, time, Math.max(1e-3, delay));
      attr.addUpdateRange(e.index * 2, 2);
      attr.needsUpdate = true;
      e.extras.forEach(hide);
    },
    hideBuilding(id) {
      const e = byId.get(id);
      if (!e) return;
      hide(e);
      e.extras.forEach(hide);
    },
    // 破片の出発点と色。props は道路沿いに数 m ずらして置いているので、見えている位置を返す。
    getPropVisual(id) {
      const part = (propParts.get('p' + id) ?? [])[0];
      if (!part) return null;
      part.mesh.getMatrixAt(part.index, _m);
      _p.setFromMatrixPosition(_m);
      const c = new THREE.Color(0.45, 0.46, 0.5);
      if (part.mesh.instanceColor) part.mesh.getColorAt(part.index, c);
      return { x: _p.x, z: _p.z, color: [c.r, c.g, c.b] };
    },
    hideProp(id) {
      for (const part of propParts.get('p' + id) ?? []) hide(part);
    },
  };
}
