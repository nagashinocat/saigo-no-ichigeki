import { createRng } from '../rng.js';
import { CONFIG } from '../config.js';
import { transitCorridors, buildTransit, pathDist } from './transit.js';

const BLOCK = 18;            // 区画の一辺 m
const ROAD = 8;              // 道路幅 m
const PITCH = BLOCK + ROAD;  // 格子の間隔 m
// 描画（道路の格子）が同じ寸法を使えるように公開する
export const GRID = { BLOCK, ROAD, PITCH };

// 高さの山の裾 m（fix1: S7 の街と同じ 420 m。広場のまわりの高さを S7 と同じにし、外の地区は低く安く）
const HEIGHT_R = 420;
const CORE_N = 18;           // 芯の区画の範囲（±区画。S7 までの半径 420 m の街の格子）
const EMPTY_R = 420;         // 空き地の割合が外へ向けて増えきる距離 m
const FOOTPRINT = [8, 17];   // 建物の幅・奥行き m（区画内に収まる）
const CENTER_MAX_H = 150;    // 中心付近の最大の高さ m
const EDGE_H = [6, 15];      // 街の端の高さ m
const TOWER_H = 60;          // これ以上は tower
const OFFICE_H = 20;         // これ以上は office、未満は house
const NEAR_DIST = 110;       // 中心からこの距離未満は低くする（上空から広場と軍勢が見えるように）
const NEAR_MAX_H = 28;       // その範囲の最大の高さ m
// 広場のまわりは、近いほど低い上限（広場に面する最初の一周は 5〜6 階建てほど）。上空カメラが近くても手前の建物が
// 広場を隠さず、広場から外へ街がせり上がって見える。上限 = NEAR_BASE_H + NEAR_SLOPE × 中心からの距離（NEAR_MAX_H まで）
const NEAR_BASE_H = 6;
const NEAR_SLOPE = 0.4;
const NEAR_VARY = 0.45;      // 近くの建物は上限の (1 - NEAR_VARY)〜1 倍にばらつく（同じ高さが並ばない）

// 体積(m³)あたりの金額（円）
const RATE = { house: 20000, office: 60000, tower: 120000 };
// props の金額（円）
const PROP_VALUE = { car: 3000000, lamp: 500000, sign: 300000 };

const kindOf = (h) => (h >= TOWER_H ? 'tower' : h >= OFFICE_H ? 'office' : 'house');

// S7（持ち主 2026-11-21 13:13 / 13:16「九龍城みたいな中国寄りと日本のネオン街が混ざった雰囲気」）: ビルの形の種類。
// 区画ごとに別の乱数で選ぶ（足元を決める乱数の引き方は前のまま。広場の近くの足元と、軍勢の見通し・釣り合いは変わらない）。
//  shop: 2〜4 階の低い商店の並び（高さの違う 2〜4 軒）、slab: 横長の中層、slim: 細い高層、stepped: 段々に細くなる塔（2〜3 段）、
//  slanted: 斜めの屋根・角を落とした屋根の塔、landmark: 空の輪郭を決める目印の超高層（街に 2〜4 本）
export const ARCHETYPES = ['shop', 'slab', 'slim', 'stepped', 'slanted', 'landmark'];
const ARCH_WEIGHTS = {
  near: { shop: 0.34, slab: 0.22, slim: 0.16, stepped: 0.14, slanted: 0.14 },
  far: { shop: 0.24, slab: 0.17, slim: 0.22, stepped: 0.2, slanted: 0.17 },
};
const FLOOR = 3.3;          // 商店の階の高さ m
const RESHAPE_DIST = 60;
const FILL_DIST = 70, FILL_P = 0.65; // あいた区画を埋める（中心からの区画の距離 m、割合）    // これより外の区画だけ足元の広さを変える（広場の近くの見通しは前のまま）
// S8: 目印の超高層は街の広さに合わせて（dist は R に対する割合。広い街では本数も少し増やす）
const LANDMARK = { count: [3, 5], dist: [0.22, 0.6], h: [205, 265], spacing: 0.8 };
// 屋根の形（cityView の aShape.x）: 0 平ら、1〜4 片流れ（+x, -x, +z, -z へ下がる）、5 四方へ下がる（角を落とした・とがった頂）
export const SHAPE = { flat: 0, shedPX: 1, shedNX: 2, shedPZ: 3, shedNZ: 4, hip: 5 };

