import { CONFIG } from '../config.js';
import { groundHeight } from './sphereDeform.js';

// 浮遊バイクに乗った軍勢の一人の置き方（見た目だけ。判定は enemies.js の水平の距離 e.dist のまま）。
// 位置は e.x, e.z（ないときは e.angle, e.dist から）。
// - 探す・近づく: 進む向き（e.heading）を向き、曲がるとき（e.lean、なければ e.turn rad/s）は内へ深く傾く。速いほど鼻先を下げて前へ傾き、
//   R0: 見つけても止まらない（見つけた瞬間に推進の光が一瞬強まって、そのまま突っ込む）。地面（穴の上なら穴の面）から hover m 浮いて、わずかに揺れる。
//   主人公の手前で減速して待たず、掴む距離のすぐ手前（turnDist）で横を向き、主人公の近くの高さへ寄せながら飛びつく。
// - 掴む（R0、持ち主 22:15「まだ主人公前で止まる感じ」）: grabSettle 秒で、いた所から主人公の横（水平 clingRadius）へ寄り、y≈0 の高さで
//   主人公のまわりを回り続ける（回るのは enemies.js。描く半径は判定の半径を grabRange − clingRadius だけ内へずらしたもの）。
//   車体は主人公の向きと直角（回る向き）。乗り手の右手側に主人公がいて手を伸ばす。回る向きへ深く傾き、推進の光は強く明滅し、
//   寄り終えてからは小刻みに揺れて引っ張る（tug）。
// - 群がる（cling。掴む枠が埋まっていた者）: 掴む者の外の輪（判定の swarmRing）を回る。段（e.layer）ごとに高さをずらし、手を伸ばしかける。
//   枠が空いて掴むと（e.unpile 秒）、unpileSec で掴む者の高さへ下りる（内へ寄るのは enemies.js）。
// - 倒れる: バイクごと外へ吹き飛び、回りながら上がって落ち、deadFling 秒で消える。
// 返す値: x, y, z（バイクの底の中心）、yaw（y 軸まわり。0 で +z を向く）、pitch（正で鼻先が下がる）、roll、
//   reach（手を伸ばす 0〜1）、anchor（大きく描くときの中心を主人公へ寄せる 0〜1。anchorFor）、thrust（推進の光。ふだん 1、見つけた瞬間・掴んで回る間は 1.8 ほどまで）、keep（大きさ。消えるとき 0 へ）、
//   trail（推進の光の尾の長さ 0〜。速さ / 探す速さ）、curve（尾の曲がり 1/m。曲がる速さ / 速さ）
export const BIKE = {
  hover: [2, 4],      // m。地面からの浮く高さ（人ごとにばらつく）
  bob: 0.18,          // m。上下の揺れ
  clingRadius: 1.35,  // m。掴むとき、主人公からバイクの中心線までの水平の距離
  nearY: [0.3, 1.7],  // m。主人公のすぐ手前（掴む距離）での高さ（人ごとにばらつく）
  grabSettle: 0.35,   // s。掴んだら、この秒で主人公の横へ寄る
  turnDist: 3.5,      // m。掴む距離のこの手前から横を向く（突っ込んできて最後に横を向いて飛びつく）
  descendDist: 8,     // m。掴む距離のこの手前から、主人公の高さへ寄せる
  // 群がる者（cling）の高さ: pileUp m 上（段ごとに pileStep m ずつ、3 段で一巡）。unpileSec で掴む者の高さへ下りる
  pileUp: 0.6, pileStep: 0.45, unpileSec: 0.3,
  // 掴んで回る者（R0）: 回る向きへの傾き（rad）、寄り終えてからの小刻みな揺れ（引っ張る。水平 tug m・上下 tugY m）
  orbitBank: 0.7, tug: 0.14, tugY: 0.1,
  // スピード感: 速さ（探す速さを 1）あたりの鼻先の下がり（rad）
  speedPitch: 0.2,
  spotFlash: 0.45,    // s。見つけた瞬間の推進の光の強まりが消えるまで
  nearFloor: -1,      // m。主人公の近く（nearDist 以内）では、深い穴の上でもこれより下がらない
  nearDist: 8,
  // nearDist より外では、下限が 1m あたりこれだけ下がる（8m 先で最大の穴の深さより下になり、穴の面に沿う）。
  // 穴は最後の一発でしかできず、その内側の者は倒れるので、深い穴の壁を駆け上がる場面はふつう起きない
  floorSlope: 60,
  bank: 0.1, bankMax: 0.8, // 曲がる速さ（rad/s）あたりの傾き（rad）と、その上限（曲がるときの深い傾き）
  // 大きく描くときの中心を主人公へ寄せる範囲（anchorFor）: anchorNear m より内では主人公を中心にし、anchorFar m で自分の足元へ戻す
  anchorNear: 4, anchorFar: 12,
  deadFling: 1.1,     // s
  // R1: 大きい者（大物 1.6 倍、重い者）は、掴んで回る輪をこれだけ外へ（大きな車体が主人公にめり込まない）
  kindCling: { boss: 0.85, heavy: 0.12 },
  // R1: 払いが当たってよろめく者（stagger）: 鼻先が上がり（staggerPitch rad）、左右に大きく揺れる（staggerRoll rad、staggerRate rad/s）
  staggerPitch: 0.45, staggerRoll: 0.55, staggerRate: 19,
};

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 大きく描く（enemyView の boost 倍）とき、主人公から水平 r m にいる者の中心をどれだけ主人公へ寄せるか（aPose.x）。
// 描かれる位置の主人公からの距離は r + (boost - 1) · anchor · r になる。anchor · r = min(r, clingRadius) · (anchorNear〜anchorFar で 1→0)
// なので、boost が maxBoost（3）までなら r が減るほど描かれる距離も減り続ける（近づく者が一瞬離れて見えない）。
// 主人公の横（clingRadius 以内）では 1（主人公を中心に大きく描き、主人公にめり込まない）
export function anchorFor(r) {
  if (!(r > BIKE.clingRadius)) return 1;
  return (BIKE.clingRadius * (1 - smooth(BIKE.anchorNear, BIKE.anchorFar, r))) / r;
}

