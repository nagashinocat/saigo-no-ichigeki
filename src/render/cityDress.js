// 街の作り込み（S7。持ち主 2026-11-21 13:13「ネオン、看板とかで色んな光」、13:16「九龍城みたいな中国寄りと日本のネオン街が混ざった雰囲気」）。
// ビルごとの飾り（どれも描くときはインスタンスで、種類ごとに 1 回の描画）を決める純粋な関数。描画は cityView。
//  boxes: 屋上の空調・小屋・アンテナの林・看板の骨組み、壁の窓用エアコン・増築の部屋・檻のようなベランダ・配管・物干し竿と洗濯物、
//         張り出し看板の鉄の腕、道をまたぐ電線（a→b の細い箱）
//  tanks: 屋上の給水塔、signs: 発光する看板・提灯・店先・ネオン管、pools: 店先の光が道に落とす色の溜まり（加算の板）、beacons: 航空灯
// 看板は二つの文化を混ぜる:
//  中国寄り（cn）: 鉄の腕で道へ大きく張り出す横長の看板を重ねて並べる（赤・琥珀・暖かい白・ときどきシアン）
//  日本のネオン街（jp）: ビルの角を縦に走る看板、提灯のような箱、屋上の大看板（マゼンタ・シアン・紫・ピンク）
// 街のどちらに寄るかは方角でゆるく分け、境目では混ざる。
// 道路の格子（軍勢が飛ぶ道）はあけておく: 道へ出るものは高さ STREET_CLEAR m 以上で、歩道の縁から OVERHANG m までしか出さない
// （道をまたぐ電線だけは細く高い）。広場のまわり（PLAZA_KEEP m 未満）では張り出し看板・電線を置かない（上空から広場のまわりの道を読めるように）。
// density（画質の段: high 1 / mid 0.75 / low 0.5）で数を間引く。間引きの乱数は density によらず同じだけ引く（段が違っても同じ並び）。

import { createRng } from '../rng.js';
import { GRID } from '../world/cityGen.js';
import { layout } from './signAtlas.js';

// ネオンの色（sRGB 0〜1）。軍勢のバイクの緑（DUSK.thrust / thrustLow、色相 136〜160°）から色相で十分離す（tests/render/cityDress.test.js）
export const NEON = {
  magenta: [1.0, 0.16, 0.68],
  pink: [1.0, 0.42, 0.78],
  cyan: [0.22, 0.74, 1.0],
  violet: [0.62, 0.32, 1.0],
  amber: [1.0, 0.66, 0.16],
  red: [1.0, 0.2, 0.16],
  warmWhite: [1.0, 0.88, 0.7],
};
const PALETTE = {
  cn: ['red', 'red', 'amber', 'amber', 'warmWhite', 'red', 'amber', 'cyan'],
  jp: ['magenta', 'pink', 'cyan', 'violet', 'magenta', 'violet', 'pink', 'cyan', 'warmWhite'],
  lantern: ['red', 'red', 'amber', 'pink', 'warmWhite'],
};
export const STREET_CLEAR = 5;   // m。道へ出るものの下端の高さ（浮遊バイクの通り道より上）
export const OVERHANG = 1.6;     // m。歩道の縁（区画の端）から道へ出してよい長さ
export const PLAZA_KEEP = 42;    // m。広場からこの距離の内には大きく張り出すものを置かない
export const DENSITY = { high: 1, mid: 0.75, low: 0.5 };
// 屋上・壁の細かい飾り（箱・給水塔）は数が多いので、看板より強く間引く（mid の Android で 30fps）
export const CLUTTER_DENSITY = { high: 1, mid: 0.6, low: 0.4 };
const FLOOR = 3.3;

