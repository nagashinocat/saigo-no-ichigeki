import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../rng.js';
import { GRID } from '../world/cityGen.js';
import { CONFIG } from '../config.js';
import { packFronts } from './sphereDeform.js';
import { dressCity, DENSITY, CLUTTER_DENSITY, NEON } from './cityDress.js';
import { createTransitView } from './transitView.js';

// 街の見た目: 地面、ビル（種類ごとに InstancedMesh。1 棟は形の部品（cityGen の parts）の数だけインスタンスを持つ）、
// 屋上や壁の飾り・看板・ネオン・店先の光の溜まり（cityDress.js。種類ごとに 1 つの InstancedMesh）、道路沿いの車・街灯・看板。
// 1 棟の部品と飾りは、つぶれるときは同じ時刻・同じ速さで（aCrush）一つのビルとしてつぶれ、隠すときは一緒に隠す。
// 壊れたビルや props は、インスタンスの拡大率を0にして隠す。
// 爆発の球に沿ったゆがみ（ビルが球の面へ押し付けられてつぶれる・地面が球の形にえぐれる）は style.js のシェーダーが描く。

const KINDS = ['house', 'office', 'tower'];
const MAX_RANGES = 48; // 一つの値の、一度に送る飛び飛びの範囲の数の上限（超えたら全体を送る）
const CAR_COLORS = ['#f4f4f2', '#c9ccd2', '#26282e', '#b8322e', '#2f5d9e', '#e8b93a', '#5f7f6a', '#8d8f94'];
// 道路沿いの看板もネオンの色から（バイクの緑と重ねない）
const SIGN_COLORS = Object.values(NEON).map((c) => '#' + new THREE.Color(...c).getHexString());

const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
// 見えない面を省いた箱（屋上の飾りの底、壁の飾りの裏）。drop: 'px' 'nx' 'py' 'ny' 'pz' 'nz'（BoxGeometry の面の順）
const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
export function openBox(drop) {
  const g = unitBox();
  const idx = g.index.array, keep = [];
  for (const grp of g.groups) {
    if (drop.includes(FACE_ORDER[grp.materialIndex])) continue;
    for (let i = grp.start; i < grp.start + grp.count; i++) keep.push(idx[i]);
  }
  g.setIndex(keep);
  g.clearGroups();
  return g;
}
// ビルの箱は、球の線に沿って曲がれるよう細かく分ける（縦を多めに）
const BUILDING_SEGMENTS = { high: [4, 14, 4], mid: [3, 10, 3], low: [2, 6, 2] };
// S8: 遠い地区（INNER_FRAC × 街の半径より外）のビルは、細かい箱でも分け方を少なく（遠くでは球の線の曲がりが小さく、画面でも小さい）
const FAR_SEGMENTS = { high: [2, 6, 2], mid: [1, 5, 1], low: [1, 3, 1] };
// S8: 地区ごとの描画（画面に入らない地区は描かない）。中心の円（INNER_FRAC × 半径の内）と、その外を SECTORS の扇に分ける。
// 一つの地区・一つの種類が 1 つの InstancedMesh（境界の球を持ち、画面の外なら three が描かない）
// 扇は軸の向き（±x・±z）を真ん中にする（上空カメラが見る -z の扇が一つにまとまる。4 つの扇も測った: task-S8-report）
export const REGIONS = { innerFrac: 0.4, sectors: 8, offset: Math.PI / 8 };
// 低い家（20m 未満。商店の並びの一軒ずつなど）は曲がりが小さいので縦の分け方を少なく（S7 で部品が増えた分の三角形を抑える）
const HOUSE_V = { high: 3, mid: 3, low: 2 };
// 2 段の細かさ（S7 fix 1）: 遊んでいる間はビルはつぶれない（小爆発はビルをゆがめない）ので粗い箱で描き、
// 最後の一発を放ったら（setDetail('fine')）球の線に沿って曲がる細かい箱へ差し替える（同じ材質・同じインスタンスの値）
const COARSE_SEGMENTS = [1, 2, 1];
// 平面の影（mid / low）はつぶれの形だけ追えばよいので、粗い箱で描く
const SHADOW_SEGMENTS = [1, 3, 1];
// 地面: 中心が細かい放射状のメッシュ（えぐれの縁がなめらかな円になるように）。街の外は粗く地平まで
const GROUND_RINGS = { high: [190, 320], mid: [140, 240], low: [90, 160] };
// S8: 細かい範囲は街の半径に合わせる。輪の間隔は中心ほど細かく（RING_POW。広くしても小さな穴の縁はなめらかなまま）
const GROUND_FINE_PAD = 150, RING_POW = 1.25;
const GROUND_FAR_R = 8000, GROUND_FAR_RINGS = 30;