function pickArch(r, weights) {
  let acc = 0;
  for (const [k, w] of Object.entries(weights)) { acc += w; if (r < acc) return k; }
  return 'slab';
}

// 部品（建物の中心からの x, z、地面からの y、w, d, h、屋根の形 shape [種類, 下がる割合]、色のばらつき tone 0〜1）
const part = (x, z, w, d, y, h, tone = 0.5, shape = [0, 0]) => ({ x, z, w, d, y, h, tone, shape });

function shapeBuilding(b, arch, r) {
  const { w, d, h } = b;
  switch (arch) {
    case 'shop': {
      // 長い辺に沿って 2〜4 軒。高さ・奥行き・色がそれぞれ違う
      const n = 2 + Math.floor(r[2] * 3), alongX = w >= d, L = alongX ? w : d, D = alongX ? d : w;
      const parts = [];
      let top = 0;
      for (let i = 0; i < n; i++) {
        const s = L / n, c = -L / 2 + s * (i + 0.5);
        const floors = 2 + Math.floor(r[3 + i] * 3);
        const ph = Math.min(h, floors * FLOOR + 0.8 + r[7 + i] * 0.6);
        const dd = D * (0.75 + 0.25 * r[4 + i]), off = (D - dd) / 2 * (r[5 + i] < 0.5 ? -1 : 1);
        parts.push(alongX ? part(c, off, s, dd, 0, ph, r[6 + i]) : part(off, c, dd, s, 0, ph, r[6 + i]));
        top = Math.max(top, ph);
      }
      return { h: top, parts };
    }
    case 'slab': {
      const parts = [part(0, 0, w, d, 0, h, r[3])];
      if (r[4] < 0.5 && h > 12) {
        // 屋上の塔屋（増築の部屋）
        const pw = w * (0.25 + 0.2 * r[5]), pd = d * (0.3 + 0.2 * r[6]);
        parts.push(part((r[7] - 0.5) * (w - pw), (r[8] - 0.5) * (d - pd), pw, pd, h, 3.2, r[9]));
        return { h: h + 3.2, parts };
      }
      return { h, parts };
    }
    case 'slim': {
      if (r[3] < 0.35 && h > 30) {
        const hc = Math.min(12, h * 0.12);
        return { h, parts: [part(0, 0, w, d, 0, h - hc, r[4]), part(0, 0, w, d, h - hc, hc, r[4], [1 + Math.floor(r[5] * 4), 0.7])] };
      }
      return { h, parts: [part(0, 0, w, d, 0, h, r[4])] };
    }
    case 'stepped':
    case 'landmark': {
      const tiers = arch === 'landmark' ? 3 : 2 + (r[3] < 0.5 ? 1 : 0);
      const parts = [];
      let y = 0, pw = w, pd = d, px = 0, pz = 0;
      for (let i = 0; i < tiers; i++) {
        const frac = tiers === 2 ? [0.5 + 0.15 * r[4], 1][i] : [0.38 + 0.12 * r[4], 0.7 + 0.1 * r[5], 1][i];
        const top = h * frac;
        const last = i === tiers - 1;
        const crown = last && (arch === 'landmark' || r[6] < 0.4);
        if (crown) {
          const hc = Math.min(arch === 'landmark' ? 26 : 10, (top - y) * 0.35);
          parts.push(part(px, pz, pw, pd, y, top - hc - y, r[7]));
          parts.push(part(px, pz, pw, pd, top - hc, hc, r[7], arch === 'landmark' || r[8] < 0.5 ? [SHAPE.hip, 0.85] : [1 + Math.floor(r[9] * 4), 0.75]));
        } else parts.push(part(px, pz, pw, pd, y, top - y, r[7]));
        y = top;
        // 次の段は細く、少し片側へ寄せる（建物の箱の内）
        const k = 0.62 + 0.14 * r[10 + i];
        const nw = pw * k, nd = pd * k;
        px = Math.max(-(w - nw) / 2, Math.min((w - nw) / 2, px + (r[13 + i] - 0.5) * (pw - nw)));
        pz = Math.max(-(d - nd) / 2, Math.min((d - nd) / 2, pz + (r[14 + i] - 0.5) * (pd - nd)));
        pw = nw; pd = nd;
      }
      return { h, parts };
    }
    case 'slanted': {
      const hc = Math.min(16, Math.max(5, h * 0.18));
      const hip = r[3] < 0.4;
      return { h, parts: [part(0, 0, w, d, 0, h - hc, r[4]), part(0, 0, w, d, h - hc, hc, r[4], hip ? [SHAPE.hip, 0.6 + 0.3 * r[5]] : [1 + Math.floor(r[6] * 4), 0.8])] };
    }
    default:
      return { h, parts: [part(0, 0, w, d, 0, h, r[3])] };
  }
}

