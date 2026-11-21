import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../rng.js';
import { GRID } from '../world/cityGen.js';
import { CONFIG } from '../config.js';
import { packFronts } from './sphereDeform.js';
import { dressCity, DENSITY, CLUTTER_DENSITY, NEON } from './cityDress.js';

// 街の見た目: 地面、ビル（種類ごとに InstancedMesh。1 棟は形の部品（cityGen の parts）の数だけインスタンスを持つ）、
// 屋上や壁の飾り・看板・ネオン・店先の光の溜まり（cityDress.js。種類ごとに 1 つの InstancedMesh）、道路沿いの車・街灯・看板。
// 1 棟の部品と飾りは、つぶれるときは同じ時刻・同じ速さで（aCrush）一つのビルとしてつぶれ、隠すときは一緒に隠す。
// 壊れたビルや props は、インスタンスの拡大率を0にして隠す。
// 爆発の球に沿ったゆがみ（ビルが球の面へ押し付けられてつぶれる・地面が球の形にえぐれる）は style.js のシェーダーが描く。

const KINDS = ['house', 'office', 'tower'];
const CAR_COLORS = ['#f4f4f2', '#c9ccd2', '#26282e', '#b8322e', '#2f5d9e', '#e8b93a', '#5f7f6a', '#8d8f94'];
// 道路沿いの看板もネオンの色から（バイクの緑と重ねない）
const SIGN_COLORS = Object.values(NEON).map((c) => '#' + new THREE.Color(...c).getHexString());

const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
// ビルの箱は、球の線に沿って曲がれるよう細かく分ける（縦を多めに）
const BUILDING_SEGMENTS = { high: [4, 14, 4], mid: [3, 10, 3], low: [2, 6, 2] };
// 低い家（20m 未満。商店の並びの一軒ずつなど）は曲がりが小さいので縦の分け方を少なく（S7 で部品が増えた分の三角形を抑える）
const HOUSE_V = { high: 6, mid: 4, low: 3 };
// 平面の影（mid / low）はつぶれの形だけ追えばよいので、粗い箱で描く
const SHADOW_SEGMENTS = [1, 3, 1];
// 地面: 中心が細かい放射状のメッシュ（えぐれの縁がなめらかな円になるように）。街の外は粗く地平まで
const GROUND_RINGS = { high: [190, 320], mid: [140, 240], low: [90, 160] };
const GROUND_FINE_R = CONFIG.cityRadius + 150;
const GROUND_FAR_R = 8000, GROUND_FAR_RINGS = 30;

