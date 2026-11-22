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
//   fix2: カメラは屋上の並みの 4 m 上。riders[0] はカメラの 12〜18 m 先・横に 3〜4 m・2.5〜3.5 m 下の大きな背中。列はその 30〜180 m 先に
//   左右へ交互に散り、ほぼ目の高さに浮く。光の玉をふさぐ遠いビルと光の玉の中のビルは、演出が白の間に隠す（plan.hide）

export const PLAN = {
  // fix1（コーディネーター: 遠くの軍勢が飲まれるのが画面で読めない）: 開けた所から、カメラの 30〜180 m 先に並ぶ列を
  // 光の壁が奥の者から順に 0.4〜0.6 秒かけて飲んでいく
  // fix2: カメラは屋上の並みのすぐ上（camAbove 4 m）。手前に大きな撮る一人の背中（near）、その先に左右へ散った列が
  // ほぼ目の高さ（lineDip 2〜3°）に浮いて、空と光の壁を背に遠くへ並ぶ
  band: [0.36, 0.56],    // 撮る一人（見回る者）を選ぶ帯（その一発の半径に対する割合）
  // カメラの爆心からの水平の距離（半径に対する割合）。fix2: スローの終わりの光の玉（じわじわ期の前線）が、画角 35° 以下で
  // 画面の高さの 0.4 以下に収まる遠さ（じわじわ期の前線は半径の 0.06 倍なので 2·atan(0.06/0.5) ≈ 13.7° ≤ 0.4·35°）
  camBand: [0.5, 0.64],
  dSteps: 7,             // カメラの帯の中で試す距離の数
  camAbove: 4,           // カメラはまわり（camReach m 以内）の屋上よりこの高さ上（fix2: 9 → 4。屋上の並みのすぐ上）
  camReach: 22,
  liftCost: 70,          // 通りの高さ（地面 + hover + camAbove）から上げた高さ liftCost m ごとに 1 点悪い。liftSoft m より上は liftSteep m ごとに 1 点
  liftSoft: 45,
  liftSteep: 15,
  maxLift: 0.3,          // カメラの高さは半径のこの割合まで
  hover: 1.2,            // 乗り手のバイクの底は、立つ屋上（か地面）から少なくともこの高さ（ほぼ目の高さの線まで hoverMax まで浮く）
  hoverMax: 120,
  lineDip: 2,          // 列の乗り手は、カメラから lineDip° 下の線（ほぼ目の高さ）に浮いて並ぶ（空と光の壁を背にした影の列）
  lineDrop: 0.5,           // 列の線は目の高さよりこれだけ下から（m。乗り手の胸がほぼ目の高さ）
  // 列: 手前の撮る一人の ahead[0]〜ahead[1] m 先に riders 人（小さな一発ではじわじわ期の光の外に収まるよう縮める）。
  // fix2: 左右へ交互に side[0]〜side[1] m。爆心への線からの角度は手前 lineAz[0]° から奥 lineAz[1]° へ（光の玉の幅の中で、
  // 光を背にした影になる。縦長の狭い画面にも入る）。minAz° 以上それて（光の玉の真ん中をふさがない）、画面の上で重ならない
  ahead: [30, 180],
  riders: 8,
  minRiders: 6,
  side: [5, 15],
  sideSpan: 120, sideMin: 0.5,
  lineAz: [5.5, 3],
  minAz: 2,
  // fix2: 撮る一人（いちばん手前。riderBody の背中・ヘルメット・推進の光）: カメラの ahead m 先、横に side m（fix3: 3〜4 → 2〜3 m。
  // 縦長の狭い画面に光の玉と並んで入る）、below[0]〜below[1] m 下
  // （見下ろす角度 dip°（8〜10°）。演出が画面の下 1/3 に、画面の高さの 15〜25% に撮る）。爆心の光の玉の真ん中より under° 下に置く。
  // それに dipMax° より深く見下ろす要る小さな一発（カメラが爆心に近く、屋上の並みから光を見下ろす）だけは、steep m まで下げる
  near: { ahead: [17, 15, 18, 13], side: [2, 2.5, 3], below: [2.5, 3.5], dip: 8.5, under: 1.5, dipMax: 10, steep: 8, steepCost: 0.15, back: 40, backCost: 2, fitCost: 10 },
  // 画面の上の乗り手の大きさ（重ならないかを確かめる）: 半分の高さ・幅（m）、遠くで大きく描かれる下限（°）と倍率の上限、余白（°）
  look: { halfH: 0.95, halfW: 0.6, minHalfDeg: 0.4, maxBoost: 3, gapDeg: 0.15 },
  maxDip: 24,            // カメラから乗り手を見下ろす角度（°）の上限（足りないときは maxDipLoose まで）
  maxDipLoose: 30,
  raise: [0],            // カメラをさらに上げる候補（m）。fix2: 上げない（屋上の並みのすぐ上から撮る）
  budget: 500,           // 開け具合を確かめる候補の数の上限（撮る場所を決める重さ。白の最初のフレームで決める）
  riderClear: 0.6,       // 乗り手（バイク）は、立つビル以外のビルの壁からこの距離より離れる
  camClear: 3,           // カメラはビルからこの距離より離れる
  othersClear: 5,        // ほかの軍勢（実際の位置で描かれる者）はカメラからこの距離より離れている
  // 見通す爆心の光の高さ（じわじわ期の終わりの前線に対する割合）。どれも必ず見える
  glow: [0.95],
  // fix2: 爆心からこの距離（じわじわ期の前線に対する割合）より近いビルは、演出が白の間に隠す（光の玉の前に浮く灰色の箱にならない）
  glowIgnore: 1.1,
  // fix2: カメラから hideFar m より遠く、真ん中（爆心の向き ±2°）の光線をふさぐビルも、演出が白の間に隠す（屋上の並みのすぐ上の
  // カメラから、街の芯の高いビルが光の玉をふさがない）。見通しを測るときも数えない（hiddenFor）
  hideFar: 60,
  // 開けた見通し: 爆心の向きから ±8° の扇（open.az）を、爆心の上の高さ open.h（じわじわ期の前線に対する割合）へ。
  // ふさがれていない光線の割合が開け具合（open.min より低い所は使わない。手前の屋上の並みが長いレンズの画面の下半分をふさがないよう、
  // 爆心を見る線から dip° 下の光線も手前 near2 m まで数える）。±4° の光線（open.side）がカメラから open.near m 以内でビルに当たる所（谷）は使わない
  open: { az: [-8, -4, 0, 4, 8], h: [0.8, 1.5, 3], side: 4, near: 60, weight: 6, min: 0.75, dip: [4], near2: 120, lookH: 0.6, centerAz: [-2, 0, 2], centerH: [0.3, 0.65, 0.95, 1], glowAz: [0.4, 0.75, 0.95], glowH: [0.04, 0.15], baseNear: 2 },
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
// city（M1）: 街の中心（爆心を原点とした位置 { x, z }。爆心が街の中心なら原点）。街の外（野原）かはそこからの距離で見る
function findRetreat(origin, base, buildings, ground, radius, lead, city = null) {
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
      const r = Math.hypot(origin[0] + dir[0] * x - (city?.x ?? 0), origin[2] + dir[1] * x - (city?.z ?? 0));
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
// M1: 位置はどれも爆心を原点とした位置。city は街の中心（その座標で。省けば原点 = 爆心が街の中心）
export function planRetreat(plan, { buildings, crater = 0, radius, lead = 0, city = null }) {
  // 基準の向きは爆心から離れる向き（カメラは光の壁から逃げる）
  const c = plan.camPos;
  return findRetreat(c, Math.atan2(c[2], c[0]), buildings, groundFor(crater), radius, lead, city);
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

// R0b fix3: 放つ瞬間の軍勢の写し（撮る場所を決めるのに使うものだけ）。撮る場所は白を描いた次のフレームで決めるが、その間（白）に
// ゲームは進む（軍勢が動く）ので、放つ瞬間の写しから決める（どの fps でも同じ答え）
export function snapshotEnemies(list) {
  return list.map((e) => ({ id: e.id, angle: e.angle, dist: e.dist, x: e.x, z: e.z, state: e.state, patrol: e.patrol }));
}

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
  // 長いレンズの真ん中（爆心の向き ±2°、じわじわ期の光の玉の 0.3〜1 倍の高さ）はふさがれない。演出が白の間に隠すビル（hiddenFor）は
  // 渡す側が除いておく（liveCenter）
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

// カメラ cam から、地面の上の箱 o までの水平の最短距離
const boxDist = (cam, o) => Math.hypot(Math.max(0, Math.abs(cam[0] - o.x) - o.w / 2), Math.max(0, Math.abs(cam[2] - o.z) - o.d / 2));

// fix2: 演出が白の間に隠すビル（追うカットで戻す）。どちらかに当たるもの:
//   - 爆心のそば（nearDist < glowIgnore·f0。じわじわ期の光の玉の中に沈む。光の玉の前に浮く窓のない灰色の箱にならない）
//   - カメラから hideFar m より遠く、真ん中の光線（爆心の向き ±2°、じわじわ期の光の玉の 0.3〜1 倍の高さ）か、光の玉の幅と根元への
//     光線（見かけの半径の ±0.4・±0.75・±0.95 倍、0.04・0.15 倍の高さ）をふさぐ（屋上の並みのすぐ上のカメラから、街の芯の高いビルと
//     手前の屋上の並みが光の玉をふさがない）
//   - fix3: 爆心から baseNear·f0 の内で、カメラから見て光の玉の下半分に重なる（光の玉の根元の前の低いビル）
// 撮る場所の見通し（openness の真ん中・爆心の光）も、この決まりで隠れるビルは数えない。演出（cinematic.js）は plan.hide を隠す
export function hiddenFor(cam, f0, buildings) {
  const D = Math.hypot(cam[0], cam[2]), base = Math.atan2(-cam[2], -cam[0]), O = PLAN.open;
  // 真ん中の光線（±2°）に加えて、光の玉の幅（見かけの半径 half° の glowAz 倍）と根元（glowH）へも
  const half = Math.atan(f0 / Math.max(1, D)) / DEG;
  const az = [...O.centerAz, ...O.glowAz.flatMap((k) => [k * half, -k * half])], hs = [...O.glowH, ...O.centerH];
  const rays = [];
  for (const deg of az) for (const h of hs) rays.push([cam[0] + Math.cos(base + deg * DEG) * D, h * f0, cam[2] + Math.sin(base + deg * DEG) * D]);
  // fix3: 爆心のそば（nearDist < baseNear·f0）で、カメラから見た箱の角度の広がりが光の玉の下半分（横は見かけの半径、縦は地面〜0.5·f0）に
  // 重なるものも（光の玉の根元の前に並ぶ低いビル）
  const yC = cam[1];
  const elOf = (h, d) => Math.atan2(h - yC, d);
  const lowLo = elOf(0, D), lowHi = elOf(0.5 * f0, D), halfR = half * DEG;
  const overlapsBase = (o) => {
    if (nearDist(o) >= O.baseNear * f0 || boxDist(cam, o) <= PLAN.hideFar) return false;
    let a0 = Infinity, a1 = -Infinity, e0 = Infinity, e1 = -Infinity;
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      const x = o.x + dx * o.w / 2 - cam[0], z = o.z + dz * o.d / 2 - cam[2];
      const a = Math.atan2(Math.sin(Math.atan2(z, x) - base), Math.cos(Math.atan2(z, x) - base)), d = Math.hypot(x, z);
      a0 = Math.min(a0, a); a1 = Math.max(a1, a);
      e0 = Math.min(e0, elOf(0, d)); e1 = Math.max(e1, elOf(o.h, d));
    }
    return a1 > -halfR && a0 < halfR && e1 > lowLo && e0 < lowHi;
  };
  return buildings.filter((o) => nearDist(o) < PLAN.glowIgnore * f0
    || (boxDist(cam, o) > PLAN.hideFar && rays.some((q) => segHitsBox(cam, q, o, 0.3)))
    || overlapsBase(o));
}

// 爆心からの向き az・カメラの水平の距離 dC での、カメラ（屋上の並みの camAbove m 上。爆心の光を見通せる高さまで上げる。
// fix2: hideFar m より遠いビルは、ふさいでいれば演出が隠すので数えない）
function beatAt(az, dC, f0, corridor, live, ground, extra = 0) {
  const out = [Math.cos(az), 0, Math.sin(az)];
  const fwd = [-out[0], 0, -out[2]];           // 爆心の方
  const right = [-fwd[2], 0, fwd[0]];
  const camXZ = [out[0] * dC, out[2] * dC];
  const c3 = [camXZ[0], 0, camXZ[1]];
  let roof = ground(c3);
  for (const o of corridor) if (boxDist(c3, o) < PLAN.camReach) roof = Math.max(roof, o.h);
  const yStreet = ground(c3) + PLAN.hover + PLAN.camAbove;
  const yT = PLAN.glow[0] * f0;
  const near = live.filter((o) => boxDist(c3, o) <= PLAN.hideFar);
  const yC = Math.max(yStreet, roof + PLAN.camAbove, needHeight(camXZ, yT, near, 0.6) + 0.5) + extra;
  const cam = [camXZ[0], yC, camXZ[1]];
  return { out, fwd, right, cam, lift: yC - yStreet, dC };
}

// カメラから見た乗り手（バイクの底 pos、高さ 2·halfH）の画面の上の角度の箱（°）: 横（爆心への線から右へ）・縦（中心）と半分の幅・高さ。
// 遠くの乗り手は小さすぎると大きく描かれる（enemyView の boost）ので、その分も見込む
function riderRect(s, pos, L = PLAN.look) {
  const { cam, fwd, right } = s;
  const rx = pos[0] - cam[0], rz = pos[2] - cam[2];
  const along = rx * fwd[0] + rz * fwd[2], across = rx * right[0] + rz * right[2];
  const d = Math.hypot(along, across);
  const t = Math.atan(L.halfH / d) / DEG;
  const hh = Math.min(t * L.maxBoost, Math.max(t, L.minHalfDeg));
  return { az: Math.atan2(across, along) / DEG, el: Math.atan2(pos[1] + L.halfH - cam[1], d) / DEG, hh, hw: hh * L.halfW / L.halfH };
}
export function rectsOverlap(a, b, gap = PLAN.look.gapDeg) {
  return Math.abs(a.az - b.az) < a.hw + b.hw + gap && Math.abs(a.el - b.el) < a.hh + b.hh + gap;
}

// fix2: スローの間のレンズ（縦の画角、度）: スローの終わりに、じわじわ期の光の玉（半径 f0、カメラから d）が画面の高さの
// ball 倍になる画角 2·atan(f0/d)/ball を、min〜max に収める。スローの始めは push 倍だけ広い（ゆっくり寄る）。
// fix4: 縦長で光の玉と撮る一人が並んで入らないときは、ball を minBall まで下げる（max も同じ割合で広げる。planFinale の plan.lens）
export const BEAT_LENS = { ball: 0.33, minBall: 0.28, min: 18, max: 35, push: 0.08 };
export function beatLens(f0, d, L = BEAT_LENS) {
  const deg = 2 * Math.atan(f0 / Math.max(1, d)) / DEG;
  return Math.min(L.max, Math.max(L.min, deg / L.ball));
}
export const BEAT_PUSH = 1.5; // スローの間にカメラを押し込む距離（m）
// fix2: 手前の撮る一人（riders[0]）を、画面の下 1/3 の縦 y（NDC）に撮る。弾けたあとは横 ±x（NDC）の内に。
// fix3: スローの間は、じわじわ期の終わりの光の玉の幅を横 ±dome の内に必ず入れ、撮る一人も入るなら入れる。
// fix4: 撮る一人の幅は riderBody の箱（横 ±body.halfW m、長さ body.back〜body.front m、高さ body.h m）の角から測る
export const NEAR_FRAME = { y: -0.5, x: 0.85, dome: 0.97, body: { halfW: 0.45, back: -1.7, front: 1.5, h: 1.6 } };
const wrapA = (x) => Math.atan2(Math.sin(x), Math.cos(x));
// 撮る一人の体の箱の角の、カメラ（x, z）から見た横の角度（rad）の幅 [lo, hi]（基準の向き az0 から）
export function riderAzSpan(camXZ, pos, yaw, az0, B = NEAR_FRAME.body) {
  let lo = Infinity, hi = -Infinity;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (const x of [-B.halfW, B.halfW]) for (const z of [B.back, B.front]) {
    const px = pos[0] + x * cy + z * sy, pz = pos[2] - x * sy + z * cy;
    const a = wrapA(Math.atan2(pz - camXZ[1], px - camXZ[0]) - az0);
    lo = Math.min(lo, a); hi = Math.max(hi, a);
  }
  return [lo, hi];
}
// fix4: スローの終わり（押し込んだカメラ、スローのレンズ）の縦長の画面で、光の玉の幅をまるごと入れたとき（演出の決まり）に、
// 撮る一人の体の箱の横の何割が画面に入るか（0〜1）。横長（aspect ≥ 1）は 1 とは限らないが、同じ式で測る
export function nearFitFrac(cam, rider, f0, aspect, ball = BEAT_LENS.ball) {
  const h = Math.hypot(cam[0], cam[2]) || 1, fx = -cam[0] / h, fz = -cam[2] / h;
  const p = [cam[0] + fx * BEAT_PUSH, cam[1], cam[2] + fz * BEAT_PUSH];
  const L = { ...BEAT_LENS, ball, max: BEAT_LENS.max * BEAT_LENS.ball / ball };
  const fov = beatLens(f0, Math.hypot(...p), L) * DEG;
  const tanH = Math.tan(fov / 2) * aspect;
  const limD = Math.atan(NEAR_FRAME.dome * tanH), limF = Math.atan(tanH);
  const hd = Math.asin(Math.min(1, f0 / Math.hypot(p[0], p[1] - PLAN.open.lookH * f0, p[2])));
  const az0 = Math.atan2(-p[2], -p[0]);
  const [aLo, aHi] = riderAzSpan([p[0], p[2]], rider.pos, rider.yaw, az0);
  if (Math.max(hd, aHi) - Math.min(-hd, aLo) <= 2 * limD) return 1;
  // 光の玉を優先: 撮る一人と反対側の光の玉の縁を画面の ±limD に置く
  const right = aLo + aHi > 0;
  const w0 = right ? -hd - (limF - limD) : hd - limD - limF, w1 = right ? -hd + limD + limF : hd + (limF - limD);
  return Math.max(0, Math.min(1, (Math.min(aHi, w1) - Math.max(aLo, w0)) / Math.max(1e-9, aHi - aLo)));
}
const FIT_FULL = 0.98; // これ以上なら「撮る一人がまるごと入る」

// カメラ s から爆心の方へ並ぶ乗り手（corridor: まわりのビル）。[0] は手前の撮る一人（near）、ほかは左右へ交互に散った列
function beatRiders(s, f0, corridorAll, ground, maxDip = PLAN.maxDip, props = [], aspect = 1) {
  const { cam, fwd, right, dC } = s, camXZ = [cam[0], cam[2]], yC = cam[1];
  // 列のまわり（カメラから爆心の方へ ahead[1] m、横に side の端 + 余裕）のビルだけ
  const sideMax = PLAN.side[1] + 8;
  const corridor = corridorAll.filter((o) => {
    const rx = o.x - camXZ[0], rz = o.z - camXZ[1];
    const along = rx * fwd[0] + rz * fwd[2], across = Math.abs(rx * right[0] + rz * right[2]);
    return along > -10 - o.w && along < PLAN.near.ahead[2] + PLAN.ahead[1] + 10 + o.w && across < sideMax + Math.max(o.w, o.d) / 2;
  });
  const at = (a, sd) => [camXZ[0] + fwd[0] * a + right[0] * sd, camXZ[1] + fwd[2] * a + right[2] * sd];
  const sees = (pos, under) => !corridor.some((o) => o !== under && segHitsBox(cam, [pos[0], pos[1] + 1.3, pos[2]], o, 0.3))
    && !(under && segHitsBox(cam, [pos[0], pos[1] + 1.3, pos[2]], { ...under, h: under.h - 0.2 }, 0));
  const riders = [], rects = [];
  // 手前の撮る一人: カメラの near.ahead m 先、横に near.side m、near.below m 下（ビルの壁に入らない所）
  // 見下ろす角度は near.dip°（爆心の光の玉の真ん中（0.5·f0 の高さ）より near.under° 下まで深くする。下がるのは near.below の幅の中）
  const glowMid = Math.atan2(yC - 0.5 * f0, Math.hypot(...camXZ)) / DEG;
  let nearSide = 1;
  // fix3: 撮る一人の背後（カメラから撮る一人の胸を通る線の先 near.back m）にビルがない所を先に選ぶ（その先は光の壁に飲まれて明るい壁になる。
  // すぐ後ろに飲まれないビルがあると、黒い背中が黒いビルにまぎれる）。どこにもなければ背後は問わない
  const backClear = (pos) => {
    const h = [pos[0], pos[1] + 1, pos[2]], d = Math.hypot(h[0] - cam[0], h[1] - cam[1], h[2] - cam[2]), k = (d + PLAN.near.back) / d;
    const q = cam.map((v, i) => v + (h[i] - v) * k);
    return !corridorAll.some((o) => segHitsBox(h, q, o, 0.3)) && !props.some((o) => segHitsBox(h, q, o, 0.3));
  };
  // fix4: 縦長では、横のずれ（near.side）と左右を、スローの終わりに光の玉と撮る一人の体がまるごと画面に入るか（nearFitFrac）で選ぶ。
  // 入るものを先に（安い画面の確かめを先にして、重い見通しの確かめは入るものだけ）。どれも入らなければ今までの順で最初の所
  const fitPass = aspect < 1 ? [true, false] : [false];
  found: for (const needBack of [true, false]) for (const needFit of fitPass) for (const a of PLAN.near.ahead) for (const m of PLAN.near.side) for (const sg of [1, -1]) {
    const dip = Math.max(PLAN.near.dip, glowMid + PLAN.near.under) * DEG;
    // ふつうは below[0]〜below[1] m 下。爆心の光をかなり見下ろす小さな一発では、光の玉の真ん中より下に来るまで steep m まで下げる
    const top = glowMid + PLAN.near.under > PLAN.near.dipMax ? PLAN.near.steep : PLAN.near.below[1];
    const below = Math.min(top, Math.max(PLAN.near.below[0], Math.hypot(a, m) * Math.tan(dip)));
    const [x, z] = at(a, sg * m), pos = [x, yC - below, z];
    const yaw = Math.atan2(-pos[0], -pos[2]);
    const fit = aspect < 1 ? nearFitFrac(cam, { pos, yaw }, f0, aspect) : 1;
    if (needFit && fit < FIT_FULL) continue;
    if (pos[1] < ground([x, 0, z]) + PLAN.hover) continue;
    if (corridorAll.some((o) => inBox(pos, o, PLAN.riderClear)) || !sees(pos, null)) continue;
    if (needBack && !backClear(pos)) continue;
    riders.push({ pos, yaw, ahead: a, near: true, back: needBack, fit });
    rects.push(riderRect(s, pos));
    nearSide = sg;
    break found;
  }
  // 列: 撮る一人の ahead[0]〜ahead[1] m 先（カメラから）。奥の者がじわじわ期の光の 12 m 外に収まるよう、長さを縮める
  const [a0, a1] = PLAN.ahead, base = riders[0]?.ahead ?? 0;
  const n = PLAN.riders;
  const span = Math.max(8, Math.min(base + a1, dC - f0 - 12));
  const first = Math.min(base + a0, span * 0.45);
  const ahead = (k) => first + (span - first) * k / (n - 1);
  // fix3: 小さな一発（列が短い）は横の幅も縮める（span / sideSpan 倍、sideMin 倍まで）。近い列が 5〜15 m に散ると、縦長の画面から外れる
  const ks = Math.min(1, Math.max(PLAN.sideMin, span / PLAN.sideSpan));
  const [s0, s1] = PLAN.side.map((v) => v * ks), [z0, z1] = PLAN.lineAz;
  for (let k = 0; k < n; k++) {
    const a = ahead(k);
    // 左右へ交互。fix3: いちばん手前の列の者は撮る一人の反対側（撮る一人は横に 2〜3 m と近くなり、同じ側では画面の上で重なる）
    const sg = (k % 2 ? 1 : -1) * nearSide;
    // 爆心への線からの角度: 手前 lineAz[0]° → 奥 lineAz[1]°（横の幅 side[0]〜side[1] m に収める）
    const want = Math.min(s1, Math.max(s0, a * Math.tan((z0 + (z1 - z0) * k / (n - 1)) * DEG)));
    const mags = [];
    for (let m = s0; m <= s1 + 1e-9; m += ks * 1) mags.push(m);
    mags.sort((p, q) => Math.abs(p - want) - Math.abs(q - want));
    for (const m of mags) {
      if (Math.atan2(m, a) < PLAN.minAz * DEG) continue; // 爆心への線から minAz° 以上それる（光の玉の真ん中をふさがない）
      const [x, z] = at(a, sg * m);
      // 足もとのビル（なければ地面）
      let under = null;
      for (const o of corridor) if (inFoot(x, z, o, -0.8) && (!under || o.h > under.h)) under = o;
      const floorY = under ? under.h : ground([x, 0, z]);
      // ほぼ目の高さの線（カメラから lineDip° 下）に浮く。屋上がそれより高ければ屋上の hover 上（目の高さより下まで）。
      // 地面から hoverMax より上には浮かない
      const line = yC - PLAN.lineDrop - a * Math.tan(PLAN.lineDip * DEG);
      const y = Math.max(floorY + PLAN.hover, Math.min(floorY + PLAN.hoverMax, line));
      if (y > yC - PLAN.lineDrop || Math.atan2(yC - y, a) > maxDip * DEG + 1e-9) continue;
      const pos = [x, y, z];
      if (corridor.some((o) => o !== under && inBox(pos, o, PLAN.riderClear))) continue;
      if (!sees(pos, under)) continue;
      const r = riderRect(s, pos);
      if (rects.some((q) => rectsOverlap(q, r))) continue; // 画面の上で重ならない
      riders.push({ pos, yaw: Math.atan2(-pos[0], -pos[2]), ahead: a });
      rects.push(r);
      break;
    }
  }
  return riders;
}

// shot: 最後の一発（radius）、buildings: 残っているビル、enemies: 軍勢、crater: 地面のえぐれ
// lead: 逃げる道を確かめる長さに足す、前線の先を行く距離（m、半径 radius のとき）
// retreat: false なら逃げる道は探さず null（放つ瞬間を軽くする。あとで planRetreat で求める）
// props: 屋上の飾りの箱（cityView.roofProps。手前の撮る一人の背後に飾りがない所を選ぶ）
export function planFinale({ shot, buildings, enemies = [], rng, crater = 0, lead = 0, retreat = true, props = [], aspect = 1 }) {
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
    const live = corridor.filter((o) => nearDist(o) >= f0 * PLAN.glowIgnore);
    for (const d of dists) for (const extra of PLAN.raise) {
      const s = beatAt(az, d, f0, corridor, live, ground, extra);
      if (!Number.isFinite(s.cam[1]) || s.cam[1] > PLAN.maxLift * R + PLAN.hover + PLAN.camAbove) continue;
      // 安い確かめから: 点数の下限（開け具合・乗り手が満点でも）が今の一番より悪ければ試さない
      const floor = liftPenalty(s.lift) + Math.abs(off) * 1.5 + Math.abs(d - dPref) / R;
      if (best && floor >= best.score) continue;
      if (corridor.some((o) => inBox(s.cam, o, PLAN.camClear))) continue;
      if (others.some((p) => Math.hypot(p[0] - s.cam[0], p[2] - s.cam[2]) < PLAN.othersClear)) continue;
      // 白の間に隠すビル（hiddenFor）は見通しに数えない
      const hidden = new Set(hiddenFor(s.cam, f0, live));
      const seen = live.filter((o) => !hidden.has(o));
      if (PLAN.glow.some((g) => seen.some((o) => segHitsBox(s.cam, [0, g * f0, 0], o, 0.5)))) continue;
      evals++;
      const op = openness(s.cam, f0, seen);
      const near = props.filter((o) => Math.hypot(o.x - s.cam[0], o.z - s.cam[2]) < PLAN.near.ahead[2] + PLAN.near.back + 10);
      s.riders = beatRiders(s, f0, corridor, ground, PLAN.maxDip, near, aspect);
      // 足りなければ、見下ろす角度の上限をゆるめて並べ直す
      if (s.riders.length < PLAN.minRiders) { const more = beatRiders(s, f0, corridor, ground, PLAN.maxDipLoose, near, aspect); if (more.length > s.riders.length) s.riders = more; }
      if (s.riders.length < 3 || !s.riders[0].near) continue;
      const w = win(s);
      // 谷・開け具合が open.min 未満・乗り手が minRiders 未満・影の間が window.min 未満は、ほかに無いときだけ（大きく減点）
      const soft = (op.canyon ? 1 : 0) + (op.center ? 0 : 1) + (op.open < PLAN.open.min ? 1 : 0) + (s.riders.length < PLAN.minRiders ? 1 : 0) + (w < PLAN.window.min ? 1 : 0);
      // 爆心の光を深く見下ろす所（小さな一発でカメラが爆心に近い）は、撮る一人が光の玉より下に来にくいので少し嫌う
      const glowDip = Math.atan2(s.cam[1] - 0.5 * f0, d) / DEG;
      const score = soft * 25 + (1 - op.open) * PLAN.open.weight + (PLAN.riders + 1 - s.riders.length) * 0.6 + liftPenalty(s.lift)
        + Math.abs(off) * 1.5 + Math.abs(d - dPref) / R + Math.abs(w - PLAN.window.want) * 4
        + Math.max(0, glowDip + PLAN.near.under - PLAN.near.dipMax) * PLAN.near.steepCost
        + (s.riders[0].back ? 0 : PLAN.near.backCost) // fix3: 撮る一人のすぐ後ろにビルがある所は嫌う
        + (1 - s.riders[0].fit) * PLAN.near.fitCost; // fix4: 縦長で撮る一人が画面の端で切れる所は嫌う
      if (!best || score < best.score) best = { ...s, score, soft, open: op.open, canyon: op.canyon, window: w };
    }
    // 開けた所が見つかった（細かい向きを試し終えたら、それより大きくずれた向きは試さない）。放つ瞬間を重くしないよう、
    // 開け具合を確かめた数が budget を超えたら、それまでの一番で決める（数で切るので、同じ街・同じ種ならいつも同じ答え）
    if (best && best.soft === 0 && Math.abs(off) >= 0.3 - 1e-9) break;
    if (best && evals > PLAN.budget) break;
  }
  let fallback = false;
  if (!best) {
    // 撮れる所がない: 好みの向き・距離で、街のどのビルより高く浮かせる
    fallback = true;
    const top = buildings.reduce((m, o) => Math.max(m, o.h), 0);
    const s = beatAt(a0, dPref, f0, [], [], ground);
    s.cam[1] = Math.max(s.cam[1], top + PLAN.camAbove);
    s.riders = beatRiders(s, f0, [], ground, 90, [], aspect);
    best = { ...s, open: 1, window: win(s), soft: 0 };
  }
  // 乗り手の顔ぶれ: 手前の撮る一人（riderBody で描く）は選んだ見回る者、列の者はその場所に近い生きた者から順に
  // （足りなければ名もない乗り手 id: null）
  const riders = best.riders;
  const atP = riders[0].pos;
  // fix4: 縦長でも撮る一人がまるごと入らなければ、スローのレンズを広げる（光の玉を画面の高さの ball 倍へ小さく。minBall まで）
  let ball = BEAT_LENS.ball, fit = riders[0].fit ?? 1;
  if (aspect < 1 && fit < FIT_FULL) {
    for (let b = BEAT_LENS.ball - 0.005; b >= BEAT_LENS.minBall - 1e-9; b -= 0.005) {
      ball = b;
      fit = nearFitFrac(best.cam, riders[0], f0, aspect, b);
      if (fit >= FIT_FULL) break;
    }
  }
  const rest = enemies.filter((e) => alive(e) && e !== picked)
    .map((e) => [e, Math.hypot(posOf(e)[0] - atP[0], posOf(e)[2] - atP[2])]).sort((a, b) => a[1] - b[1]).map(([e]) => e.id);
  const ids = [picked ? picked.id : null, ...rest];
  const group = riders.map((r, i) => ({ id: ids[i] ?? null, pos: r.pos, yaw: r.yaw, dist: len2(r.pos) }));
  const plan = {
    riderId: group[0].id,
    rider: { pos: group[0].pos, yaw: group[0].yaw, out: best.out, fwd: best.fwd },
    riders: group,
    open: best.open,
    soft: best.soft ?? 0, // 開けた所の決まり（谷でない・真ん中が見通せる・開け具合・人数・影の間）のうち守れなかった数（ふつう 0）
    fallback,             // 撮れる所が一つもなく、街のどのビルより高く浮かせた
    nearBack: !!riders[0].back, // fix3: 撮る一人のすぐ後ろ（near.back m）にビルがない（黒い背中が明るい光の壁を背にする）
    nearFit: fit, // fix4: スローの終わりに撮る一人の体の箱の横の何割が画面に入るか（縦長。横長は 1）
    lens: { ...BEAT_LENS, ball, max: BEAT_LENS.max * BEAT_LENS.ball / ball }, // fix4: スローのレンズ（演出の beatLens に渡す）
    window: best.window,
    riderDist: Math.hypot(...group[0].pos),
    firstDist: Math.min(...group.map((g) => Math.hypot(...g.pos))),
    camPos: best.cam,
    look: [0, f0 * PLAN.open.lookH, 0],
    camDist: Math.hypot(...best.cam),
    creepFront: f0,
    // 演出が白の間に隠すビル（hiddenFor。追うカットで戻す）
    hide: hiddenFor(best.cam, f0, buildings).map((o) => o.id),
    retreat: null,
  };
  if (retreat) plan.retreat = planRetreat(plan, { buildings, crater, radius: R, lead });
  return plan;
}
