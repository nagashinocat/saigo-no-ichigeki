import * as THREE from 'three';
import { createRng } from '../rng.js';
import { pointAt } from '../world/transit.js';
import { CONFIG } from '../config.js';

// S8（持ち主 2026-11-21 13:16「高速とか、電車とかも走ってた方がいいよね」）: 高架の高速道路と環状線の見た目。
//  struct（1 回の描画）: 橋桁・欄干・桁・橋脚・横梁・線路・架線の柱と線（屋上の飾りと同じ材質。つぶれはビルと同じ aCrush）
//  train（1 回の描画）: 電車の車体・帯・屋根。環状線をぐるぐる回る
//  lights（1 回の描画、看板と同じ発光の材質）: 高速の車の光の流れ（行く向きは白いヘッドライト、戻る向きは赤いテールライト）、
//    高速の照明、電車の窓の明かり・前照灯・尾灯・パンタグラフの火花
// 爆発の前線が橋桁の一区間に届くと、ビルと同じように球の線に沿ってつぶれ（crush）、つぶれきると隠れて破片になる（destruction）。
// その区間の上の車の光は消える。電車は前線に触れるか、走っている区間がこわれると脱線して外へ吹き飛び（落ちたら破片）、
// 光の中（vaporizeDist の内）なら溶ける。どちらも events で知らせる（音・破片・溶ける見た目は main がつなぐ）。
// 時間（車と電車の位置）は世界の時間で進む（演出のゆっくりの間はゆっくり）。snapshot / restore はリプレイが使う

