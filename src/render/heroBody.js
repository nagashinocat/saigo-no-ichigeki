import * as THREE from 'three';
import { surfaceNets } from './surfaceNets.js';
import { srgb } from './figureGeo.js';

// 主人公の体を、コードで組み立てる（オリジナルの成人の体。頭身約 7.3、上着・ズボン・靴・襟巻き）。
// 体は handModel と同じやり方: 骨ごとの形（太さの変わるカプセル・楕円体・角の丸い箱）を滑らかにつないだ「距離の場」を
// Surface Nets で網にする。細かさの要る頭と両手は、それぞれ細かい格子で別に網にする（体の網の中へ重なって閉じる）。
// 髪の房・上着の裾・襟巻きの尾は、なびかせるために曲線から直接組む（aKind 1〜3、aFlut に揺れの大きさと位相）。
//
// 体の空間（メートル）: +z が前、+y が上、+x が主人公の左。立ち姿（REST_POSE）では足の裏が y=0。
// 骨は 17 本（HERO_BONES）。どの骨も休みの向きは体の空間と同じ（回転なし）で、姿勢は骨ごとの回転（親から見た XYZ のオイラー角）。
// 形は指定した姿勢で直接組む（ゆがまない）。各頂点は近い 2 本の骨に重みを持ち、skinPose で姿勢をさらに変えられる。

export const HERO_BONES = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'upperArm.L', 'foreArm.L', 'hand.L', 'upperArm.R', 'foreArm.R', 'hand.R',
  'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R',
];
const PARENT = {
  spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  'upperArm.L': 'chest', 'foreArm.L': 'upperArm.L', 'hand.L': 'foreArm.L',
  'upperArm.R': 'chest', 'foreArm.R': 'upperArm.R', 'hand.R': 'foreArm.R',
  'thigh.L': 'pelvis', 'shin.L': 'thigh.L', 'foot.L': 'shin.L',
  'thigh.R': 'pelvis', 'shin.R': 'thigh.R', 'foot.R': 'shin.R',
};

// 立ち姿の目印（体の比率）。頭のてっぺん 1.745、あご 1.505（頭の高さ 0.24 → 約 7.3 頭身）
export const HERO_BODY = {
  crown: 1.745, chin: 1.505, shoulderY: 1.415, hipY: 0.9, kneeY: 0.49, ankleY: 0.085,
  handLen: 0.19,
};

// 休みの関節の位置（左。右は x を反転）
const REST = {
  pelvis: [0, 0.95, 0], spine: [0, 1.08, -0.005], chest: [0, 1.24, -0.01], neck: [0, 1.44, -0.02], head: [0, 1.535, -0.005],
  'upperArm.L': [0.18, 1.415, -0.015], 'foreArm.L': [0.2, 1.115, -0.035], 'hand.L': [0.212, 0.865, -0.005],
  'thigh.L': [0.09, 0.9, 0], 'shin.L': [0.095, 0.49, 0.012], 'foot.L': [0.1, 0.085, -0.02],
};
for (const k of Object.keys(REST)) if (k.endsWith('.L')) { const [x, y, z] = REST[k]; REST[k.replace('.L', '.R')] = [-x, y, z]; }
// 骨の先（重みを決める線分の終わり）
const TAIL = {
  pelvis: REST.spine, spine: REST.chest, chest: REST.neck, neck: REST.head, head: [0, 1.7, 0.0],
  'upperArm.L': REST['foreArm.L'], 'foreArm.L': REST['hand.L'], 'hand.L': [0.217, 0.715, 0.0],
  'thigh.L': REST['shin.L'], 'shin.L': REST['foot.L'], 'foot.L': [0.108, 0.035, 0.18],
};
for (const k of Object.keys(TAIL)) if (k.endsWith('.L')) { const [x, y, z] = TAIL[k]; TAIL[k.replace('.L', '.R')] = [-x, y, z]; }

// 姿勢: 骨の名前 → [rx, ry, rz]（ラジアン）。lift: いちばん低い所をこの高さへ（null なら動かさない）
export const REST_POSE = Object.freeze({ lift: null });
// 宙に浮く、力の抜けた立ち姿: 腕は少し開いて前へ出し、肘を曲げて前腕をひねり（手のひらが後ろ → 下）、
// 手首を少し返して手のひらを下へ向ける。左右の腕と脚は少しだけ違う曲げ方で、足はつま先が下がる。頭はわずかにうつむく
export const FLOAT_POSE = Object.freeze({
  lift: 0.06,
  spine: [0.02, 0, 0.01], chest: [-0.05, 0.02, 0], neck: [0.05, 0, 0], head: [0.1, 0.06, 0.03],
  'upperArm.L': [-0.1, 0, 0.36], 'foreArm.L': [-0.34, -1.35, 0], 'hand.L': [0, 0, 0.72],
  'upperArm.R': [-0.06, 0, -0.34], 'foreArm.R': [-0.4, 1.3, 0], 'hand.R': [0, 0, -0.68],
  'thigh.L': [-0.12, 0, 0.05], 'shin.L': [0.3, 0, 0], 'foot.L': [0.5, 0, 0.04],
  'thigh.R': [0.03, 0, -0.04], 'shin.R': [0.12, 0, 0], 'foot.R': [0.52, 0, -0.06],
});
// 熱風の向き（体の空間）: 後ろへ、少し上へ。髪・裾・襟巻きの尾はこの向きへ流れ、頂点シェーダーがここから揺らす
export const HERO_WIND = Object.freeze([0, 0.45, -1].map((v, _, a) => v / Math.hypot(...a)));

// 細かさ: 体・頭・手の格子の間隔（m）と、髪の房の数・断面、裾と襟巻きの分け方
const DETAIL = {
  high: { body: 0.025, head: 0.0155, hand: 0.0105, tufts: 30, tuftSeg: 5, tuftSides: 5, coatU: 12, coatV: 9, scarfSeg: 12 },
  mid: { body: 0.03, head: 0.019, hand: 0.013, tufts: 24, tuftSeg: 4, tuftSides: 4, coatU: 10, coatV: 7, scarfSeg: 10 },
  low: { body: 0.042, head: 0.025, hand: 0.017, mitten: true, tufts: 14, tuftSeg: 3, tuftSides: 4, coatU: 8, coatV: 5, scarfSeg: 7 },
};

