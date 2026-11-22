import { CONFIG } from '../config.js';
import { lineOfSight } from './enemies.js';

// R1f（持ち主 18:14「隠れる動作が…分かりづらいから派手でかっこいいアクションをつけて移動させよう」）: 物陰へ跳ぶ動き（描画も DOM も知らない）。
// 段: crouch（しゃがんで踏み切る）→ leap（跳ぶ。近くにビルの壁があれば、途中でその壁を蹴る kick）→ land（物陰で着地のしゃがみ）→ done。
// 物陰に着くのは hide.dashSec 秒（M2 のまま。隠れる時刻と物陰の選び方は前と同じ）。着地のしゃがみはそのあと hideAction.landSec 秒（見た目だけ）。
// 動きの道すじ（x, z）はゲームの主人公の位置そのもの（hero.js が使う）。高さ y と、しゃがむ強さ crouch は描く側が使う。
// 壁を蹴る点は、道すじの真ん中から hideAction.kickNear m の内のビルの面の、主人公の半径 + 0.2 m 外。そこを通る二つの線分が
// ビルにさえぎられない（M2 の物陰の通り道と同じ確かめ）ときだけ蹴る。無ければまっすぐ跳ぶ

const smooth = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => Math.min(1, Math.max(0, u));

// from, to: { x, z }。buildings: 街の建物（足元 { x, z, w, d }）
export function planHideMotion(from, to, buildings = [], cfg = CONFIG) {
  const A = cfg.hideAction, R = cfg.hero.radius, sec = cfg.hide.dashSec;
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  let kick = null;
  if (len >= A.kickMinLen) {
    const mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2;
    let best = null;
    for (const b of buildings) {
      if (Math.abs(mx - b.x) - b.w / 2 > A.kickNear + R || Math.abs(mz - b.z) - b.d / 2 > A.kickNear + R) continue;
      // その足元のいちばん近い面の外の点（面に沿う向きは真ん中のまま）
      const ex = Math.abs(mx - b.x) - b.w / 2, ez = Math.abs(mz - b.z) - b.d / 2;
      if (ex < 0 && ez < 0) continue;
      let kx = mx, kz = mz, d;
      if (ex >= ez) { kx = b.x + Math.sign(mx - b.x) * (b.w / 2 + R + 0.2); d = ex; } else { kz = b.z + Math.sign(mz - b.z) * (b.d / 2 + R + 0.2); d = ez; }
      if (d > A.kickNear) continue;
      if (!best || d < best.d) best = { x: kx, z: kz, d };
    }
    if (best) {
      const k = { x: best.x, z: best.z };
      const inside = buildings.some((b) => Math.abs(k.x - b.x) < b.w / 2 + R - 1e-6 && Math.abs(k.z - b.z) < b.d / 2 + R - 1e-6);
      const off = Math.hypot(k.x - (from.x + to.x) / 2, k.z - (from.z + to.z) / 2);
      if (!inside && off > 0.3 && lineOfSight(from.x, from.z, buildings, R * 0.8, k.x, k.z) && lineOfSight(k.x, k.z, buildings, R * 0.8, to.x, to.z)) kick = k;
    }
  }
  const pts = kick ? [from, kick, to] : [from, to];
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); segs.push({ a: pts[i - 1], b: pts[i], l, s0: total }); total += l; }
  const crouchSec = Math.min(A.crouchSec, sec * 0.4);
  return { from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, kick, segs, length: total, sec, crouchSec, landSec: A.landSec, total: sec + A.landSec, leapH: A.leapH, crouchCreep: A.crouchCreep };
}

// 道すじの s（0〜1、長さの割合）の点と、その点がどの区間か
function along(plan, s) {
  const L = plan.length * clamp01(s);
  for (let i = 0; i < plan.segs.length; i++) {
    const g = plan.segs[i];
    if (L <= g.s0 + g.l + 1e-9 || i === plan.segs.length - 1) {
      const u = g.l > 1e-9 ? clamp01((L - g.s0) / g.l) : 1;
      return { x: g.a.x + (g.b.x - g.a.x) * u, z: g.a.z + (g.b.z - g.a.z) * u, seg: i, u };
    }
  }
  return { x: plan.to.x, z: plan.to.z, seg: 0, u: 1 };
}

// t 秒（跳び始めから）の様子: { phase, x, z, y（高さ m）, crouch（0〜1）, s（道すじの割合）}
export function hideMotionAt(plan, t) {
  const { sec, crouchSec } = plan;
  if (t >= plan.total) return { phase: 'done', x: plan.to.x, z: plan.to.z, y: 0, crouch: 0, s: 1 };
  if (t >= sec) {
    const u = (t - sec) / plan.landSec;
    // 着地の瞬間に深くしゃがみ、すっと立つ（物陰でしゃがみ続けるのは dashStreak の隠れている間のしゃがみ）
    return { phase: 'land', x: plan.to.x, z: plan.to.z, y: 0, crouch: 1 - 0.5 * smooth(u), s: 1, u };
  }
  if (t < crouchSec) {
    const u = t / crouchSec;
    const s = plan.crouchCreep * u * u;
    const p = along(plan, s);
    return { phase: 'crouch', x: p.x, z: p.z, y: 0, crouch: Math.sin(u * Math.PI * 0.5), s, u };
  }
  // 跳ぶ: crouchCreep から 1 まで、はじめ速く終わりで少しゆるむ（踏み切りの勢い）
  const v = (t - crouchSec) / (sec - crouchSec);
  const s = plan.crouchCreep + (1 - plan.crouchCreep) * (1 - (1 - v) ** 2);
  const p = along(plan, s);
  // 高さ: まっすぐなら一つの弧。壁を蹴るなら、壁の上の高い所（leapH × 0.9）へ駆け上がり、蹴ってひと弧で物陰へ降りる
  const h = plan.leapH * Math.min(1, plan.length / 4);
  let y;
  if (!plan.kick) y = h * Math.sin(Math.PI * p.u);
  else if (p.seg === 0) y = 0.9 * h * Math.sin(0.5 * Math.PI * p.u);
  else y = 0.9 * h * (1 - p.u) + 0.45 * h * Math.sin(Math.PI * p.u);
  let phase = 'leap';
  if (plan.kick) {
    const sk = plan.segs[0].l / plan.length;
    if (Math.abs(s - sk) < 0.08) phase = 'kick';
  }
  return { phase, x: p.x, z: p.z, y, crouch: 0.15 * (1 - v), s, u: v };
}