const CONCRETE = [[0.40, 0.40, 0.42], [0.36, 0.36, 0.39], [0.44, 0.43, 0.42]];
const RAIL_C = [0.45, 0.44, 0.43];
const METAL = [0.26, 0.27, 0.30], STEEL = [0.58, 0.59, 0.62];
const TRAIN = { body: [0.74, 0.76, 0.8], stripe: [0.98, 0.42, 0.12], roof: [0.34, 0.35, 0.38], h: 3.5, d: 2.9, lift: 0.9 };
// 光の色（sRGB）。行く向き（+）は白、戻る向き（-）は赤。照明はナトリウム灯の琥珀。窓は暖かい白
export const TRANSIT_LIGHT = {
  head: [1.0, 0.95, 0.86], tail: [1.0, 0.13, 0.08], lamp: [1.0, 0.62, 0.24], window: [1.0, 0.86, 0.66], spark: [0.72, 0.88, 1.0],
  gain: { head: 0.85, tail: 0.95, lamp: 0.7, window: 0.62, cab: 1.4, spark: 2.4 },
};
const DERAIL = { out: [26, 46], up: [9, 16], spin: [1.2, 3.2], gravity: 22, life: 1.7 };
const SPARK = { every: [1.2, 3.6], dur: 0.12 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
// ローカルの +x を道の向き heading（x 軸から z 軸への角）へ
const along = (heading) => -heading;

export function createTransitView(transit, style, tier, { markRange } = {}) {
  const group = new THREE.Group();
  group.name = 'transitView';
  const { segments, pillars, paths, config: T } = transit;
  const rng = createRng(0x7a11 + segments.length);
  const mark = markRange ?? ((attr, start, count) => { attr.addUpdateRange(start, count); attr.needsUpdate = true; });
  const color = new THREE.Color();
  const segIndex = new Map(segments.map((s, i) => [s.id, i]));

  // ---- 動かない骨組み（区間ごとに並べる） ----
  const parts = []; // { seg, x, y, z, w, h, d, ry, color }
  const off = (s, k) => [-Math.sin(s.heading) * k, Math.cos(s.heading) * k]; // 道の横（左）へ k m
  const put = (seg, x, y, z, w, h, d, ry, c) => parts.push({ seg, x, y, z, w, h, d, ry, color: c });
  const lampSpots = []; // 照明 { seg, x, y, z, ry }
  for (const s of segments) {
    const cx = s.x, cz = s.z, ry = along(s.heading), conc = CONCRETE[Math.floor(rng() * CONCRETE.length)];
    const pil = pillars.filter((p) => p.seg === s.id);
    if (s.line === 'expressway') {
      put(s.id, cx, s.y - s.thick, cz, s.len + 0.05, s.thick, s.width, ry, conc);
      put(s.id, cx, s.y - s.thick - 1.3, cz, s.len + 0.05, 1.3, s.width * 0.55, ry, CONCRETE[1]);
      for (const k of [-1, 1]) {
        const [ox, oz] = off(s, k * (s.width / 2 - 0.2));
        put(s.id, cx + ox, s.y, cz + oz, s.len + 0.05, 1.05, 0.4, ry, conc);
      }
      // 照明の柱（左右交互）と、中央分離帯
      const [mx, mz] = off(s, 0);
      put(s.id, cx + mx, s.y, cz + mz, s.len + 0.05, 0.8, 0.5, ry, CONCRETE[2]);
      const side = segIndex.get(s.id) % 2 ? 1 : -1, [lx, lz] = off(s, side * (s.width / 2 - 0.3));
      put(s.id, cx + lx, s.y, cz + lz, 0.18, 6.2, 0.18, ry, METAL);
      const [hx, hz] = off(s, side * (s.width / 2 - 2.0));
      put(s.id, cx + (lx + hx) / 2, s.y + 6.1, cz + (lz + hz) / 2, 0.16, 0.16, 3.4, ry, METAL);
      lampSpots.push({ seg: s.id, x: cx + hx, y: s.y + 5.85, z: cz + hz, ry });
      for (const p of pil) {
        const hb = p.h - 1.3;
        put(s.id, p.x, 0, p.z, p.w, hb - 1.5, p.w, ry, CONCRETE[0]);
        put(s.id, p.x, hb - 1.6, p.z, 2.6, 1.6, s.width * 0.82, ry, CONCRETE[1]); // 横梁
      }
    } else {
      put(s.id, cx, s.y - s.thick, cz, s.len + 0.05, s.thick, s.width, ry, RAIL_C);
      for (const k of [-1, 1]) {
        const [ox, oz] = off(s, k * (s.width / 2 - 0.15));
        put(s.id, cx + ox, s.y, cz + oz, s.len + 0.05, 0.85, 0.3, ry, RAIL_C);
        const [rx, rz] = off(s, k * 0.75);
        put(s.id, cx + rx, s.y, cz + rz, s.len + 0.05, 0.2, 0.14, ry, STEEL);
      }
      // 架線の柱と腕と線
      const [px, pz] = off(s, s.width / 2 - 0.35), [ax, az] = off(s, s.width / 4 - 0.2);
      const a0 = s.a, ox = (s.b[0] - s.a[0]) * 0.02, oz = (s.b[1] - s.a[1]) * 0.02;
      put(s.id, a0[0] + ox + px, s.y, a0[1] + oz + pz, 0.26, 6.6, 0.26, ry, METAL);
      put(s.id, a0[0] + ox + ax, s.y + 6.3, a0[1] + oz + az, 0.14, 0.14, s.width * 0.55, ry, METAL);
      put(s.id, cx, s.y + 5.6, cz, s.len + 0.05, 0.05, 0.05, ry, [0.12, 0.12, 0.13]);
      for (const p of pil) {
        put(s.id, p.x, 0, p.z, p.w, p.h - 0.7, p.w, ry, CONCRETE[2]);
        put(s.id, p.x, p.h - 0.8, p.z, 1.8, 0.8, s.width * 0.85, ry, CONCRETE[0]);
      }
    }
  }
  // 長い箱（橋桁・欄干・線路・架線）は長い向き（x）を 4 つに分け（球の線に沿って曲がる）、短い箱（橋脚・梁・柱）は分けない。
  // 見えない底の面は省く。どちらも 1 回の描画
  const bySeg = new Map(segments.map((s) => [s.id, { struct: [], lights: [] }]));
  const makeStruct = (list, sx, name) => {
    const g = new THREE.BoxGeometry(1, 1, 1, sx, 1, 1).translate(0, 0.5, 0);
    const keep = [];
    for (const grp of g.groups) if (grp.materialIndex !== 3) for (let i = grp.start; i < grp.start + grp.count; i++) keep.push(g.index.array[i]); // 3: -y（底）
    g.setIndex(keep); g.clearGroups();
    const crush = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 2), 2);
    g.setAttribute('aCrush', crush);
    const mesh = new THREE.InstancedMesh(g, style.props.clutter, Math.max(1, list.length));
    mesh.count = list.length;
    mesh.name = name;
    mesh.castShadow = style.shadows;
    mesh.receiveShadow = style.shadows;
    mesh.frustumCulled = false; // 街を横切る・一周するので、ほとんどいつも画面に入る
    list.forEach((x, i) => {
      _q.setFromAxisAngle(UP, x.ry);
      mesh.setMatrixAt(i, _m.compose(_p.set(x.x, x.y, x.z), _q, _s.set(x.w, x.h, x.d)));
      mesh.setColorAt(i, color.setRGB(...x.color, THREE.SRGBColorSpace));
      bySeg.get(x.seg).struct.push({ mesh, index: i, crush });
    });
    group.add(mesh);
    return mesh;
  };
  const struct = makeStruct(parts.filter((x) => x.w > 6), 4, 'transit-struct');
  const structShort = makeStruct(parts.filter((x) => x.w <= 6), 1, 'transit-struct-short');

  // ---- 車の光の流れ（高速） ----
  const E = T.expressway, xp = paths.expressway;
  const cars = []; // { s0, v, lane（横のずれ m。+ は左）, dir: 1 | -1 }
  for (const [li, lane] of [E.lanes[0], E.lanes[1], -E.lanes[0], -E.lanes[1]].entries()) {
    const dir = lane > 0 ? 1 : -1, v = E.carSpeed[0] + (E.carSpeed[1] - E.carSpeed[0]) * (li % 2 ? 0.25 : 0.75) + rng() * 2;
    for (let s = rng() * E.carGap[1]; s < xp.length; s += E.carGap[0] + (E.carGap[1] - E.carGap[0]) * rng() ** 1.6) cars.push({ s0: s, v: v * (0.96 + 0.08 * rng()), lane, dir });
  }
  // ---- 電車 ----
  const Rl = T.rail, rp = paths.rail;
  const train = { s: rng() * rp.length, v: Rl.speed, cars: Array.from({ length: Rl.cars }, () => ({ state: 'run' })), spark: { next: 1, until: -1, car: 1 } };
  const WIN = 5; // 一両の片側の窓の数
  const nLamp = lampSpots.length, nCar = cars.length, nWin = Rl.cars * 2 * WIN, nCab = 4, nSpark = 1;
  const nLights = nLamp + nCar + nWin + nCab + nSpark;
  const lightGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const lCrush = new THREE.InstancedBufferAttribute(new Float32Array(nLights * 2), 2);
  const lTile = new THREE.InstancedBufferAttribute(new Float32Array(nLights * 4), 4);
  const lSign = new THREE.InstancedBufferAttribute(new Float32Array(nLights * 4), 4);
  lightGeo.setAttribute('aCrush', lCrush); lightGeo.setAttribute('aTile', lTile); lightGeo.setAttribute('aSign', lSign);
  const lights = new THREE.InstancedMesh(lightGeo, style.props.sign, nLights);
  lights.name = 'transit-lights';
  lights.frustumCulled = false;
  lights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const G = TRANSIT_LIGHT.gain;
  const setLight = (i, c, gain) => { lights.setColorAt(i, color.setRGB(...c)); lSign.setXYZW(i, 0, (i * 0.618) % 1, gain, 2); };
  lampSpots.forEach((l, i) => {
    _q.setFromAxisAngle(UP, l.ry);
    lights.setMatrixAt(i, _m.compose(_p.set(l.x, l.y, l.z), _q, _s.set(0.5, 0.22, 1.3)));
    setLight(i, TRANSIT_LIGHT.lamp, G.lamp);
    bySeg.get(l.seg).lights.push(i);
  });
  const C0 = nLamp, W0 = C0 + nCar, K0 = W0 + nWin, S0 = K0 + nCab;
  cars.forEach((c, k) => setLight(C0 + k, c.dir > 0 ? TRANSIT_LIGHT.head : TRANSIT_LIGHT.tail, c.dir > 0 ? G.head : G.tail));
  for (let i = 0; i < nWin; i++) setLight(W0 + i, TRANSIT_LIGHT.window, G.window * (0.8 + 0.4 * rng()));
  for (let i = 0; i < nCab; i++) setLight(K0 + i, i < 2 ? TRANSIT_LIGHT.head : TRANSIT_LIGHT.tail, G.cab);
  setLight(S0, TRANSIT_LIGHT.spark, G.spark);
  group.add(lights);

  // 電車の車体（一両に 車体・帯・屋根）
  const trainGeo = new THREE.BoxGeometry(1, 1, 1, 4, 1, 1).translate(0, 0.5, 0);
  trainGeo.setAttribute('aCrush', new THREE.InstancedBufferAttribute(new Float32Array(Rl.cars * 3 * 2), 2));
  const trainMesh = new THREE.InstancedMesh(trainGeo, style.props.clutter, Rl.cars * 3);
  trainMesh.name = 'train';
  trainMesh.frustumCulled = false;
  trainMesh.castShadow = style.shadows;
  trainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let k = 0; k < Rl.cars; k++) {
    trainMesh.setColorAt(k * 3, color.setRGB(...TRAIN.body, THREE.SRGBColorSpace));
    trainMesh.setColorAt(k * 3 + 1, color.setRGB(...TRAIN.stripe, THREE.SRGBColorSpace));
    trainMesh.setColorAt(k * 3 + 2, color.setRGB(...TRAIN.roof, THREE.SRGBColorSpace));
  }
  group.add(trainMesh);

  // ---- 状態 ----
  let time = 0;
  const broken = new Set(); // つぶれ始めた・隠れた区間（その上の車の光は消える。電車はそこで脱線する）
  const segAt = (path, line, s) => {
    // 長さ s の点がどの区間か（区間は s0〜s1。輪は回り込む）
    const L = path.length; s = path.closed ? ((s % L) + L) % L : s;
    const list = line === 'expressway' ? xSegs : rSegs;
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].s0 <= s) lo = m; else hi = m - 1; }
    return list[lo];
  };
  const xSegs = segments.filter((s) => s.line === 'expressway'), rSegs = segments.filter((s) => s.line === 'rail');
  const events = [];
  const vaporizeRatio = CONFIG.blast.vaporizeRatio;

  // 電車の一両の置き場所（前と後ろの台車の点の真ん中、その向き）
  const carPose = (k) => {
    const back = Rl.carLen + Rl.carGap;
    const sMid = train.s - k * back - Rl.carLen / 2;
    const a = pointAt(rp, sMid + Rl.carLen / 2 - 2), b = pointAt(rp, sMid - Rl.carLen / 2 + 2);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, heading: Math.atan2(a.z - b.z, a.x - b.x), s: sMid };
  };

  function writeTrain() {
    for (let k = 0; k < Rl.cars; k++) {
      const car = train.cars[k];
      if (car.state === 'run') {
        const p = carPose(k);
        car.x = p.x; car.y = Rl.deckY + TRAIN.lift; car.z = p.z; car.heading = p.heading;
        _q.setFromAxisAngle(UP, along(p.heading));
      } else if (car.state === 'derail') {
        _q.setFromEuler(_e.set(car.rx, along(car.heading), car.rz, 'YXZ'));
      }
      const show = car.state !== 'gone';
      const base = k * 3;
      if (!show) { for (let j = 0; j < 3; j++) trainMesh.setMatrixAt(base + j, ZERO); continue; }
      _p.set(car.x, car.y, car.z);
      trainMesh.setMatrixAt(base, _m.compose(_p, _q, _s.set(Rl.carLen, TRAIN.h, TRAIN.d)));
      const lift = (y) => _p.set(car.x, car.y, car.z).add(_s.set(0, y, 0).applyQuaternion(_q));
      trainMesh.setMatrixAt(base + 1, _m.compose(lift(1.05), _q, _s.set(Rl.carLen + 0.04, 0.34, TRAIN.d + 0.04)));
      trainMesh.setMatrixAt(base + 2, _m.compose(lift(TRAIN.h - 0.05), _q, _s.set(Rl.carLen - 0.6, 0.32, TRAIN.d - 0.5)));
    }
    trainMesh.instanceMatrix.needsUpdate = true;
  }

  function writeLights() {
    // 車
    for (let k = 0; k < nCar; k++) {
      const c = cars[k];
      let s = (c.s0 + c.dir * c.v * time) % xp.length; if (s < 0) s += xp.length;
      const seg = segAt(xp, 'expressway', s);
      if (broken.has(seg.id)) { lights.setMatrixAt(C0 + k, ZERO); continue; }
      const p = pointAt(xp, s);
      const ox = -Math.sin(p.heading) * c.lane, oz = Math.cos(p.heading) * c.lane;
      _q.setFromAxisAngle(UP, along(p.heading));
      lights.setMatrixAt(C0 + k, _m.compose(_p.set(p.x + ox, E.deckY + 0.55, p.z + oz), _q, _s.set(3.4, 0.26, 1.0)));
    }
    // 電車の窓・前照灯・尾灯・火花
    for (let k = 0; k < Rl.cars; k++) {
      const car = train.cars[k];
      const base = W0 + k * 2 * WIN;
      if (car.state !== 'run') { // 脱線した車両は明かりが消える
        for (let i = 0; i < 2 * WIN; i++) lights.setMatrixAt(base + i, ZERO);
        continue;
      }
      _q.setFromAxisAngle(UP, along(car.heading));
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < WIN; i++) {
          const u = (i + 0.5) / WIN - 0.5;
          _p.set(u * (Rl.carLen - 3), 1.55, (side ? 1 : -1) * (TRAIN.d / 2 + 0.02)).applyQuaternion(_q).add(_s.set(car.x, car.y, car.z));
          lights.setMatrixAt(base + side * WIN + i, _m.compose(_p, _q, _s.set(2.5, 1.05, 0.06)));
        }
      }
    }
    const cab = (i, k, end) => {
      const car = train.cars[k];
      if (car.state !== 'run') { lights.setMatrixAt(K0 + i, ZERO); return; }
      _q.setFromAxisAngle(UP, along(car.heading));
      const side = i % 2 ? 0.85 : -0.85;
      _p.set(end * (Rl.carLen / 2 + 0.03), 0.9, side).applyQuaternion(_q).add(_s.set(car.x, car.y, car.z));
      lights.setMatrixAt(K0 + i, _m.compose(_p, _q, _s.set(0.08, 0.32, 0.5)));
    };
    cab(0, 0, 1); cab(1, 0, 1); cab(2, Rl.cars - 1, -1); cab(3, Rl.cars - 1, -1);
    // パンタグラフの火花: ときどき一瞬、どれかの車両の屋根の上で青白く光る
    const sp = train.spark, sc = train.cars[sp.car];
    if (time < sp.until && sc?.state === 'run') {
      _q.setFromAxisAngle(UP, along(sc.heading));
      const fl = 0.6 + 0.8 * Math.abs(Math.sin(time * 173));
      _p.set(Rl.carLen * 0.25, TRAIN.h + 0.3, 0).applyQuaternion(_q).add(_s.set(sc.x, sc.y, sc.z));
      lights.setMatrixAt(S0, _m.compose(_p, _q, _s.set(0.9 * fl, 0.9 * fl, 0.9 * fl)));
    } else lights.setMatrixAt(S0, ZERO);
    lights.instanceMatrix.clearUpdateRanges();
    lights.instanceMatrix.needsUpdate = true; // 動く光は毎フレーム全部送る（数百個）
  }

  // 一両を脱線させる（外へ吹き飛ぶ）か溶かす
  function derail(k, front, radius) {
    const car = train.cars[k];
    const dist = Math.hypot(car.x, car.z);
    const target = { id: 't' + k, x: car.x, z: car.z, y: car.y, w: Rl.carLen, d: TRAIN.d, h: car.y + TRAIN.h, dist, heading: car.heading, color: TRAIN.body };
    if (front > 0 && radius > 0 && dist < radius * vaporizeRatio) {
      car.state = 'gone';
      events.push({ kind: 'vaporize', target });
      return;
    }
    const r = (a) => a[0] + (a[1] - a[0]) * rng();
    const ox = car.x / Math.max(1, dist), oz = car.z / Math.max(1, dist), out = r(DERAIL.out);
    Object.assign(car, { state: 'derail', vx: ox * out + (rng() - 0.5) * 8, vy: r(DERAIL.up), vz: oz * out + (rng() - 0.5) * 8,
      rx: 0, rz: 0, wx: (rng() < 0.5 ? -1 : 1) * r(DERAIL.spin), wz: (rng() < 0.5 ? -1 : 1) * r(DERAIL.spin), wy: (rng() - 0.5) * 2, life: 0 });
    events.push({ kind: 'derail', target });
  }

  writeTrain();
  writeLights();

  const api = {
    group, struct, structShort, lights, trainMesh,
    // テスト・調査用
    get time() { return time; },
    get train() { return train; },
    // 区間の部品: struct は [{ mesh, index }]（長い箱・短い箱の 2 つの InstancedMesh）、lights は光の番号
    segmentParts(id) { const e = bySeg.get(id); return e ? { struct: e.struct.map(({ mesh, index }) => ({ mesh, index })), lights: [...e.lights] } : null; },
    isBroken(id) { return broken.has(id); },
    // 区間をつぶす（ビルと同じ: 球の線に沿って delay 秒でつぶれる）。照明も一緒に消えていく。その上の車の光はすぐ消える
    crush(id, at, delay) {
      const e = bySeg.get(id);
      if (!e) return;
      for (const { index: i, crush: c } of e.struct) { c.setXY(i, at, delay); mark(c, i * 2, 2); }
      for (const i of e.lights) { lCrush.setXY(i, at, delay); mark(lCrush, i * 2, 2); }
      broken.add(id);
    },
    hide(id) {
      const e = bySeg.get(id);
      if (!e) return;
      for (const { mesh, index: i } of e.struct) { mesh.setMatrixAt(i, ZERO); mark(mesh.instanceMatrix, i * 16, 16); }
      for (const i of e.lights) lights.setMatrixAt(i, ZERO); // 照明（動く光と同じ値。毎フレーム全部送る）
      e.lightsHidden = true;
      broken.add(id);
    },
    // dt 秒進める。front / radius: 今の最後の一発の前線と半径（なければ 0）。起きたこと（脱線・溶ける・落ちた）を返す
    update(dt, { front = 0, radius = 0 } = {}) {
      events.length = 0;
      time += dt;
      // 電車を進め、こわれた区間に入った・前線に触れた車両を脱線させる
      const running = train.cars.some((c) => c.state === 'run');
      if (running) train.s += train.v * dt;
      for (let k = 0; k < Rl.cars; k++) {
        const car = train.cars[k];
        if (car.state === 'run') {
          const p = carPose(k);
          car.x = p.x; car.z = p.z; car.heading = p.heading; car.y = Rl.deckY + TRAIN.lift;
          const hitByFront = front > 0 && Math.hypot(p.x, p.z) <= front;
          if (hitByFront || broken.has(segAt(rp, 'rail', p.s).id)) derail(k, front, radius);
        } else if (car.state === 'derail' && dt > 0) {
          car.vy -= DERAIL.gravity * dt;
          car.x += car.vx * dt; car.y += car.vy * dt; car.z += car.vz * dt;
          car.rx += car.wx * dt; car.rz += car.wz * dt; car.heading += car.wy * dt;
          car.life += dt;
          if (car.y <= 0.5 || car.life >= DERAIL.life) {
            car.state = 'gone';
            const dist = Math.hypot(car.x, car.z);
            events.push({ kind: 'land', target: { id: 't' + k, x: car.x, z: car.z, y: Math.max(0, car.y), w: Rl.carLen, d: TRAIN.d, h: Math.max(0, car.y) + TRAIN.h, dist, heading: car.heading, color: TRAIN.body } });
          }
        }
      }
      // 火花の間合い
      const sp = train.spark;
      if (time >= sp.next) {
        sp.until = time + SPARK.dur;
        sp.next = time + SPARK.every[0] + (SPARK.every[1] - SPARK.every[0]) * rng();
        sp.car = 1 + 2 * Math.floor(rng() * Math.floor((Rl.cars - 1) / 2));
      }
      writeTrain();
      // 隠した区間の照明は毎フレーム消しておく（光の行列は毎フレーム全部送るので）
      for (const id of broken) { const e = bySeg.get(id); if (e.lightsHidden) for (const i of e.lights) lights.setMatrixAt(i, ZERO); }
      writeLights();
      return events;
    },
    // 音のための近くの音源（今のカメラの位置から）: 走っている一番近い車両と、こわれていない高速の一番近い点
    sources(cam) {
      let tr = null, td = Infinity;
      for (const c of train.cars) {
        if (c.state !== 'run') continue;
        const d = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z);
        if (d < td) { td = d; tr = { x: c.x, y: c.y, z: c.z, dist: d, speed: train.v }; }
      }
      let hw = null, hd = Infinity;
      for (const s of xSegs) {
        if (broken.has(s.id)) continue;
        const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz || 1;
        const u = Math.min(1, Math.max(0, ((cam.x - s.a[0]) * dx + (cam.z - s.a[1]) * dz) / L2));
        const x = s.a[0] + dx * u, z = s.a[1] + dz * u, d = Math.hypot(x - cam.x, E.deckY - cam.y, z - cam.z);
        if (d < hd) { hd = d; hw = { x, y: E.deckY, z, dist: d }; }
      }
      return { train: tr, highway: hw };
    },
    // リプレイ: 放つ直前の時刻と電車の姿を写す・戻す（骨組みのつぶれ・隠しは cityView の snapshot が写す）
    state() { return { time, s: train.s, spark: { ...train.spark } }; },
    setState(st) {
      time = st.time; train.s = st.s; Object.assign(train.spark, st.spark);
      for (const c of train.cars) { for (const k of Object.keys(c)) delete c[k]; c.state = 'run'; }
      broken.clear();
      for (const e of bySeg.values()) e.lightsHidden = false;
      lampSpots.forEach((l, i) => {
        _q.setFromAxisAngle(UP, l.ry);
        lights.setMatrixAt(i, _m.compose(_p.set(l.x, l.y, l.z), _q, _s.set(0.5, 0.22, 1.3)));
      });
      events.length = 0;
      writeTrain();
      writeLights();
    },
  };
  return api;
}
