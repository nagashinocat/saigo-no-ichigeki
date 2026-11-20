import { CONFIG } from '../config.js';
import { groundHeight } from './sphereDeform.js';

// 浮遊バイクに乗った軍勢の一人の置き方（見た目だけ。判定は enemies.js の水平の距離 e.dist のまま）。
// 位置は e.x, e.z（ないときは e.angle, e.dist から）。
// - 探す・近づく: 進む向き（e.heading）を向き、曲がるとき（e.turn rad/s）は内へ傾く。地面（穴の上なら穴の面）から hover m 浮いて、わずかに揺れる。
//   最後の数 m で横を向き、浮いている主人公の近くの高さへ上がる/下がる。掴む枠が埋まっていれば、主人公のまわりの輪（queueDist）で待つ。
// - 掴む: grabSettle 秒で、いた所から主人公の横（水平 clingRadius）へ寄り、y≈0 で止まる。車体は主人公の向きと直角。
//   乗り手の右手側に主人公がいて手を伸ばす。
// - 倒れる: バイクごと外へ吹き飛び、回りながら上がって落ち、deadFling 秒で消える。
// 返す値: x, y, z（バイクの底の中心）、yaw（y 軸まわり。0 で +z を向く）、pitch、roll、
//   reach（手を伸ばす 0〜1）、anchor（大きく描くときの中心を主人公へ寄せる 0〜1。anchorFor）、thrust（推進の光 0〜1）、keep（大きさ。消えるとき 0 へ）
export const BIKE = {
  hover: [2, 4],      // m。地面からの浮く高さ（人ごとにばらつく）
  bob: 0.18,          // m。上下の揺れ
  clingRadius: 1.35,  // m。掴むとき、主人公からバイクの中心線までの水平の距離
  queueY: [0.3, 1.7], // m。主人公のすぐ近くで待つ者の高さ（人ごとにばらつき、待つ者が重なりにくい）
  grabSettle: 0.45,   // s。掴んだら、この秒で主人公の横へ寄る
  turnDist: 6,        // m。掴む距離のこの手前から横を向く
  descendDist: 12,    // m。掴む距離のこの手前から、主人公の高さへ寄せる
  nearFloor: -1,      // m。主人公の近く（nearDist 以内）では、深い穴の上でもこれより下がらない
  nearDist: 8,
  // nearDist より外では、下限が 1m あたりこれだけ下がる（8m 先で最大の穴の深さより下になり、穴の面に沿う）。
  // 穴は最後の一発でしかできず、その内側の者は倒れるので、深い穴の壁を駆け上がる場面はふつう起きない
  floorSlope: 60,
  bank: 0.05, bankMax: 0.45, // 曲がる速さ（rad/s）あたりの傾き（rad）と、その上限
  // 大きく描くときの中心を主人公へ寄せる範囲（anchorFor）: anchorNear m より内では主人公を中心にし、anchorFar m で自分の足元へ戻す
  anchorNear: 4, anchorFar: 12,
  deadFling: 1.1,     // s
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

const posOf = (e) => (e.x != null ? [e.x, e.z] : [Math.cos(e.angle) * e.dist, Math.sin(e.angle) * e.dist]);

// 探している・近づいている者（と倒れた瞬間の者）の置き方
function approachPose(e, fronts, time, cfg) {
  const grab = cfg.enemy.grabRange;
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
  const queue = BIKE.queueY[0] + (BIKE.queueY[1] - BIKE.queueY[0]) * hash(e.id + 3);
  const bob = BIKE.bob * Math.sin(time * 2.1 + h * 37) * (1 - 0.6 * settle);
  const y = far + (queue - far) * settle + bob;
  // 進む向き（heading は x 軸から z 軸へ。ないときは主人公の方）→ 最後に横（主人公が右手側）
  const go = e.heading != null ? Math.PI / 2 - e.heading : -ang - Math.PI / 2;
  const yaw = go + wrap(-ang - go) * turn;
  const bank = Math.max(-BIKE.bankMax, Math.min(BIKE.bankMax, BIKE.bank * (e.turn ?? 0)));
  const roll = 0.05 * Math.sin(time * 1.7 + h * 23) * (1 - settle) + bank * (1 - turn) - 0.32 * Math.sin(Math.PI * turn); // 曲がる・横を向くとき、内へ傾く
  return {
    x, y, z, yaw, pitch: 0.06 * (1 - settle), roll,
    reach: smooth(grab + 2, grab, dist) * 0.5, anchor: anchorFor(r), thrust: 1 - 0.4 * turn, keep: 1,
  };
}

// 掴んでいる者（grabTime: 掴んでからの秒。ないときは寄り終えたものとする）
function grabPose(e, fronts, time, cfg) {
  const p = approachPose(e, fronts, time, cfg);
  const k = smooth(0, BIKE.grabSettle, e.grabTime ?? BIKE.grabSettle);
  const h = hash(e.id);
  const r0 = Math.hypot(p.x, p.z);
  const r = r0 + (BIKE.clingRadius - r0) * k;
  const y = p.y + (0.04 * Math.sin(time * 5.3 + h * 11) - p.y) * k;
  return {
    ...p, x: (p.x / r0) * r, y, z: (p.z / r0) * r,
    roll: p.roll * (1 - k), pitch: 0, reach: p.reach + (1 - p.reach) * k, thrust: p.thrust - 0.05 * k, anchor: anchorFor(r),
  };
}

export function bikePose(e, fronts = [], time = 0, cfg = CONFIG) {
  if (e.state === 'grab') return grabPose(e, fronts, time, cfg);
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
      reach: 0, thrust: Math.max(0, 1 - 3 * k), keep: 1 - k * k,
      anchor: p.anchor * (1 - smooth(0, 0.5, k)), // 主人公を中心に大きく描くのをやめていく（遠くへ飛んだ者が大きく描かれすぎない）
    };
  }
  return approachPose(e, fronts, time, cfg);
}