// 汚れた・錆びた・色あせた増築の色（sRGB）
const GRIME = [[0.42, 0.40, 0.37], [0.36, 0.33, 0.30], [0.47, 0.42, 0.36], [0.33, 0.35, 0.36], [0.45, 0.30, 0.24], [0.30, 0.31, 0.34], [0.52, 0.49, 0.44]];
const METAL = [[0.24, 0.25, 0.28], [0.32, 0.30, 0.29], [0.40, 0.27, 0.20]];
const CLOTH = [[0.85, 0.82, 0.76], [0.75, 0.30, 0.30], [0.35, 0.45, 0.70], [0.85, 0.72, 0.35], [0.62, 0.55, 0.70], [0.92, 0.9, 0.88]];

const lotCenter = (v) => Math.round(v / GRID.PITCH) * GRID.PITCH;

// 部品の 4 つの壁: 外向きの法線 n、壁の中心、壁に沿う向き t、壁の幅、区画の端までの余白 gap（歩道を含まない、区画の内の余白）
function facesOf(b, p) {
  const cx = b.x + p.x, cz = b.z + p.z, lx = lotCenter(b.x), lz = lotCenter(b.z), hb = GRID.BLOCK / 2;
  return [
    { n: [1, 0], t: [0, 1], c: [cx + p.w / 2, cz], width: p.d, gap: hb - (cx + p.w / 2 - lx) },
    { n: [-1, 0], t: [0, -1], c: [cx - p.w / 2, cz], width: p.d, gap: hb + (cx - p.w / 2 - lx) },
    { n: [0, 1], t: [-1, 0], c: [cx, cz + p.d / 2], width: p.w, gap: hb - (cz + p.d / 2 - lz) },
    { n: [0, -1], t: [1, 0], c: [cx, cz - p.d / 2], width: p.w, gap: hb + (cz - p.d / 2 - lz) },
  ];
}
// 回転（y 軸まわり）: ローカルの +z を n へ向ける / ローカルの +x を n へ向ける
const faceRy = (n) => Math.atan2(n[0], n[1]);
const outRy = (n) => Math.atan2(-n[1], n[0]);

// 上に別の部品が載っていない（屋上が空に出ている）か
function openRoof(b, p) {
  const top = p.y + p.h;
  return !b.parts.some((q) => q !== p && q.y >= top - 0.01 && Math.abs(q.x - p.x) < (q.w + p.w) / 2 && Math.abs(q.z - p.z) < (q.d + p.d) / 2);
}