const COLORS = {
  coat: '#2a2840', lining: '#3b2a33', pants: '#23252c', shoe: '#141416', scarf: '#d9d2c4', skin: '#c99a7f', hair: '#1a1714',
};
// 種類: 0 距離の場の体, 1 髪の房, 2 上着の裾, 3 襟巻きの尾
export const HERO_KIND = { body: 0, hair: 1, coat: 2, scarf: 3 };

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const smin = (a, b, k) => { if (a === Infinity || b === Infinity) return Math.min(a, b); if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// ---- 骨の姿勢（前向きの運動学） ----
function fk(pose, extra = null) {
  const out = {};
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  for (const name of HERO_BONES) {
    const r = pose[name] ?? [0, 0, 0];
    const L = new THREE.Quaternion().setFromEuler(e.set(r[0], r[1], r[2], 'XYZ'));
    const x = extra?.[name];
    if (x) L.multiply(q.setFromEuler(e.set(x[0], x[1], x[2], 'XYZ')));
    const par = PARENT[name];
    if (!par) out[name] = { q: L, p: V(REST[name]) };
    else {
      const P = out[par];
      out[name] = { q: P.q.clone().multiply(L), p: V(REST[name]).sub(V(REST[par])).applyQuaternion(P.q).add(P.p) };
    }
  }
  return out;
}
// 休みの点 r（骨 b に付く）を、姿勢を付けた位置へ
const xf = (F, b, r) => V(r).sub(V(REST[b])).applyQuaternion(F[b].q).add(F[b].p);

// ---- 距離の場の部品（姿勢を付けた空間で。負が内側）。どれも包む球（cx, cy, cz, r）を持つ ----
function capsule(a, b, ra, rb, flatDir = null, flat = 1) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const bb = Math.max(1e-12, bax * bax + bay * bay + baz * baz);
  const fx = flatDir?.x ?? 0, fy = flatDir?.y ?? 0, fz = flatDir?.z ?? 0, fk1 = 1 / flat - 1;
  const fn = (x, y, z) => {
    const px = x - a.x, py = y - a.y, pz = z - a.z;
    const t = Math.min(1, Math.max(0, (px * bax + py * bay + pz * baz) / bb));
    let ox = px - bax * t, oy = py - bay * t, oz = pz - baz * t;
    if (flatDir) { const s = (ox * fx + oy * fy + oz * fz) * fk1; ox += fx * s; oy += fy * s; oz += fz * s; }
    return Math.sqrt(ox * ox + oy * oy + oz * oz) - (ra + (rb - ra) * t);
  };
  const rm = Math.max(ra, rb);
  return bound(fn, a.clone().lerp(b, 0.5), Math.sqrt(bb) / 2 + rm, new THREE.Box3().setFromPoints([a, b]).expandByScalar(rm));
}
// 楕円体（q: 向き、r: 半径 3 つ）
function ellipsoid(c, q, r) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q.clone().invert()).elements;
  const [rx, ry, rz] = r;
  const fn = (x, y, z) => {
    const px = x - c.x, py = y - c.y, pz = z - c.z;
    const lx = m[0] * px + m[4] * py + m[8] * pz, ly = m[1] * px + m[5] * py + m[9] * pz, lz = m[2] * px + m[6] * py + m[10] * pz;
    const k0 = len3(lx / rx, ly / ry, lz / rz), k1 = len3(lx / (rx * rx), ly / (ry * ry), lz / (rz * rz));
    return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  };
  return bound(fn, c, Math.max(rx, ry, rz));
}
// 角の丸い箱（h: 半分の大きさ、rr: 角の丸み）
function roundBox(c, q, h, rr) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q.clone().invert()).elements;
  const fn = (x, y, z) => {
    const px = x - c.x, py = y - c.y, pz = z - c.z;
    const lx = Math.abs(m[0] * px + m[4] * py + m[8] * pz) - h[0], ly = Math.abs(m[1] * px + m[5] * py + m[9] * pz) - h[1], lz = Math.abs(m[2] * px + m[6] * py + m[10] * pz) - h[2];
    return len3(Math.max(lx, 0), Math.max(ly, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, ly, lz), 0) - rr;
  };
  return bound(fn, c, len3(...h) + rr);
}
// 半空間で切る（n の向きの側を捨てる）
function clip(f, p0, n) {
  const fn = (x, y, z) => Math.max(f(x, y, z), (x - p0.x) * n.x + (y - p0.y) * n.y + (z - p0.z) * n.z);
  return bound(fn, new THREE.Vector3(f.cx, f.cy, f.cz), f.r);
}
// 包む球（cx, cy, cz, r）と、包む箱（box。なければ球の箱）
function bound(fn, c, r, box = null) {
  fn.cx = c.x; fn.cy = c.y; fn.cz = c.z; fn.r = r;
  fn.box = box ?? new THREE.Box3(new THREE.Vector3(c.x - r, c.y - r, c.z - r), new THREE.Vector3(c.x + r, c.y + r, c.z + r));
  return fn;
}

// 部品の一覧を滑らかにつないだ場。部品ごとに k（なじませる幅）。finger の部品どうしは滑らかにつながず（最小）、
// ほかの部品とは FINGER_K でなじむ（指がくっついて手袋にならない）。
// 速さのため、空間を bucket の升目に分け、升目ごとに「近くの部品」（包む箱から margin 以内）だけを、近い順に調べる。
// 面の近く（値が margin − なじませる幅より小さい所）では、省いた部品は値を変えない。面から遠い所の値は省いた部品の分だけ
// 大きく出ることがあるが、省いた部品の面はその点から margin 以上離れていて、Surface Nets が省く塊（対角線 margin 未満）の
// 中には入らない。近くの部品がない升目は margin（値の下限）を返す
const FINGER_K = 0.008;
function makeField(prims, box, bucket = 0.1, margin = 0.15) {
  const fs = prims.map((p) => p.d), ks = prims.map((p) => p.k), fing = prims.map((p) => !!p.finger);
  const x0 = box.min.x - margin, y0 = box.min.y - margin, z0 = box.min.z - margin;
  const nx = Math.ceil((box.max.x - x0 + margin) / bucket) + 1, ny = Math.ceil((box.max.y - y0 + margin) / bucket) + 1, nz = Math.ceil((box.max.z - z0 + margin) / bucket) + 1;
  const N = nx * ny * nz;
  const raw = Array.from({ length: N }, () => []);
  const cl = (v, n) => Math.min(n - 1, Math.max(0, Math.floor(v)));
  fs.forEach((f, n) => {
    const b = f.box;
    const i0 = cl((b.min.x - margin - x0) / bucket, nx), i1 = cl((b.max.x + margin - x0) / bucket, nx);
    const j0 = cl((b.min.y - margin - y0) / bucket, ny), j1 = cl((b.max.y + margin - y0) / bucket, ny);
    const k0 = cl((b.min.z - margin - z0) / bucket, nz), k1 = cl((b.max.z + margin - z0) / bucket, nz);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) raw[i + nx * (j + ny * k)].push(n);
  });
  const lists = new Array(N);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const b = i + nx * (j + ny * k), L = raw[b];
    if (L.length) {
      const cx = x0 + (i + 0.5) * bucket, cy = y0 + (j + 0.5) * bucket, cz = z0 + (k + 0.5) * bucket;
      const key = (n) => len3(cx - fs[n].cx, cy - fs[n].cy, cz - fs[n].cz) - fs[n].r;
      L.sort((a, c) => key(a) - key(c));
    }
    lists[b] = Int16Array.from(L);
  }
  return (x, y, z) => {
    const i = Math.floor((x - x0) / bucket), j = Math.floor((y - y0) / bucket), k = Math.floor((z - z0) / bucket);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return margin;
    const b = i + nx * (j + ny * k), L = lists[b];
    if (!L.length) return margin;
    let d = Infinity, f = Infinity;
    for (let n = 0; n < L.length; n++) {
      const p = L[n], g = fs[p];
      const s = len3(x - g.cx, y - g.cy, z - g.cz) - g.r;
      if (fing[p]) {
        if (s >= Math.min(f, d + FINGER_K)) continue;
        const v = g(x, y, z);
        if (v < f) f = v;
      } else {
        if (s >= Math.min(d, f + FINGER_K) + ks[p]) continue;
        d = smin(d, g(x, y, z), ks[p]);
      }
    }
    return f === Infinity ? d : smin(d, f, FINGER_K);
  };
}