// 形の種類ごとの高さ（足元の高さの式で決めた h0 から）。広場の近くの上限（上空から広場と軍勢が見えるように）はあとでかける
function archHeight(arch, h0, r) {
  switch (arch) {
    case 'shop': return 2 * FLOOR + 1.5 + r[1] * 3 * FLOOR;
    case 'slab': return Math.min(46, Math.max(14, h0 * (0.55 + 0.3 * r[1])));
    case 'slim': return Math.min(150, Math.max(30, h0 * (1.5 + 1.0 * r[1])));
    case 'stepped': return Math.min(145, Math.max(34, h0 * (1.3 + 0.8 * r[1])));
    case 'slanted': return Math.min(140, Math.max(26, h0 * (1.1 + 0.6 * r[1])));
    default: return h0;
  }
}

// 区画内で足元を広げる・細くする（RESHAPE_DIST より外だけ）。区画（BLOCK）の内に収める
function reshapeFootprint(arch, cx, cz, x, z, w, d, r, block) {
  let nw = w, nd = d;
  if (arch === 'slab') { nw = Math.max(w, block * (0.8 + 0.12 * r[1])); nd = Math.max(d, block * (0.55 + 0.3 * r[2])); if (r[0] < 0.5) [nw, nd] = [nd, nw]; }
  else if (arch === 'shop') { nw = Math.max(w, block * 0.85); nd = Math.max(d, block * 0.6); if (r[0] < 0.5) [nw, nd] = [nd, nw]; }
  else if (arch === 'slim') { nw = Math.max(8, w * (0.6 + 0.2 * r[2])); nd = Math.max(8, d * (0.6 + 0.2 * r[1])); }
  else { nw = Math.max(w, block * (0.7 + 0.22 * r[1])); nd = Math.max(d, block * (0.7 + 0.22 * r[2])); } // 詰まった街: 区画いっぱい近くまで
  nw = Math.min(nw, block - 1); nd = Math.min(nd, block - 1);
  const fx = Math.max(-(block - nw) / 2, Math.min((block - nw) / 2, x - cx));
  const fz = Math.max(-(block - nd) / 2, Math.min((block - nd) / 2, z - cz));
  return { x: cx + fx, z: cz + fz, w: nw, d: nd };
}

