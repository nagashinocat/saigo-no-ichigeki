import { CONFIG } from '../config.js';
import { groundHeight } from './sphereDeform.js';
import { phaseTimes, frontAt, timeAtFront } from '../game/blast.js';

// 最後の一発の演出の「どこで撮るか」を決める純粋な関数（描画は知らない）。
// R0b（持ち主 2026-11-21 22:15。ガラスの一拍はやめた）: 遠くの軍勢（街を見回る者。爆心から数百 m）の後ろにカメラを置き、
// 地平の爆心（主人公の所）を見る。爆発がスローでふくらみ、弾けて、光の壁が街を走ってきて、軍勢を後ろから一気に飲み、
// カメラも飲まれる。そのあとカメラはそこから上へ・外へ、追ってくる爆発から逃げる（retreat の道）。
// 軍勢は実際の位置ではなく、ここで決めた隊形に描く（白の間に置き直す。ゲームの軍勢の状態は変えない）。
//   fix1: カメラは屋上の並みの上の開けた所（爆心へ向けた ±8° の扇がビルにふさがれず、±4° の光線が 60 m 以内で当たらない）。
//   乗り手は 6〜10 人、カメラの 30〜180 m 先に屋上（なければ地面）に立って並び、奥の者から順に光の壁に飲まれる。
//   riders[0] はいちばん手前（演出の一人の体 riderBody で描く）。カメラから爆心の光と、乗り手の一人ひとりが見通せること。

