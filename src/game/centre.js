import { segDist } from '../world/transit.js';

// M1（spec §16）: 爆心は放った瞬間の主人公の位置。これまで「爆心は原点（広場）」だった所は、どれも爆心 { x, z } を受ける。
// 原点（または省いた）ときは、前からの値（街を作ったときに測った dist）をそのまま使う（前と同じ数になる）

export const ORIGIN = Object.freeze({ x: 0, z: 0 });
export const isOrigin = (c) => !c || (c.x === 0 && c.z === 0);

// 対象（ビル・props は中心 x, z。高架の区間は線分 a → b の一番近い点）の、爆心 c からの水平の距離
export function distFrom(t, c) {
  if (isOrigin(c)) return t.dist;
  if (t.a && t.b) return segDist(c.x, c.z, t.a, t.b);
  return Math.hypot(t.x - c.x, t.z - c.z);
}

// R2: 軍勢の一人（e）の、爆心 c からの水平の距離。最後の一発・払うの前線が「倒したか」を決める距離と同じ（enemies.applyBlastFront）。
// 位置（x, z）があれば爆心から、まだ無い者（試しの角度と距離だけの者）は主人公からの dist
export const riderDist = (e, c) => (c && e.x != null ? Math.hypot(e.x - c.x, e.z - c.z) : e.dist);
