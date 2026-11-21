import { CONFIG } from '../config.js';
import { groundHeight } from './sphereDeform.js';
import { FINALE } from './finaleTimeline.js';

// 最後の一発の演出の「どこで撮るか」を決める純粋な関数（描画は知らない）。
// ガラスの一拍（持ち主の絵コンテ 2026-11-21 09:40）: 軍勢の一人（浮遊バイクの乗り手）が通りの上に浮いて爆心（迫る光の壁）を
// 向いている。カメラはその背後・肩越し。光の壁は乗り手の数 m 前で止まりかけ、瓦礫とガラスが飛んでくる。時間が戻ると、
// 乗り手が飲まれて吹き飛び、カメラも飲まれる。そのあとカメラはそこから上へ・外へ、追ってくる爆発から逃げる（retreat の道）。
// 乗り手は実際の位置ではなく、ここで決めた場所に描く（白の間に置き直す。ゲームの軍勢の状態は変えない）。

export const PLAN = {
  enemyNear: 120,        // この距離までの生きた軍勢から、撮る一人を選ぶ
  riderRange: [24, 60],  // 乗り手を置く爆心からの水平の距離（m）
  riderFrac: 0.72,       // かつ、その一発の半径のこの割合まで（かならず光の壁に飲まれる）
  riderHover: 2.6,       // バイクの底の、地面からの高さ（m）
  riderClear: 1.6,       // 乗り手（バイク）はビルからこの距離より離れる
  camBack: 4.4,          // 始めのカメラは乗り手の背後（乗り手の向きの後ろ）にこの距離（m）。バイクの尾の推進の光が手前に入る
  camSide: 0.4,          // 横（肩越し。乗り手の頭と肩が画面の片側に入る）
  // 乗り手の頭（演出の一人の体 riderBody の前かがみの姿で、バイクの底から上・前へ m）
  head: { up: 1.43, fwd: 0.02 },
  // 目が映るガラス片の止まる所: 乗り手の顔の前（光の壁の側）、カメラの肩の側へ少しずれて頭より上（カメラから見て頭に隠れない）
  glass: { fwd: 1.25, side: 0.3, up: 0.28 },
  // ガラス片が来るとカメラが寄る所: 乗り手の頭の後ろ・肩の上（同じ側）。ここで止まり、時間が戻って飲まれる
  near: { back: 1.35, side: 0.24, up: 0.1, aim: 0.22 },
  // 目が合ったあと、最後の鼓動の間にカメラは始めの方へこの割合だけ戻る（camEnd）。時間が戻ると、乗り手が飲まれて
  // バイクごとレンズの横をかすめるのが見え、そのあとカメラが飲まれる
  backOut: 0.55,
  camY: 1.6,             // バイクの底からの高さ（乗り手の頭は約 1.55）
  camClear: 1.6,         // カメラはビルからこの距離より離れる
  othersClear: 3.0,      // ほかの軍勢はカメラ・乗り手からこの距離より離れている
  // 時間が戻って追うカットへ切り替わるまでに前線が触れるビル（球の面へ押されて形が大きく動く）は、カメラからこの距離（m）、
  // カメラから乗り手の頭への線から sweptLine m より離れている（ゆがんだ壁がレンズの前をふさがない）
  sweptClear: 10,
  sweptLine: 3,
  faceOff: 0.6,          // 乗り手は爆心から少しそれた向き（rad）に光の壁を見る（画面に壁の面の模様が斜めに入り、白熱の芯は頭の側へ）
  lookAhead: 14,         // 見る先: 乗り手の頭から前へ（m）
  view: { u: [-0.4, -0.2, 0, 0.2, 0.4], v: [-0.22, 0, 0.16, 0.32], blocked: 6 }, // 見通しを確かめる画面の向き（tan）と、ふさがれてよい数
  lookUp: -1.86,         // わずかに見下ろす（約 6°。下の縁に推進の光、真ん中に頭と肩、その上と横に迫る光の壁）
  azSteps: [0, 0.1, -0.1, 0.2, -0.2, 0.32, -0.32, 0.45, -0.45, 0.6, -0.6, 0.8, -0.8, 1.0, -1.0, 1.25, -1.25, 1.55, -1.55, 1.9, -1.9, 2.3, -2.3, 2.75, -2.75, Math.PI],
  dStep: 2,
  // 逃げる道: 横に x 引いたときの高さ = 始めの高さ + rise·(1 − e^(−x/riseLen)) + slope·x
  clearance: 2.2,
  rises: [8, 14, 22, 32, 45, 60, 80, 105, 135, 170, 210],
  flats: [110, 70, 40, 20, 0], // 通りの高さのまま飛ぶ長さ（m）の候補。長いほどよい
  riseLen: 7,
  slope: 0.2,
  // fix1: 逃げる道は屋上をなぞる（findRetreat）。flatMax: 通りの高さで飛ぶ最長、above: 屋上（余裕 pathClear 込み）から上へ、
  // lookAhead: 先の高いビルへ上がり始める距離、climb / descend: 上り・下りの傾きの上限、chaseLen: 追うカットで比べる長さ
  profile: { flatMax: 240, above: 1.5, lookAhead: 28, climb: 1.1, descend: 0.35, chaseLen: 600, outside: 34 },
  pathClear: 4,
  azOffsets: [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9],
};

