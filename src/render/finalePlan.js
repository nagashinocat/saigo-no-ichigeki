import { CONFIG } from '../config.js';
import { groundHeight } from './sphereDeform.js';
import { phaseTimes, frontAt } from '../game/blast.js';

// 最後の一発の演出の「どこで撮るか」を決める純粋な関数（描画は知らない）。
// R0b（持ち主 2026-11-21 22:15。ガラスの一拍はやめた）: 遠くの軍勢（街を見回る者。爆心から数百 m）の後ろにカメラを置き、
// 地平の爆心（主人公の所）を見る。爆発がスローでふくらみ、弾けて、光の壁が街を走ってきて、軍勢を後ろから一気に飲み、
// カメラも飲まれる。そのあとカメラはそこから上へ・外へ、追ってくる爆発から逃げる（retreat の道）。
// 軍勢は実際の位置ではなく、ここで決めた隊形に描く（白の間に置き直す。ゲームの軍勢の状態は変えない）。
//   撮る一人（riders[0]、いちばん手前。演出の一人の体 riderBody で描く）と、その前（爆心の側）に並ぶ数人。
//   カメラは撮る一人の後ろ（爆心から離れる側）。通りの高さ（street）か、屋上の並びの上（roof）。
//   カメラから爆心の光（じわじわ期の光の玉）と、軍勢の一人ひとりが見通せること。