// ---- 部品を並べる ----
// 体（頭と手を除く）。tag は色、bone は重みの目安（色と同じく、最も近い部品から）
function bodyPrims(F) {
  const P = [];
  const add = (d, k, tag, bone) => P.push({ d, k, tag, bone });
  const E = (b, c, r, k, tag) => add(ellipsoid(xf(F, b, c), F[b].q, r), k, tag, b);
  const C = (b, a, bb, ra, rb, k, tag, flatDir = null, flat = 1) =>
    add(capsule(xf(F, b, a), xf(F, b, bb), ra, rb, flatDir ? V(flatDir).applyQuaternion(F[b].q) : null, flat), k, tag, b);
  const S0 = (b, c, r, k, tag) => add(capsule(xf(F, b, c), xf(F, b, [c[0], c[1] + 1e-4, c[2]]), r, r), k, tag, b);
  // 胴（上着）: 骨盤・腹・胸郭・胸と背中のふくらみ・肩の張り
  E('pelvis', [0, 0.925, -0.012], [0.165, 0.115, 0.112], 0.04, 'coat');
  E('spine', [0, 1.07, -0.002], [0.15, 0.12, 0.106], 0.06, 'coat');
  // 上着の身ごろ: 胸から腰までほぼまっすぐに落ちる（腰をくびれさせない）
  add(roundBox(xf(F, 'spine', [0, 1.11, -0.006]), F.spine.q, [0.112, 0.16, 0.068], 0.036), 0.05, 'coat', 'spine');
  E('chest', [0, 1.25, -0.008], [0.158, 0.15, 0.112], 0.06, 'coat');
  E('chest', [0, 1.29, 0.035], [0.145, 0.095, 0.075], 0.05, 'coat');
  E('chest', [0, 1.31, -0.058], [0.15, 0.115, 0.07], 0.05, 'coat');
  C('chest', [-0.125, 1.372, -0.02], [0.125, 1.372, -0.02], 0.056, 0.056, 0.05, 'coat', [0, 0, 1], 0.8);
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    // 首の付け根から肩へ下りる線（僧帽筋）と、肩の丸み（三角筋）
    C('chest', [0.03 * s, 1.452, -0.03], [0.155 * s, 1.398, -0.02], 0.036, 0.042, 0.045, 'coat');
    E(`upperArm.${S}`, [0.18 * s, 1.378, -0.015], [0.05, 0.072, 0.058], 0.045, 'coat');
    // 腕（上着の袖）: 肘で少し細く、袖口は手首を覆う
    const sh = REST[`upperArm.${S}`], el = REST[`foreArm.${S}`], wr = REST[`hand.${S}`];
    C(`upperArm.${S}`, sh, el, 0.053, 0.045, 0.03, 'coat');
    S0(`foreArm.${S}`, el, 0.046, 0.02, 'coat');
    C(`foreArm.${S}`, el, [wr[0], wr[1] + 0.015, wr[2]], 0.045, 0.038, 0.02, 'coat');
    C(`foreArm.${S}`, [wr[0], wr[1] + 0.05, wr[2]], [wr[0], wr[1] + 0.012, wr[2]], 0.041, 0.042, 0.012, 'coat');
    // 脚（ズボン）: 太もも、ひざ、すね、ふくらはぎ
    const hp = REST[`thigh.${S}`], kn = REST[`shin.${S}`], an = REST[`foot.${S}`];
    C(`thigh.${S}`, [hp[0] + 0.006 * s, hp[1], hp[2]], kn, 0.08, 0.055, 0.035, 'pants');
    E(`thigh.${S}`, [hp[0] + 0.018 * s, hp[1] - 0.17, hp[2] + 0.018], [0.064, 0.16, 0.068], 0.03, 'pants');
    S0(`shin.${S}`, [kn[0], kn[1], kn[2] + 0.01], 0.052, 0.02, 'pants');
    C(`shin.${S}`, kn, [an[0], an[1] + 0.03, an[2]], 0.051, 0.038, 0.02, 'pants');
    E(`shin.${S}`, [kn[0], kn[1] - 0.13, kn[2] - 0.026], [0.052, 0.11, 0.05], 0.035, 'pants');
    // 靴: 足首から細いかかと、甲は平たく、つま先へ細くなる（低い靴）
    const x = an[0];
    C(`foot.${S}`, [x, an[1] + 0.03, an[2]], [x, 0.042, -0.045], 0.037, 0.035, 0.025, 'shoe', [1, 0, 0], 0.9);
    C(`foot.${S}`, [x, 0.044, -0.05], [x + 0.008 * s, 0.036, 0.13], 0.036, 0.038, 0.025, 'shoe', [0, 1, 0], 0.85);
    C(`foot.${S}`, [x + 0.008 * s, 0.033, 0.13], [x + 0.014 * s, 0.03, 0.2], 0.037, 0.029, 0.015, 'shoe', [0, 1, 0], 0.85);
  }
  // 首（肌）と、首に巻いた襟巻き
  C('neck', [0, 1.4, -0.02], [0, 1.56, 0.0], 0.05, 0.047, 0.02, 'skin');
  const ring = 7, c0 = [0, 1.425, -0.016];
  for (let i = 0; i < ring; i++) {
    const a0 = (i / ring) * Math.PI * 2, a1 = ((i + 1) / ring) * Math.PI * 2;
    const p = (a, dy) => [c0[0] + Math.sin(a) * 0.066, c0[1] + dy, c0[2] + Math.cos(a) * 0.062];
    C('neck', p(a0, 0.012 * Math.sin(a0)), p(a1, 0.012 * Math.sin(a1)), 0.029, 0.029, 0.015, 'scarf');
  }
  return P;
}