const len2 = (a) => Math.hypot(a[0], a[2]);
const inBox = (p, b, m) => Math.abs(p[0] - b.x) < b.w / 2 + m && Math.abs(p[2] - b.z) < b.d / 2 + m && p[1] < b.h + m;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const enemyPos = (e) => [Math.cos(e.angle) * e.dist, 3, Math.sin(e.angle) * e.dist];

// 原点（爆心）から箱までの地面の上の最短距離（前線がその箱に届く距離）
export function nearDist(b) {
  const dx = Math.max(0, Math.abs(b.x) - b.w / 2), dz = Math.max(0, Math.abs(b.z) - b.d / 2);
  return Math.hypot(dx, dz);
}

// 線分 a→c がビルの箱（margin 付き）を通るか（スラブ法）
export function segHitsBox(a, c, b, m = 0) {
  const lo = [b.x - b.w / 2 - m, -1e9, b.z - b.d / 2 - m], hi = [b.x + b.w / 2 + m, b.h + m, b.z + b.d / 2 + m];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = c[i] - a[i];
    if (Math.abs(d) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return false; continue; }
    let u = (lo[i] - a[i]) / d, v = (hi[i] - a[i]) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}

// 逃げる道がビルから離れる距離: 始まり（通りの中のカメラ）は clearance、上がるにつれて pathClear へ
export const pathMargin = (x) => Math.min(PLAN.pathClear, PLAN.clearance - 0.2 + x * 0.4);
// 道の上の x の点が、ビルから離れる距離（低く飛ぶ間は通りの中なので clearance）
export const retreatMargin = (path, x) => (x < (path.flat ?? 0) ? PLAN.clearance - 0.2 : pathMargin(x - (path.flat ?? 0)));

// 逃げる道の上の、横に x 引いた点。はじめの flat m は通りの高さのまま低く飛び、そこから上がる
export function retreatPoint(path, x) {
  if (path.profile) {
    // 始まり（x = 0）はカメラの位置。最初の点（x0）まではそこからつなぐ
    if (x < path.x0) return [path.origin[0] + path.dir[0] * x, path.origin[1] + (path.profile[0] - path.origin[1]) * Math.max(0, x) / path.x0, path.origin[2] + path.dir[1] * x];
    const f = Math.max(0, (x - path.x0) / path.step), i = Math.min(path.profile.length - 1, Math.floor(f));
    const j = Math.min(path.profile.length - 1, i + 1), y = path.profile[i] + (path.profile[j] - path.profile[i]) * Math.min(1, f - i);
    return [path.origin[0] + path.dir[0] * x, y, path.origin[2] + path.dir[1] * x];
  }
  const u = Math.max(0, x - (path.flat ?? 0));
  const y = path.origin[1] + path.rise * (1 - Math.exp(-u / path.riseLen)) + path.slope * u;
  return [path.origin[0] + path.dir[0] * x, y, path.origin[2] + path.dir[1] * x];
}

