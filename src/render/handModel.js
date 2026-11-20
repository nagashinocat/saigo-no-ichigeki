import * as THREE from 'three';
import { HAND_JOINTS } from './handPose.js';
import { surfaceNets } from './surfaceNets.js';

// 主人公の右手を、コードで組み立てる（1つの SkinnedMesh と、WebXR の関節名の骨）。
// 形は「距離の場」で作る: 骨ごとのカプセルを滑らかにつなぎ、関節・拳・親指の付け根をふくらませ、
// その 0 の面を Surface Nets で網にする。各頂点は最も近い 2 本の骨に重みづけする。
//
// 手の空間（メートル）: 手首の関節が原点、指先は -Z、手の甲は +Y、親指は -X（右手）。
// どの骨も WebXR と同じく、-Z が子の関節の向き、+Y が甲の側。poseFor の rx は -X 軸まわりで手のひらの側へ曲がる。
// 形は力の抜けた、指を少し開いた右手（handPose の open がこれに少し丸みを足す）。

const DETAIL = {
  high: { cell: 0.0035, tendons: true },
  low: { cell: 0.0055, tendons: false },
};

const ARM_LEN = 0.17;     // 手首から先に伸ばす前腕の長さ（画面の外まで）
const WRIST_BLEND = [-0.05, -0.008]; // この z の間で、肌の重みを手のひらの骨から手首の骨へ移す（手首の関節は z = 0）
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

// 指: 中手骨の付け根（metacarpal）、拳の関節（MCP）、扇の開き（度、正が親指の側）、
// 指節の長さ（基節・中節・末節）、太さ（拳・第二関節・第一関節・指先の半径）
const FINGERS = {
  index: { cmc: v3(-0.016, 0.004, -0.022), mcp: v3(-0.031, 0.001, -0.097), fan: 9, len: [0.045, 0.027, 0.022], r: [0.0105, 0.0097, 0.0086, 0.0074] },
  middle: { cmc: v3(-0.004, 0.005, -0.024), mcp: v3(-0.0095, 0.002, -0.101), fan: 1, len: [0.05, 0.031, 0.024], r: [0.0108, 0.01, 0.0088, 0.0076] },
  ring: { cmc: v3(0.008, 0.004, -0.023), mcp: v3(0.0115, 0.0, -0.095), fan: -8, len: [0.046, 0.029, 0.023], r: [0.0102, 0.0094, 0.0083, 0.0071] },
  pinky: { cmc: v3(0.019, 0.0, -0.021), mcp: v3(0.0305, -0.004, -0.085), fan: -18, len: [0.036, 0.022, 0.02], r: [0.0092, 0.0084, 0.0075, 0.0065] },
};
const PARTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
// 親指: 付け根、各骨の向き、長さ、半径（付け根・MCP・IP・指先）。甲の向きは手のひらから外へ大きくひねる
const THUMB = {
  cmc: v3(-0.019, -0.007, -0.02),
  dirs: [v3(-0.6, -0.26, -0.76), v3(-0.46, -0.22, -0.86), v3(-0.36, -0.2, -0.91)],
  len: [0.047, 0.033, 0.027],
  r: [0.0125, 0.0108, 0.0098, 0.0082],
  roll: -62, // 親指の甲（爪の側）を、手の甲の向きから親指の軸まわりにこれだけ回す
};

// ---- 距離の場の部品（どれも手の空間の点 → おおよその距離。負が内側） ----