// 頭（顔の横顔の輪郭が影に出るように: 額・眉・鼻・唇・あご・耳、髪のかたまり）
function headPrims(F) {
  const P = [];
  const add = (d, k, tag, bone = 'head') => P.push({ d, k, tag, bone });
  const E = (c, r, k, tag) => add(ellipsoid(xf(F, 'head', c), F.head.q, r), k, tag);
  const C = (a, b, ra, rb, k, tag) => add(capsule(xf(F, 'head', a), xf(F, 'head', b), ra, rb), k, tag);
  add(capsule(xf(F, 'neck', [0, 1.47, -0.014]), xf(F, 'head', [0, 1.57, -0.005]), 0.049, 0.049), 0.02, 'skin', 'neck'); // 首の上（体の首へ重なる）
  E([0, 1.64, -0.012], [0.076, 0.096, 0.097], 0.02, 'skin');           // 頭蓋
  E([0, 1.585, 0.03], [0.064, 0.077, 0.071], 0.03, 'skin');            // 顔とあご
  add(capsule(xf(F, 'head', [0, 1.527, 0.07]), xf(F, 'head', [0, 1.5271, 0.07]), 0.023, 0.023), 0.02, 'skin'); // あご先
  for (const s of [1, -1]) {
    C([0.058 * s, 1.575, -0.005], [0.02 * s, 1.527, 0.064], 0.02, 0.02, 0.02, 'skin'); // あごの線
    E([0.045 * s, 1.605, 0.064], [0.02, 0.016, 0.02], 0.015, 'skin');                 // 頬骨
    E([0.078 * s, 1.603, -0.008], [0.012, 0.029, 0.019], 0.008, 'skin');              // 耳
  }
  C([-0.04, 1.648, 0.082], [0.04, 1.648, 0.082], 0.015, 0.015, 0.02, 'skin');         // 眉
  C([0, 1.636, 0.096], [0, 1.594, 0.12], 0.009, 0.0115, 0.012, 'skin');               // 鼻筋
  add(capsule(xf(F, 'head', [0, 1.592, 0.106]), xf(F, 'head', [0, 1.5921, 0.106]), 0.017, 0.017), 0.01, 'skin');
  E([0, 1.562, 0.094], [0.024, 0.012, 0.012], 0.01, 'skin');                          // 唇
  // 髪のかたまり: 頭蓋より少し大きく、額から下の顔の側は切り落とす
  const cap = ellipsoid(xf(F, 'head', [0, 1.651, -0.024]), F.head.q, [0.084, 0.094, 0.103]);
  const n = V([0, -0.5, 1]).normalize().applyQuaternion(F.head.q);
  add(clip(cap, xf(F, 'head', [0, 1.69, 0.07]), n), 0.012, 'hair');
  return P;
}

// 手（手の空間: 手首が原点、指は -y、手のひらは -x（左手。右手は x を反転）、親指は +z）
function handLocalPrims() {
  const P = [];
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const I = new THREE.Quaternion();
  P.push({ d: capsule(v(0, 0.05, 0), v(0, -0.02, 0), 0.027, 0.026, v(1, 0, 0), 0.7), k: 0.012, tag: 'skin' });
  P.push({ d: roundBox(v(0.001, -0.054, 0.0), I, [0.0035, 0.038, 0.031], 0.0105), k: 0.018, tag: 'skin' });
  P.push({ d: ellipsoid(v(-0.009, -0.04, 0.024), I, [0.013, 0.03, 0.017]), k: 0.012, tag: 'skin' }); // 親指の付け根のふくらみ
  // 指: 付け根の z、3 つの節の長さ、太さ（付け根・先）、扇の開き、曲げ
  const fingers = [
    { z: 0.029, len: [0.042, 0.025, 0.02], r: [0.0095, 0.0076], fan: 0.1, curl: [0.16, 0.3, 0.2] },
    { z: 0.0095, len: [0.047, 0.028, 0.022], r: [0.0098, 0.0078], fan: 0.02, curl: [0.2, 0.34, 0.22] },
    { z: -0.0095, len: [0.044, 0.027, 0.021], r: [0.0093, 0.0074], fan: -0.06, curl: [0.24, 0.36, 0.22] },
    { z: -0.028, len: [0.034, 0.021, 0.018], r: [0.0083, 0.0066], fan: -0.16, curl: [0.3, 0.38, 0.24] },
  ];
  for (const f of fingers) {
    let p = v(0.001, -0.09, f.z);
    let d = v(0, -Math.cos(f.fan), Math.sin(f.fan));
    const total = f.len.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let i = 0; i < 3; i++) {
      d.multiplyScalar(Math.cos(f.curl[i])).add(v(-Math.sin(f.curl[i]), 0, 0)).normalize();
      const q = p.clone().addScaledVector(d, f.len[i] - (i === 2 ? f.r[1] * 0.8 : 0));
      const ra = f.r[0] + (f.r[1] - f.r[0]) * (acc / total), rb = f.r[0] + (f.r[1] - f.r[0]) * ((acc + f.len[i]) / total);
      P.push({ d: capsule(p, q, ra, rb, v(1, 0, 0), 0.88), k: 0.003, tag: 'skin', finger: true });
      acc += f.len[i];
      p = p.clone().addScaledVector(d, f.len[i]);
    }
  }
  // 親指: 付け根から前（+z）と下へ、少し手のひらの側へ
  {
    let p = v(-0.006, -0.018, 0.028);
    const d = v(-0.3, -0.62, 0.72).normalize();
    const segs = [[0.042, 0.015, 0.012], [0.032, 0.0118, 0.0102], [0.026, 0.0098, 0.0085]];
    for (const [L, ra, rb] of segs) {
      d.add(v(-0.12, -0.08, -0.08)).normalize();
      const q = p.clone().addScaledVector(d, L);
      P.push({ d: capsule(p, q, ra, rb), k: 0.004, tag: 'skin', finger: true });
      p = q;
    }
  }
  // 部品をすべて包む箱
  const box = new THREE.Box3();
  for (const { d } of P) box.union(d.box);
  return { prims: P, box };
}
const HAND_LOCAL = handLocalPrims();

// 左手の網は手の空間で 1 回だけ作り（軸にそろった小さな格子で済む）、姿勢を付けた手首へ置く。右手は x を鏡に映す
// mitten: 粗い格子では細い指が途切れて点になるので、指どうしを薄くなじませて 1 枚の手の形にする
const handMeshes = new Map();
function handLocalMesh(h, mitten = false) {
  const key = `${h}:${mitten}`;
  const prims = mitten ? HAND_LOCAL.prims.map((p) => (p.finger ? { ...p, finger: false, k: 0.012 } : p)) : HAND_LOCAL.prims;
  // 手の場（手の空間で）: 細かい升目で近くの部品だけを調べる
  if (!handMeshes.has(key)) handMeshes.set(key, meshField(makeField(prims, HAND_LOCAL.box, 0.03, 0.06), HAND_LOCAL.box, h));
  return handMeshes.get(key);
}

