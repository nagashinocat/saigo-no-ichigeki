import { CONFIG } from '../config.js';
import { groundHeight } from './sphereDeform.js';

// 浮遊バイクに乗った軍勢の一人の置き方（見た目だけ。判定は enemies.js の水平の距離 e.dist のまま）。
// - 近づく: 主人公の方を向き、地面（穴の上なら穴の面）から hover m 浮いて、わずかに揺れる。
//   最後の数 m で横を向き、主人公のまわりの輪（clingRadius + queueGap）で、浮いている主人公の近くの高さへ上がる/下がる。
// - 掴む: grabSettle 秒で輪から主人公の横（水平 clingRadius）へ寄り、y≈0 で止まる。車体は主人公の向きと直角。
//   乗り手の右手側に主人公がいて手を伸ばす。
// - 倒れる: バイクごと外へ吹き飛び、回りながら上がって落ち、deadFling 秒で消える。
// 返す値: x, y, z（バイクの底の中心）、yaw（y 軸まわり。0 で +z を向く）、pitch、roll、
//   reach（手を伸ばす 0〜1）、anchor（大きく描くときの中心を主人公へ寄せる 0〜1）、thrust（推進の光 0〜1）、keep（大きさ。消えるとき 0 へ）
export const BIKE = {
  hover: [2, 4],      // m。地面からの浮く高さ（人ごとにばらつく）
  bob: 0.18,          // m。上下の揺れ
  clingRadius: 1.35,  // m。掴むとき、主人公からバイクの中心線までの水平の距離
  queueGap: 2.4,      // m。掴む距離まで来た者は、まず clingRadius のこの外側の輪で横を向いて止まる（掴む枠が空くのを待つ）
  queueY: [0.3, 1.7], // m。その輪での高さ（人ごとにばらつき、待つ者が重なりにくい）
  grabSettle: 0.45,   // s。掴んだら、この秒で輪から主人公の横へ寄る
  turnDist: 6,        // m。掴む距離のこの手前から横を向き、主人公の横へ寄る
  descendDist: 12,    // m。掴む距離のこの手前から、主人公の高さへ寄せる
  nearFloor: -1,      // m。主人公の近く（nearDist 以内）では、深い穴の上でもこれより下がらない
  nearDist: 8,
  // nearDist より外では、下限が 1m あたりこれだけ下がる（8m 先で最大の穴の深さより下になり、穴の面に沿う）。
  // 穴は最後の一発でしかできず、その内側の者は倒れるので、深い穴の壁を駆け上がる場面はふつう起きない
  floorSlope: 60,
  deadFling: 1.1,     // s
};

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 近づいている者（と倒れた瞬間の者）の置き方。dist は判定の水平の距離
function approachPose(e, dist, fronts, time, cfg) {
  const grab = cfg.enemy.grabRange;
  const h = hash(e.id);
  const turn = smooth(grab + BIKE.turnDist, grab, dist);   // 0: 主人公を向く → 1: 横を向く
  const settle = smooth(grab + BIKE.descendDist, grab, dist); // 0: 地面の上に浮く → 1: 主人公のまわりの輪の高さ
  // 判定の距離から、見た目の半径へ（最後の turnDist m で、掴む距離 → 待つ輪の半径へ寄せる）
  const r = dist - (grab - BIKE.clingRadius - BIKE.queueGap) * turn;
  const ground = groundHeight(r, fronts);
  const floor = BIKE.nearFloor - BIKE.floorSlope * Math.max(0, r - BIKE.nearDist);
  const hover = BIKE.hover[0] + (BIKE.hover[1] - BIKE.hover[0]) * h;
  const far = Math.max(ground, floor) + hover;
  const queue = BIKE.queueY[0] + (BIKE.queueY[1] - BIKE.queueY[0]) * hash(e.id + 3);
  const bob = BIKE.bob * Math.sin(time * 2.1 + h * 37) * (1 - 0.6 * settle);
  const y = far + (queue - far) * settle + bob;
  const yaw = -e.angle - Math.PI / 2 + (Math.PI / 2) * turn;
  const roll = 0.05 * Math.sin(time * 1.7 + h * 23) * (1 - settle) - 0.32 * Math.sin(Math.PI * turn); // 横を向くとき、内へ傾く
  return {
    x: Math.cos(e.angle) * r, y, z: Math.sin(e.angle) * r,
    yaw, pitch: 0.06 * (1 - settle), roll,
    reach: smooth(grab + 2, grab, dist) * 0.5, anchor: turn, thrust: 1 - 0.4 * turn, keep: 1,
  };
}

// 掴んでいる者（grabTime: 掴んでからの秒。ないときは寄り終えたものとする）
function grabPose(e, fronts, time, cfg) {
  const p = approachPose(e, cfg.enemy.grabRange, fronts, time, cfg);
  const k = smooth(0, BIKE.grabSettle, e.grabTime ?? BIKE.grabSettle);
  const h = hash(e.id);
  const r = Math.hypot(p.x, p.z) + (BIKE.clingRadius - Math.hypot(p.x, p.z)) * k;
  const y = p.y + (0.04 * Math.sin(time * 5.3 + h * 11) - p.y) * k;
  return {
    ...p, x: Math.cos(e.angle) * r, y, z: Math.sin(e.angle) * r,
    roll: p.roll * (1 - k), pitch: 0, reach: p.reach + (1 - p.reach) * k, thrust: p.thrust - 0.05 * k,
  };
}

export function bikePose(e, fronts = [], time = 0, cfg = CONFIG) {
  if (e.state === 'grab') return grabPose(e, fronts, time, cfg);
  if (e.state === 'dead') {
    const k = (e.deadTime ?? 0) / BIKE.deadFling;
    if (k >= 1) return null;
    // 掴んでいた者は主人公の横から、それ以外はいた場所から
    const p = e.grabTime != null ? grabPose(e, fronts, time, cfg) : approachPose(e, e.dist, fronts, time, cfg);
    const r0 = Math.hypot(p.x, p.z), r = r0 + 26 * k;
    const spin = hash(e.id + 5) < 0.5 ? -1 : 1;
    return {
      ...p,
      x: Math.cos(e.angle) * r, z: Math.sin(e.angle) * r,
      y: p.y + 14 * k - 10 * k * k,
      pitch: p.pitch - 5 * k, roll: p.roll + spin * 7 * k,
      reach: 0, thrust: Math.max(0, 1 - 3 * k), keep: 1 - k * k,
      anchor: p.anchor * (1 - smooth(0, 0.5, k)), // 主人公を中心に大きく描くのをやめていく（遠くへ飛んだ者が大きく描かれすぎない）
    };
  }
  return approachPose(e, e.dist, fronts, time, cfg);
}
