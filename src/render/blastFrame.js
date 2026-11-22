import { isOrigin } from '../game/centre.js';

// M1（spec §16）: 最後の一発の演出・リプレイ・時間切れの結末の撮る場所を決める式（finalePlan・replayPlan・blackholePlan）は、
// 爆心を原点として解く。世界の物（ビル・軍勢・飾り・高架の箱）を爆心 c からの位置へ写して渡し、決まったカメラの位置を世界へ戻す。
// c が原点なら写さずにそのまま返す（前と同じ物・同じ数）

// { x, z, dist?, angle? } の一覧を、爆心 c を原点とした位置へ（写し。元は変えない）
export function toLocal(list, c) {
  if (isOrigin(c) || !list) return list;
  return list.map((o) => {
    if (o.x == null) return o;
    const x = o.x - c.x, z = o.z - c.z;
    const out = { ...o, x, z };
    if ('dist' in o) out.dist = Math.hypot(x, z);
    if ('angle' in o) out.angle = Math.atan2(z, x);
    return out;
  });
}

// 爆心を原点とした点 [x, y, z] を世界へ（新しい配列）
export const toWorld = (p, c) => (isOrigin(c) ? p : [p[0] + c.x, p[1], p[2] + c.z]);
