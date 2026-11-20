import { createRng } from '../rng.js';
import { fractureBox } from './fracture.js';
import { createDebrisPool, pushVelocity, crushVelocity } from './debris.js';
import { createNearPhysics } from './nearPhysics.js';
import { crushPoint } from '../render/sphereDeform.js';

const NEAR_RANGE = 60; // 焦点からこの距離以内の破片だけ物理で動かす
const PROP_CHUNKS = [2, 4];
const CRUSH_DELAY = [0.3, 0.6]; // s。球の表面が通ってから、つぶれた形のまま見せる時間
const CHIP_RATIO = 0.75;        // 割った破片の数に対する、足す小さい破片の割合
const CHIP_SIZE = [0.4, 1.6];   // m
const CRUSH_DUST = [3, 5];      // つぶれた瞬間に根元から上がる土煙の数

// 壊れたものを破片に変える。getTier は「今使っている画質」の設定（TIERS[tier]）を返す。
export function createDestruction({ cityView, getTier, seed = 1 }) {
  const rng = createRng(seed ^ 0xdeb15);
  const initial = getTier();
  const pool = createDebrisPool(initial.debrisMax, rng);
  const near = createNearPhysics(initial.nearPhysicsMax, rng);
  let focus = null;
  let time = 0;
  let hole = 0; // えぐれた地面の半径（今の球を含む）。手前の物理の地面は平らなので、この内側の破片はプールへ
  const crushing = []; // { id, target, color, at }

  const isNear = (c) => focus && Math.hypot(c[0] - focus[0], c[1] - focus[1], c[2] - focus[2]) <= NEAR_RANGE;

  function emit(center, dims, vel, color) {
    const half = dims.map((v) => v / 2);
    if (isNear(center) && Math.hypot(center[0], center[2]) >= hole) {
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
        // すぐには壊さない: 球の線に沿ってつぶれた形を少し見せてから破片にする（見た目のつぶれは cityView のシェーダー）
        const delay = CRUSH_DELAY[0] + (CRUSH_DELAY[1] - CRUSH_DELAY[0]) * rng();
        const color = cityView.getBuildingColor(id) ?? [0.75, 0.75, 0.75];
        cityView.crushBuilding(id, delay);
        crushing.push({ id, target, color, at: time + delay });
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
    // 進める。fronts は今の球の半径の一覧（cityView のシェーダーと同じもの）。粉に変わった地点（DustEvent）を返す
    update(dt, fronts = []) {
      time += dt;
      hole = fronts.length ? Math.max(...fronts) : 0;
      const dust = pool.update(dt);
      for (let i = crushing.length - 1; i >= 0; i--) {
        if (crushing[i].at > time + 1e-9) continue;
        const c = crushing[i];
        crushing.splice(i, 1);
        fractureCrushed(c, fronts, dust);
      }
      if (near.bodies.length) dust.push(...near.step(dt));
      return dust;
    },
  };

  // つぶれきったビルを隠し、つぶれた形（crushPoint の k=1）の上から破片と土煙を出す
  function fractureCrushed({ id, target, color }, fronts, dust) {
    const tier = getTier();
    cityView.hideBuilding(id);
    const at = (lx, ly, lz) => crushPoint([target.x + lx, ly, target.z + lz], fronts, 1);
    const chunks = fractureBox(target, tier.piecesPerBuilding, id * 7919 + 13);
    for (const ch of chunks) {
      const dims = [ch.max[0] - ch.min[0], ch.max[1] - ch.min[1], ch.max[2] - ch.min[2]];
      // つぶれた分だけ縦を縮めた箱にする
      const cx = (ch.min[0] + ch.max[0]) / 2, cz = (ch.min[2] + ch.max[2]) / 2;
      const top = at(cx, ch.max[1], cz), bottom = at(cx, ch.min[1], cz);
      const center = at(cx, (ch.min[1] + ch.max[1]) / 2, cz);
      dims[1] = Math.max(0.5, Math.min(dims[1], Math.hypot(top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2])));
      const k = shade();
      emit(center, dims, crushVelocity(center, rng), [color[0] * k, color[1] * k, color[2] * k]);
    }
    // 小さい破片（壁のかけら）を表面のあちこちから
    const chips = Math.round(tier.piecesPerBuilding * CHIP_RATIO);
    for (let i = 0; i < chips; i++) {
      const s = CHIP_SIZE[0] + (CHIP_SIZE[1] - CHIP_SIZE[0]) * rng();
      const p = at((rng() - 0.5) * target.w, rng() * target.h, (rng() - 0.5) * target.d);
      const k = shade() * 0.9;
      pool.spawn({ pos: p, vel: crushVelocity(p, rng), size: s, dims: [s, s * (0.5 + 0.7 * rng()), s * (0.6 + 0.6 * rng())], color: [color[0] * k, color[1] * k, color[2] * k] });
    }
    // 根元から土煙
    const n = CRUSH_DUST[0] + Math.floor(rng() * (CRUSH_DUST[1] - CRUSH_DUST[0] + 1));
    const size = Math.max(target.w, target.d) * 0.5 + target.h * 0.08;
    for (let i = 0; i < n; i++) {
      const p = at((rng() - 0.5) * target.w, rng() * target.h * 0.4, (rng() - 0.5) * target.d);
      dust.push({ pos: p, size });
    }
  }
}