// 見つけた瞬間（chase の spotT 秒）は、推進の光が一瞬強まる（1.8 倍から spotFlash 秒で 1 へ。止まらずに突っ込む）
const spotted = (e) => (e.state === 'chase' && e.spotT != null ? 1 + 0.8 * (1 - smooth(0, BIKE.spotFlash, e.spotT)) : 1);

const posOf = (e) => (e.x != null ? [e.x, e.z] : [Math.cos(e.angle) * e.dist, Math.sin(e.angle) * e.dist]);

// 探している・近づいている者（と倒れた瞬間の者）の置き方
function approachPose(e, fronts, time, cfg) {
  const E = cfg.enemy;
  const grab = E.grabRange;
  const h = hash(e.id);
  const [x, z] = posOf(e);
  const r = Math.hypot(x, z), ang = Math.atan2(z, x);
  const dist = e.dist ?? r;
  const turn = smooth(grab + BIKE.turnDist, grab, dist);   // 0: 進む向き → 1: 横を向く
  const settle = smooth(grab + BIKE.descendDist, grab, dist); // 0: 地面の上に浮く → 1: 主人公の近くの高さ
  const ground = groundHeight(r, fronts);
  const floor = BIKE.nearFloor - BIKE.floorSlope * Math.max(0, r - BIKE.nearDist);
  const hover = BIKE.hover[0] + (BIKE.hover[1] - BIKE.hover[0]) * h;
  const far = Math.max(ground, floor) + hover;
  const near = BIKE.nearY[0] + (BIKE.nearY[1] - BIKE.nearY[0]) * hash(e.id + 3);
  const bob = BIKE.bob * Math.sin(time * 2.1 + h * 37) * (1 - 0.6 * settle);
  const y = far + (near - far) * settle + bob;
  // 進む向き（heading は x 軸から z 軸へ。ないときは主人公の方）→ 最後に横（主人公が右手側）
  const go = e.heading != null ? Math.PI / 2 - e.heading : -ang - Math.PI / 2;
  const yaw = go + wrap(-ang - go) * turn;
  const w = e.lean ?? e.turn ?? 0;
  const bank = Math.max(-BIKE.bankMax, Math.min(BIKE.bankMax, BIKE.bank * w));
  const roll = 0.05 * Math.sin(time * 1.7 + h * 23) * (1 - settle) + bank * (1 - turn) - 0.32 * Math.sin(Math.PI * turn); // 曲がる・横を向くとき、内へ傾く
  // 速さ: 尾の長さと前傾
  const v = e.state === 'dead' ? 0 : Math.max(0, e.speed ?? 0);
  const trail = v / E.searchSpeed;
  const pitch = (0.06 + BIKE.speedPitch * Math.min(trail, 1.2)) * (1 - settle);
  return {
    x, y, z, yaw, pitch, roll,
    reach: smooth(grab + 2, grab, dist) * 0.5, anchor: anchorFor(r), thrust: (1 - 0.4 * turn) * spotted(e), keep: 1,
    trail, curve: v > 1e-6 ? (e.lean ?? e.turn ?? 0) / Math.max(v, 4) : 0,
  };
}