// opts（S7）: radius 街の半径（既定は cfg.cityRadius）、variety 形の種類をつけるか（false で S6 までの箱だけの街）、
// corridors 通り道の予約 [{ axis: 'x' | 'z', at: m, half: m }]（その帯にかかる区画には建物を置かない。後の高架・線路のため）、
// landmarks 目印の超高層の本数の範囲 [min, max]、
// transit（S8）高架の高速道路と環状線（world/transit.js）を通すか（既定 true。その道筋の帯は corridors に足す）。
// S8: 芯（S7 までの街の範囲 ±CORE_N 区画）は前と同じ一本の乱数を同じ順に引き、その外は区画ごとの乱数（種と区画の番号から）。
// 街を広げても広場のまわりの足元は前のまま（見通しと釣り合いを変えない）。
// corridors の帯: { axis: 'x' | 'z', at, half }（その帯にかかる区画には建物を置かない）、
//   または { path（transit.js の makePath）, half }（足元が道筋から half m の内にかかる建物を置かない）
export function generateCity(seed, cfg = CONFIG, opts = {}) {
  const { radius = cfg.cityRadius, variety = true, landmarks = LANDMARK.count, transit = true } = opts;
  const R = radius;
  const corridors = [...(opts.corridors ?? []), ...(transit ? transitCorridors(R) : [])];
  const lotRng = (i, j, salt) => createRng(lotSeed(seed, i, j, salt));
  const coreRng = createRng(seed), coreArng = createRng((seed ^ 0x51ab7) >>> 0);
  let legacyCount = 0;
  const n = Math.ceil(R / PITCH) + 1;
  const buildings = [];
  const props = [];
  const axisC = corridors.filter((c) => c.axis), pathC = corridors.filter((c) => c.path);
  const blocked = (cx, cz) => axisC.some((c) => Math.abs((c.axis === 'z' ? cx : cz) - c.at) < c.half + BLOCK / 2);
  // 足元（x, z, w, d）が道筋の帯にかかるか（足元の四角の外接円で見る）
  const onPath = (x, z, w, d) => pathC.some((c) => pathDist(c.path, x, z) < c.half + Math.hypot(w, d) / 2);
  const inCorridor = (x, z, pad = 0) => axisC.some((c) => Math.abs((c.axis === 'z' ? x : z) - c.at) < c.half + pad) || pathC.some((c) => pathDist(c.path, x, z) < c.half + pad);

  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const cx = i * PITCH, cz = j * PITCH;
      // 芯の区画（S7 までの街の範囲）は前と同じ一本の乱数を同じ順に引く（広場のまわりの足元・見通し・釣り合いを前のまま）。
      // その外は区画ごとの乱数
      const core = Math.abs(i) <= CORE_N && Math.abs(j) <= CORE_N;
      if (!core && Math.hypot(cx, cz) > R + PITCH) continue; // 街の外の区画（何も置かない）
      const rng = core ? coreRng : lotRng(i, j, 1);
      const arng = core ? coreArng : lotRng(i, j, 2); // 形の種類（足元の乱数の引き方を変えない）
      // 空き地の割合は中心からの距離 m で決める（街の広さによらない。広場のまわりの空き地は前のまま）
      const t0 = Math.min(1, Math.hypot(cx, cz) / EMPTY_R);
      // 乱数の消費順を固定するため、先に全部引く
      const skip = rng(), w = FOOTPRINT[0] + (FOOTPRINT[1] - FOOTPRINT[0]) * rng();
      const d = FOOTPRINT[0] + (FOOTPRINT[1] - FOOTPRINT[0]) * rng();
      const ox = (rng() - 0.5) * (BLOCK - w), oz = (rng() - 0.5) * (BLOCK - d);
      const noise = 0.55 + 0.45 * rng(), edge = EDGE_H[0] + (EDGE_H[1] - EDGE_H[0]) * rng();
      const propRoll = rng(), propKind = rng(), propPos = rng(), propSide = rng(), propAcross = rng();
      const ar = Array.from({ length: 20 }, arng); // 形の種類の乱数（区画ごとに同じ数だけ引く）

      const x = cx + ox, z = cz + oz;
      const dist = Math.hypot(x, z);
      // 詰まった街（S7）: 広場から FILL_DIST より外であいていた区画の多くに、低い商店の並びを建てる（広場の近くの見通しは前のまま）
      const empty = skip >= 0.85 - 0.25 * t0;
      const fill = variety && empty && ar[16] < FILL_P && Math.hypot(cx, cz) >= FILL_DIST;
      if ((empty && !fill) || dist > R || dist <= cfg.plazaRadius + Math.max(w, d) / 2 || blocked(cx, cz)) {
        // 建物なし
      } else {
        // 高さの山は中心から HEIGHT_R m で裾まで下がる（広い街の外の地区は低く、遠くまで見通せる）
        const t = Math.min(1, dist / HEIGHT_R);
        let h = Math.max(EDGE_H[0], edge + (CENTER_MAX_H - edge) * (1 - t) ** 2 * noise);
        const near = dist < NEAR_DIST;
        const arch = fill ? (ar[0] < 0.7 ? 'shop' : 'slab') : variety ? pickArch(ar[0], near ? ARCH_WEIGHTS.near : ARCH_WEIGHTS.far) : 'box';
        if (variety) h = archHeight(arch, h, ar);
        let cap = Infinity;
        if (near) {
          cap = Math.min(NEAR_MAX_H, NEAR_BASE_H + NEAR_SLOPE * dist);
          const vary = (noise - 0.55) / 0.45; // 0〜1
          cap *= 1 - NEAR_VARY * (1 - vary);
          h = Math.max(EDGE_H[0] * (arch === 'shop' ? 0.9 : 1), Math.min(h, cap));
        }
        let fp = { x, z, w, d };
        if (variety && dist >= RESHAPE_DIST) {
          const re = reshapeFootprint(arch, cx, cz, x, z, w, d, [ar[17], ar[18], ar[19]], BLOCK);
          if (Math.hypot(re.x, re.z) <= R) fp = re;
        }
        // S7 の街（半径 420 m、通り道なし）での番号。飾りの乱数に使う（広場のまわりの看板・飾りを S7 と同じに）
        const legacyId = core && dist <= HEIGHT_R ? legacyCount++ : null;
        if (!onPath(fp.x, fp.z, fp.w, fp.d)) {
        const b = { id: buildings.length, legacyId, x: fp.x, z: fp.z, w: fp.w, d: fp.d, h, dist: Math.hypot(fp.x, fp.z), arch, kind: 'house', value: 0 };
        const shaped = variety ? shapeBuilding(b, arch, ar) : { h, parts: [part(0, 0, b.w, b.d, 0, h, ar[3])] };
        // 部品（塔屋など）で上限を超えたら全体を縮める
        const k = shaped.h > cap ? cap / shaped.h : 1;
        if (k < 1) for (const p of shaped.parts) { p.y *= k; p.h *= k; }
        b.h = shaped.h * k;
        b.parts = shaped.parts;
        b._r = ar;
        buildings.push(b);
        }
      }

      // 道路沿いの props。区画の東側か北側の道路に置く（交差点は避ける）
      if (propRoll < 0.45) {
        const along = (propPos - 0.5) * BLOCK, across = BLOCK / 2 + ROAD / 2 + (propAcross - 0.5) * (ROAD - 2);
        const px = propSide < 0.5 ? cx + across : cx + along;
        const pz = propSide < 0.5 ? cz + along : cz + across;
        const pd = Math.hypot(px, pz);
        // 高架の通り道（橋脚が立つ帯）には置かない
        if (pd > cfg.plazaRadius && pd <= R && !inCorridor(px, pz, 2)) {
          const kind = propKind < 0.5 ? 'car' : propKind < 0.8 ? 'lamp' : 'sign';
          props.push({ id: props.length, x: px, z: pz, dist: pd, value: PROP_VALUE[kind], kind });
        }
      }
    }
  }
  if (variety) placeLandmarks(buildings, createRng((seed ^ 0x1a2d) >>> 0), landmarks, R);
  for (const b of buildings) {
    delete b._r;
    b.kind = kindOf(b.h);
    b.value = b.w * b.h * b.d * RATE[b.kind];
  }
  const city = { seed, radius: R, buildings, props };
  if (transit) city.transit = buildTransit(R);
  return city;
}

