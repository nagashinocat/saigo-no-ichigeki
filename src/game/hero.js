import { CONFIG } from '../config.js';
import { GRID } from '../world/cityGen.js';

// M1（持ち主 09:11、spec §16）: 動く主人公。通りと広場の上を浮いたまま動き、ビルの足元は通り抜けない（壁に沿って滑る）。
// 街の中心から cityRadius − edgePad m より外へは出ない。掴んでいる者の数だけ遅くなる（heroSpeedFactor）。
// 動くのは溜めている間だけ（update の active）。描く側と軍勢は hero（同じ物）を読む: x, z（m）、vx, vz（m/s）、
// heading（進む向き。x 軸から z 軸へ、rad）、lean（前への傾き 0〜leanMax rad）

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 掴んでいる者 n 人のときの速さの倍率: 1 人ごとに grabSlow（20%）遅く、minSpeedFrac（40%）より遅くはならない
export function heroSpeedFactor(n, cfg = CONFIG) {
  const H = cfg.hero;
  return Math.max(H.minSpeedFrac, 1 - H.grabSlow * Math.max(0, n));
}

// ビルの足元（主人公の半径だけ広げた四角）を、道路の格子の区画ごとに引ける表
function footprintGrid(buildings, pad) {
  const P = GRID.PITCH, cells = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const b of buildings) {
    const box = { x0: b.x - b.w / 2 - pad, x1: b.x + b.w / 2 + pad, z0: b.z - b.d / 2 - pad, z1: b.z + b.d / 2 + pad };
    for (let i = Math.floor(box.x0 / P); i <= Math.floor(box.x1 / P); i++) {
      for (let j = Math.floor(box.z0 / P); j <= Math.floor(box.z1 / P); j++) {
        const k = key(i, j);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(box);
      }
    }
  }
  return (x, z) => cells.get(key(Math.floor(x / P), Math.floor(z / P))) ?? [];
}

export function createHeroMotion(city, cfg = CONFIG) {
  const H = cfg.hero;
  const hero = { x: 0, z: 0, vx: 0, vz: 0, heading: -Math.PI / 2, lean: 0 };
  const boxesAt = footprintGrid(city.buildings, H.radius);
  const maxR = (city.radius ?? cfg.cityRadius) - H.edgePad;
  const move = { x: 0, z: 0 };

  // 一つの軸だけ動かして、足元に入ったら、入る前の側の縁へ戻す（その軸の速さは 0。もう一つの軸はそのまま: 壁に沿って滑る）
  function slide(axis, d) {
    if (d === 0) return;
    const from = hero[axis];
    hero[axis] = from + d;
    for (const b of boxesAt(hero.x, hero.z)) {
      if (hero.x <= b.x0 || hero.x >= b.x1 || hero.z <= b.z0 || hero.z >= b.z1) continue;
      const lo = axis === 'x' ? b.x0 : b.z0, hi = axis === 'x' ? b.x1 : b.z1;
      hero[axis] = d > 0 ? Math.min(hero[axis], lo) : Math.max(hero[axis], hi);
      if (axis === 'x') hero.vx = 0; else hero.vz = 0;
    }
  }

  return {
    hero,
    setMove(x, z) {
      const m = Math.hypot(x, z);
      const k = m > 1 ? 1 / m : 1;
      move.x = Number.isFinite(x) ? x * k : 0;
      move.z = Number.isFinite(z) ? z * k : 0;
    },
    // 止める（放った瞬間から、主人公は爆心にとどまる）
    stop() { hero.vx = 0; hero.vz = 0; hero.lean = 0; move.x = 0; move.z = 0; },
    update(dt, { active = true, grabbing = 0 } = {}) {
      if (!(dt > 0)) return;
      const v = H.speed * heroSpeedFactor(grabbing, cfg);
      const tx = active ? move.x * v : 0, tz = active ? move.z * v : 0;
      // なめらかな加速と減速（目標の速さへ指数で寄せる）
      const k = 1 - Math.exp(-H.accelRate * dt);
      hero.vx += (tx - hero.vx) * k;
      hero.vz += (tz - hero.vz) * k;
      if (Math.hypot(hero.vx, hero.vz) < 1e-3 && !tx && !tz) { hero.vx = 0; hero.vz = 0; }
      slide('x', hero.vx * dt);
      slide('z', hero.vz * dt);
      // 街の端: 外へは出ない（外へ向かう速さを消す）
      const r = Math.hypot(hero.x, hero.z);
      if (r > maxR) {
        const ux = hero.x / r, uz = hero.z / r;
        hero.x = ux * maxR; hero.z = uz * maxR;
        const out = hero.vx * ux + hero.vz * uz;
        if (out > 0) { hero.vx -= out * ux; hero.vz -= out * uz; }
      }
      // 体は進む向きへ向き直り、速さに応じて前へ傾く
      const sp = Math.hypot(hero.vx, hero.vz);
      if (sp > 0.5) {
        const d = wrap(Math.atan2(hero.vz, hero.vx) - hero.heading);
        hero.heading = wrap(hero.heading + Math.max(-H.turnRate * dt, Math.min(H.turnRate * dt, d)));
      }
      const leanT = H.leanMax * Math.min(1, sp / H.speed);
      hero.lean += (leanT - hero.lean) * (1 - Math.exp(-8 * dt));
    },
  };
}