// 掴んでいる者・群がる者（grabTime: 掴んでからの秒。ないときは寄り終えたものとする）
function grabPose(e, fronts, time, cfg) {
  const E = cfg.enemy;
  const p = approachPose(e, fronts, time, cfg);
  const k = smooth(0, BIKE.grabSettle, e.grabTime ?? BIKE.grabSettle);
  const h = hash(e.id);
  const r0 = Math.max(1e-6, Math.hypot(p.x, p.z));
  // 描く半径: 判定の半径を grabRange − clingRadius だけ内へ（掴む者は主人公の横、群がる者はそのすぐ外）。寄り終えてからは小刻みに引っ張る
  const tugK = smooth(BIKE.grabSettle + 0.15, BIKE.grabSettle + 0.6, e.grabTime ?? 1);
  const rT = Math.max(0.8, BIKE.clingRadius + (BIKE.kindCling[e.kind] ?? 0) + ((e.dist ?? r0) - E.grabRange) + BIKE.tug * tugK * Math.sin(time * 9.3 + h * 17));
  const r = r0 * (1 - k) + rT * k;
  let y = p.y + (0.04 * Math.sin(time * 5.3 + h * 11) + BIKE.tugY * tugK * Math.sin(time * 7.7 + h * 29) - p.y) * k;
  // 群がる者（layer がある）は掴む者より高く、段ごとにずらす。枠が空いて掴んだ者（unpile）は下りる
  const pile = e.layer != null ? k * (e.unpile != null ? 1 - smooth(0, BIKE.unpileSec, e.unpile) : 1) : 0;
  if (pile > 0) y += (BIKE.pileUp + BIKE.pileStep * (e.layer % 3) + 0.05 * Math.sin(time * 6.1 + h * 13)) * pile;
  // 回る向き（e.turn > 0 で左回り）へ深く傾き、推進の光は強く明滅する
  const w = e.lean ?? e.turn ?? 0;
  const bank = Math.sign(w) * Math.min(BIKE.bankMax, BIKE.orbitBank + 0.08 * Math.sin(time * 11 + h * 7)) * Math.min(1, Math.abs(w));
  const v = Math.max(0, e.speed ?? 0);
  const clinging = e.state === 'cling' ? 1 : 0;
  return {
    ...p, x: (p.x / r0) * r, y, z: (p.z / r0) * r,
    roll: p.roll * (1 - k) + bank * k, pitch: p.pitch * (1 - k) + 0.1 * k - 0.15 * pile,
    reach: p.reach * (1 - k) + (clinging ? 0.6 : 1) * k,
    thrust: p.thrust * (1 - k) + (1.45 - 0.2 * clinging + 0.35 * Math.sin(time * 17 + h * 9)) * k,
    anchor: anchorFor(r),
    // 尾は回る道すじ（描く輪）に沿って曲がる。長さは速さ / 探す速さ（fix1: 0.5 倍では上空の画面で止まった光の円盤に見えたので 1 倍）
    trail: v / E.searchSpeed, curve: v > 1e-6 ? Math.sign(w) / Math.max(r, 0.8) : 0,
  };
}

export function bikePose(e, fronts = [], time = 0, cfg = CONFIG) {
  if (e.state === 'grab' || e.state === 'cling') return grabPose(e, fronts, time, cfg);
  if (e.state === 'dead') {
    const k = (e.deadTime ?? 0) / BIKE.deadFling;
    if (k >= 1) return null;
    // 掴んでいた者は主人公の横から、それ以外はいた場所から、爆心（主人公）の外へ
    const p = e.grabTime != null ? grabPose(e, fronts, time, cfg) : approachPose(e, fronts, time, cfg);
    const r0 = Math.max(1e-6, Math.hypot(p.x, p.z)), r = r0 + 26 * k;
    const spin = hash(e.id + 5) < 0.5 ? -1 : 1;
    return {
      ...p,
      x: (p.x / r0) * r, z: (p.z / r0) * r,
      y: p.y + 14 * k - 10 * k * k,
      pitch: p.pitch - 5 * k, roll: p.roll + spin * 7 * k,
      reach: 0, thrust: Math.max(0, 1 - 3 * k), keep: 1 - k * k, trail: 0, curve: 0,
      anchor: p.anchor * (1 - smooth(0, 0.5, k)), // 主人公を中心に大きく描くのをやめていく（遠くへ飛んだ者が大きく描かれすぎない）
    };
  }
  const p = approachPose(e, fronts, time, cfg);
  if (e.state === 'stagger') {
    // 払いに弾かれて後ろへよろめく: 鼻先が上がり、左右に大きく揺れ、推進の光がちらつく（だんだん収まる）
    const u = Math.min(1, (e.staggerT ?? 0) / (cfg.enemy.stagger?.sec ?? 0.5)), k = (1 - u) * (1 - u);
    p.pitch -= BIKE.staggerPitch * k;
    p.roll += BIKE.staggerRoll * k * Math.sin(time * BIKE.staggerRate + hash(e.id) * 9);
    p.thrust *= 1 - 0.6 * k * (0.5 + 0.5 * Math.sin(time * 47));
    p.reach = 0;
  }
  return p;
}
