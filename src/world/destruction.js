import { createRng } from '../rng.js';
import { fractureBox } from './fracture.js';
import { createDebrisPool, pushVelocity } from './debris.js';
import { createNearPhysics } from './nearPhysics.js';

const NEAR_RANGE = 60; // 焦点からこの距離以内の破片だけ物理で動かす
const PROP_CHUNKS = [2, 4];

// 壊れたものを破片に変える。getTier は「今使っている画質」の設定（TIERS[tier]）を返す。
export function createDestruction({ cityView, getTier, seed = 1 }) {
  const rng = createRng(seed ^ 0xdeb15);
  const initial = getTier();
  const pool = createDebrisPool(initial.debrisMax, rng);
  const near = createNearPhysics(initial.nearPhysicsMax, rng);
  let focus = null;

  const isNear = (c) => focus && Math.hypot(c[0] - focus[0], c[1] - focus[1], c[2] - focus[2]) <= NEAR_RANGE;

  function emit(center, dims, vel, color) {
    const half = dims.map((v) => v / 2);
    if (isNear(center)) {
      const box = { min: center.map((v, i) => v - half[i]), max: center.map((v, i) => v + half[i]), color };
      if (near.add(box, vel)) return;
    }
    pool.spawn({ pos: center, vel, size: Math.max(...dims), dims, color });
  }

  const shade = () => 0.8 + 0.3 * rng();

  return {
    pool, near,
    setPhysicsFocus(pos) { focus = pos ? [pos[0], pos[1], pos[2]] : null; },
    // game の 'hit' を受ける
    onHit({ hit, target }) {
      const tier = getTier();
      pool.setLimit(tier.debrisMax);
      near.setBudget(tier.nearPhysicsMax);
      const id = Number(hit.id.slice(1));
      const isBuilding = hit.id[0] === 'b';
      if (hit.kind === 'vaporize') { // 溶ける演出は Task 9
        if (isBuilding) cityView.hideBuilding(id); else cityView.hideProp(id);
        return;
      }
      if (isBuilding) {
        const base = cityView.getBuildingColor(id) ?? [0.75, 0.75, 0.75];
        cityView.hideBuilding(id);
        const chunks = fractureBox(target, tier.piecesPerBuilding, id * 7919 + 13);
        for (const ch of chunks) {
          const dims = [ch.max[0] - ch.min[0], ch.max[1] - ch.min[1], ch.max[2] - ch.min[2]];
          const center = [target.x + (ch.min[0] + ch.max[0]) / 2, (ch.min[1] + ch.max[1]) / 2, target.z + (ch.min[2] + ch.max[2]) / 2];
          const k = shade();
          emit(center, dims, pushVelocity(center, target.dist, rng), [base[0] * k, base[1] * k, base[2] * k]);
        }
      } else {
        const vis = cityView.getPropVisual(id);
        cityView.hideProp(id);
        const x = vis?.x ?? target.x, z = vis?.z ?? target.z;
        const color = vis?.color ?? [0.5, 0.5, 0.5];
        const n = PROP_CHUNKS[0] + Math.floor(rng() * (PROP_CHUNKS[1] - PROP_CHUNKS[0] + 1));
        for (let i = 0; i < n; i++) {
          const s = 0.4 + 0.8 * rng();
          const center = [x + (rng() - 0.5) * 2, 0.5 + rng() * 2, z + (rng() - 0.5) * 2];
          emit(center, [s, s * (0.6 + 0.6 * rng()), s], pushVelocity(center, target.dist, rng), color);
        }
      }
    },
    // 粉に変わった地点（Task 10 の土煙が使う）を返す
    update(dt) {
      const dust = pool.update(dt);
      if (near.bodies.length) dust.push(...near.step(dt));
      return dust;
    },
  };
}