function radialGround(tier) {
  const [rings, seg] = GROUND_RINGS[tier] ?? GROUND_RINGS.mid;
  const step = GROUND_FINE_R / rings;
  const radii = [];
  for (let i = 1; i <= rings; i++) radii.push(i * step);
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

  // ビル（種類ごとに箱の形を持ち、つぶれ始めた時刻を部品ごとの aCrush、屋根の形を aShape に書く）
  const segs = BUILDING_SEGMENTS[tier] ?? BUILDING_SEGMENTS.mid;
  const byId = new Map(); // building id -> { parts: [{mesh, index}], extras: [{mesh, index}] }
  const meshes = {};
  const color = new THREE.Color(), base = new THREE.Color();
  for (const kind of KINDS) {
    const list = city.buildings.filter((b) => b.kind === kind);
    const n = list.reduce((a, b) => a + b.parts.length, 0);
    const sg = kind === 'house' ? [segs[0], HOUSE_V[tier] ?? HOUSE_V.mid, segs[2]] : segs;
    const geo = new THREE.BoxGeometry(1, 1, 1, ...sg).translate(0, 0.5, 0);
    const crushAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 2), 2);
    geo.setAttribute('aCrush', crushAttr);
    const shape = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 2), 2);
    geo.setAttribute('aShape', shape);
    const mesh = instanced(geo, style.building(kind), n, { cast: shadows, receive: shadows });
    if (style.buildingDepth) mesh.customDepthMaterial = style.buildingDepth;
    mesh.name = 'buildings-' + kind;
    const colors = style.kindColors[kind];
    let i = 0;
    for (const b of list) {
      base.set(pick(colors)).multiplyScalar(0.9 + 0.14 * rng());
      const entry = { parts: [], extras: [] };
      for (const p of b.parts) {
        mesh.setMatrixAt(i, boxMatrix(b.x + p.x, p.y, b.z + p.z, p.w, p.h, p.d));
        // 商店の並びは一軒ずつ違う色、ほかは同じ色を部品ごとに少しだけ変える
        if (b.arch === 'shop') color.set(colors[Math.floor(p.tone * colors.length) % colors.length]).multiplyScalar(0.86 + 0.2 * rng());
        else color.copy(base).multiplyScalar(0.95 + 0.1 * p.tone);
        mesh.setColorAt(i, color);
        shape.setXY(i, p.shape?.[0] ?? 0, p.shape?.[1] ?? 0);
        entry.parts.push({ mesh, index: i });
        i++;
      }
      byId.set(b.id, entry);
    }
    meshes[kind] = mesh;
    group.add(mesh);
    if (style.outline) {
      const line = instanced(geo, style.outline, n);
      line.instanceMatrix = mesh.instanceMatrix; // 同じ行列を使うので、隠すと線も消える
      line.name = 'outline-' + kind;
      group.add(line);
    }
    if (style.planarShadow) {
      // 同じ aCrush / aShape を使う粗い箱（つぶすと影も同じようにつぶれる）
      const sgeo = new THREE.BoxGeometry(1, 1, 1, ...SHADOW_SEGMENTS).translate(0, 0.5, 0);
      sgeo.setAttribute('aCrush', crushAttr);
      sgeo.setAttribute('aShape', shape);
      const sh = instanced(sgeo, style.planarShadow, n);
      sh.instanceMatrix = mesh.instanceMatrix;
      sh.renderOrder = 1;
      sh.name = 'planarShadow-' + kind;
      group.add(sh);
    }
  }


  // 屋上・壁の飾り、看板・ネオン、店先の光の溜まり（cityDress.js）。画質の段で数を間引く
  const dress = dressCity(city, { density: DENSITY[tier] ?? DENSITY.mid, clutter: CLUTTER_DENSITY[tier] ?? CLUTTER_DENSITY.mid, seed: 7 });
  const withCrush = (g, n) => { g.setAttribute('aCrush', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 2), 2)); return g; };
  const attach = (bid, mesh, index) => byId.get(bid)?.extras.push({ mesh, index });

  const boxMesh = instanced(withCrush(unitBox(), dress.boxes.length), style.props.clutter, dress.boxes.length, { receive: shadows });
  boxMesh.name = 'clutter-boxes';
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), XAX = new THREE.Vector3(1, 0, 0);
  dress.boxes.forEach((x, i) => {
    if (x.a) {
      // a → b の細い箱（電線・腕・竿）。箱の底が y=0 なので、太さの半分だけ下げて線の上に中心を置く
      _a.fromArray(x.a); _b.fromArray(x.b);
      _d.subVectors(_b, _a);
      const L = _d.length();
      _q.setFromUnitVectors(XAX, _d.normalize());
      _p.addVectors(_a, _b).multiplyScalar(0.5).sub(_s.set(0, x.t / 2, 0).applyQuaternion(_q));
      boxMesh.setMatrixAt(i, _m.compose(_p, _q, _s.set(L, x.t, x.t)));
    } else boxMesh.setMatrixAt(i, boxMatrix(x.x, x.y, x.z, x.w, x.h, x.d, x.ry));
    boxMesh.setColorAt(i, color.setRGB(...x.color, THREE.SRGBColorSpace));
    attach(x.bid, boxMesh, i);
  });

  const tankGeo = mergeGeometries([
    new THREE.CylinderGeometry(1, 1, 0.62, 10).translate(0, 0.62, 0),
    new THREE.ConeGeometry(1.05, 0.2, 10).translate(0, 1.03, 0),
    ...[[0.62, 0.62], [-0.62, 0.62], [0.62, -0.62], [-0.62, -0.62]].map(([x, z]) => new THREE.BoxGeometry(0.14, 0.32, 0.14).translate(x, 0.16, z)),
  ]);
  const tankMesh = instanced(withCrush(tankGeo, dress.tanks.length), style.props.clutter, dress.tanks.length, { receive: shadows });
  tankMesh.name = 'clutter-tanks';
  dress.tanks.forEach((x, i) => {
    tankMesh.setMatrixAt(i, boxMatrix(x.x, x.y, x.z, x.r, x.h, x.r));
    tankMesh.setColorAt(i, color.setRGB(...x.color, THREE.SRGBColorSpace));
    attach(x.bid, tankMesh, i);
  });

  const signGeo = withCrush(unitBox(), dress.signs.length);
  const tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, dress.signs.length) * 4), 4);
  const signAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, dress.signs.length) * 4), 4);
  signGeo.setAttribute('aTile', tileAttr);
  signGeo.setAttribute('aSign', signAttr);
  const signMesh = instanced(signGeo, style.props.sign, dress.signs.length);
  signMesh.name = 'neon-signs';
  dress.signs.forEach((x, i) => {
    signMesh.setMatrixAt(i, boxMatrix(x.x, x.y, x.z, x.w, x.h, x.t, x.ry));
    signMesh.setColorAt(i, color.setRGB(...x.color)); // ネオンの色は sRGB のままシェーダーへ（シェーダーが線形へ直す）
    tileAttr.setXYZW(i, ...(x.tile ?? [0, 0, 0, 0]));
    signAttr.setXYZW(i, x.flicker, x.phase, x.gain, x.mode);
    attach(x.bid, signMesh, i);
  });

  const poolGeo = withCrush(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.07, 0), dress.pools.length);
  const neonPools = instanced(poolGeo, style.props.neonPool, dress.pools.length);
  neonPools.name = 'neon-pools';
  neonPools.renderOrder = 2;
  dress.pools.forEach((x, i) => {
    neonPools.setMatrixAt(i, boxMatrix(x.x, 0, x.z, x.w, 1, x.d, x.ry));
    neonPools.setColorAt(i, color.setRGB(...x.color));
    attach(x.bid, neonPools, i);
  });

  const beaconMesh = instanced(new THREE.SphereGeometry(0.7, 8, 6).translate(0, 1.2, 0), style.props.beacon, dress.beacons.length);
  beaconMesh.name = 'beacons';
  dress.beacons.forEach((r, i) => {
    beaconMesh.setMatrixAt(i, boxMatrix(r.x, r.y, r.z, 1, 1, 1));
    attach(r.bid, beaconMesh, i);
  });
  group.add(boxMesh, tankMesh, signMesh, neonPools, beaconMesh);
  const dressCounts = { boxes: dress.boxes.length, tanks: dress.tanks.length, signs: dress.signs.length, pools: dress.pools.length, beacons: dress.beacons.length };

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
  // 街灯の頭の真下の道路に落ちる光の溜まり（暗めの夕方の照り返し）。街灯と一緒に隠す
  const pools = style.props.lampPool
    ? instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).scale(9, 1, 7).translate(1.6, 0.08, 0), style.props.lampPool, lamps.length)
    : null;
  if (pools) { pools.name = 'lamp-pools'; pools.renderOrder = 2; }
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
    pools?.setMatrixAt(i, _m);
    addPart('p' + l.id, poles, i);
    addPart('p' + l.id, heads, i);
    if (pools) addPart('p' + l.id, pools, i);
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
  if (pools) group.add(pools);

  // 範囲だけ GPU へ送る（1 棟の飾りは並んだ番号なので、three が隣り合う範囲をまとめて送る）
  const hide = ({ mesh, index }) => {
    mesh.setMatrixAt(index, ZERO);
    mesh.instanceMatrix.addUpdateRange(index * 16, 16);
    mesh.instanceMatrix.needsUpdate = true;
  };
  const setCrush = ({ mesh, index }, at, delay) => {
    const attr = mesh.geometry.getAttribute('aCrush');
    if (!attr) return false;
    attr.setXY(index, at, delay);
    attr.addUpdateRange(index * 2, 2);
    attr.needsUpdate = true;
    return true;
  };
  let time = 0;
  // 一時的に隠したビル（演出の肩越しのカットの間だけ）: id → 隠す前の行列。本当に隠した（gone）・つぶし始めた（crushed）ものは覚えておく
  const veiled = new Map(), gone = new Set(), crushed = new Set();
  const matOf = ({ mesh, index }) => mesh.instanceMatrix.array.slice(index * 16, index * 16 + 16);
  const setMat = ({ mesh, index }, arr) => { mesh.instanceMatrix.array.set(arr, index * 16); mesh.instanceMatrix.addUpdateRange(index * 16, 16); mesh.instanceMatrix.needsUpdate = true; };

  return {
    group,
    tier,
    meshes,
    // 飾りの数（描画の回数・三角形の見積もりと、テスト用）
    dressCounts,
    // Task 8 の破片が、そのビルの色や位置を引き継ぐために使う
    getBuildingMesh(id) {
      const e = byId.get(id);
      return e ? { mesh: e.parts[0].mesh, index: e.parts[0].index } : null;
    },
    // 1 棟の部品と飾り（テスト・調査用）: { parts: [{mesh, index}], extras: [{mesh, index}] }
    getBuildingParts(id) {
      const e = byId.get(id);
      return e ? { parts: [...e.parts], extras: [...e.extras] } : null;
    },
    getBuildingColor(id) {
      const e = byId.get(id);
      if (!e) return null;
      const c = new THREE.Color();
      e.parts[0].mesh.getColorAt(e.parts[0].index, c);
      return [c.r, c.g, c.b];
    },
    // 画質の段が下がったとき（看板のちらつき・明るさ。飾りの数は作ったときの段のまま）
    setTier(t) { style.setSignTier?.(t); },
    // 初めて描くときに止まらないよう、街の材質を前もって作る（scene: 光の数を合わせるため、街を入れたシーン）
    warmup(renderer, camera, scene = group) { renderer.compile(scene, camera); },
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
    // 球の表面が通ったビル: 部品も飾りも看板も同じ時刻から delay 秒かけて、一つのビルとして球の線に沿ってつぶれていく
    // （看板はちらついて消える。つぶれ方を持たない航空灯だけすぐ隠す）。隠すのは hideBuilding
    crushBuilding(id, delay) {
      const e = byId.get(id);
      if (!e) return;
      const d = Math.max(1e-3, delay);
      for (const p of e.parts) setCrush(p, time, d);
      for (const x of e.extras) if (!setCrush(x, time, d)) hide(x);
      crushed.add(id);
    },
    hideBuilding(id) {
      const e = byId.get(id);
      if (!e) return;
      e.parts.forEach(hide);
      e.extras.forEach(hide);
      gone.add(id);
    },
    // 一時的に隠す（on）・戻す（off）。戻すとき、その間に hideBuilding されたものは隠したまま、crushBuilding されたものは
    // 部品と飾りを戻す（つぶれはシェーダーが進める。つぶれ方を持たない航空灯は隠したまま）
    veilBuilding(id, on) {
      const e = byId.get(id);
      if (!e) return;
      if (on) {
        if (veiled.has(id) || gone.has(id)) return;
        veiled.set(id, { parts: e.parts.map(matOf), extras: e.extras.map(matOf) });
        e.parts.forEach(hide);
        e.extras.forEach(hide);
        return;
      }
      const v = veiled.get(id);
      if (!v) return;
      veiled.delete(id);
      if (gone.has(id)) return;
      e.parts.forEach((p, i) => setMat(p, v.parts[i]));
      // つぶし始めたビルの飾りも、つぶれ方（aCrush）を持つものは戻す（ビルと一緒につぶれていく）。航空灯は隠したまま
      e.extras.forEach((x, i) => { if (!crushed.has(id) || x.mesh.geometry.getAttribute('aCrush')) setMat(x, v.extras[i]); });
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
    // 今の姿（置き場所の行列と、つぶれの始まりなど一つずつの値）を写して返す。restore で戻す（リプレイ）
    snapshot() {
      const mats = [], attrs = [];
      group.traverse((o) => {
        if (!o.isInstancedMesh) return;
        mats.push({ attr: o.instanceMatrix, array: o.instanceMatrix.array.slice() });
        for (const a of Object.values(o.geometry.attributes)) {
          if (a.isInstancedBufferAttribute && !attrs.some((x) => x.attr === a)) attrs.push({ attr: a, array: a.array.slice() });
        }
      });
      return { mats, attrs };
    },
    // snapshot の姿へ戻す。一部の範囲だけ送る印は消して、全部を GPU へ送り直す
    restore(snap) {
      veiled.clear(); gone.clear(); crushed.clear();
      for (const { attr, array } of [...snap.mats, ...snap.attrs]) {
        attr.array.set(array);
        attr.clearUpdateRanges();
        attr.needsUpdate = true;
      }
    },
  };
}