export const PLAN = {
  // fix1（コーディネーター: 遠くの軍勢が飲まれるのが画面で読めない）: 屋上の並みの上の開けた所から、屋上に立つ 6〜10 人の列を
  // カメラの 30〜180 m 先に並べ、光の壁が奥の者から順に 0.4〜0.6 秒かけて飲んでいく
  band: [0.36, 0.56],    // 撮る一人（見回る者）を選ぶ帯（その一発の半径に対する割合）
  camBand: [0.4, 0.58],  // カメラの爆心からの水平の距離（半径に対する割合）
  dSteps: 7,             // カメラの帯の中で試す距離の数
  camAbove: 9,           // カメラはまわり（camReach m 以内）の屋上よりこの高さ上
  camReach: 22,
  liftCost: 70,          // 通りの高さ（地面 + hover + camAbove）から上げた高さ liftCost m ごとに 1 点悪い。liftSoft m より上は liftSteep m ごとに 1 点
  liftSoft: 45,
  liftSteep: 15,
  maxLift: 0.3,          // カメラの高さは半径のこの割合まで
  hover: 1.2,            // 乗り手のバイクの底は、立つ屋上（か地面）からこの高さ（見下ろしすぎるときは hoverMax まで浮く）
  hoverMax: 80,
  lineDip: 7,            // 浮く乗り手は、カメラから lineDip° 下の線に並ぶ（地平の爆心と迫る光の壁を背にした影の列）
  // 列: カメラから爆心の方へ ahead[0]〜ahead[1] m に riders 人（小さな一発ではじわじわ期の光の外に収まるよう縮める）。
  // 一人ずつ横へ ±side m の中で、屋上に立てて見通せる所を探す
  ahead: [30, 180],
  riders: 8,
  minRiders: 6,
  side: [0, 5, -5, 10, -10, 15, -15, 22, -22],
  maxDip: 24,            // カメラから乗り手を見下ろす角度（°）の上限（足りないときは maxDipLoose まで）
  maxDipLoose: 30,
  raise: [0, 18, 40],
  budget: 500,           // 開け具合を確かめる候補の数の上限（放つ瞬間の重さ）    // カメラをさらに上げる候補（m。上げると屋上の並みの上が開ける）
  riderClear: 0.6,       // 乗り手（バイク）は、立つビル以外のビルの壁からこの距離より離れる
  camClear: 3,           // カメラはビルからこの距離より離れる
  othersClear: 5,        // ほかの軍勢（実際の位置で描かれる者）はカメラからこの距離より離れている
  // 見通す爆心の光の高さ（じわじわ期の終わりの前線に対する割合）。どれも必ず見える
  glow: [0.95],
  glowIgnore: 1,       // 爆心からこの距離（じわじわ期の前線に対する割合）より近いビルは、光の中に沈むので見通しから外す
  // 開けた見通し: 爆心の向きから ±8° の扇（open.az）を、爆心の上の高さ open.h（じわじわ期の前線に対する割合）へ。
  // ふさがれていない光線の割合が開け具合（open.min より低い所は使わない。手前の屋上の並みが長いレンズの画面の下半分をふさがないよう、
  // 爆心を見る線から dip° 下の光線も手前 near2 m まで数える）。±4° の光線（open.side）がカメラから open.near m 以内でビルに当たる所（谷）は使わない
  open: { az: [-8, -4, 0, 4, 8], h: [0.8, 1.5, 3], side: 4, near: 60, weight: 6, min: 0.75, dip: [4], near2: 120, lookH: 0.6, centerAz: [-2, 0, 2], centerH: [0.3, 0.65, 1], occlude: 1.6 },
  window: { min: 0.4, want: 0.55 }, // 奥の乗り手が飲まれてからカメラが飲まれるまで（秒）。min より短い所は避ける
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
  // 速い見切り: 線分より低い箱・線分の水平の広がりの外の箱
  if (b.h + m < Math.min(a[1], c[1])) return false;
  const hw = b.w / 2 + m, hd = b.d / 2 + m;
  if (Math.max(a[0], c[0]) < b.x - hw || Math.min(a[0], c[0]) > b.x + hw || Math.max(a[2], c[2]) < b.z - hd || Math.min(a[2], c[2]) > b.z + hd) return false;
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


// ---- 遠くの軍勢の後ろ（R0b・fix1）----
// 試す向きのずれ（rad）: 近くは細かく、遠くは粗く
const AZ_STEPS = [0];
for (let k = 1; k <= 12; k++) AZ_STEPS.push(0.025 * k, -0.025 * k);
for (let a = 0.38; a < Math.PI - 0.04; a += 0.08) AZ_STEPS.push(a, -a);
AZ_STEPS.push(Math.PI);
const DEG = Math.PI / 180;
const angleOf = (e) => e.angle ?? Math.atan2(e.z, e.x);
const distOf = (e) => e.dist ?? Math.hypot(e.x, e.z);
const posOf = (e) => [e.x ?? Math.cos(e.angle) * e.dist, 3, e.z ?? Math.sin(e.angle) * e.dist];
const alive = (e) => e.state !== 'dead';
const inFoot = (x, z, o, m = 0) => Math.abs(x - o.x) < o.w / 2 + m && Math.abs(z - o.z) < o.d / 2 + m;

// 撮る一人を選ぶ: 帯の中にいる生きた見回る者から乱数で。いなければ帯にいちばん近い見回る者、それもいなければ帯にいちばん近い
// 生きた者（誰でもよい。その一人を列の先頭へ置き直す）。誰もいなければ null（名もない乗り手）
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
    let l0 = 0, l1 = 1, hit = true;
    for (const [p, lo, hi] of [[c[0], o.x - o.w / 2 - m, o.x + o.w / 2 + m], [c[1], o.z - o.d / 2 - m, o.z + o.d / 2 + m]]) {
      if (Math.abs(p) < 1e-9) { if (lo > 0 || hi < 0) { hit = false; break; } continue; }
      let u = lo / p, v = hi / p;
      if (u > v) [u, v] = [v, u];
      l0 = Math.max(l0, u); l1 = Math.min(l1, v);
      if (l0 > l1) { hit = false; break; }
    }
    if (!hit) continue;
    if (l0 < 1e-3) return Infinity;
    need = Math.max(need, yT + (top - yT) / l0);
  }
  return need;
}