// ---- 場を網にする: 格子で Surface Nets、頂点を本当の面へ寄せ、法線は場の傾きから ----
function meshField(field, box, h) {
  const ax = (a, b) => { const n = Math.ceil((b - a) / h) + 1; return Array.from({ length: n }, (_, i) => a + i * h); };
  const pad = 2.5 * h;
  const xs = ax(box.min.x - pad, box.max.x + pad), ys = ax(box.min.y - pad, box.max.y + pad), zs = ax(box.min.z - pad, box.max.z + pad);
  const { positions, indices } = surfaceNets(field, xs, ys, zs, { lipschitz: 1.5, block: 2 });
  const nv = positions.length / 3;
  const grad = (x, y, z, out) => {
    const e = 1e-4;
    const a = field(x + e, y - e, z - e), b = field(x - e, y - e, z + e), c = field(x - e, y + e, z - e), d = field(x + e, y + e, z + e);
    out[0] = a - b - c + d; out[1] = -a - b + c + d; out[2] = -a + b - c + d;
    const l = len3(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
  };
  const raw = positions.slice();
  const normals = new Float32Array(nv * 3), g = [0, 0, 0];
  for (let i = 0; i < nv; i++) {
    let x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    // 2 回寄せる。2 回目の歩幅はごく小さいので、その傾きをそのまま法線に使う
    for (let it = 0; it < 2; it++) {
      const d = field(x, y, z);
      grad(x, y, z, g);
      const s = Math.max(-h * 0.5, Math.min(h * 0.5, d));
      x -= g[0] * s; y -= g[1] * s; z -= g[2] * s;
    }
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    normals[i * 3] = g[0]; normals[i * 3 + 1] = g[1]; normals[i * 3 + 2] = g[2];
  }
  // 細い溝で寄せたせいで裏返った三角形の頂点は寄せる前へ戻し、法線は周りの面から。残ったものは巻きを逆に
  const P = positions, N = normals, I = indices;
  const fd = new Float64Array(4);
  const faceDot = (t) => {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    fd[0] = nx * (N[a] + N[b] + N[c]) + ny * (N[a + 1] + N[b + 1] + N[c + 1]) + nz * (N[a + 2] + N[b + 2] + N[c + 2]);
    fd[1] = nx; fd[2] = ny; fd[3] = nz;
    return fd;
  };
  const flipped = new Set();
  for (let t = 0; t < I.length; t += 3) if (faceDot(t)[0] < 0) for (let k = 0; k < 3; k++) flipped.add(I[t + k] * 3);
  for (const k of flipped) { P[k] = raw[k]; P[k + 1] = raw[k + 1]; P[k + 2] = raw[k + 2]; N[k] = N[k + 1] = N[k + 2] = 0; }
  if (flipped.size) {
    for (let t = 0; t < I.length; t += 3) {
      const ks = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
      if (!ks.some((k) => flipped.has(k))) continue;
      const r = faceDot(t), nx = r[1], ny = r[2], nz = r[3];
      for (const k of ks) if (flipped.has(k)) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
    }
    for (const k of flipped) { const l = len3(N[k], N[k + 1], N[k + 2]) || 1; N[k] /= l; N[k + 1] /= l; N[k + 2] /= l; }
  }
  for (let t = 0; t < I.length; t += 3) if (faceDot(t)[0] <= 0) { const k = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = k; }
  return { positions, normals, indices };
}

// ---- 曲線から組む部品（どれも外向きの三角形と法線） ----
// 網を集める入れ物
// 速さのため、型付き配列を先に大きめに取って書き込む（最後に使った分だけを切り出す）
function createSink(maxVerts = 16384) {
  const pos = new Float32Array(maxVerts * 3), nrm = new Float32Array(maxVerts * 3), col = new Float32Array(maxVerts * 3);
  const kind = new Float32Array(maxVerts), flut = new Float32Array(maxVerts * 2), idx = new Uint32Array(maxVerts * 6);
  const bones = new Float32Array(maxVerts * 4); // 頂点ごとの近い 2 本の骨 [b1, d1, b2, d2]（b1 が -1 なら骨の線分までの距離で決める）
  let nv = 0, ni = 0;
  return {
    pos, nrm, col, kind, flut, idx, bones,
    get n() { return nv; },
    get ni() { return ni; },
    vert(p, n, c, k, a = 0, ph = 0, b1 = -1, d1 = 0, b2 = -1, d2 = 0) {
      const i = nv++;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      nrm[i * 3] = n.x; nrm[i * 3 + 1] = n.y; nrm[i * 3 + 2] = n.z;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      kind[i] = k; flut[i * 2] = a; flut[i * 2 + 1] = ph;
      bones[i * 4] = b1; bones[i * 4 + 1] = d1; bones[i * 4 + 2] = b2 < 0 ? b1 : b2; bones[i * 4 + 3] = d2;
      return i;
    },
    tri(a, b, c) { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; },
  };
}

// 格子状の面（rows × cols の点）の、各点の法線を三角形から
function gridNormals(pts, rows, cols) {
  const N = pts.map(() => new THREE.Vector3());
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), f = new THREE.Vector3();
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    for (const [p, q, r] of [[a, c, b], [b, c, d]]) {
      f.crossVectors(e1.subVectors(pts[q], pts[p]), e2.subVectors(pts[r], pts[p]));
      N[p].add(f); N[q].add(f); N[r].add(f);
    }
  }
  return N.map((n) => n.normalize());
}
// 薄い布（2 枚重ね）: 表（out の向き）と、わずかに内へずらした裏。amp[i] と ph[i] は揺れ
function cloth(sink, pts, rows, cols, out, colA, colB, k, amp, ph, gap = 0.004) {
  let N = gridNormals(pts, rows, cols);
  // 表は out の側を向く（巻きをそろえる）
  let sum = 0;
  N.forEach((n, i) => { sum += n.dot(out(i)); });
  const flip = sum < 0;
  if (flip) N = N.map((n) => n.clone().negate());
  for (const layer of [0, 1]) {
    const base = sink.n;
    pts.forEach((p, i) => {
      const n = layer ? N[i].clone().negate() : N[i];
      const q = layer ? p.clone().addScaledVector(N[i], -gap) : p;
      sink.vert(q, n, layer ? colB : colA, k, amp[i], ph[i]);
    });
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
      const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      // gridNormals の向き（a, c, b）が表。裏返すときは逆に
      if (flip !== !!layer) { sink.tri(a, b, c); sink.tri(b, d, c); } else { sink.tri(a, c, b); sink.tri(b, c, d); }
    }
  }
}

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// 髪の房: 頭の髪のかたまりの上から、後ろと少し上（熱風の向き）へ流れる平たい束。先は細くとがる
function hairTufts(sink, F, opt, C) {
  const W = V(HERO_WIND).applyQuaternion(F.head.q.clone().invert()); // 頭の休みの空間での風（あとで頭の向きへ戻す）
  const cc = [0, 1.651, -0.024], rr = [0.084, 0.094, 0.103];
  const n = opt.tufts, segs = opt.tuftSeg, sides = opt.tuftSides;
  for (let t = 0; t < n; t++) {
    // 髪の生える範囲（頭のてっぺんから後ろ・横。顔の前は除く）に、黄金角でばらまく
    const u = (t + 0.5) / n;
    const pol = Math.acos(1 - 1.55 * u);        // 0 = てっぺん、下へ約 118° まで
    const az = t * 2.39996 + 0.3;
    let dir = new THREE.Vector3(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az));
    // 顔の前・下（額より下の前）には生やさず、後ろへ回す
    if (dir.z > 0.45 && dir.y < 0.75) dir.z = -dir.z * 0.6;
    dir.normalize();
    const root = new THREE.Vector3(cc[0] + dir.x * rr[0] * 0.94, cc[1] + dir.y * rr[1] * 0.94, cc[2] + dir.z * rr[2] * 0.94);
    const nrm = dir.clone();
    // 長さ: 後ろほど長く（襟まで）、てっぺんは短め
    const back = Math.max(0, -dir.z);
    const L = 0.06 + 0.085 * back + 0.03 * Math.max(0, -dir.y) + 0.02 * hash(t + 3);
    // 流れ: 頭の丸みに沿って後ろ・下へ（風で後ろへ寄る）。先だけ頭から離れて風の向きへ
    const down = new THREE.Vector3(0, -0.7, -1);
    const along = down.clone().addScaledVector(nrm, -down.dot(nrm)).normalize();
    const flow = along.clone().multiplyScalar(0.7).addScaledVector(W, 0.45 + 0.35 * back).normalize();
    const side = new THREE.Vector3().crossVectors(along, nrm).normalize();
    const p1 = root.clone().addScaledVector(along, L * 0.45).addScaledVector(nrm, 0.006 + 0.004 * hash(t));
    const p2 = p1.clone().addScaledVector(flow, L * 0.55).addScaledVector(side, (hash(t + 9) - 0.5) * 0.025);
    p2.y = Math.min(p2.y, HERO_BODY.crown - 0.012); // 頭のてっぺんより上へ立たない
    const width = 0.026 + 0.012 * hash(t + 5), thick = 0.008;
    const ring = [];
    const phase = hash(t + 11) * 6.283;
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      // 2 次のベジェ（root → p1 → p2）
      const c = root.clone().multiplyScalar((1 - s) ** 2).addScaledVector(p1, 2 * s * (1 - s)).addScaledVector(p2, s * s);
      const tan = p1.clone().sub(root).multiplyScalar(2 * (1 - s)).addScaledVector(p2.clone().sub(p1), 2 * s).normalize();
      const up = nrm.clone().addScaledVector(tan, -nrm.dot(tan)).normalize();
      const sd = new THREE.Vector3().crossVectors(tan, up).normalize();
      const taper = (1 - s) ** 0.8;
      const amp = 0.022 * (L / 0.15) * s ** 1.5;
      if (i === segs) { ring.push([sink.vert(xf(F, 'head', c.toArray()), tan.clone().applyQuaternion(F.head.q), C.hair, HERO_KIND.hair, amp, phase + s * 5)]); break; }
      const r = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const off = sd.clone().multiplyScalar(Math.cos(a) * width * taper).addScaledVector(up, Math.sin(a) * thick * taper);
        const nn = sd.clone().multiplyScalar(Math.cos(a) / width).addScaledVector(up, Math.sin(a) / thick).normalize();
        r.push(sink.vert(xf(F, 'head', c.clone().add(off).toArray()), nn.applyQuaternion(F.head.q), C.hair, HERO_KIND.hair, amp, phase + s * 5));
      }
      ring.push(r);
    }
    for (let i = 0; i < segs; i++) {
      const A = ring[i], B = ring[i + 1];
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        if (B.length === 1) sink.tri(A[k], B[0], A[k1]);
        else { sink.tri(A[k], B[k1], A[k1]); sink.tri(A[k], B[k], B[k1]); }
      }
    }
  }
}