function radialGround(tier, R = CONFIG.cityRadius) {
  const [rings, seg] = GROUND_RINGS[tier] ?? GROUND_RINGS.mid;
  const GROUND_FINE_R = R + GROUND_FINE_PAD;
  // 縁を円へ寄せる量（uRingStep）は、いちばん粗いところの輪の間隔
  const step = GROUND_FINE_R * (1 - ((rings - 1) / rings) ** RING_POW);
  const radii = [];
  for (let i = 1; i <= rings; i++) radii.push(GROUND_FINE_R * (i / rings) ** RING_POW);
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
  const R = city.radius ?? CONFIG.cityRadius;
  const groundGeo = radialGround(tier, R);
  const ground = new THREE.Mesh(groundGeo.geo, style.ground);
  ground.receiveShadow = shadows;
  ground.frustumCulled = false; // えぐれで頂点が下がるので、元の平らな境界では判定しない
  group.add(ground);
  const u = style.uniforms;
  u.uRingStep.value = groundGeo.step;

  // ビル（種類と地区ごとに箱の形を持ち、つぶれ始めた時刻を部品ごとの aCrush、屋根の形を aShape に書く）
  const segs = BUILDING_SEGMENTS[tier] ?? BUILDING_SEGMENTS.mid;
  const farSegs = FAR_SEGMENTS[tier] ?? FAR_SEGMENTS.mid;
  const byId = new Map(); // building id -> { parts: [{mesh, index}], extras: [{mesh, index}] }
  const lod = []; // 種類と地区ごと: { coarse, fine, meshes, region, sphere: { coarse, fine } }
  const meshes = {}; // 'kind:region' -> InstancedMesh（テスト・調査用）
  const color = new THREE.Color(), base = new THREE.Color();
  const innerR = REGIONS.innerFrac * R;
  const sectorOf = (a) => Math.floor((((a + Math.PI + REGIONS.offset) / (2 * Math.PI)) % 1) * REGIONS.sectors) % REGIONS.sectors;
  const regionOf = (b) => (b.dist < innerR ? 0 : 1 + sectorOf(Math.atan2(b.z, b.x)));
  const sunDir = style.sunDir ?? new THREE.Vector3(0.8, 0.3, -0.45).normalize();
  // fix1: 種類の違いはインスタンスの aKind で材質が選ぶので、低い家（house）と高いビル（office と tower）の 2 つに分ける
  // （細かい箱の縦の分け方が違う）。地区ごとに 2 つの InstancedMesh
  for (const [kind, kinds] of [['house', ['house']], ['tall', ['office', 'tower']]]) {
    const all = city.buildings.filter((b) => kinds.includes(b.kind));
    for (let region = 0; region <= REGIONS.sectors; region++) {
      const list = all.filter((b) => regionOf(b) === region);
      if (!list.length) continue;
      const n = list.reduce((a, b) => a + b.parts.length, 0);
      const near = region === 0;
      const sg0 = near ? segs : farSegs;
      const sg = kind === 'house' ? [sg0[0], Math.min(sg0[1], HOUSE_V[tier] ?? HOUSE_V.mid), sg0[2]] : sg0;
      const crushAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
      const shape = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
      const kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      const boxGeo = (sgm) => {
        const g = new THREE.BoxGeometry(1, 1, 1, ...sgm).translate(0, 0.5, 0);
        g.setAttribute('aCrush', crushAttr);
        g.setAttribute('aShape', shape);
        g.setAttribute('aKind', kindAttr);
        return g;
      };
      const geo = boxGeo(COARSE_SEGMENTS);
      const entryL = { kind, region, coarse: geo, fine: boxGeo(sg), meshes: [], spheres: regionSpheres(list, region) };
      lod.push(entryL);
      const mesh = instanced(geo, style.building(), n, { cast: shadows, receive: shadows });
      entryL.meshes.push(mesh);
      if (style.buildingDepth) mesh.customDepthMaterial = style.buildingDepth;
      mesh.name = 'buildings-' + kind + (region ? '-s' + region : '');
      let i = 0;
      for (const b of list) {
        const colors = style.kindColors[b.kind];
        base.set(pick(colors)).multiplyScalar(0.9 + 0.14 * rng());
        const entry = { parts: [], extras: [] };
        for (const p of b.parts) {
          mesh.setMatrixAt(i, boxMatrix(b.x + p.x, p.y, b.z + p.z, p.w, p.h, p.d));
          // 商店の並びは一軒ずつ違う色、ほかは同じ色を部品ごとに少しだけ変える
          if (b.arch === 'shop') color.set(colors[Math.floor(p.tone * colors.length) % colors.length]).multiplyScalar(0.86 + 0.2 * rng());
          else color.copy(base).multiplyScalar(0.95 + 0.1 * p.tone);
          mesh.setColorAt(i, color);
          shape.setXY(i, p.shape?.[0] ?? 0, p.shape?.[1] ?? 0);
          kindAttr.setX(i, KINDS.indexOf(b.kind));
          entry.parts.push({ mesh, index: i });
          i++;
        }
        byId.set(b.id, entry);
      }
      meshes[kind + ':' + region] = mesh;
      group.add(mesh);
      if (style.outline) {
        const line = instanced(geo, style.outline, n);
        line.instanceMatrix = mesh.instanceMatrix; // 同じ行列を使うので、隠すと線も消える
        line.name = 'outline-' + kind + (region ? '-s' + region : '');
        entryL.meshes.push(line);
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
        sh.name = 'planarShadow-' + kind + (region ? '-s' + region : '');
        entryL.shadow = sh;
        group.add(sh);
      }
    }
  }
  // 地区の境界の球: coarse（遊んでいる間。ビルの箱と、日なたの向きに地面へ落ちる影の先）と、
  // fine（最後の一発から。球に押されたビルは爆心から外へ、同じ扇の内を最大の半径まで動くので、扇の内の最大の半径までの球）
  function regionSpheres(list, region) {
    if (region === 0) return { coarse: null, shadow: null, fine: null };
    const pts = [], tips = [];
    for (const b of list) {
      for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
        const x = b.x + sx * b.w, z = b.z + sz * b.d;
        pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, b.h, z));
        // 平らな影（mid / low）の先: 屋上の角を日なたと逆の向きへ地面まで
        tips.push(new THREE.Vector3(x - sunDir.x / sunDir.y * b.h, 0, z - sunDir.z / sunDir.y * b.h));
      }
    }
    const coarse = new THREE.Sphere().setFromPoints(pts);
    const shadow = new THREE.Sphere().setFromPoints([...pts, ...tips]);
    const a0 = (region - 1) / REGIONS.sectors * 2 * Math.PI - Math.PI - REGIONS.offset, a1 = a0 + 2 * Math.PI / REGIONS.sectors;
    const rMax = Math.max(CONFIG.radius.max, ...list.map((b) => b.dist + Math.hypot(b.w, b.d)));
    const hMax = Math.max(...list.map((b) => b.h));
    const wedge = [...pts, ...tips];
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (a1 - a0) * k / 4;
      for (const r of [innerR * 0.8, rMax]) for (const y of [0, hMax]) wedge.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    return { coarse, shadow, fine: new THREE.Sphere().setFromPoints(wedge) };
  }
  // 地区の球をあてる（中心の地区はいつも描く）。平らな影は影の先まで含む球
  const applySpheres = (level) => {
    for (const l of lod) {
      const fine = level === 'fine';
      for (const [m, sp] of [...l.meshes.map((m) => [m, fine ? l.spheres.fine : l.spheres.coarse]), [l.shadow, fine ? l.spheres.fine : l.spheres.shadow]]) {
        if (!m) continue;
        m.frustumCulled = !!sp;
        if (sp) m.boundingSphere = sp.clone();
      }
      // mid / low: 最後の一発からは、外の地区の平らな影を描かない（つぶれていく遠いビルの影は光の中で見えない。描画を減らす）
      if (l.shadow) l.shadow.visible = !(fine && l.region !== 0);
    }
  };
  applySpheres('coarse');


  // 屋上・壁の飾り、看板・ネオン、店先の光の溜まり（cityDress.js）。作るときの段の密度で作り、
  // どの InstancedMesh も間引きの値 roll の小さい順に並べる。段が下がったら count を減らすだけで間引ける（setTier）
  const dress = dressCity(city, { density: DENSITY[tier] ?? DENSITY.mid, clutter: CLUTTER_DENSITY[tier] ?? CLUTTER_DENSITY.mid, seed: city.seed ?? 7 });
  const byRoll = (a, b) => a.roll - b.roll;
  const roofBoxes = dress.boxes.filter((x) => x.layer !== 'wall').sort(byRoll);
  const wallBoxes = dress.boxes.filter((x) => x.layer === 'wall').sort(byRoll);
  dress.tanks.sort(byRoll); dress.signs.sort(byRoll); dress.pools.sort(byRoll);
  const withCrush = (g, n) => { g.setAttribute('aCrush', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 2), 2)); return g; };
  const attach = (bid, mesh, index) => byId.get(bid)?.extras.push({ mesh, index });
  // 段ごとの数: 並べた先頭から roll < 密度 のものだけ
  const tiered = []; // { mesh, list, kind: 'sign' | 'clutter' }
  const countAt = (list, d) => { let n = 0; while (n < list.length && list[n].roll < d) n++; return n; };

  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), XAX = new THREE.Vector3(1, 0, 0);
  const _flip = new THREE.Quaternion().setFromAxisAngle(XAX, Math.PI);
  const placeBoxes = (mesh, list) => list.forEach((x, i) => {
    if (x.a) {
      // a → b の細い箱（電線・腕・竿）。見えない面（底・裏）を省いた箱なので、省いた面を上へ向ける（下や横から見える面を残す）。
      // 箱の底が y=0 なので、太さの半分だけずらして線の上に中心を置く
      _a.fromArray(x.a); _b.fromArray(x.b);
      _d.subVectors(_b, _a);
      const L = _d.length();
      _q.setFromUnitVectors(XAX, _d.normalize()).multiply(_flip);
      _p.addVectors(_a, _b).multiplyScalar(0.5).sub(_s.set(0, x.t / 2, 0).applyQuaternion(_q));
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s.set(L, x.t, x.t)));
    } else mesh.setMatrixAt(i, boxMatrix(x.x, x.y, x.z, x.w, x.h, x.d, x.ry));
    mesh.setColorAt(i, color.setRGB(...x.color, THREE.SRGBColorSpace));
    attach(x.bid, mesh, i);
  });
  // fix1: 屋上・壁の飾りと看板は、ビルと同じ地区（中心の円と 8 つの扇）ごとの InstancedMesh（画面の外の地区は描かない）。
  // 外の地区は境界の球を持つ: 遊んでいる間は飾りの位置から、最後の一発からは押されて外へ動く扇の全体（ビルと同じ考え）
  const regionByBid = new Map(city.buildings.map((b) => [b.id, regionOf(b)]));
  const wedgeSphere = (region) => {
    const a0 = (region - 1) / REGIONS.sectors * 2 * Math.PI - Math.PI - REGIONS.offset, a1 = a0 + 2 * Math.PI / REGIONS.sectors;
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (a1 - a0) * k / 4;
      for (const r of [innerR * 0.8, Math.max(CONFIG.radius.max, R + 20)]) for (const y of [0, 300]) pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    return new THREE.Sphere().setFromPoints(pts);
  };
  const dressRegions = []; // { mesh, spheres: { coarse, fine } }（中心の地区は入れない）
  const regional = (list, makeGeo, material, name, place, kind, opts = {}) => {
    const by = new Map();
    for (const x of list) { const r = regionByBid.get(x.bid) ?? 0; (by.get(r) ?? by.set(r, []).get(r)).push(x); }
    const out = [];
    for (const [region, items] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
      const mesh = instanced(makeGeo(items.length), material, items.length, opts);
      mesh.name = name + (region ? '-s' + region : '');
      place(mesh, items);
      tiered.push({ mesh, list: items, kind });
      if (region) {
        const pts = [];
        for (const x of items) {
          if (x.a) pts.push(_a.fromArray(x.a).clone(), _b.fromArray(x.b).clone());
          else pts.push(new THREE.Vector3(x.x, x.y ?? 0, x.z), new THREE.Vector3(x.x, (x.y ?? 0) + (x.h ?? 1), x.z));
        }
        const coarse = new THREE.Sphere().setFromPoints(pts);
        coarse.radius += 10; // 箱の大きさの分
        dressRegions.push({ mesh, spheres: { coarse, fine: wedgeSphere(region) } });
      }
      out.push(mesh);
    }
    return out;
  };
  // 屋上・区画の飾り: 底の面を省いた箱。壁と道の飾り: 底と裏（壁の側 = ローカルの -z）を省いた箱
  const boxMeshes = regional(roofBoxes, (n) => withCrush(openBox(['ny']), n), style.props.clutter, 'clutter-boxes', placeBoxes, 'clutter', { receive: shadows });
  const wallMeshes = regional(wallBoxes, (n) => withCrush(openBox(['ny', 'nz']), n), style.props.clutter, 'clutter-wall', placeBoxes, 'clutter', { receive: shadows });

  const tankGeo = mergeGeometries([
    new THREE.CylinderGeometry(1, 1, 0.62, 10, 1, true).translate(0, 0.62, 0),
    new THREE.ConeGeometry(1.05, 0.2, 10, 1, true).translate(0, 1.03, 0),
    ...[[0.62, 0.62], [-0.62, 0.62], [0.62, -0.62], [-0.62, -0.62]].map(([x, z]) => new THREE.BoxGeometry(0.14, 0.32, 0.14).translate(x, 0.16, z)),
  ].map((g) => g.toNonIndexed()));
  const tankMesh = instanced(withCrush(tankGeo, dress.tanks.length), style.props.clutter, dress.tanks.length, { receive: shadows });
  tankMesh.name = 'clutter-tanks';
  dress.tanks.forEach((x, i) => {
    tankMesh.setMatrixAt(i, boxMatrix(x.x, x.y, x.z, x.r, x.h, x.r));
    tankMesh.setColorAt(i, color.setRGB(...x.color, THREE.SRGBColorSpace));
    attach(x.bid, tankMesh, i);
  });
  tiered.push({ mesh: tankMesh, list: dress.tanks, kind: 'clutter' });

  const signGeo = (n) => {
    const g = withCrush(unitBox(), n);
    g.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 4), 4));
    g.setAttribute('aSign', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 4), 4));
    return g;
  };
  const placeSigns = (mesh, list) => {
    const tileAttr = mesh.geometry.getAttribute('aTile'), signAttr = mesh.geometry.getAttribute('aSign');
    list.forEach((x, i) => {
      mesh.setMatrixAt(i, boxMatrix(x.x, x.y, x.z, x.w, x.h, x.t, x.ry));
      mesh.setColorAt(i, color.setRGB(...x.color)); // ネオンの色は sRGB のままシェーダーへ（シェーダーが線形へ直す）
      tileAttr.setXYZW(i, ...(x.tile ?? [0, 0, 0, 0]));
      signAttr.setXYZW(i, x.flicker, x.phase, x.gain, x.mode);
      attach(x.bid, mesh, i);
    });
  };
  const signMeshes = regional(dress.signs, signGeo, style.props.sign, 'neon-signs', placeSigns, 'sign');

  const poolGeo = withCrush(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.07, 0), dress.pools.length);
  const neonPools = instanced(poolGeo, style.props.neonPool, dress.pools.length);
  neonPools.name = 'neon-pools';
  neonPools.renderOrder = 2;
  dress.pools.forEach((x, i) => {
    neonPools.setMatrixAt(i, boxMatrix(x.x, 0, x.z, x.w, 1, x.d, x.ry));
    neonPools.setColorAt(i, color.setRGB(...x.color));
    attach(x.bid, neonPools, i);
  });
  tiered.push({ mesh: neonPools, list: dress.pools, kind: 'sign' });

  const beaconMesh = instanced(new THREE.SphereGeometry(0.7, 8, 6).translate(0, 1.2, 0), style.props.beacon, dress.beacons.length);
  beaconMesh.name = 'beacons';
  dress.beacons.forEach((r, i) => {
    beaconMesh.setMatrixAt(i, boxMatrix(r.x, r.y, r.z, 1, 1, 1));
    attach(r.bid, beaconMesh, i);
  });
  group.add(...boxMeshes, ...wallMeshes, tankMesh, ...signMeshes, neonPools, beaconMesh);
  const applyDressSpheres = (level) => {
    for (const { mesh, spheres } of dressRegions) { mesh.frustumCulled = true; mesh.boundingSphere = (level === 'fine' ? spheres.fine : spheres.coarse).clone(); }
  };
  applyDressSpheres('coarse');
  const dressCounts = { boxes: roofBoxes.length + wallBoxes.length, roofBoxes: roofBoxes.length, wallBoxes: wallBoxes.length, tanks: dress.tanks.length, signs: dress.signs.length, pools: dress.pools.length, beacons: dress.beacons.length };
  let tierNow = tier, closeView = false;
  // 壁と道の細かい飾りは、mid / low の上空の画面では描かない（演出・リプレイ・結末の近いカメラでは描く）
  const applyWallVisibility = () => { for (const m of wallMeshes) m.visible = closeView || tierNow === 'high'; };
  applyWallVisibility();

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

  // 範囲だけ GPU へ送る（three は updateRanges があればその範囲だけを送り、なければ全体を送る）。
  // restore は全体を送る印（範囲なし）を付けるが、描く前に同じ値へ部分の範囲を足すと、全体が送られずに部分だけになる
  // （リプレイで、戻した飾りが GPU の上では隠れたままになった）。そこで restore のあと最初に範囲を足すときは、全体の範囲も足す
  // S8: 大きな街が一気に壊れていくフレームでは、一つの値に飛び飛びの範囲が多くなる（飾りは並べ替えてあるので、1 棟の飾りが
  // 散らばる）。範囲ごとに bufferSubData を呼ぶ代わりに、MAX_RANGES を超えたら全体を一度に送る
  const fullPending = new Set();
  const isFull = (attr) => { const r = attr.updateRanges; return r.length > 0 && r[0].start === 0 && r[0].count >= attr.array.length; };
  const markRange = (attr, start, count) => {
    const full = () => { attr.clearUpdateRanges(); attr.addUpdateRange(0, attr.array.length); };
    if (fullPending.has(attr)) { fullPending.delete(attr); full(); }
    else if (isFull(attr)) { /* もう全体を送る */ }
    else if (attr.updateRanges.length >= MAX_RANGES) full();
    else attr.addUpdateRange(start, count);
    attr.needsUpdate = true;
  };
  // S8: 高架の高速道路と環状線（transitView.js）。つぶれ・隠しは同じ markRange で送る
  const transitV = city.transit ? createTransitView(city.transit, style, tier, { markRange }) : null;
  if (transitV) group.add(transitV.group);
  const hide = ({ mesh, index }) => {
    mesh.setMatrixAt(index, ZERO);
    markRange(mesh.instanceMatrix, index * 16, 16);
  };
  const setCrush = ({ mesh, index }, at, delay) => {
    const attr = mesh.geometry.getAttribute('aCrush');
    if (!attr) return false;
    attr.setXY(index, at, delay);
    markRange(attr, index * 2, 2);
    return true;
  };
  let time = 0, detail = 'coarse';
  // 一時的に隠したビル（演出の軍勢の後ろのカットの間だけ、カメラのそばのビル）: id → 隠す前の行列。本当に隠した（gone）・つぶし始めた（crushed）ものは覚えておく
  const veiled = new Map(), gone = new Set(), crushed = new Set();
  const matOf = ({ mesh, index }) => mesh.instanceMatrix.array.slice(index * 16, index * 16 + 16);
  const setMat = ({ mesh, index }, arr) => { mesh.instanceMatrix.array.set(arr, index * 16); markRange(mesh.instanceMatrix, index * 16, 16); };

  let preTarget = null;
  // 街を入れたシーン（光の数を同じにして、同じシェーダーで描く）の光だけを残し、細かい箱を 1 棟ずつだけ描く
  function preloadFine(renderer, camera, scene) {
    const tmp = new THREE.Group();
    for (const l of lod) for (const m of l.meshes) {
      const d = new THREE.InstancedMesh(l.fine, m.material, 1);
      d.instanceMatrix = m.instanceMatrix;
      if (m.instanceColor) d.instanceColor = m.instanceColor;
      d.customDepthMaterial = m.customDepthMaterial;
      d.castShadow = m.castShadow; d.receiveShadow = m.receiveShadow;
      d.frustumCulled = false;
      tmp.add(d);
    }
    const root = scene ?? group;
    const vis = root.children.map((o) => o.visible);
    root.children.forEach((o) => { if (!o.isLight) o.visible = false; });
    root.add(tmp);
    preTarget ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(preTarget);
    renderer.render(root, camera);
    renderer.setRenderTarget(prev);
    root.remove(tmp);
    root.children.forEach((o, i) => { o.visible = vis[i]; });
  }

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
    // 画質の段が下がったとき: 看板のちらつき・明るさを合わせ、飾りを roll の小さい順に残して数を減らす（作ったときの段より増やさない）
    setTier(t) {
      style.setSignTier?.(t);
      for (const { mesh, list, kind } of tiered) {
        const d = kind === 'sign' ? (DENSITY[t] ?? DENSITY.mid) : (CLUTTER_DENSITY[t] ?? CLUTTER_DENSITY.mid);
        mesh.count = Math.min(mesh.count, countAt(list, d));
      }
      tierNow = t;
      applyWallVisibility();
    },
    // 近いカメラ（演出・リプレイ・結末）で描いているか。mid / low では、その間だけ壁と道の細かい飾りを描く
    setCloseView(on) { closeView = !!on; applyWallVisibility(); },
    // ビルの細かさ: 'coarse'（遊んでいる間）/ 'fine'（最後の一発から。球の線に沿って曲がる）
    setDetail(level) {
      for (const l of lod) for (const m of l.meshes) m.geometry = level === 'fine' ? l.fine : l.coarse;
      applySpheres(level);
      applyDressSpheres(level);
      detail = level;
    },
    get detail() { return detail; },
    // 初めて描くときに止まらないよう、街の材質を前もって作る（scene: 光の数を合わせるため、街を入れたシーン）。
    // 隠している壁の飾りも作る
    // S8: 最後の一発で差し替える細かい箱の形も、ここで一度だけ 1 画素の的へ描いて GPU へ送っておく（差し替えた瞬間に止まらない）
    warmup(renderer, camera, scene = group) {
      const v = wallMeshes.map((m) => m.visible);
      for (const m of wallMeshes) m.visible = true;
      renderer.compile(scene, camera);
      wallMeshes.forEach((m, i) => { m.visible = v[i]; });
      preloadFine(renderer, camera, scene === group ? null : scene);
    },
    // 爆発の球に沿ったゆがみを進める。fronts: [えぐれの半径, ...今の球の半径]（createFrontTracker）、
    // heat: 球の明るさ（0〜1。押し付けられた面と穴の割れ目が光る）、ember: 熾火の残り（0〜1）
    // front / radius: 最後の一発の今の前線と半径（高架の電車が前線に触れたら脱線する）。高架で起きたこと（脱線・溶ける・落ちた）を返す
    update(dt, { fronts = [], heat = 0, ember = 0, front = 0, radius = 0 } = {}) {
      time += dt;
      u.uTime.value = time;
      u.uFrontCount.value = packFronts(fronts, u.uFronts.value);
      u.uCrater.value = u.uFronts.value[0];
      u.uHeat.value = heat;
      u.uEmber.value = ember;
      return transitV ? transitV.update(dt, { front, radius }) : [];
    },
    // ---- 高架（S8）: 区間 id は 'x3'（高速）/ 'r5'（線路） ----
    get transit() { return transitV; },
    crushTransit(id, delay) { transitV?.crush(id, time, Math.max(1e-3, delay)); },
    hideTransit(id) { transitV?.hide(id); },
    transitState() { return transitV ? transitV.state() : null; },
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
      return { mats, attrs, transit: transitV ? transitV.state() : null };
    },
    // snapshot の姿へ戻す。一部の範囲だけ送る印は消して、全部を GPU へ送り直す
    restore(snap) {
      veiled.clear(); gone.clear(); crushed.clear();
      for (const { attr, array } of [...snap.mats, ...snap.attrs]) {
        attr.array.set(array);
        attr.clearUpdateRanges();
        attr.needsUpdate = true;
        fullPending.add(attr);
      }
      if (transitV && snap.transit) transitV.setState(snap.transit);
    },
  };
}