// density: 看板・ネオン・光の溜まりの密度、clutter: 屋上・壁の飾りの密度（省けば density）
export function dressCity(city, { density = 1, clutter = density, seed = 7 } = {}) {
  const tiles = layout();
  const out = { boxes: [], tanks: [], signs: [], pools: [], beacons: [] };
  const byLot = new Map();
  for (const b of city.buildings) byLot.set(lotCenter(b.x) + ',' + lotCenter(b.z), b);

  for (const b of city.buildings) {
    const r = createRng((seed * 7919 + b.id * 104729 + 0x2545) >>> 0);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const keep = () => r() < density; // 看板の間引き（いつも 1 つ引く）
    const keepC = () => r() < clutter; // 飾りの間引き
    const box = (spec) => out.boxes.push({ bid: b.id, ...spec });
    const sign = (spec) => out.signs.push({ bid: b.id, flicker: 0, phase: 0, gain: 1, mode: 0, ...spec });
    const ang = Math.atan2(b.z, b.x);
    const cnBias = 0.5 + 0.38 * Math.sin(2 * ang + 1.3) + 0.25 * (r() - 0.5);
    const culture = r() < cnBias ? 'cn' : 'jp';
    const col = (pal = culture) => NEON[pick(PALETTE[pal])];
    const flick = (spec) => { const f = r(), ph = r(); spec.flicker = f < 0.28 ? 0.35 + 0.65 * r() : 0; spec.phase = ph; spec.gain = 0.85 + 0.35 * r(); return spec; };
    const open = b.dist >= PLAZA_KEEP;
    const base = b.parts.reduce((a, p) => (p.y === 0 && p.w * p.d > a.w * a.d ? p : a), b.parts.find((p) => p.y === 0));

    // ---- 壁: 窓のエアコン・増築・配管・物干し ----
    for (const p of b.parts) {
      if (p.shape && p.shape[0]) continue;
      const faces = facesOf(b, p);
      const top = Math.min(p.y + p.h, 48);
      const floors = Math.max(0, Math.floor((top - Math.max(p.y, FLOOR)) / FLOOR));
      for (const f of faces) {
        const room = Math.max(0, f.gap - 0.25); // 区画の内で外へ出してよい長さ
        const nAc = Math.min(8, Math.floor((f.width / 3.6) * floors * 0.13));
        for (let i = 0; i < nAc; i++) {
          const k = keepC(), fl = 1 + Math.floor(r() * Math.max(1, floors)), s = (r() - 0.5) * (f.width - 1.6);
          const y = Math.max(p.y, FLOOR) + (fl - 1) * FLOOR + 0.9;
          const dep = Math.min(0.6, room);
          if (!k || dep < 0.25 || y + 0.6 > p.y + p.h - 0.4) continue;
          box({ x: f.c[0] + f.t[0] * s + f.n[0] * dep / 2, y, z: f.c[1] + f.t[1] * s + f.n[1] * dep / 2, w: 0.9, h: 0.6, d: dep, ry: faceRy(f.n), color: pick(GRIME) });
        }
        // 増築の部屋・檻のようなベランダ（中国寄りに多い）
        const nAdd = p.y === 0 && p.h > 9 ? Math.floor(r() * (culture === 'cn' ? 4 : 2)) : 0;
        for (let i = 0; i < nAdd; i++) {
          const k = keepC(), w = Math.min(2 + 2.5 * r(), f.width - 0.5), dep = Math.min(1.1 + 0.6 * r(), room), fl = 1 + Math.floor(r() * Math.max(1, Math.min(floors, 9)));
          const s = (r() - 0.5) * Math.max(0, f.width - w - 0.6), cage = r() < 0.4;
          const y = fl * FLOOR + 0.2;
          if (!k || dep < 0.5 || w < 1.5 || y + 2.6 > p.y + p.h - 0.5) continue;
          box({ x: f.c[0] + f.t[0] * s + f.n[0] * dep / 2, y, z: f.c[1] + f.t[1] * s + f.n[1] * dep / 2, w, h: cage ? 2.2 : 2.7, d: dep, ry: faceRy(f.n), color: cage ? pick(METAL) : pick(GRIME) });
        }
        // 配管（壁を縦に走る）
        if (r() < 0.3 && keepC() && p.h > 8 && f.gap > 0.45) {
          const s = (r() - 0.5) * (f.width - 1);
          box({ x: f.c[0] + f.t[0] * s + f.n[0] * 0.2, y: p.y, z: f.c[1] + f.t[1] * s + f.n[1] * 0.2, w: 0.28, h: p.h - 0.3, d: 0.28, ry: faceRy(f.n), color: pick(METAL) });
        }
        // 物干し竿と洗濯物（中国寄り）
        if (culture === 'cn' && p.y === 0 && r() < 0.45 && keepC() && floors >= 2 && room > 1.2) {
          const s = (r() - 0.5) * (f.width - 2), y = (1 + Math.floor(r() * Math.min(floors, 6))) * FLOOR + 1.8, L = Math.min(1.6, room);
          if (y < p.y + p.h - 0.5) {
            const ax = f.c[0] + f.t[0] * s, az = f.c[1] + f.t[1] * s;
            box({ a: [ax, y, az], b: [ax + f.n[0] * L, y, az + f.n[1] * L], t: 0.07, color: METAL[0] });
            for (let j = 0; j < 3; j++) {
              const o = 0.3 + (L - 0.4) * (j / 2);
              box({ x: ax + f.n[0] * o, y: y - 0.75, z: az + f.n[1] * o, w: 0.06, h: 0.72, d: 0.5, ry: faceRy(f.n), color: pick(CLOTH) });
            }
          }
        }
      }
    }

    // ---- 屋上 ----
    for (const p of b.parts) {
      if (!openRoof(b, p)) continue;
      const shaped = p.shape && p.shape[0];
      const px = b.x + p.x, pz = b.z + p.z, top = p.y + p.h;
      if (shaped) {
        if (b.arch === 'landmark') addSpire(px, top, pz);
        continue;
      }
      const inset = (w, d) => [px + (r() - 0.5) * Math.max(0, p.w - w - 1.5), pz + (r() - 0.5) * Math.max(0, p.d - d - 1.5)];
      const nAc = 1 + Math.floor(r() * 3);
      for (let i = 0; i < nAc; i++) {
        const k = keepC(), w = 1.4 + 2.4 * r(), d = 1.4 + 2.4 * r(), h = 1 + 1.6 * r(), [x, z] = inset(w, d);
        if (k) box({ x, y: top, z, w, h, d, ry: 0, color: pick(GRIME) });
      }
      if ((culture === 'cn' || r() < 0.3) && p.w > 6 && p.d > 6) { // 屋上の小屋
        const k = keepC(), w = 2.5 + 2 * r(), d = 2.5 + 2 * r(), [x, z] = inset(w, d);
        if (k) box({ x, y: top, z, w, h: 2.4 + 0.6 * r(), d, ry: 0, color: pick(GRIME) });
      }
      if (top > 12 && r() < 0.55) { // 給水塔
        const k = keepC(), rad = 1.1 + 0.7 * r(), [x, z] = inset(rad * 2, rad * 2);
        if (k) out.tanks.push({ bid: b.id, x, y: top, z, r: rad, h: 2.4 + 1.4 * r(), color: pick(GRIME) });
      }
      const nAnt = Math.floor(r() * (culture === 'cn' ? 7 : 3)); // アンテナの林
      for (let i = 0; i < nAnt; i++) {
        const k = keepC(), h = 2 + 7 * r() * r(), [x, z] = inset(0.5, 0.5);
        if (!k) continue;
        box({ x, y: top, z, w: 0.12, h, d: 0.12, ry: 0, color: METAL[0] });
        if (r() < 0.5) box({ x, y: top + h * (0.6 + 0.35 * r()), z, w: 0.8 + 0.8 * r(), h: 0.07, d: 0.07, ry: r() * Math.PI, color: METAL[0] });
      }
      if (b.arch === 'landmark') addSpire(px, top, pz);
      // 屋上の大看板（骨組みつき）。カメラ（+z の上）の側を向くものが多い
      if (b.dist > 24 && top > 8 && p.w * p.d > 80 && r() < (culture === 'jp' ? 0.32 : 0.16)) {
        const k = keep();
        const faces = facesOf(b, p);
        const f = r() < 0.7 ? faces[2] : pick(faces);
        const bw = Math.min(16, f.width * 0.9), bh = bw * (0.42 + 0.1 * r()), lift = 1.6 + r();
        const cx = f.c[0] - f.n[0] * 1.2, cz = f.c[1] - f.n[1] * 1.2;
        if (k) {
          sign(flick({ type: 'billboard', x: cx, y: top + lift, z: cz, w: bw, h: bh, t: 0.4, ry: faceRy(f.n), tile: pick(tiles.board).uv, color: col('jp'), mode: 0 }));
          for (const s of [-0.4, 0, 0.4]) {
            const lx = cx + f.t[0] * s * bw, lz = cz + f.t[1] * s * bw;
            box({ x: lx, y: top, z: lz, w: 0.25, h: lift + bh * 0.9, d: 0.25, ry: 0, color: METAL[1] });
            box({ a: [lx - f.n[0] * 2.2, top, lz - f.n[1] * 2.2], b: [lx, top + lift + bh * 0.7, lz], t: 0.16, color: METAL[1] });
          }
          box({ x: cx - f.n[0] * 0.3, y: top + lift - 0.3, z: cz - f.n[1] * 0.3, w: bw, h: 0.18, d: 0.5, ry: faceRy(f.n), color: METAL[1] });
        }
      }
    }
    if (b.h > 85) out.beacons.push({ bid: b.id, x: b.x + b.w * 0.42, y: b.h, z: b.z + b.d * 0.42 });

    // ---- 区画の余白に建て増した低い小屋（1〜2 階。九龍城のように区画を埋める）と、その店先の光 ----
    for (const f of facesOf(b, base)) {
      const room = f.gap - 0.3;
      if (room < 2.2 || r() > 0.75) continue;
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const k = keep(), w = Math.min(f.width / n - 0.2, 3 + 4 * r()), dep = Math.min(room, 2 + 4 * r()), h = 2.8 + (r() < 0.4 ? 3 : 0) + r();
        const s = (-0.5 + (i + 0.5) / n) * f.width + (r() - 0.5) * 0.2, lit = r() < 0.55, c = col(r() < 0.5 ? 'lantern' : culture), tile = pick(tiles.shop).uv;
        if (!k || w < 2 || h > base.h) continue;
        const ax = f.c[0] + f.t[0] * s, az = f.c[1] + f.t[1] * s;
        box({ x: ax + f.n[0] * dep / 2, y: 0, z: az + f.n[1] * dep / 2, w, h, d: dep, ry: faceRy(f.n), color: pick(GRIME) });
        if (lit && room - dep > 0.3) {
          sign(flick({ type: 'shop', x: ax + f.n[0] * (dep + 0.08), y: 0.3, z: az + f.n[1] * (dep + 0.08), w: w * 0.85, h: Math.min(2.4, h - 0.5), t: 0.1, ry: faceRy(f.n), tile, color: c }));
          const reach = Math.max(0, f.gap - dep) + 3.2;
          out.pools.push({ bid: b.id, x: ax + f.n[0] * (dep + reach / 2), z: az + f.n[1] * (dep + reach / 2), w: w + 3, d: reach, ry: faceRy(f.n), color: c });
        }
      }
    }

    // ---- 看板 ----
    const faces = facesOf(b, base);
    const tall = base.h;
    // 店先の光（1 階）と道に落ちる色の溜まり
    if (b.dist > 18) {
      for (const f of faces) {
        if (r() > (b.arch === 'shop' ? 0.8 : 0.45)) continue;
        const k = keep(), w = f.width * (0.45 + 0.4 * r()), s = (r() - 0.5) * (f.width - w), c = col(r() < 0.5 ? 'lantern' : culture);
        if (!k || f.gap < 0.2) continue;
        const x = f.c[0] + f.t[0] * s + f.n[0] * 0.12, z = f.c[1] + f.t[1] * s + f.n[1] * 0.12;
        sign(flick({ type: 'shop', x, y: 0.35, z, w, h: 2.5, t: 0.12, ry: faceRy(f.n), tile: pick(tiles.shop).uv, color: c, mode: 0 }));
        const reach = Math.max(0, f.gap) + 3.2;
        out.pools.push({ bid: b.id, x: f.c[0] + f.t[0] * s + f.n[0] * reach / 2, z: f.c[1] + f.t[1] * s + f.n[1] * reach / 2, w: w + 3, d: reach, ry: faceRy(f.n), color: c });
      }
    }
    if (culture === 'cn') {
      // 鉄の腕で道へ張り出す横長の看板を、重ねて積む。カメラから見える ±x の壁を選びやすくする
      const order = [...faces].sort((a, c) => Math.abs(c.n[0]) - Math.abs(a.n[0]) + (r() - 0.5) * 1.6);
      const nFaces = open ? 1 + Math.floor(r() * 3) : 0;
      for (const f of order.slice(0, nFaces)) {
        if (f.width < 4) continue;
        let y = STREET_CLEAR + 0.6 + 1.5 * r();
        const stack = 2 + Math.floor(r() * 4);
        for (let i = 0; i < stack; i++) {
          const k = keep(), h = 1.4 + 1.4 * r(), L = Math.min(7, f.gap + OVERHANG - 0.3 - 0.15 * r()), s = (r() - 0.5) * (f.width - 1.4);
          if (y + h > Math.min(tall - 1, 34)) break;
          if (k && L >= 1.4) {
            const ax = f.c[0] + f.t[0] * s, az = f.c[1] + f.t[1] * s;
            sign(flick({ type: 'cantilever', x: ax + f.n[0] * (0.15 + L / 2), y, z: az + f.n[1] * (0.15 + L / 2), w: L, h, t: 0.35, ry: outRy(f.n), tile: pick(tiles.band).uv, color: col('cn') }));
            box({ a: [ax, y + h + 0.12, az], b: [ax + f.n[0] * (L + 0.2), y + h + 0.12, az + f.n[1] * (L + 0.2)], t: 0.12, color: METAL[0] });
            box({ a: [ax, y + h + 1.1, az], b: [ax + f.n[0] * (L + 0.2), y + h + 0.12, az + f.n[1] * (L + 0.2)], t: 0.08, color: METAL[0] });
          }
          y += h + 0.25 + 1.2 * r();
        }
      }
      // 壁の横長の看板
      if (r() < 0.7) {
        const f = pick(faces), k = keep();
        if (k && tall > 6 && f.gap > 0.35) sign(flick({ type: 'band', x: f.c[0] + f.n[0] * 0.18, y: 3.2 + 0.4 * r(), z: f.c[1] + f.n[1] * 0.18, w: f.width * (0.5 + 0.35 * r()), h: 1.2 + 0.7 * r(), t: 0.25, ry: faceRy(f.n), tile: pick(tiles.band).uv, color: col('cn') }));
      }
    } else {
      // ビルの角を縦に走る看板
      const nBlade = 1 + Math.floor(r() * 2);
      for (let i = 0; i < nBlade; i++) {
        const f = r() < 0.6 ? (faces[0].n[0] === 1 && r() < 0.5 ? faces[0] : faces[1]) : pick(faces);
        const k = keep(), bw = Math.min(1.4 + 0.7 * r(), Math.max(0.8, f.gap + OVERHANG - 0.4)), bh = Math.min(18, Math.max(5, tall - 6) * (0.4 + 0.5 * r()));
        const end = r() < 0.5 ? -1 : 1, s = end * (f.width / 2 - 0.5), y = STREET_CLEAR + 0.3 + 2 * r();
        if (!k || tall < 10 || y + bh > tall - 0.5) continue;
        const ax = f.c[0] + f.t[0] * s, az = f.c[1] + f.t[1] * s;
        sign(flick({ type: 'blade', x: ax + f.n[0] * (0.2 + bw / 2), y, z: az + f.n[1] * (0.2 + bw / 2), w: bw, h: bh, t: 0.3, ry: outRy(f.n), tile: pick(tiles.blade).uv, color: col('jp') }));
      }
      // 提灯のような箱
      if (r() < 0.6 && b.dist > 18) {
        const f = pick(faces), n = 2 + Math.floor(r() * 4), out0 = Math.min(0.5, f.gap - 0.35);
        for (let i = 0; i < n; i++) {
          const k = keep(), s = (i / Math.max(1, n - 1) - 0.5) * (f.width - 1.5);
          if (k && out0 > 0) sign(flick({ type: 'lantern', x: f.c[0] + f.t[0] * s + f.n[0] * out0, y: 3.0, z: f.c[1] + f.t[1] * s + f.n[1] * out0, w: 0.6, h: 0.95, t: 0.6, ry: faceRy(f.n), tile: pick(tiles.lantern).uv, color: col('lantern'), mode: 1 }));
        }
      }
      if (r() < 0.5) {
        const f = pick(faces), k = keep();
        if (k && tall > 8 && f.gap > 0.35) sign(flick({ type: 'band', x: f.c[0] + f.n[0] * 0.18, y: 3.4 + 2 * r(), z: f.c[1] + f.n[1] * 0.18, w: f.width * (0.4 + 0.4 * r()), h: 1.0 + 0.8 * r(), t: 0.25, ry: faceRy(f.n), tile: pick(tiles.band).uv, color: col('jp') }));
      }
    }
    // ネオン管: ビルの縁と段の縁（日本寄りと目印の超高層に多い）
    const stripP = b.arch === 'landmark' ? 1 : culture === 'jp' ? 0.45 : 0.22;
    if (r() < stripP) {
      const c = col(b.arch === 'landmark' ? 'jp' : culture);
      for (const p of b.parts) {
        if (p.h < 12 && b.arch !== 'shop') continue;
        const k = keep();
        if (!k) continue;
        const px = b.x + p.x, pz = b.z + p.z, top = p.y + p.h - (p.shape && p.shape[0] ? p.h * p.shape[1] : 0);
        // 段の上の縁を一周
        for (const f of facesOf(b, p)) {
          const len = f.width + 0.3;
          sign({ type: 'strip', x: f.c[0] + f.n[0] * 0.12, y: top - 0.32, z: f.c[1] + f.n[1] * 0.12, w: len, h: 0.22, t: 0.18, ry: faceRy(f.n), tile: null, color: c, mode: 2, gain: 1.1 });
        }
        // 縦の角（1〜2 本）
        if (p.h > 25) {
          const corners = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
          const m = b.arch === 'landmark' ? 4 : 1 + Math.floor(r() * 2);
          for (let i = 0; i < m; i++) {
            const [sx, sz] = corners[(i + Math.floor(r() * 4)) % 4];
            sign({ type: 'strip', x: px + sx * (p.w / 2 + 0.05), y: Math.max(p.y + 0.3, STREET_CLEAR), z: pz + sz * (p.d / 2 + 0.05), w: 0.2, h: top - Math.max(p.y + 0.3, STREET_CLEAR) - 0.3, t: 0.2, ry: 0, tile: null, color: c, mode: 2, gain: 1.0 });
          }
        }
      }
    }
    // 道をまたぐ電線（向かいの区画のビルへ）
    if (open && b.dist < 380) {
      for (const f of faces) {
        if (r() > 0.35) continue;
        const k = keepC();
        const nb = byLot.get((lotCenter(b.x) + f.n[0] * GRID.PITCH) + ',' + (lotCenter(b.z) + f.n[1] * GRID.PITCH));
        const y = STREET_CLEAR + 1.5 + 6 * r(), s = (r() - 0.5) * (f.width - 1);
        if (!k || !nb || nb.dist < PLAZA_KEEP || y > Math.min(tall, nb.h) - 1) continue;
        const ax = f.c[0] + f.t[0] * s, az = f.c[1] + f.t[1] * s;
        // 向かいの壁: 法線の向きに、向かいのビルの手前の面まで
        const far = f.n[0] ? nb.x - f.n[0] * nb.w / 2 : nb.z - f.n[1] * nb.d / 2;
        const bx = f.n[0] ? far : ax, bz = f.n[0] ? az : far;
        const tx = f.n[0] ? bx : Math.max(nb.x - nb.w / 2 + 0.3, Math.min(nb.x + nb.w / 2 - 0.3, bx));
        const tz = f.n[0] ? Math.max(nb.z - nb.d / 2 + 0.3, Math.min(nb.z + nb.d / 2 - 0.3, bz)) : bz;
        const y2 = y + (r() - 0.5) * 1.5, mx = (ax + tx) / 2, mz = (az + tz) / 2, my = Math.max(STREET_CLEAR + 0.6, (y + y2) / 2 - 0.9);
        box({ a: [ax, y, az], b: [mx, my, mz], t: 0.13, color: [0.1, 0.1, 0.11] });
        box({ a: [mx, my, mz], b: [tx, y2, tz], t: 0.13, color: [0.1, 0.1, 0.11] });
      }
    }

    function addSpire(x, top, z) {
      const h = 22 + 16 * r();
      box({ x, y: top, z, w: 0.7, h, d: 0.7, ry: 0, color: METAL[0] });
      box({ x, y: top, z, w: 2.4, h: h * 0.3, d: 2.4, ry: Math.PI / 4, color: METAL[1] });
      out.beacons.push({ bid: b.id, x, y: top + h - 1.2, z });
    }
  }
  return out;
}