// 上着の裾: 腰から膝の上まで。前は開き、後ろに小さな切れ込み。下ほど広がり、熱風で後ろ・上へなびく。縦のひだ
function coatSkirt(sink, F, opt, C) {
  const pel = F.pelvis;
  const W = V(HERO_WIND);
  const prof = (knots, v) => {
    for (let i = 0; i + 1 < knots.length; i++) {
      const [v0, a] = knots[i], [v1, b] = knots[i + 1];
      if (v <= v1) { const t = (v - v0) / (v1 - v0); const s = t * t * (3 - 2 * t); return a + (b - a) * s; }
    }
    return knots[knots.length - 1][1];
  };
  const RX = [[0, 0.12], [0.19, 0.178], [0.45, 0.192], [1, 0.212]], RZ = [[0, 0.09], [0.19, 0.13], [0.45, 0.14], [1, 0.162]];
  const yTop = 1.03, yHem = 0.45;
  const rows = opt.coatV + 1, cols = opt.coatU + 1;
  for (const s of [1, -1]) {
    const pts = [], amp = [], ph = [], outs = [];
    for (let i = 0; i < rows; i++) {
      const v = i / (rows - 1);
      for (let j = 0; j < cols; j++) {
        const u = j / (cols - 1);
        const phi = s * (0.42 + (Math.PI - 0.05 - 0.42) * u); // 前の開きから後ろの切れ込みまで
        const fold = 0.006 * Math.sin(phi * 9 + 1) * v + 0.012 * Math.sin(phi * 7 + 0.5) * v * v;
        const rx = prof(RX, v) + fold, rz = prof(RZ, v) + fold;
        const backK = 0.55 - 0.45 * Math.cos(phi); // 後ろほど大きくなびく
        const p = new THREE.Vector3(Math.sin(phi) * rx, yTop + (yHem - yTop) * v, Math.cos(phi) * rz).sub(V(REST.pelvis));
        p.applyQuaternion(pel.q).add(pel.p).addScaledVector(W, 0.11 * v * v * backK);
        pts.push(p);
        outs.push(new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi)).applyQuaternion(pel.q));
        amp.push(0.045 * v ** 1.6 * (0.6 + 0.4 * backK));
        ph.push(v * 4 + phi * 2.2);
      }
    }
    cloth(sink, pts, rows, cols, (i) => outs[i], C.coat, C.lining, HERO_KIND.coat, amp, ph, 0.005);
  }
}