// 開け具合（0〜1）と、谷（±side° の光線が near m 以内でビルに当たる）か。
// 光線はカメラから、爆心の向きを az° 回した向きの、爆心と同じ水平の距離・爆心の上の高さ h·f0 の点へ
export function openness(cam, f0, live, liveCenter = live) {
  const D = Math.hypot(cam[0], cam[2]), base = Math.atan2(-cam[2], -cam[0]);
  const O = PLAN.open;
  const target = (deg, h) => [cam[0] + Math.cos(base + deg * DEG) * D, h * f0, cam[2] + Math.sin(base + deg * DEG) * D];
  let clear = 0, n = 0;
  for (const deg of O.az) for (const h of O.h) { n++; const q = target(deg, h); if (!live.some((o) => segHitsBox(cam, q, o, 0.3))) clear++; }
  // 長いレンズの画面の下半分（演出が見る先＝爆心の上 lookH·f0 を見る線から dip° 下）も、手前 near2 m（爆心までの 6 割まで）はビルにふさがれない
  const mid = target(0, O.lookH), L = Math.min(O.near2, 0.6 * D);
  const pitch0 = Math.atan2(mid[1] - cam[1], D);
  for (const deg of [-O.side, 0, O.side]) for (const dip of O.dip) {
    n++;
    const a = base + deg * DEG, pt = pitch0 - dip * DEG;
    const q = [cam[0] + Math.cos(a) * Math.cos(pt) * L, cam[1] + Math.sin(pt) * L, cam[2] + Math.sin(a) * Math.cos(pt) * L];
    if (!live.some((o) => segHitsBox(cam, q, o, 0.3))) clear++;
  }
  // 長いレンズの真ん中（爆心の向き ±2°、じわじわ期の光の玉の 0.3〜1 倍の高さ）はふさがれない。爆心のそば（OCCLUDE·f0 の内）の
  // ビルは演出が白の間に隠すので数えない（liveCenter）
  let center = true;
  for (const deg of O.centerAz) for (const h of O.centerH) if (liveCenter.some((o) => segHitsBox(cam, target(deg, h), o, 0.3))) center = false;
  let canyon = false;
  for (const deg of [-O.side, O.side]) {
    const q = target(deg, O.h[1]), k = O.near / Math.max(O.near, Math.hypot(q[0] - cam[0], q[2] - cam[2]));
    const p = cam.map((v, i) => v + (q[i] - v) * k);
    if (live.some((o) => segHitsBox(cam, p, o, 0.3))) canyon = true;
  }
  return { open: clear / n, canyon, center };
}

const liftPenalty = (lift) => lift / PLAN.liftCost + Math.max(0, lift - PLAN.liftSoft) / PLAN.liftSteep;

// 爆心からの向き az・カメラの水平の距離 dC での、カメラと乗り手の列
function beatAt(az, dC, f0, corridor, live, ground, extra = 0) {
  const out = [Math.cos(az), 0, Math.sin(az)];
  const fwd = [-out[0], 0, -out[2]];           // 爆心の方
  const right = [-fwd[2], 0, fwd[0]];
  const camXZ = [out[0] * dC, out[2] * dC];
  let roof = ground([camXZ[0], 0, camXZ[1]]);
  for (const o of corridor) if (Math.hypot(Math.max(0, Math.abs(camXZ[0] - o.x) - o.w / 2), Math.max(0, Math.abs(camXZ[1] - o.z) - o.d / 2)) < PLAN.camReach) roof = Math.max(roof, o.h);
  const yStreet = ground([camXZ[0], 0, camXZ[1]]) + PLAN.hover + PLAN.camAbove;
  const yT = PLAN.glow[0] * f0;
  const yC = Math.max(yStreet, roof + PLAN.camAbove, needHeight(camXZ, yT, live, 0.6) + 0.5) + extra;
  const cam = [camXZ[0], yC, camXZ[1]];
  return { out, fwd, right, cam, lift: yC - yStreet, dC };
}