function pickRider(enemies, rng) {
  const alive = enemies.filter((e) => e.state !== 'dead' && e.dist <= PLAN.enemyNear);
  return alive.length ? alive[Math.floor(rng() * alive.length)] : null;
}

// 逃げる道: 爆心から離れる向きを基準に、低い順に、ビルを通らない道を探す。
// 向きと「低く飛ぶ長さ」ごとに、道の上の各点で越えなければならない高さを先に求めておく（放つ瞬間に止まらないように）
const STEP = 0.75;
function findRetreat(origin, base, buildings, ground, radius, lead) {
  const radial = Math.atan2(origin[2], origin[0]);
  const len = Math.max(60, radius + lead + 20 - len2(origin), radius + lead + 2) + 10; // 道の長さ: 爆心から見た前線の先まで、かつ始まりから radius + lead まで
  const n = Math.ceil((len - 0.5) / STEP) + 1;
  const xs = Array.from({ length: n }, (_, i) => 0.5 + i * STEP);
  let best = null;
  for (const off of PLAN.azOffsets) {
    // 外へ向かう向き（爆心から離れていく）だけ
    const az = base + off;
    if (Math.cos(az - radial) < 0.35) continue;
    const dir = [Math.cos(az), Math.sin(az)];
    // 道の近く（横に 30 m 以内）のビルだけ
    const corridor = buildings.filter((o) => {
      const rx = o.x - origin[0], rz = o.z - origin[2];
      const along = rx * dir[0] + rz * dir[1], across = Math.abs(-rx * dir[1] + rz * dir[0]);
      return along > -20 && along < len + 20 && across < 30 + Math.max(o.w, o.d);
    });
    const floorY = xs.map((x) => ground([origin[0] + dir[0] * x, 0, origin[2] + dir[1] * x]) + 1);
    // 各点で越えなければならない高さ（ビルの箱を margin だけ広げた中に入るなら、その屋上 + margin）。
    // S8: 低く飛ぶ間の margin（clearance）と、上がってからの margin（pathClear。上がり始めの数 m も広い方で見る）の 2 通りだけを
    // 向きごとに一度求め、低く飛ぶ長さの候補で使い回す（広い街の長い道で、放ったあとの一拍の計算が重くならないように）
    // 道に沿った 10 m ごとの棚に、その範囲にかかるビルを入れておく（各点は自分の棚のビルだけ確かめる）
    const BIN = 10, bins = new Map();
    for (const o of corridor) {
      const rx = o.x - origin[0], rz = o.z - origin[2], along = rx * dir[0] + rz * dir[1];
      // 箱を margin 広げたときの道に沿った広がり: (|dx|·(w + 2m) + |dz|·(d + 2m)) / 2（斜めの道では m·(|dx| + |dz|) まで）
      const ext = (Math.abs(dir[0]) * o.w + Math.abs(dir[1]) * o.d) / 2 + PLAN.pathClear * (Math.abs(dir[0]) + Math.abs(dir[1])) + 1;
      for (let k = Math.floor((along - ext) / BIN); k <= Math.floor((along + ext) / BIN); k++) (bins.get(k) ?? bins.set(k, []).get(k)).push(o);
    }
    const needAt = (m) => xs.map((x, i) => {
      const px = origin[0] + dir[0] * x, pz = origin[2] + dir[1] * x;
      let h = floorY[i];
      for (const o of bins.get(Math.floor(x / BIN)) ?? []) if (Math.abs(px - o.x) < o.w / 2 + m && Math.abs(pz - o.z) < o.d / 2 + m) h = Math.max(h, o.h + m);
      return h;
    });
    const needLow = needAt(PLAN.clearance - 0.2), needUp = needAt(PLAN.pathClear);
    // fix1（追うカットで手前のビルが消えた）: 屋上をなぞる道。通りの高さで飛べる間（はじめから needLow が始めの高さより低い間、
    // flatMax m まで）は低く、その先はビルの屋上 + 余裕の少し上を、先の高いビルへ早めに上がり（lookAhead m 先まで見る、
    // 上りの傾き climb まで）、越えたらゆっくり下がる（descend）。手前にビルが入ったまま、引いていく
    const y0 = origin[1];
    let i0 = 0;
    while (i0 < n && xs[i0] < PLAN.profile.flatMax && needLow[i0] < y0) i0++;
    // 街の外（野原）へ出たら、outside m より下へは下がらない（屋上の並びを見下ろして、手前に街を入れる）
    const low = xs.map((x, i) => {
      const r = Math.hypot(origin[0] + dir[0] * x, origin[2] + dir[1] * x);
      return Math.max(r > CONFIG.cityRadius ? PLAN.profile.outside : 4, i < i0 ? Math.max(y0, needLow[i] + 0.3) : needUp[i] + PLAN.profile.above);
    });
    const A = Math.ceil(PLAN.profile.lookAhead / STEP);
    const prof = new Float32Array(n);
    // 先 A 点の最大（簡単な両端の窓。n は 2000 ほど）
    for (let i = n - 1; i >= 0; i--) {
      let m = low[i];
      for (let j = i + 1; j <= Math.min(n - 1, i + A); j++) if (low[j] > m) m = low[j];
      prof[i] = m;
    }
    for (let i = n - 2; i >= 0; i--) prof[i] = Math.max(prof[i], prof[i + 1] - PLAN.profile.climb * STEP);
    for (let i = 1; i < n; i++) prof[i] = Math.max(prof[i], prof[i - 1] - PLAN.profile.descend * STEP);
    for (let i = 0; i < i0; i++) if (prof[i] < y0) prof[i] = y0;
    // 追うカットで見える範囲（始まりから chaseLen m）の平均の高さが低いほどよい。爆心からそれた向きは少し嫌う
    const nC = Math.min(n, Math.ceil(PLAN.profile.chaseLen / STEP));
    let mean = 0, top = 0;
    for (let i = 0; i < nC; i++) mean += prof[i];
    for (let i = 0; i < n; i++) top = Math.max(top, prof[i]);
    mean /= nC;
    const score = mean + Math.abs(off) * 25 - xs[Math.max(0, i0 - 1)] * 0.05;
    if (!best || score < best.score) {
      best = { score, path: { origin, dir, profile: prof, step: STEP, x0: xs[0], flat: i0 > 0 ? xs[i0 - 1] : 0, rise: top - y0, riseLen: PLAN.riseLen, slope: 0 } };
    }
  }
  return best ? best.path : { origin, dir: [Math.cos(radial), Math.sin(radial)], rise: 260, riseLen: PLAN.riseLen, slope: PLAN.slope, flat: 0 };
}