// 襟巻きの尾: 首の後ろの結び目から、熱風の向きへ流れる帯（ねじれと波）
function scarfTail(sink, F, opt, C) {
  const W = V(HERO_WIND);
  const start = xf(F, 'neck', [0.035, 1.425, -0.07]);
  const lat = new THREE.Vector3(1, 0, 0).applyQuaternion(F.chest.q);
  const up = new THREE.Vector3().crossVectors(lat, W).normalize(); // 風に直角で上向き
  const segs = opt.scarfSeg, across = 3, Lr = 0.52;
  const pts = [], amp = [], ph = [], outs = [];
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    // 風の向きより少し低く（布の重さで垂れる）、横へも流れる（正面や背中から見ても頭に重ならない）
    const c = start.clone().addScaledVector(W, Lr * s).addScaledVector(up, 0.04 * Math.sin(s * 4.5) * s - 0.16 * s * s).addScaledVector(lat, 0.16 * s + 0.025 * Math.sin(s * 6) * s);
    const tw = 0.5 * s + 0.25 * Math.sin(s * 5);
    const wv = lat.clone().multiplyScalar(Math.cos(tw)).addScaledVector(up, Math.sin(tw));
    const w = 0.09 - 0.025 * s;
    for (let j = 0; j < across; j++) {
      const a = j / (across - 1) - 0.5;
      pts.push(c.clone().addScaledVector(wv, a * w));
      outs.push(new THREE.Vector3().crossVectors(wv, W).normalize());
      amp.push(0.085 * s ** 1.3);
      ph.push(s * 6.5);
    }
  }
  cloth(sink, pts, segs + 1, across, (i) => outs[i], C.scarf, C.scarf, HERO_KIND.scarf, amp, ph, 0.004);
}

// ---- まとめる ----
function boneSegments(F) {
  return HERO_BONES.map((b) => {
    const a = F[b].p, t = xf(F, b, TAIL[b]);
    return { a, ab: t.clone().sub(a) };
  });
}
function segDist(s, x, y, z) {
  const px = x - s.a.x, py = y - s.a.y, pz = z - s.a.z;
  const bb = s.ab.lengthSq();
  const t = Math.min(1, Math.max(0, (px * s.ab.x + py * s.ab.y + pz * s.ab.z) / bb));
  return len3(px - s.ab.x * t, py - s.ab.y * t, pz - s.ab.z * t);
}

// 組み立ての本体。重い区切り（体・頭・手・残り）ごとに yield する（少しずつ組み立てられる）。
// buildMs は実際に計算していた時間の和（区切りの間に待った時間は数えない）
function* buildSteps(detail, pose) {
  let ms = 0, t0 = performance.now();
  const pause = function* () { ms += performance.now() - t0; yield; t0 = performance.now(); };
  const opt = DETAIL[detail];
  const F = fk(pose);
  const C = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, srgb(v)]));
  const sink = createSink();
  const counts = {};

  // 距離の場の網を入れ物へ。色は最も近い部品の tag、骨の候補は骨ごとに最も近い部品までの距離
  const addField = (name, prims, field, box, h) => {
    const m = meshField(field, box, h);
    const nv = m.positions.length / 3, base = sink.n;
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    const boneOf = Int8Array.from(prims.map((pr) => HERO_BONES.indexOf(pr.bone)));
    const fs = prims.map((pr) => pr.d), cols = prims.map((pr) => C[pr.tag]);
    const near = new Float64Array(HERO_BONES.length);
    for (let i = 0; i < nv; i++) {
      p.fromArray(m.positions, i * 3); n.fromArray(m.normals, i * 3);
      let best = Infinity, c = C.skin;
      near.fill(Infinity);
      for (let j = 0; j < fs.length; j++) {
        const f = fs[j];
        if (len3(p.x - f.cx, p.y - f.cy, p.z - f.cz) - f.r >= best + 0.08) continue;
        const d = f(p.x, p.y, p.z);
        if (d < best) { best = d; c = cols[j]; }
        if (d < near[boneOf[j]]) near[boneOf[j]] = d;
      }
      let b1 = -1, d1 = Infinity, b2 = -1, d2 = Infinity;
      for (let k = 0; k < near.length; k++) {
        const d = Math.max(0, near[k]);
        if (near[k] === Infinity) continue;
        if (d < d1) { b2 = b1; d2 = d1; b1 = k; d1 = d; } else if (d < d2) { b2 = k; d2 = d; }
      }
      sink.vert(p, n, c, HERO_KIND.body, 0, 0, b1, d1, b2, d2);
    }
    for (let t = 0; t < m.indices.length; t += 3) sink.tri(m.indices[t] + base, m.indices[t + 1] + base, m.indices[t + 2] + base);
    counts[name] = nv;
  };
  const boxOf = (prims) => {
    const b = new THREE.Box3();
    for (const { d } of prims) b.union(d.box);
    return b;
  };
  const bp = bodyPrims(F);
  const bb = boxOf(bp);
  addField('body', bp, makeField(bp, bb), bb, opt.body);
  yield* pause();
  const hp = headPrims(F);
  const hb = boxOf(hp);
  addField('head', hp, makeField(hp, hb), hb, opt.head);
  yield* pause();
  const palmNormal = {};
  const hm = handLocalMesh(opt.hand, !!opt.mitten);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const hq = F[`hand.${side}`].q, hpos = F[`hand.${side}`].p;
    const before = sink.n;
    const nv = hm.positions.length / 3;
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    // 骨: 手（手首の所だけ前腕へなじむ）
    const hb = HERO_BONES.indexOf(`hand.${side}`), fb = HERO_BONES.indexOf(`foreArm.${side}`);
    const all = boneSegments(F), seg = all[fb], segH = all[hb];
    for (let i = 0; i < nv; i++) {
      p.fromArray(hm.positions, i * 3); n.fromArray(hm.normals, i * 3);
      p.x *= s; n.x *= s;
      p.applyQuaternion(hq).add(hpos); n.applyQuaternion(hq);
      const dh = segDist(segH, p.x, p.y, p.z), df = segDist(seg, p.x, p.y, p.z);
      if (dh <= df) sink.vert(p, n, C.skin, HERO_KIND.body, 0, 0, hb, dh, fb, df);
      else sink.vert(p, n, C.skin, HERO_KIND.body, 0, 0, fb, df, hb, dh);
    }
    const I = hm.indices;
    for (let t = 0; t < I.length; t += 3) {
      // 鏡に映した右手は巻きを逆にして外向きを保つ
      if (s > 0) sink.tri(I[t] + before, I[t + 1] + before, I[t + 2] + before);
      else sink.tri(I[t] + before, I[t + 2] + before, I[t + 1] + before);
    }
    counts[`hand${side}`] = nv;
    palmNormal[side] = new THREE.Vector3(-s, 0, 0).applyQuaternion(hq).toArray();
  }
  yield* pause();
  let mark = sink.n;
  hairTufts(sink, F, opt, C); counts.hair = sink.n - mark; mark = sink.n;
  coatSkirt(sink, F, opt, C); counts.coat = sink.n - mark; mark = sink.n;
  scarfTail(sink, F, opt, C); counts.scarf = sink.n - mark;

  // 浮かせる: いちばん低い所を pose.lift へ
  const nv = sink.n;
  let minY = Infinity;
  for (let i = 0; i < nv; i++) minY = Math.min(minY, sink.pos[i * 3 + 1]);
  const dy = pose.lift == null ? 0 : pose.lift - minY;
  const segs0 = boneSegments(F); // 浮かせる前の骨（重みは浮かせる前の位置で）
  if (dy) { for (let i = 0; i < nv; i++) sink.pos[i * 3 + 1] += dy; for (const b of HERO_BONES) F[b].p.y += dy; }

  // 重み: 近い 2 本の骨（場の網は部品までの距離、ほかは骨の線分までの距離。髪は頭だけ）
  const segs = segs0;
  const skinIndex = new Uint8Array(nv * 2), skinWeight = new Float32Array(nv * 2);
  const head = HERO_BONES.indexOf('head');
  const K = 0.012;
  for (let i = 0; i < nv; i++) {
    const x = sink.pos[i * 3], y = sink.pos[i * 3 + 1] - dy, z = sink.pos[i * 3 + 2];
    let b1 = sink.bones[i * 4], d1 = sink.bones[i * 4 + 1], b2 = sink.bones[i * 4 + 2], d2 = sink.bones[i * 4 + 3];
    if (sink.kind[i] === HERO_KIND.hair) { b1 = b2 = head; d1 = d2 = 0; }
    else if (b1 < 0) {
      d1 = d2 = Infinity;
      for (let k = 0; k < segs.length; k++) {
        const d = segDist(segs[k], x, y, z);
        if (d < d1) { b2 = b1; d2 = d1; b1 = k; d1 = d; } else if (d < d2) { b2 = k; d2 = d; }
      }
    }
    const w1 = 1 / (d1 + K) ** 4, w2 = b2 === b1 ? 0 : 1 / (d2 + K) ** 4;
    skinIndex[i * 2] = b1; skinIndex[i * 2 + 1] = b2;
    skinWeight[i * 2] = w1 / (w1 + w2); skinWeight[i * 2 + 1] = w2 / (w1 + w2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(sink.pos.slice(0, nv * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(sink.nrm.slice(0, nv * 3), 3));
  geometry.setAttribute('aCol', new THREE.BufferAttribute(sink.col.slice(0, nv * 3), 3));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(sink.kind.slice(0, nv), 1));
  geometry.setAttribute('aFlut', new THREE.BufferAttribute(sink.flut.slice(0, nv * 2), 2));
  const idx = sink.idx.subarray(0, sink.ni);
  geometry.setIndex(new THREE.BufferAttribute(nv > 65535 ? idx.slice() : Uint16Array.from(idx), 1));
  geometry.computeBoundingSphere();

  // 目印（姿勢を付けた位置）
  const joints = Object.fromEntries(HERO_BONES.map((b) => [b, F[b].p.toArray()]));
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? 1 : -1;
    joints[`toe${S}`] = xf(F, `foot.${S}`, [0.112 * s, 0.035, 0.233]).toArray();
    joints[`heel${S}`] = xf(F, `foot.${S}`, [0.1 * s, 0.002, -0.06]).toArray();
  }
  joints.crown = xf(F, 'head', [0, HERO_BODY.crown, -0.02]).toArray();

  return {
    detail, pose, geometry, skinIndex, skinWeight, joints, palmNormal, bones: HERO_BONES,
    counts: { ...counts, vertices: nv, triangles: sink.ni / 3 },
    _fk: F, _dy: dy,
    buildMs: Math.max(1e-3, ms + performance.now() - t0),
  };
}

