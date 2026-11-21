import { GRID } from './cityGen.js';

// S8（持ち主 2026-11-21 13:16「高速とか、電車とかも走ってた方がいいよね」）: 高架の高速道路と、高架の環状線（電車がぐるぐる回る）。
// 描画は知らない純粋な関数だけ（描くのは render/transitView.js）。
//  - 道筋（path）は街の半径 R に合わせて決める。広場から離し（上空の画面の通りをふさがない）、街を横切る・街を一周する
//  - 道筋のまわりの帯（half m）は建物を置かない通り道（cityGen の corridors）
//  - 橋脚は道筋に沿って等間隔。道路（軍勢が飛ぶ道）の上に来たら、少しずらして区画の上へ逃がす
//  - 橋桁は橋脚から橋脚までの一区間ずつ（爆発の前線がその区間で一番近い点に届いたら、ビルと同じようにつぶれる・溶ける）
// 区間の id は 'x' + 番号（高速）、'r' + 番号（線路）。ゲームの命中の表（game.js）に入る

export const TRANSIT = {
  expressway: {
    // 制御点（R に対する割合）。上空カメラ（+z の上から -z を見る）の画面の上端より奥を、街を東西に横切る
    // 中ほどは区画の列の真ん中（z = -156 m、道路の間）を通る（橋脚が道路に立たない）
    ctrl: [[-1.18, -0.06], [-0.62, -0.2294], [-0.2, -0.2294], [0.2, -0.2294], [0.62, -0.268], [1.18, -0.52]],
    deckY: 17,        // 路面の高さ m
    width: 15,        // 橋桁の幅 m（片側 2 車線）
    thick: 1.9,       // 橋桁の厚み m
    span: 32,         // 橋脚の間隔 m
    half: 12,         // 建物を置かない帯の半分の幅 m
    lanes: [2.0, 5.4],// 車線の中心線からの距離 m（+ の側が進む向き、- の側が戻る向き）
    carGap: [11, 34], // 同じ車線の車の間隔 m
    carSpeed: [24, 31],
    endPad: 15,       // 街の端からこの距離の内で終える
  },
  rail: {
    ring: 0.5,        // 環状線の半径（R に対する割合）
    deckY: 10,
    width: 8,
    thick: 1.4,
    span: 26,
    half: 8,
    cars: 7, carLen: 19, carGap: 1.2, speed: 21, // 電車: 7 両、一両 19 m、速さ m/s
  },
  plazaKeep: 120,      // 道筋はこの距離より広場に近づけない（上空の画面の通りをふさがない）
};

// ---- 折れ線の道 ----
// pts: [[x, z], ...]、closed: 輪。cum: 始まりからの長さ
export function makePath(pts, closed = false) {
  const p = closed ? [...pts, pts[0]] : pts;
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return { pts: p, cum, length: cum[cum.length - 1], closed };
}

// 長さ s の点と向き（輪なら s は回り込む。開いた道は両端で止まる）。heading: x 軸から z 軸への角
export function pointAt(path, s) {
  const L = path.length;
  s = path.closed ? ((s % L) + L) % L : Math.min(L, Math.max(0, s));
  const { pts, cum } = path;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], seg = cum[hi] - cum[lo] || 1, u = (s - cum[lo]) / seg;
  return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, heading: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

// 点から線分までの距離
export function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  const u = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
  return Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u);
}
// 点から折れ線までの距離
export function pathDist(path, x, z) {
  let d = Infinity;
  for (let i = 1; i < path.pts.length; i++) d = Math.min(d, segDist(x, z, path.pts[i - 1], path.pts[i]));
  return d;
}