const groundFor = (crater) => (p) => groundHeight(Math.hypot(p[0], p[2]), crater > 0 ? [crater] : []);

// 逃げる道だけを探す（planFinale の retreat: false で後回しにしたとき、演出の白〜一拍の間に呼ぶ）。
// plan: planFinale の戻り値、ほかは planFinale に渡したものと同じ（radius は shot.radius）
export function planRetreat(plan, { buildings, crater = 0, radius, lead = 0 }) {
  // 基準の向きは爆心から離れる向き（カメラは光の壁から逃げる）
  const c = plan.camPos;
  return findRetreat(c, Math.atan2(c[2], c[0]), buildings, groundFor(crater), radius, lead);
}

// 目が映る一人: 乗り手の場所の向き（angle から RIDER_MAX_ANG 以内）にいる生きた軍勢のうち、その場所にいちばん近い一人
// （その一人を、白の間にこの場所へ置き直して描く）
export const RIDER_MAX_ANG = 1.2;
function nearestRider(enemies, pos, angle) {
  let best = null, bd = Infinity;
  for (const e of enemies) {
    if (e.state === 'dead' || e.dist > PLAN.enemyNear || angDiff(e.angle, angle) >= RIDER_MAX_ANG) continue;
    const p = enemyPos(e), d = Math.hypot(p[0] - pos[0], p[2] - pos[2]);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// 箱の、原点から最も遠い点までの水平の距離（前線がこれを越えると、そのビルは光の壁の中）
const farDist = (b) => Math.hypot(Math.abs(b.x) + b.w / 2, Math.abs(b.z) + b.d / 2);

// 爆心からの向き az・水平の距離 d に乗り手を置いたときの、乗り手とカメラ（side: 右肩 1 / 左肩 −1）。
// 乗り手は爆心の向きから faceOff だけカメラの側へそれた向き（fwd）にバイクの前（+z）を向ける。
// right(f) はその向きの右（乗り手の右手側）。out は爆心から離れる向き（光の壁に押されて吹き飛ぶ向き）
const rightOf = (f) => [-f[2], 0, f[0]];
function shoulderAt(az, d, side, ground, lift = 0) {
  const out = [Math.cos(az), 0, Math.sin(az)];
  const inw = [-out[0], 0, -out[2]], ri = rightOf(inw);
  const c = Math.cos(PLAN.faceOff), s = Math.sin(PLAN.faceOff) * side;
  const fwd = [inw[0] * c + ri[0] * s, 0, inw[2] * c + ri[2] * s];
  const right = rightOf(fwd);
  const pos = [out[0] * d, 0, out[2] * d];
  pos[1] = ground(pos) + PLAN.riderHover + lift;
  const cam = [pos[0] - fwd[0] * PLAN.camBack + right[0] * PLAN.camSide * side, pos[1] + PLAN.camY, pos[2] - fwd[2] * PLAN.camBack + right[2] * PLAN.camSide * side];
  const head = [pos[0], pos[1] + 1.55, pos[2]];
  const look = [head[0] + fwd[0] * PLAN.lookAhead, head[1] + PLAN.lookUp, head[2] + fwd[2] * PLAN.lookAhead];
  // 寄ったカメラ・ガラス片・本当の頭（前かがみの姿）。寄ったカメラはガラス片を見る（頭の方へ aim だけ寄せて、頭が画面の縁に入る）
  const at = (b, f, r, u) => [b[0] + fwd[0] * f + right[0] * r * side, b[1] + u, b[2] + fwd[2] * f + right[2] * r * side];
  const headC = at(pos, PLAN.head.fwd, 0, PLAN.head.up);
  const glass = at(headC, PLAN.glass.fwd, PLAN.glass.side, PLAN.glass.up);
  const camNear = at(headC, -PLAN.near.back, PLAN.near.side, PLAN.near.up);
  const lookNear = glass.map((v, i) => v + (headC[i] - v) * PLAN.near.aim);
  const camEnd = camNear.map((v, i) => v + (cam[i] - v) * PLAN.backOut);
  return { pos, cam, head, look, out, fwd, yaw: Math.atan2(fwd[0], fwd[2]), headC, glass, camNear, lookNear, camEnd };
}

// カメラから見る向きに並べた光線が光の壁（半径 wall の球）に届く点（届かなければ 40 m 先）
function viewRays(s) {
  const F = [s.look[0] - s.cam[0], s.look[1] - s.cam[1], s.look[2] - s.cam[2]];
  const fl = Math.hypot(...F);
  for (let i = 0; i < 3; i++) F[i] /= fl;
  const R = rightOf(F), rl = Math.hypot(R[0], R[2]);
  R[0] /= rl; R[2] /= rl;
  const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
  const rays = [];
  for (const v of PLAN.view.v) for (const u of PLAN.view.u) rays.push({ u, v, d: [F[0] + R[0] * u + U[0] * v, F[1] + R[1] * u + U[1] * v, F[2] + R[2] * u + U[2] * v] });
  return rays;
}
function rayToWall(c, d, w) {
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], b = c[0] * d[0] + c[1] * d[1] + c[2] * d[2], cc = c[0] * c[0] + c[1] * c[1] + c[2] * c[2] - w * w;
  const disc = b * b - a * cc;
  const t = disc > 0 ? (-b - Math.sqrt(disc)) / a : 40 / Math.sqrt(a);
  const k = t > 0 ? t : 40 / Math.sqrt(a);
  return [c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k];
}

// 撮れるか: 乗り手とカメラがビルの外、ほかの軍勢がそばにいない、カメラから乗り手の頭・見る先を、まだ飲まれていない
// ビルがふさがない。画面の向きに並べた光線のうち、光の壁（一拍の前線 wall）まで届かずビルに当たるものが blocked 以下で、
// 真ん中の列（乗り手の頭とガラス片の背）はふさがれない（乗り手の影が光の壁を背に浮かぶ）。戻り値: ふさがれた数（撮れなければ −1）
function shoulderClear(s, near, ground, others, wall) {
  if (near.some((o) => inBox(s.pos, o, PLAN.riderClear) || inBox(s.cam, o, PLAN.camClear) || inBox(s.camNear, o, PLAN.camClear) || inBox(s.glass, o, 0.5))) return -1;
  if (s.cam[1] <= ground(s.cam) + 1) return -1;
  for (const p of others) {
    if ([s.cam, s.camNear, s.pos].some((q) => Math.hypot(p[0] - q[0], p[2] - q[2]) <= PLAN.othersClear)) return -1;
  }
  // 始めのカメラ・寄ったカメラ・飲まれるカメラのどれからも、押されてゆがむビルが離れている
  for (const c of [s.cam, s.camNear, s.camEnd]) {
    const camD = Math.hypot(...c);
    for (const o of near) {
      if (nearDist(o) >= camD + FINALE.passBeyond) continue;
      if (Math.hypot(Math.max(0, Math.abs(c[0] - o.x) - o.w / 2), Math.max(0, Math.abs(c[2] - o.z) - o.d / 2)) < PLAN.sweptClear) return -1;
      if (segHitsBox(c, s.head, o, PLAN.sweptLine)) return -1;
    }
  }
  const live = near.filter((o) => farDist(o) > wall - 0.5);
  if (live.some((o) => segHitsBox(s.cam, s.head, o, 0.2) || segHitsBox(s.cam, s.look, o, 0.2) || segHitsBox(s.camNear, s.glass, o, 0.2))) return -1;
  let blocked = 0;
  for (const r of viewRays(s)) {
    const q = rayToWall(s.cam, r.d, wall - 1);
    if (live.some((o) => segHitsBox(s.cam, q, o, 0.2))) {
      if (Math.abs(r.u) < 0.25) return -1;
      blocked++;
    }
  }
  return blocked <= PLAN.view.blocked ? blocked : -1;
}

// shot: 最後の一発（radius）、buildings: 残っているビル、enemies: 軍勢、crater: 地面のえぐれ
// lead: 逃げる道を確かめる長さに足す、前線の先を行く距離（m、半径 radius のとき）
// retreat: false なら逃げる道は探さず null（放つ瞬間を軽くする。あとで planRetreat で求める）
export function planFinale({ shot, buildings, enemies = [], rng, crater = 0, lead = 0, retreat = true }) {
  const ground = groundFor(crater);
  const picked = pickRider(enemies, rng);
  const a0 = picked ? picked.angle : rng() * Math.PI * 2;
  const dMax = Math.max(PLAN.riderRange[0], Math.min(PLAN.riderRange[1], shot.radius * PLAN.riderFrac));
  const dMin = Math.min(PLAN.riderRange[0], dMax);
  const dPref = Math.min(dMax, Math.max(dMin, picked ? picked.dist : (dMin + dMax) / 2));
  const reach = dMax + PLAN.camBack + 30;
  const near = buildings.filter((b) => b.dist - Math.hypot(b.w, b.d) / 2 < reach);
  const dists = [dPref];
  for (let k = PLAN.dStep; dPref - k >= dMin || dPref + k <= dMax; k += PLAN.dStep) {
    if (dPref - k >= dMin) dists.push(dPref - k);
    if (dPref + k <= dMax) dists.push(dPref + k);
  }
  // 撮る一人は、ほかの軍勢の邪魔の確かめから外す（その一人はこの場所へ置き直す）
  const others = (az, d) => {
    const pos = [Math.cos(az) * d, 0, Math.sin(az) * d];
    const who = nearestRider(enemies, pos, az) ?? picked;
    return { who, pts: enemies.filter((e) => e.state !== 'dead' && e !== who).map(enemyPos) };
  };
  // 向きのずれが小さい順に、近い距離から、右肩・左肩の順に試す。ふさがれた光線のない所が見つかればそこ、
  // なければ、ふさがれた数とずれの少ないもの
  let best = null;
  for (const off of PLAN.azSteps) {
    const az = a0 + off;
    for (const d of dists) {
      const wall = d - FINALE.riderGap;
      const o = others(az, d);
      for (const side of [1, -1]) {
        const s = shoulderAt(az, d, side, ground);
        const bl = shoulderClear(s, near, ground, o.pts, wall);
        if (bl < 0) continue;
        const score = bl * 3 + Math.abs(off) * 4 + Math.abs(d - dPref) * 0.05;
        if (!best || score < best.score) best = { ...s, side, d, who: o.who, score };
      }
      if (best && best.score < 1e-9) break;
    }
    if (best && best.score - Math.abs(off) * 4 < 1e-9) break;
  }
  if (!best) {
    // 撮れる通りがない: 好みの向き・距離で、まわりのビルより高く浮かせる
    const s0 = shoulderAt(a0, dPref, 1, ground);
    const top = near.filter((o) => [s0.pos, s0.cam].some((p) => inBox([p[0], 0, p[2]], o, 4))).reduce((m, o) => Math.max(m, o.h), 0);
    const lift = Math.max(0, top + 2 - s0.pos[1]);
    best = { ...shoulderAt(a0, dPref, 1, ground, lift), side: 1, d: dPref, who: others(a0, dPref).who };
  }
  const hitDist = best.d - FINALE.riderGap - FINALE.crawl;
  const plan = {
    riderId: best.who ? best.who.id : null,
    rider: { pos: best.pos, yaw: best.yaw, out: best.out, fwd: best.fwd, side: best.side, head: best.headC },
    hitDist,
    riderDist: Math.hypot(best.d, best.pos[1] + 1),
    camPos: best.cam,
    look: best.look,
    // ガラス片が来ると寄る肩越しのカメラ（camNear、見る先 lookNear）と、目が映るガラス片の止まる所（乗り手の顔の前）。
    // 目が合ったあと少し戻った所（camEnd）で飲まれるので、時刻表の camDist はそこまで
    camNear: best.camNear,
    lookNear: best.lookNear,
    glass: best.glass,
    camEnd: best.camEnd,
    camDist: Math.hypot(...best.camEnd),
    retreat: null,
  };
  if (retreat) plan.retreat = planRetreat(plan, { buildings, crater, radius: shot.radius, lead });
  return plan;
}