// カメラ s から爆心の方へ並ぶ乗り手の列（corridor: まわりのビル）
function beatRiders(s, f0, corridorAll, ground, maxDip = PLAN.maxDip) {
  const { cam, fwd, right, dC } = s, camXZ = [cam[0], cam[2]], yC = cam[1];
  // 列のまわり（カメラから爆心の方へ ahead[1] m、横に side の端 + 余裕）のビルだけ
  const sideMax = Math.max(...PLAN.side.map(Math.abs)) + 8;
  const corridor = corridorAll.filter((o) => {
    const rx = o.x - camXZ[0], rz = o.z - camXZ[1];
    const along = rx * fwd[0] + rz * fwd[2], across = Math.abs(rx * right[0] + rz * right[2]);
    return along > -10 - o.w && along < PLAN.ahead[1] + 10 + o.w && across < sideMax + Math.max(o.w, o.d) / 2;
  });
  // 列: 奥の者がじわじわ期の光の 12 m 外に収まるよう、長さを縮める
  const [a0, a1] = PLAN.ahead;
  const span = Math.max(8, Math.min(a1, dC - f0 - 12));
  const ahead = (k) => Math.min(a0, span * 0.17) + (span - Math.min(a0, span * 0.17)) * k / (PLAN.riders - 1);
  const riders = [];
  for (let k = 0; k < PLAN.riders; k++) {
    const a = ahead(k);
    let best = null;
    for (const sd of PLAN.side) {
      const x = camXZ[0] + fwd[0] * a + right[0] * sd * (k % 2 ? -1 : 1), z = camXZ[1] + fwd[2] * a + right[2] * sd * (k % 2 ? -1 : 1);
      // 立つ所: 足もとのビルの屋上（なければ地面）
      let under = null;
      for (const o of corridor) if (inFoot(x, z, o, -0.8) && (!under || o.h > under.h)) under = o;
      // 屋上（なければ地面）の hover 上。屋上が低ければ、カメラから lineDip° 下の線まで浮き上がる（hoverMax まで。浮遊バイク）。
      // それでも maxDip より見下ろすなら使わない
      const floorY = (under ? under.h : ground([x, 0, z]));
      const y = Math.max(floorY + PLAN.hover, Math.min(floorY + PLAN.hoverMax, yC - 2 - a * Math.tan(Math.min(maxDip, PLAN.lineDip) * DEG)));
      if (y > yC - 2 || Math.atan2(yC - y, a) > maxDip * DEG + 1e-9) continue;
      const pos = [x, y, z];
      // 立つビル以外の壁に入らない・カメラから頭が見通せる
      if (corridor.some((o) => o !== under && inBox(pos, o, PLAN.riderClear))) continue;
      if (corridor.some((o) => o !== under && segHitsBox(cam, [x, y + 1.3, z], o, 0.3)) || (under && segHitsBox(cam, [x, y + 1.3, z], { ...under, h: under.h - 0.2 }, 0))) continue;
      const score = (under ? 0 : 1) + Math.abs(sd) * 0.02; // 屋上に立てる所が先
      if (!best || score < best.score) best = { pos, score };
      if (under) break;
    }
    if (best) riders.push({ pos: best.pos, yaw: Math.atan2(-best.pos[0], -best.pos[2]), ahead: a });
  }
  return riders;
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
  const [dMin, dMax] = PLAN.camBand.map((k) => k * R);
  // 好みのカメラの距離: 選んだ見回る者が列の手前の方に来る所
  const dPref = Math.min(dMax, Math.max(dMin, picked ? distOf(picked) + PLAN.ahead[0] : (dMin + dMax) / 2));
  const dists = [dPref];
  for (let i = 1; i < PLAN.dSteps; i++) {
    const step = (dMax - dMin) / (PLAN.dSteps - 1) * Math.ceil(i / 2);
    const d = i % 2 ? dPref - step : dPref + step;
    if (d >= dMin - 1e-9 && d <= dMax + 1e-9) dists.push(d);
  }
  const reach = dMax + 40;
  const others = enemies.filter((e) => alive(e) && e !== picked).map(posOf);
  // 奥の乗り手が飲まれてからカメラが飲まれるまで（現実の速さ）
  const win = (s) => timeAtFront(Math.hypot(...s.cam), R) - timeAtFront(Math.min(...s.riders.map((r) => Math.hypot(...r.pos))), R);
  let best = null, evals = 0;
  for (const off of AZ_STEPS) {
    const az = a0 + off;
    const ux = Math.cos(az), uz = Math.sin(az);
    const corridor = buildings.filter((o) => {
      const along = o.x * ux + o.z * uz, across = Math.abs(-o.x * uz + o.z * ux);
      return along > -20 && along < reach && across < Math.max(o.w, o.d) / 2 + 0.16 * Math.max(0, dMax - along) + 30;
    });
    const live = corridor.filter((o) => nearDist(o) > f0 * PLAN.glowIgnore);
    const liveC = live.filter((o) => nearDist(o) > f0 * PLAN.open.occlude);
    for (const d of dists) for (const extra of PLAN.raise) {
      const s = beatAt(az, d, f0, corridor, live, ground, extra);
      if (!Number.isFinite(s.cam[1]) || s.cam[1] > PLAN.maxLift * R + PLAN.hover + PLAN.camAbove) continue;
      // 安い確かめから: 点数の下限（開け具合・乗り手が満点でも）が今の一番より悪ければ試さない
      const floor = liftPenalty(s.lift) + Math.abs(off) * 1.5 + Math.abs(d - dPref) / R;
      if (best && floor >= best.score) continue;
      if (corridor.some((o) => inBox(s.cam, o, PLAN.camClear))) continue;
      if (others.some((p) => Math.hypot(p[0] - s.cam[0], p[2] - s.cam[2]) < PLAN.othersClear)) continue;
      if (PLAN.glow.some((g) => live.some((o) => segHitsBox(s.cam, [0, g * f0, 0], o, 0.5)))) continue;
      evals++;
      const op = openness(s.cam, f0, live, liveC);
      s.riders = beatRiders(s, f0, corridor, ground);
      // 足りなければ、見下ろす角度の上限をゆるめて並べ直す（それでも見通せて、屋上か地面の上に浮く）
      if (s.riders.length < PLAN.minRiders) { const more = beatRiders(s, f0, corridor, ground, PLAN.maxDipLoose); if (more.length > s.riders.length) s.riders = more; }
      if (s.riders.length < 3) continue;
      const w = win(s);
      // 谷・開け具合が open.min 未満・乗り手が minRiders 未満・影の間が window.min 未満は、ほかに無いときだけ（大きく減点）
      const soft = (op.canyon ? 1 : 0) + (op.center ? 0 : 1) + (op.open < PLAN.open.min ? 1 : 0) + (s.riders.length < PLAN.minRiders ? 1 : 0) + (w < PLAN.window.min ? 1 : 0);
      const score = soft * 25 + (1 - op.open) * PLAN.open.weight + (PLAN.riders - s.riders.length) * 0.6 + liftPenalty(s.lift)
        + Math.abs(off) * 1.5 + Math.abs(d - dPref) / R + Math.abs(w - PLAN.window.want) * 4;
      if (!best || score < best.score) best = { ...s, score, soft, open: op.open, canyon: op.canyon, window: w };
    }
    // 開けた所が見つかった（細かい向きを試し終えたら、それより大きくずれた向きは試さない）。放つ瞬間を重くしないよう、
    // 開け具合を確かめた数が budget を超えたら、それまでの一番で決める（数で切るので、同じ街・同じ種ならいつも同じ答え）
    if (best && best.soft === 0 && Math.abs(off) >= 0.3 - 1e-9) break;
    if (best && evals > PLAN.budget) break;
  }
  if (!best) {
    // 撮れる所がない: 好みの向き・距離で、街のどのビルより高く浮かせる
    const top = buildings.reduce((m, o) => Math.max(m, o.h), 0);
    const s = beatAt(a0, dPref, f0, [], [], ground);
    s.cam[1] = Math.max(s.cam[1], top + PLAN.camAbove);
    s.riders = beatRiders(s, f0, [], ground, 90);
    best = { ...s, open: 1, window: win(s) };
  }
  // 乗り手の顔ぶれ: 列の手前（撮る一人。riderBody で描く）は選んだ見回る者、ほかはその場所に近い生きた者から順に
  // （足りなければ名もない乗り手 id: null）
  // いちばん手前（カメラに近い）が撮る一人
  const riders = [...best.riders].sort((a, b) => Math.hypot(a.pos[0] - best.cam[0], a.pos[2] - best.cam[2]) - Math.hypot(b.pos[0] - best.cam[0], b.pos[2] - best.cam[2]));
  const at = riders[0].pos;
  const rest = enemies.filter((e) => alive(e) && e !== picked)
    .map((e) => [e, Math.hypot(posOf(e)[0] - at[0], posOf(e)[2] - at[2])]).sort((a, b) => a[1] - b[1]).map(([e]) => e.id);
  const ids = [picked ? picked.id : null, ...rest];
  const group = riders.map((r, i) => ({ id: ids[i] ?? null, pos: r.pos, yaw: r.yaw, dist: len2(r.pos) }));
  const plan = {
    riderId: group[0].id,
    rider: { pos: group[0].pos, yaw: group[0].yaw, out: best.out, fwd: best.fwd },
    riders: group,
    open: best.open,
    soft: best.soft ?? 0, // 開けた所の決まり（谷でない・真ん中が見通せる・開け具合・人数・影の間）のうち守れなかった数（ふつう 0）
    window: best.window,
    riderDist: Math.hypot(...group[0].pos),
    firstDist: Math.min(...group.map((g) => Math.hypot(...g.pos))),
    camPos: best.cam,
    look: [0, f0 * PLAN.open.lookH, 0],
    camDist: Math.hypot(...best.cam),
    creepFront: f0,
    retreat: null,
  };
  if (retreat) plan.retreat = planRetreat(plan, { buildings, crater, radius: R, lead });
  return plan;
}