// Catmull-Rom で制御点をなめらかにつなぎ、step m ほどの間隔の折れ線にする
function smooth(ctrl, step) {
  const out = [];
  for (let i = 0; i + 1 < ctrl.length; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

// 街の半径 R の高速と環状線の道筋
export function transitPaths(R, T = TRANSIT) {
  // 高速は街の内（端から endPad m 手前）で終える（最大の一発が全部を飲み、街の外に残らない）
  const pts = smooth(T.expressway.ctrl.map(([x, z]) => [x * R, z * R]), 6).filter(([x, z]) => Math.hypot(x, z) <= R - T.expressway.endPad);
  const expressway = makePath(pts);
  const rr = T.rail.ring * R, n = Math.max(48, Math.round((2 * Math.PI * rr) / 8));
  const ring = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ring.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  const rail = makePath(ring, true);
  return { expressway, rail };
}

// cityGen の通り道（建物を置かない帯）
export function transitCorridors(R, T = TRANSIT) {
  const { expressway, rail } = transitPaths(R, T);
  return [{ path: expressway, half: T.expressway.half }, { path: rail, half: T.rail.half }];
}

// 道路の中心線の上（軍勢が飛ぶ道）なら true
const onRoad = (x, z, pad) => {
  const off = (v) => Math.abs(v - (Math.round(v / GRID.PITCH - 0.5) + 0.5) * GRID.PITCH);
  return off(x) < GRID.ROAD / 2 + pad || off(z) < GRID.ROAD / 2 + pad;
};

// 橋脚の置き場所（道筋の長さ s）: 前の橋脚から span m ほど先。道路の上なら span の 0.6〜1.4 倍の内で、区画の上の
// 一番近い点へずらす（なければ道路の上のまま）。輪は最後の間が短くなりすぎないように終える
function pillarStations(path, span) {
  const out = [0];
  const free = (s) => { const p = pointAt(path, s); return !onRoad(p.x, p.z, 1.2); };
  for (let k = 0; k < 2; k++) { if (free(out[0])) break; out[0] += span * 0.2; }
  const end = path.closed ? out[0] + path.length : path.length;
  for (;;) {
    const prev = out[out.length - 1], want = prev + span;
    if (want > end - span * 0.6) break;
    let pick = want;
    for (let d = 0; d <= span * 0.4; d += 1) {
      if (want + d <= end - span * 0.6 && free(want + d)) { pick = want + d; break; }
      if (free(want - d)) { pick = want - d; break; }
    }
    out.push(pick);
  }
  if (!path.closed) out.push(path.length);
  return out;
}

// 車線（軍勢が飛ぶ所）: 道路の中心線から LANE_HALF m の内。橋脚の柱はその外に立てる（歩道・区画の上）
export const LANE_HALF = 3.5; // = GRID.ROAD / 2 - 0.5（cityGen と互いに読み込むので数で書く。テストで確かめる）
// 柱の足元（一辺 w）が車線にかかるか
export const legOnLane = (x, z, w) => {
  const off = (v) => Math.abs(v - (Math.round(v / GRID.PITCH - 0.5) + 0.5) * GRID.PITCH);
  return off(x) < LANE_HALF + w / 2 || off(z) < LANE_HALF + w / 2;
};
// 橋脚の柱の置き場所（道筋の点 p、向き heading）: 車線の外の、橋桁の下の一番近い所に 1 本。
// なければ道路をまたぐ門形（2 本の柱を道の両側に立てて梁で結ぶ）
function legsFor(p, heading, width, w) {
  const ax = Math.cos(heading), az = Math.sin(heading), px = -az, pz = ax;
  const side = width / 2 - w / 2 - 0.3;
  let best = null;
  for (let a = -8; a <= 8; a += 1) for (let k = -side; k <= side + 1e-9; k += 0.5) {
    const x = p.x + ax * a + px * k, z = p.z + az * a + pz * k;
    if (legOnLane(x, z, w)) continue;
    const c = Math.abs(a) * 0.6 + Math.abs(k);
    if (!best || c < best.c) best = { c, legs: [[x, z]] };
  }
  if (best) return best.legs;
  for (let a = 0; a <= 8; a += 1) for (const sa of a ? [1, -1] : [1]) for (let d = side; d <= 16; d += 0.5) {
    const cx = p.x + ax * a * sa, cz = p.z + az * a * sa;
    const l1 = [cx + px * d, cz + pz * d], l2 = [cx - px * d, cz - pz * d];
    if (!legOnLane(...l1, w) && !legOnLane(...l2, w)) return [l1, l2];
  }
  return [[p.x, p.z]];
}

// 金額（円）: 橋桁の体積あたり
const RATE = { expressway: 90000, rail: 110000 };

// 高架の全部: { paths, lines: { expressway, rail }, segments, pillars }
//  segments: 一区間 { id: 'x3', line, a: [x, z], b: [x, z], s0, s1, y（路面の高さ）, width, thick, len, heading,
//    x, z（中心）, dist（爆心から一番近い点の距離）, w, d, h（命中の箱: 地面から路面まで）, value }
//  pillars: { seg（その区間の id）, x, z, h, w, heading, kind: 'T'（高速の T 字）| 'I'（線路の柱） }
export function buildTransit(R, T = TRANSIT) {
  const paths = transitPaths(R, T);
  const segments = [], pillars = [];
  for (const line of ['expressway', 'rail']) {
    const L = T[line], path = paths[line];
    const st = pillarStations(path, L.span);
    const ends = path.closed ? [...st, st[0] + path.length] : st; // 輪の最後の区間は最初の橋脚へ戻る
    for (let i = 0; i + 1 < ends.length; i++) {
      const s0 = ends[i], s1 = ends[i + 1];
      const pa = pointAt(path, s0), pb = pointAt(path, s1);
      const a = [pa.x, pa.z], b = [pb.x, pb.z];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
      // 一番近い点（爆心は原点）
      const near = segDist(0, 0, a, b);
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      const ex = Math.abs(Math.cos(heading)) * len + Math.abs(Math.sin(heading)) * L.width;
      const ez = Math.abs(Math.sin(heading)) * len + Math.abs(Math.cos(heading)) * L.width;
      const id = (line === 'expressway' ? 'x' : 'r') + segments.filter((s) => s.line === line).length;
      segments.push({ id, line, a, b, s0, s1, y: L.deckY, width: L.width, thick: L.thick, len, heading, x: cx, z: cz, dist: near,
        w: ex, d: ez, h: L.deckY, value: Math.round(len * L.width * L.thick * RATE[line]) });
      const pw = line === 'expressway' ? 2.4 : 1.6;
      const pier = (q) => ({ seg: id, x: q[0], z: q[1], h: L.deckY - L.thick, w: pw, heading, kind: line === 'expressway' ? 'T' : 'I', legs: legsFor({ x: q[0], z: q[1] }, heading, L.width, pw) });
      pillars.push(pier(a));
      if (!path.closed && i + 2 === ends.length) pillars.push(pier(b));
    }
  }
  return { paths, segments, pillars, config: T };
}

// 演出のカメラの逃げる道（finalePlan）がよける箱: 橋桁に沿って step m ごとの、路面の幅の四角（高さは欄干・架線の上まで）。
// ビルと同じ形（x, z, w, d, h）。地面から路面までの箱にする（下をくぐらず、上を越える）
export function transitObstacles(transit, step = 8) {
  const out = [];
  for (const s of transit.segments) {
    const n = Math.max(1, Math.ceil(s.len / step));
    const top = s.y + (s.line === 'rail' ? 7 : 7.5);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      out.push({ id: s.id + ':' + i, x: s.a[0] + (s.b[0] - s.a[0]) * u, z: s.a[1] + (s.b[1] - s.a[1]) * u, w: s.width + step * 0.8, d: s.width + step * 0.8, h: top, dist: s.dist });
    }
  }
  return out;
}