export const PLAN = {
  band: [0.36, 0.56],    // 撮る一人を置く爆心からの距離（その一発の半径に対する割合）。弾ける期〜見せる期のはじめに飲まれる
  camBack: 14,           // カメラは撮る一人の後ろ（爆心から離れる向き）にこの距離（m）
  camSide: 1.0,          // 横へ（撮る一人が画面の真ん中から少しずれ、その向こうに爆心の光）
  hover: 2.8,            // 通りの高さのとき、バイクの底の地面からの高さ（m）
  camUp: 3.0,            // カメラは乗り手のバイクの底から少なくともこの高さ上（乗り手の頭の上から見る）
  riderBelow: 0.1,       // 撮る一人は、カメラから爆心を見る線よりこの角度（rad）下
  // 通りの高さから爆心の光が見通せなければ、見通せる高さまで上げる（屋上の並みの上）。liftCost m 上げるごとに 1 点悪い。
  // 半径の maxLift より高くはしない
  liftCost: 25,
  maxLift: 0.22,
  // 隊形（撮る一人から見て [爆心の方へ m, 右へ m]）。小さな一発では爆心の方の長さを縮める（じわじわ期の光の外に収める）
  formation: [[12, -4.5], [21, 5], [31, -1.5], [42, 7]],
  minRiders: 3,          // 撮る一人を含めて、少なくともこの人数（名もない乗り手で埋める）
  riderClear: 1.6,       // 乗り手（バイク）はビルからこの距離より離れる
  camClear: 3,           // カメラはビルからこの距離より離れる
  othersClear: 5,        // ほかの軍勢（実際の位置で描かれる者）はカメラからこの距離より離れている
  // 見通す爆心の光の高さ（じわじわ期の終わりの前線に対する割合）。どちらも必ず見える（スローの初めの小さな光の玉から見せる）
  glow: [0.3, 0.95],
  glowIgnore: 0.5,       // 爆心からこの距離（じわじわ期の前線に対する割合）より近いビルは、光の中に沈むので見通しから外す
  dSteps: 7,             // 帯の中で試す距離の数
  // 逃げる道: 横に x 引いたときの高さ = 始めの高さ + rise·(1 − e^(−x/riseLen)) + slope·x
  clearance: 2.2,
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


// ---- 遠くの軍勢の後ろ（R0b）----
// 試す向きのずれ（rad）: 近くは細かく（爆心へまっすぐ向かう通りを見つける）、遠くは粗く
const AZ_STEPS = [0];
for (let k = 1; k <= 12; k++) AZ_STEPS.push(0.025 * k, -0.025 * k);
for (const a of [0.4, 0.5, 0.62, 0.75, 0.9, 1.1, 1.35, 1.65, 2.0, 2.4, 2.8]) AZ_STEPS.push(a, -a);
AZ_STEPS.push(Math.PI);
const angleOf = (e) => e.angle ?? Math.atan2(e.z, e.x);
const distOf = (e) => e.dist ?? Math.hypot(e.x, e.z);
const posOf = (e) => [e.x ?? Math.cos(e.angle) * e.dist, 3, e.z ?? Math.sin(e.angle) * e.dist];
const alive = (e) => e.state !== 'dead';

// 撮る一人を選ぶ: 帯の中にいる生きた見回る者から乱数で。いなければ帯にいちばん近い見回る者、それもいなければ帯にいちばん近い
// 生きた者（誰でもよい。その一人を帯の中へ置き直す）。誰もいなければ null（名もない乗り手）
export function pickLead(enemies, radius, rng) {
  const [a, b] = PLAN.band.map((k) => k * radius);
  const live = enemies.filter(alive);
  const inBand = live.filter((e) => e.patrol && distOf(e) >= a && distOf(e) <= b);
  if (inBand.length) return inBand[Math.floor(rng() * inBand.length) % inBand.length];
  const gap = (e) => Math.max(0, a - distOf(e), distOf(e) - b);
  const near = (list) => list.reduce((m, e) => (!m || gap(e) < gap(m) - 1e-9 ? e : m), null);
  return near(live.filter((e) => e.patrol)) ?? near(live);
}

// カメラ（水平の位置 c）から爆心の光の点 T = [0, yT, 0] を見通すのに要るカメラの高さ（ビルの屋上 + margin の上を通る）。
// 線を T（λ = 0）からカメラ（λ = 1）へとると、箱にかかる最初の λ1 で線の高さ yT + (yC − yT)·λ1 が屋上を越えればよい
function needHeight(c, yT, boxes, m) {
  let need = -Infinity;
  for (const o of boxes) {
    const top = o.h + m;
    if (top <= yT) continue;
    // 水平の線分 T→c と、箱（margin 付き）の重なる λ の範囲（スラブ法）
    let l0 = 0, l1 = 1, hit = true;
    for (const [p, lo, hi] of [[c[0], o.x - o.w / 2 - m, o.x + o.w / 2 + m], [c[1], o.z - o.d / 2 - m, o.z + o.d / 2 + m]]) {
      if (Math.abs(p) < 1e-9) { if (lo > 0 || hi < 0) { hit = false; break; } continue; }
      let u = lo / p, v = hi / p;
      if (u > v) [u, v] = [v, u];
      l0 = Math.max(l0, u); l1 = Math.min(l1, v);
      if (l0 > l1) { hit = false; break; }
    }
    if (!hit) continue;
    if (l0 < 1e-3) return Infinity; // 光の点の真上（ありえないほど高い）
    need = Math.max(need, yT + (top - yT) / l0);
  }
  return need;
}

// 爆心からの向き az・撮る一人の水平の距離 d での、乗り手の列とカメラ。カメラは通りの高さか、爆心の光（glow の高い方）を
// ビルの上から見通せる高さの高い方。乗り手はカメラの camUp 下（それより地面に近くはしない）
function beatAt(az, d, f0, corridor, live, ground) {
  const out = [Math.cos(az), 0, Math.sin(az)];
  const fwd = [-out[0], 0, -out[2]];           // 爆心の方
  const right = [-fwd[2], 0, fwd[0]];          // 爆心を向いたときの右手
  const yaw = Math.atan2(fwd[0], fwd[2]);       // バイクの前（+z）を爆心へ
  // 小さな一発: 隊形の奥行きを、いちばん奥の者がじわじわ期の光より 6 m 外になるよう縮める
  const span = PLAN.formation[PLAN.formation.length - 1][0];
  const k = Math.max(0.2, Math.min(1, (d - f0 - 6) / span));
  const spots = [[0, 0], ...PLAN.formation].map(([f, r]) => [out[0] * d + fwd[0] * f * k + right[0] * r, out[2] * d + fwd[2] * f * k + right[2] * r]);
  const camXZ = [out[0] * (d + PLAN.camBack) + right[0] * PLAN.camSide, out[2] * (d + PLAN.camBack) + right[2] * PLAN.camSide];
  const gStreet = ground([camXZ[0], 0, camXZ[1]]);
  const yStreet = Math.max(gStreet, ground([spots[0][0], 0, spots[0][1]])) + PLAN.hover + PLAN.camUp;
  const yT = PLAN.glow[0] * f0;
  const yC = Math.max(yStreet, needHeight(camXZ, yT, live, 0.6) + 0.5);
  // 乗り手はカメラの下、爆心を見る線よりはっきり下（画面で撮る一人が爆心の光をふさがず、光の壁を背にした影になる）
  const depGZ = Math.atan2(yC - 0.5 * f0, Math.hypot(camXZ[0], camXZ[1]));
  const yR = yC - Math.max(PLAN.camUp, PLAN.camBack * Math.tan(depGZ + PLAN.riderBelow));
  const riders = spots.map(([x, z]) => ({ pos: [x, Math.max(yR, ground([x, 0, z]) + PLAN.hover), z], yaw: Math.atan2(-x, -z) })); // 一人ずつ爆心を向く
  const cam = [camXZ[0], yC, camXZ[1]];
  return { out, fwd, right, yaw, riders, cam, lift: yC - yStreet, mode: yC - yStreet < 1 ? 'street' : 'roof' };
}

// 撮れるか: カメラと乗り手がビルの外、カメラから爆心の光（低い方も高い方も）と乗り手の一人ひとりが見通せる。
// 戻り値: { score, keep（見通せる乗り手の番号） }、撮れなければ null
function beatScore(s, corridor, live, f0, others) {
  if (!Number.isFinite(s.cam[1])) return null;
  if (corridor.some((o) => inBox(s.cam, o, PLAN.camClear))) return null;
  if (others.some((p) => Math.hypot(p[0] - s.cam[0], p[2] - s.cam[2]) < PLAN.othersClear)) return null;
  const glowBlocked = PLAN.glow.map((g) => live.some((o) => segHitsBox(s.cam, [0, g * f0, 0], o, 0.5)));
  if (glowBlocked.some(Boolean)) return null;
  const keep = [];
  s.riders.forEach((r, i) => {
    if (corridor.some((o) => inBox(r.pos, o, PLAN.riderClear))) return;
    if (corridor.some((o) => segHitsBox(s.cam, [r.pos[0], r.pos[1] + 1.2, r.pos[2]], o, 0.3))) return;
    keep.push(i);
  });
  if (keep[0] !== 0) return null; // 撮る一人は必ず
  return { score: (PLAN.formation.length + 1 - keep.length) * 1.2 + s.lift / PLAN.liftCost, keep };
}

// shot: 最後の一発（radius）、buildings: 残っているビル、enemies: 軍勢、crater: 地面のえぐれ
// lead: 逃げる道を確かめる長さに足す、前線の先を行く距離（m、半径 radius のとき）
// retreat: false なら逃げる道は探さず null（放つ瞬間を軽くする。あとで planRetreat で求める）
export function planFinale({ shot, buildings, enemies = [], rng, crater = 0, lead = 0, retreat = true }) {
  const R = shot.radius;
  const ground = groundFor(crater);
  const f0 = frontAt(phaseTimes(R).creep, R);
  const picked = pickLead(enemies, R, rng);
  const a0 = picked ? angleOf(picked) : rng() * Math.PI * 2;
  const [dMin, dMax] = PLAN.band.map((k) => k * R);
  const dPref = Math.min(dMax, Math.max(dMin, picked ? distOf(picked) : (dMin + dMax) / 2));
  const dists = [dPref];
  for (let i = 1; i < PLAN.dSteps; i++) {
    const step = (dMax - dMin) / (PLAN.dSteps - 1) * Math.ceil(i / 2);
    const d = i % 2 ? dPref - step : dPref + step;
    if (d >= dMin - 1e-9 && d <= dMax + 1e-9) dists.push(d);
  }
  const reach = dMax + PLAN.camBack + 40;

  const others = enemies.filter((e) => alive(e) && e !== picked).map(posOf);
  let best = null;
  for (const off of AZ_STEPS) {
    const az = a0 + off;
    const ux = Math.cos(az), uz = Math.sin(az);
    // この向きの線（爆心からカメラの少し先まで）のまわりのビルだけ
    const corridor = buildings.filter((o) => {
      const along = o.x * ux + o.z * uz, across = Math.abs(-o.x * uz + o.z * ux);
      return along > -20 && along < reach && across < Math.max(o.w, o.d) / 2 + 60;
    });
    const live = corridor.filter((o) => nearDist(o) > f0 * PLAN.glowIgnore);
    for (const d of dists) {
      const s = beatAt(az, d, f0, corridor, live, ground);
      // 高すぎる所（乗り手が光の壁の球に飲まれる順がくずれる・街が小さく見える）は使わない
      if (s.cam[1] > PLAN.maxLift * R + PLAN.hover + PLAN.camUp) continue;
      const r = beatScore(s, corridor, live, f0, others);
      if (!r) continue;
      const score = r.score + Math.abs(off) * 3 + Math.abs(d - dPref) / R * 2;
      if (!best || score < best.score) best = { ...s, keep: r.keep, score, d };
    }
    if (best && best.score - Math.abs(off) * 3 < 0.8) break; // 見通しのよい低い所が見つかった（それより大きくずれた向きは試さない）
  }
  if (!best) {
    // 撮れる所がない: 好みの向き・距離で、街のどのビルより高く浮かせる
    const s = beatAt(a0, dPref, f0, [], [], ground);
    const top = buildings.reduce((m, o) => Math.max(m, o.h), 0);
    const lift = Math.max(0, top + 4 - s.riders[0].pos[1]);
    for (const r of s.riders) r.pos[1] += lift;
    s.cam[1] += lift;
    best = { ...s, mode: 'roof', keep: s.riders.map((_, i) => i), d: dPref };
  }
  // 乗り手の顔ぶれ: 撮る一人と、その場所に近い生きた者から順に（足りなければ名もない乗り手 id: null）
  // 見通せる者が足りなければ、隊形の残りのうちビルの外にいる者（見通せなくても）、それでも足りなければ撮る一人のすぐ前の横に並べる
  const riders = best.keep.map((i) => best.riders[i]);
  for (let i = 1; i < best.riders.length && riders.length < PLAN.minRiders; i++) {
    const r = best.riders[i];
    if (!riders.includes(r) && !buildings.some((o) => inBox(r.pos, o, PLAN.riderClear))) riders.push(r);
  }
  for (let k = 0; riders.length < PLAN.minRiders; k++) {
    const l = best.riders[0].pos, side = k % 2 ? -1 : 1;
    const pos = [l[0] + best.fwd[0] * (5 + 4 * k) + best.right[0] * 2.5 * side, l[1], l[2] + best.fwd[2] * (5 + 4 * k) + best.right[2] * 2.5 * side];
    riders.push({ pos, yaw: Math.atan2(-pos[0], -pos[2]) });
  }
  const at = riders[0].pos;
  const rest = enemies.filter((e) => alive(e) && e !== picked)
    .map((e) => [e, Math.hypot(posOf(e)[0] - at[0], posOf(e)[2] - at[2])]).sort((a, b) => a[1] - b[1]).map(([e]) => e.id);
  const ids = [picked ? picked.id : null, ...rest];
  const group = riders.map((r, i) => ({ id: ids[i] ?? null, pos: r.pos, yaw: r.yaw, dist: len2(r.pos) }));
  const look = [0, f0 * 0.6, 0];
  const plan = {
    riderId: group[0].id,
    rider: { pos: group[0].pos, yaw: group[0].yaw, out: best.out, fwd: best.fwd },
    riders: group,
    mode: best.mode,
    riderDist: Math.hypot(group[0].dist, group[0].pos[1]),
    firstDist: Math.min(...group.map((g) => Math.hypot(g.dist, g.pos[1]))),
    camPos: best.cam,
    look,
    camDist: Math.hypot(...best.cam),
    creepFront: f0,
    retreat: null,
  };
  if (retreat) plan.retreat = planRetreat(plan, { buildings, crater, radius: R, lead });
  return plan;
}