// 両端で太さの変わるカプセル。flat < 1 で甲と手のひらの向き（up）に平たくする
// flat に [付け根, 先] を渡すと、平たさが途中で変わる
function capsule(a, b, ra, rb, up = v3(0, 1, 0), flat = 1) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const bb = bax * bax + bay * bay + baz * baz;
  const [fa, fb] = Array.isArray(flat) ? flat : [flat, flat];
  const ux = up.x, uy = up.y, uz = up.z;
  const fn = (x, y, z) => {
    const px = x - a.x, py = y - a.y, pz = z - a.z;
    const t = Math.min(1, Math.max(0, (px * bax + py * bay + pz * baz) / bb));
    let ox = px - bax * t, oy = py - bay * t, oz = pz - baz * t;
    const s = (ox * ux + oy * uy + oz * uz) * (1 / (fa + (fb - fa) * t) - 1);
    ox += ux * s; oy += uy * s; oz += uz * s;
    return Math.sqrt(ox * ox + oy * oy + oz * oz) - (ra + (rb - ra) * t);
  };
  // 包む球（遠くの点では部品ごと計算を省くのに使う）
  fn.c = a.clone().lerp(b, 0.5);
  fn.cx = fn.c.x; fn.cy = fn.c.y; fn.cz = fn.c.z;
  fn.r = Math.sqrt(bb) / 2 + Math.max(ra, rb);
  return fn;
}
const sphere = (c, r) => capsule(c, c.clone().add(v3(0, 0, 1e-6)), r, r);
// 滑らかな和（k: なじませる幅）
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const smin = (a, b, k) => { if (a === Infinity || b === Infinity) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// 骨の向き: -Z が dir、+Y がなるべく up
function frame(dir, up) {
  const z = dir.clone().normalize().negate();
  const x = up.clone().cross(z).normalize();
  const y = z.clone().cross(x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// 関節の位置と向き（手の空間）、形の部品を決める
function layout(opt) {
  const joints = {}; // name -> { p, q, up }
  const parts = [];  // { bone, d, group }
  const up0 = v3(0, 1, 0);
  joints.wrist = { p: v3(0, 0, 0), q: frame(v3(0, 0, -1), up0) };

  for (const [f, s] of Object.entries(FINGERS)) {
    const dir = v3(0, 0, -1).applyAxisAngle(up0, s.fan * DEG).add(v3(0, -0.02, 0)).normalize();
    const pts = [s.cmc, s.mcp];
    for (const L of s.len) pts.push(pts[pts.length - 1].clone().addScaledVector(dir, L));
    PARTS.forEach((part, i) => {
      const to = pts[Math.min(i + 1, 4)].clone().sub(pts[i]);
      joints[`${f}-finger-${part}`] = { p: pts[i], q: frame(i < 4 ? to : dir, up0), up: up0 };
    });
    const bone = (i) => `${f}-finger-${PARTS[i]}`;
    const [r0, r1, r2, r3] = s.r;
    // 指節: 平たいカプセルに、手のひら側の腹（節の中ほど）と甲側の関節の骨の角を足す。
    // 腹と腹の間が関節のしわになり、曲げると甲の側に角が立つ。末節は指先の丸みのぶん手前で止める
    const tipEnd = pts[4].clone().addScaledVector(dir, -r3 * 0.8);
    const g = `finger-${f}`;
    const ends = [pts[1], pts[2], pts[3], tipEnd], rads = [r0, r1, r2, r3];
    for (let i = 0; i < 3; i++) {
      const a = ends[i], b = ends[i + 1], ra = rads[i] * (i ? 0.95 : 1), rb = rads[i + 1] * (i < 2 ? 0.95 : 1);
      const L = a.distanceTo(b);
      parts.push({ bone: bone(i + 1), group: g, d: capsule(a, b, ra, rb * (i < 2 ? 1 : 0.92), up0, i < 2 ? 0.86 : 0.9) });
      const pa = a.clone().addScaledVector(dir, L * (i < 2 ? 0.28 : 0.3)).addScaledVector(up0, -ra * 0.22);
      const pb = a.clone().addScaledVector(dir, L * (i < 2 ? 0.72 : 0.62)).addScaledVector(up0, -rb * 0.22);
      parts.push({ bone: bone(i + 1), group: g, d: capsule(pa, pb, ra * 0.84, rb * 0.84) });
      if (i < 2) {
        // 第二関節・第一関節: 甲の側の骨の角と、横にわずかに張る関節
        parts.push({ bone: bone(i + 1), group: g, d: sphere(b.clone().addScaledVector(dir, -0.001).addScaledVector(up0, rb * 0.34), rb * 0.74) });
        parts.push({ bone: bone(i + 1), group: g, d: capsule(b.clone().addScaledVector(dir, -0.002), b.clone().addScaledVector(dir, 0.0015), rb * 1.02, rb * 1.0, up0, 0.8) });
      }
    }
    // 手のひら: 中手骨に沿った平たいカプセル（手のひらの側へ厚い）と、甲に出る拳の骨
    parts.push({ bone: bone(0), group: 'palm', d: capsule(s.cmc.clone().add(v3(0, -0.004, 0)), s.mcp.clone().add(v3(0, -0.003, 0.004)), f === 'pinky' ? 0.0105 : 0.0118, r0 * 1.12, up0, 0.92) });
    parts.push({ bone: bone(0), group: 'knuckle', d: sphere(s.mcp.clone().add(v3(0, 0.0046, 0.0015)), r0 * 0.76) });
    if (opt.tendons) {
      // 甲の腱: 手首から拳へ、皮膚の下にうっすら
      parts.push({ bone: bone(0), group: 'tendon', d: capsule(v3(s.cmc.x * 0.8, 0.0062, -0.032), s.mcp.clone().add(v3(0, 0.0062, 0.013)), 0.0014, 0.0024) });
    }
  }
  // 指の付け根の手のひら側のふくらみ（指との境に小さな段差を作る）
  parts.push({ bone: 'middle-finger-metacarpal', group: 'palm', d: capsule(v3(-0.03, -0.0105, -0.088), v3(0.026, -0.0115, -0.078), 0.0068, 0.0062) });
  // 小指側の手のひらのふくらみ
  parts.push({ bone: 'pinky-finger-metacarpal', group: 'palm', d: capsule(v3(0.021, -0.008, -0.022), v3(0.027, -0.009, -0.066), 0.0118, 0.0098) });

  // 親指
  {
    const s = THUMB;
    const dirs = s.dirs.map((d) => d.clone().normalize());
    const ups = dirs.map((d) => {
      const u = up0.clone().addScaledVector(d, -up0.dot(d)).normalize();
      return u.applyAxisAngle(d, s.roll * DEG);
    });
    const pts = [s.cmc];
    for (let i = 0; i < 3; i++) pts.push(pts[i].clone().addScaledVector(dirs[i], s.len[i]));
    const names = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
    names.forEach((n, i) => { joints[n] = { p: pts[i], q: frame(dirs[Math.min(i, 2)], ups[Math.min(i, 2)]), up: ups[Math.min(i, 2)] }; });
    const [r0, r1, r2, r3] = s.r;
    const tipEnd = pts[3].clone().addScaledVector(dirs[2], -r3 * 0.8);
    parts.push({ bone: names[0], group: 'thumb0', d: capsule(pts[0], pts[1], r0, r1 * 0.95, ups[0], 0.9) });
    parts.push({ bone: names[1], group: 'thumb', d: capsule(pts[1], pts[2], r1 * 0.95, r2 * 0.9, ups[1], 0.86) });
    parts.push({ bone: names[2], group: 'thumb', d: capsule(pts[2], tipEnd, r2 * 0.95, r3, ups[2], 0.82) });
    parts.push({ bone: names[1], group: 'thumb', d: sphere(pts[2].clone().addScaledVector(ups[1], 0.001), r2 * 1.02) });
    parts.push({ bone: names[2], group: 'thumb', d: sphere(pts[2].clone().lerp(tipEnd, 0.6).addScaledVector(ups[2], -0.0022), r3 * 1.06) });
    // 親指の付け根のふくらみ（母指球）: 中手骨に沿って、手のひらの側へ厚く
    const toPalm = v3(0.012, -0.006, 0.0);
    parts.push({ bone: names[0], group: 'thenar', d: capsule(pts[0].clone().add(toPalm).add(v3(0.004, 0, 0.002)), pts[0].clone().lerp(pts[1], 0.72).add(toPalm), 0.0152, 0.0112, up0, 0.82) });
  }

  // 手首から前腕へ: 楕円の断面で細くなり、また太くなって画面の外へ
  parts.push({ bone: 'wrist', group: 'arm', d: capsule(v3(0, -0.0045, -0.014), v3(0, -0.003, 0.035), 0.028, 0.0268, up0, [0.76, 0.76]) });
  parts.push({ bone: 'wrist', group: 'arm', d: capsule(v3(0, -0.003, 0.035), v3(0, 0.0, ARM_LEN), 0.0268, 0.034, up0, [0.76, 0.82]) });
  // 手首の手のひらの側: 手のひらの付け根のふくらみから前腕へ、くびれずになだらかに下りる
  parts.push({ bone: 'wrist', group: 'arm', d: capsule(v3(0.001, -0.012, -0.03), v3(0, -0.01, 0.045), 0.02, 0.019, up0, 0.74) });

  return { joints, parts };
}

// 部品を組み合わせた距離の場。速さのため、部品の組と部品ごとに包む球を持ち、
// 包む球までの距離が「今の値 + なじませる幅」以上なら計算を省く（滑らかな和の結果は変わらないので、値は正確なまま）
function makeField(parts) {
  const group = (g, k) => {
    const fs = parts.filter((p) => p.group === g).map((p) => p.d);
    if (!fs.length) return null;
    const c = fs.reduce((s, f) => s.add(f.c), v3(0, 0, 0)).multiplyScalar(1 / fs.length);
    const r = Math.max(...fs.map((f) => f.c.distanceTo(c) + f.r));
    return { fs, k, cx: c.x, cy: c.y, cz: c.z, r };
  };
  const bound = (gr, x, y, z) => len3(x - gr.cx, y - gr.cy, z - gr.cz) - gr.r;
  const chain = (gr, x, y, z) => {
    let d = Infinity;
    for (const f of gr.fs) {
      if (len3(x - f.cx, y - f.cy, z - f.cz) - f.r >= d + gr.k) continue;
      d = smin(d, f(x, y, z), gr.k);
    }
    return d;
  };
  // 組を今の値へ滑らかに足す
  const add = (d, gr, k, x, y, z) => (!gr || bound(gr, x, y, z) >= d + k ? d : smin(d, chain(gr, x, y, z), k));
  const fingers = [...Object.keys(FINGERS).map((f) => group(`finger-${f}`, 0.0028)), group('thumb', 0.003)];
  const arm = group('arm', 0.02), palm = group('palm', 0.011), knuckle = group('knuckle', 0.004), tendon = group('tendon', 0.003);
  const thenar = group('thenar', 0.006), thumb0 = group('thumb0', 0.004);
  const FK = 0.0075;
  return (x, y, z) => {
    let d = chain(arm, x, y, z);
    d = add(d, palm, 0.03, x, y, z);
    d = add(d, knuckle, 0.006, x, y, z);
    d = add(d, tendon, 0.004, x, y, z);
    d = add(d, thenar, 0.018, x, y, z);
    d = add(d, thumb0, 0.01, x, y, z);
    // 指どうしは滑らかにつながない（くっついて手袋にならない）。手のひらとは水かきのようになじむ
    let f = Infinity;
    for (const gr of fingers) {
      if (bound(gr, x, y, z) >= Math.min(f, d + FK)) continue;
      f = Math.min(f, chain(gr, x, y, z));
    }
    return smin(d, f, FK);
  };
}

// 軸の座標: 区間ごとの間隔 [[ここまで, 間隔], ...] で a から並べる（間隔の変わり目はなめらかに）
function axis(a, spans) {
  const out = [a];
  let x = a, step = spans[0][1];
  for (const [end, h] of spans) {
    while (x < end) {
      step += (h - step) * 0.5;
      x += step;
      out.push(x);
    }
  }
  return out;
}

const SKIN = [1, 1, 1];

export function buildHandModel({ detail = 'high' } = {}) {
  const opt = DETAIL[detail] ?? DETAIL.high;
  const { joints, parts } = layout(opt);
  const field = makeField(parts);
  const h = opt.cell;

  // ---- 面を作る ----
  // 指の所は細かく、平たい手のひらと、まっすぐな前腕の向き（z）は粗く
  const xs = axis(-0.088, [[0.064, h]]), ys = axis(-0.043, [[0.033, h]]);
  const zs = axis(-0.215, [[-0.085, h], [-0.03, h * 1.45], [0.03, h * 1.6], [ARM_LEN + 0.045, 0.03]]);
  const { positions, indices } = surfaceNets(field, xs, ys, zs);
  const nv = positions.length / 3;
  // 場の傾き（四面体の 4 点で）。返すのは正規化した向き
  const grad = (x, y, z, out) => {
    const e = 1e-4;
    const a = field(x + e, y - e, z - e), b = field(x - e, y - e, z + e), c = field(x - e, y + e, z - e), d = field(x + e, y + e, z + e);
    out[0] = a - b - c + d; out[1] = -a - b + c + d; out[2] = -a + b - c + d;
    const l = len3(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
  };
  // 頂点を本当の面へ寄せ（格子の段がなくなる）、法線は場の傾きから
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
  // 細い溝（指の股や拳の間）では、寄せたせいで三角形が裏返ることがある。その頂点は寄せる前へ戻し、
  // 法線も周りの面の向きから取る（小さなとげを出さない）
  {
    const P = positions, N = normals, I = indices;
    const flippedVerts = new Set();
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const dot = nx * (N[a] + N[b] + N[c]) + ny * (N[a + 1] + N[b + 1] + N[c + 1]) + nz * (N[a + 2] + N[b + 2] + N[c + 2]);
      if (dot < 0) for (const k of [a, b, c]) flippedVerts.add(k);
    }
    for (const k of flippedVerts) { P[k] = raw[k]; P[k + 1] = raw[k + 1]; P[k + 2] = raw[k + 2]; N[k] = N[k + 1] = N[k + 2] = 0; }
    if (flippedVerts.size) {
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        if (!flippedVerts.has(a) && !flippedVerts.has(b) && !flippedVerts.has(c)) continue;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const k of [a, b, c]) if (flippedVerts.has(k)) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
      }
      for (const k of flippedVerts) { const l = len3(N[k], N[k + 1], N[k + 2]) || 1; N[k] /= l; N[k + 1] /= l; N[k + 2] /= l; }
    }
  }

  // ---- 爪: 末節の甲の側に、面に沿った薄い板 ----
  const nailPos = [], nailNrm = [], nailIdx = [], nailBone = [];
  const nailOf = (bone, a, tipJoint, up) => {
    const dir = tipJoint.clone().sub(a);
    const L = dir.length(); dir.normalize();
    const side = dir.clone().cross(up).normalize();
    const NA = 5, NB = 5, base = (nv + nailPos.length / 3);
    // 軸から向き ray へたどって、面までの距離
    const surf = (t, ray) => {
      const c = a.clone().addScaledVector(dir, t * L);
      let lo = 0, hi = 0.02;
      for (let it = 0; it < 20; it++) { const m = (lo + hi) / 2, p = c.clone().addScaledVector(ray, m); if (field(p.x, p.y, p.z) < 0) lo = m; else hi = m; }
      return lo;
    };
    const FLAT_FROM = 0.58; // ここから先は面の丸みに沿わず、平らに伸ばす（爪の先が少し浮く）
    for (let ia = 0; ia < NA; ia++) {
      const u = ia / (NA - 1);
      const t = 0.36 + 0.54 * u;               // 末節の付け根寄りから指先の手前まで
      const halfAng = (38 + 16 * Math.sin(Math.PI * Math.min(1, u * 1.25))) * DEG; // 付け根は狭く、中ほどで広い
      for (let ib = 0; ib < NB; ib++) {
        const th = ((ib / (NB - 1)) * 2 - 1) * halfAng;
        const ray = up.clone().multiplyScalar(Math.cos(th)).addScaledVector(side, Math.sin(th));
        const R = surf(Math.min(t, FLAT_FROM), ray);
        const p = a.clone().addScaledVector(dir, t * L).addScaledVector(ray, R);
        grad(...p.toArray(), g);
        // 平たい板: 法線は甲の向きに寄せ、少し浮かせる
        const n = v3(g[0], g[1], g[2]).lerp(ray, 0.5).lerp(up, 0.25).normalize();
        p.addScaledVector(ray, 0.0005);
        nailPos.push(p.x, p.y, p.z);
        nailNrm.push(n.x, n.y, n.z);
        nailBone.push(bone);
      }
    }
    for (let ia = 0; ia < NA - 1; ia++) for (let ib = 0; ib < NB - 1; ib++) {
      const q = base + ia * NB + ib;
      // 甲の側から見て反時計回り
      const p0 = q, p1 = q + 1, p2 = q + NB + 1, p3 = q + NB;
      nailIdx.push(p0, p2, p1, p0, p3, p2);
    }
  };
  for (const f of Object.keys(FINGERS)) {
    const j = joints[`${f}-finger-phalanx-distal`], tip = joints[`${f}-finger-tip`];
    nailOf(`${f}-finger-phalanx-distal`, j.p, tip.p, v3(0, 1, 0));
  }
  nailOf('thumb-phalanx-distal', joints['thumb-phalanx-distal'].p, joints['thumb-tip'].p, joints['thumb-phalanx-distal'].up);
  // 板の向きを場の法線と合わせる（裏返っていたら巻きを逆に）
  {
    const base = nv;
    for (let t = 0; t < nailIdx.length; t += 3) {
      const [a, b, c] = [nailIdx[t], nailIdx[t + 1], nailIdx[t + 2]].map((k) => v3(...nailPos.slice((k - base) * 3, (k - base) * 3 + 3)));
      const fn = b.sub(a).cross(c.sub(a));
      const n = v3(...nailNrm.slice((nailIdx[t] - base) * 3, (nailIdx[t] - base) * 3 + 3));
      if (fn.dot(n) < 0) { const k = nailIdx[t + 1]; nailIdx[t + 1] = nailIdx[t + 2]; nailIdx[t + 2] = k; }
    }
  }

  // ---- まとめて、重みと色 ----
  const total = nv + nailPos.length / 3;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3);
  pos.set(positions); pos.set(nailPos, nv * 3);
  nrm.set(normals); nrm.set(nailNrm, nv * 3);
  const skinIndex = new Uint16Array(total * 4), skinWeight = new Float32Array(total * 4);
  const boneIdx = Object.fromEntries(HAND_JOINTS.map((n, i) => [n, i]));
  const byBone = new Map();
  for (const p of parts) { if (!byBone.has(p.bone)) byBone.set(p.bone, []); byBone.get(p.bone).push(p.d); }
  const boneList = [...byBone.keys()];
  const phalanx = boneList.map((n) => n.includes('phalanx'));
  const K = 0.0017, K_PALM = 0.006, _p = v3(0, 0, 0);
  const wristK = boneList.indexOf('wrist');
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const tips = [...Object.keys(FINGERS).map((f) => joints[`${f}-finger-tip`].p), joints['thumb-tip'].p];
  const knuckles = Object.keys(FINGERS).flatMap((f) => [joints[`${f}-finger-phalanx-proximal`].p, joints[`${f}-finger-phalanx-intermediate`].p, joints[`${f}-finger-phalanx-distal`].p]);
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    // 最も近い 2 本の骨（その骨の部品の面までの距離）
    let b1 = -1, d1 = Infinity, b2 = -1, d2 = Infinity;
    for (let k = 0; k < boneList.length; k++) {
      let d = Infinity;
      for (const fn of byBone.get(boneList[k])) {
        if (len3(x - fn.cx, y - fn.cy, z - fn.cz) - fn.r >= Math.min(d, d2)) continue; // 届かない部品は省く
        d = Math.min(d, fn(x, y, z));
      }
      if (d < d1) { b2 = b1; d2 = d1; b1 = k; d1 = d; } else if (d < d2) { b2 = k; d2 = d; }
    }
    // 指の関節は境目をくっきり（曲げると角が立つ）、手のひらと手首の間はなだらかに
    const k = phalanx[b1] && phalanx[b2] ? K : K_PALM;
    let w1 = 1 / (Math.max(d1, 0) + k) ** 4, w2 = 1 / (Math.max(d2, 0) + k) ** 4;
    // 手首の切れ目を出さない: 手のひらの付け根から手首へ、手首の骨（前腕）の重みをなめらかに増やす。
    // 中手骨は手首の少し先を軸に回るので、それより腕側の肌が中手骨（とくに母指球）について行くと、手首に折れ目ができる
    const s = smooth(WRIST_BLEND[0], WRIST_BLEND[1], z);
    if (s > 0) {
      let dw = Infinity;
      for (const fn of byBone.get('wrist')) dw = Math.min(dw, fn(x, y, z));
      const ww = (1 / (Math.max(dw, 0) + K_PALM) ** 4) * (1 + 300 * s * s);
      // 重みの大きい 2 本を使う（手首が 3 番目なら、ほかの骨と同じく、重みで上回ったときに軽いほうと入れ替える）
      if (b1 === wristK) w1 = ww; else if (b2 === wristK) w2 = ww;
      else if (ww > Math.min(w1, w2)) { if (w1 >= w2) { b2 = wristK; w2 = ww; } else { b1 = wristK; w1 = ww; } }
    }
    skinIndex[i * 4] = boneIdx[boneList[b1]]; skinIndex[i * 4 + 1] = boneIdx[boneList[b2]];
    skinWeight[i * 4] = w1 / (w1 + w2); skinWeight[i * 4 + 1] = 1 - skinWeight[i * 4];
    // 肌の色むら: 指先と関節の甲は少し赤く、手のひらは少し明るい
    const p = _p.set(x, y, z);
    let red = 0;
    for (const t of tips) red = Math.max(red, 1 - p.distanceTo(t) / 0.016);
    for (const kn of knuckles) red = Math.max(red, (1 - p.distanceTo(kn) / 0.011) * 0.6);
    // 手のひらだけを明るく。手首でぷつりと切り替えず、手首の前後でなめらかに薄める
    const palmSide = Math.max(0, -nrm[i * 3 + 1]) * (1 - smooth(-0.02, 0.02, z));
    col[i * 3] = SKIN[0] * (1 + 0.04 * palmSide);
    col[i * 3 + 1] = SKIN[1] * (1 - 0.1 * red + 0.02 * palmSide);
    col[i * 3 + 2] = SKIN[2] * (1 - 0.12 * red + 0.02 * palmSide);
  }
  for (let i = nv; i < total; i++) {
    skinIndex[i * 4] = boneIdx[nailBone[i - nv]]; skinIndex[i * 4 + 1] = skinIndex[i * 4];
    skinWeight[i * 4] = 1;
    col.set(SKIN, i * 3); // 爪の色は爪の材質で
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  const allIdx = new Uint32Array(indices.length + nailIdx.length);
  allIdx.set(indices); allIdx.set(nailIdx, indices.length);
  geo.setIndex(new THREE.BufferAttribute(total > 65535 ? allIdx : new Uint16Array(allIdx), 1));
  // 描き分けのまとまり: 0 が肌、1 が爪（輪郭線は肌だけに付ける）
  geo.addGroup(0, indices.length, 0);
  geo.addGroup(indices.length, nailIdx.length, 1);
  geo.computeBoundingSphere();

  // ---- 骨 ----
  const bones = {};
  const parentOf = (name) => {
    if (name === 'wrist') return null;
    const m = name.match(/^(thumb|[a-z]+-finger)-(.+)$/);
    const list = m[1] === 'thumb' ? ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'] : PARTS;
    const i = list.indexOf(m[2]);
    return i === 0 ? 'wrist' : `${m[1]}-${list[i - 1]}`;
  };
  for (const name of HAND_JOINTS) {
    const b = new THREE.Bone();
    b.name = name;
    const j = joints[name], par = parentOf(name);
    if (!par) { b.position.copy(j.p); b.quaternion.copy(j.q); }
    else {
      const pj = joints[par], inv = pj.q.clone().invert();
      b.position.copy(j.p).sub(pj.p).applyQuaternion(inv);
      b.quaternion.copy(inv).multiply(j.q);
      bones[par].add(b);
    }
    bones[name] = b;
  }

  const root = new THREE.Group();
  root.name = 'hand';
  const mesh = new THREE.SkinnedMesh(geo, [new THREE.MeshStandardMaterial({ vertexColors: true }), new THREE.MeshStandardMaterial({ color: 0xf0c8b8 })]);
  mesh.frustumCulled = false;
  root.add(bones.wrist, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(HAND_JOINTS.map((n) => bones[n])));
  return { root, mesh, bones };
}