// 組み立て途中のもの（createHeroBodyBuilder）と、できあがったもの。どちらも姿勢 → 細かさ で引く
const cache = new Map(), pending = new Map();
const slot = (m, pose) => { let byPose = m.get(pose); if (!byPose) m.set(pose, (byPose = new Map())); return byPose; };
const detailOf = (detail) => (DETAIL[detail] ? detail : 'mid');

// 少しずつ組み立てる。step() は区切り 1 つぶん進めて、できあがったら true。finish() は残りを一度に進めて体を返す。
// できあがった体は buildHeroBody と同じものとして覚える（同じ組をもう組み立てない）
export function createHeroBodyBuilder({ detail = 'mid', pose = FLOAT_POSE } = {}) {
  const d = detailOf(detail);
  const done = slot(cache, pose), wait = slot(pending, pose);
  if (!done.has(d) && !wait.has(d)) wait.set(d, buildSteps(d, pose));
  const step = () => {
    if (done.has(d)) return true;
    const r = wait.get(d).next();
    if (!r.done) return false;
    done.set(d, r.value);
    wait.delete(d);
    return true;
  };
  return {
    step,
    get done() { return done.has(d); },
    get body() { return done.get(d) ?? null; },
    finish() { while (!step()); return done.get(d); },
  };
}

// detail: 'high' | 'mid' | 'low'、pose: FLOAT_POSE（省いたとき）など。同じ組は 1 回だけ組み立てる（途中のものは続きから）
export function buildHeroBody({ detail = 'mid', pose = FLOAT_POSE } = {}) {
  return createHeroBodyBuilder({ detail, pose }).finish();
}

// 組み立てた姿勢に、骨ごとの回転 rot（{ 骨の名前: [rx, ry, rz] }、親から見た向きに重ねる）を足した頂点の位置
// out: 書き込む配列（毎フレーム使い回すとき。省けば新しく作る）
export function skinPose(body, rot = {}, out = null) {
  const F0 = body._fk, F1 = fk(body.pose, rot);
  for (const b of HERO_BONES) F1[b].p.y += body._dy;
  const P = body.geometry.attributes.position.array;
  out ??= new Float32Array(P.length);
  const M = HERO_BONES.map((b) => {
    const q = F1[b].q.clone().multiply(F0[b].q.clone().invert());
    return { q, p0: F0[b].p, p1: F1[b].p };
  });
  const v = new THREE.Vector3(), acc = new THREE.Vector3();
  for (let i = 0; i < P.length / 3; i++) {
    acc.set(0, 0, 0);
    for (let k = 0; k < 2; k++) {
      const w = body.skinWeight[i * 2 + k];
      if (w <= 0) continue;
      const m = M[body.skinIndex[i * 2 + k]];
      v.fromArray(P, i * 3).sub(m.p0).applyQuaternion(m.q).add(m.p1);
      acc.addScaledVector(v, w);
    }
    out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
  }
  return out;
}

// 距離の場の部品と網を作る道具（演出で大きく映る軍勢の一人の体 riderBody.js も同じやり方で組む）
export const FIELD = { capsule, ellipsoid, roundBox, clip, makeField, meshField };