// 区画 (i, j) の乱数の種（種・区画の番号・用途から。混ぜ方は murmur3 の仕上げ）
function lotSeed(seed, i, j, salt) {
  let h = (seed ^ Math.imul(i + 0x9e37, 0x85ebca6b) ^ Math.imul(j + 0x7f4a, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// 目印の超高層: 街の中ほどの帯から、向きが離れた 2〜4 区画を選んで、段々の超高層にする。
// 上空カメラ（+z の上から -z を見下ろす）の画面の上の方（奥）に来るものを選びやすくする
function placeLandmarks(buildings, rng, [lo, hi], R) {
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const d0 = LANDMARK.dist[0] * R, d1 = LANDMARK.dist[1] * R;
  const cand = buildings.filter((b) => b.dist >= d0 && b.dist <= d1 && b.w >= 10 && b.d >= 10)
    .map((b) => ({ b, s: rng() + 0.8 * Math.max(0, -b.z / b.dist) }))
    .sort((a, b) => b.s - a.s);
  const chosen = [];
  for (const { b } of cand) {
    if (chosen.length >= count) break;
    const a = Math.atan2(b.z, b.x);
    if (chosen.some((c) => Math.abs(Math.atan2(Math.sin(a - c.a), Math.cos(a - c.a))) < LANDMARK.spacing)) continue;
    chosen.push({ b, a });
  }
  for (const { b } of chosen) {
    const h = LANDMARK.h[0] + (LANDMARK.h[1] - LANDMARK.h[0]) * rng();
    b.arch = 'landmark';
    b.h = h;
    b.parts = shapeBuilding(b, 'landmark', b._r).parts;
  }
}
