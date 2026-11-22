import { createRng } from '../rng.js';
import { fractureBox } from './fracture.js';
import { createDebrisPool, pushVelocity, crushVelocity, slumpVelocity } from './debris.js';
import { createNearPhysics } from './nearPhysics.js';
import { createRubble } from './rubble.js';
import { crushPoint } from '../render/sphereDeform.js';
import { TIERS } from '../render/quality.js';

const TIER_RUBBLE_MAX = Object.fromEntries(Object.entries(TIERS).map(([k, t]) => [k, t.rubbleMax]));

const NEAR_RANGE = 60; // 焦点からこの距離以内の破片だけ物理で動かす
const PROP_CHUNKS = [2, 4];
const CRUSH_DELAY = [0.3, 0.6]; // s。球の表面が通ってから、つぶれた形のまま見せる時間
const CHIP_RATIO = 0.75;        // 割った破片の数に対する、足す小さい破片の割合
const CHIP_SIZE = [0.4, 1.6];   // m
const CRUSH_DUST = [3, 5];      // つぶれた瞬間に根元から上がる土煙の数
const BIG_MAX = 28;             // m。建物ごとに残す大きな塊（建物の幅の半分ほど・階の厚みの板）の一辺の上限
const SLUMP_FRAC = 0.55;        // 穴があるとき、押しつぶされたビルの破片のうち穴の中へ崩れ落ちる割合
// 瓦礫は土ぼこりをかぶって白っぽくなる（焼けた暗い岩肌の上で見えるように）
const RUBBLE_TINT = 0.55, RUBBLE_DUST = [0.30, 0.27, 0.24];
const bigChunks = (tier) => Math.max(1, Math.round(tier.piecesPerBuilding / 8)); // high 3 / mid 2 / low 1

// 壊れたものを破片に変える。getTier は「今使っている画質」の設定（TIERS[tier]）を返す。
// 穴の中で止まった破片と建物の大きな塊は瓦礫（rubble）として残す。瓦礫は止まったまま動かさない。
export function createDestruction({ cityView, getTier, seed = 1 }) {
  const rng = createRng(seed ^ 0xdeb15);
  const initial = getTier();
  const pool = createDebrisPool(initial.debrisMax, rng);
  const near = createNearPhysics(initial.nearPhysicsMax, rng);
  const rubble = createRubble(Math.max(...Object.values(TIER_RUBBLE_MAX), initial.rubbleMax));
  rubble.setLimit(initial.rubbleMax);
  let pendingDust = [];
  let rubbleLimit = initial.rubbleMax; // 上限を下げたときに消えた瓦礫（次の update で返す）
  const settled = [];
  const lastSettled = []; // 直前の update で瓦礫として止まった破片（落ちて止まる音。持ち主 23:01）
  let focus = null;
  let time = 0;
  let hole = 0; // えぐれた地面の半径（今の球を含む）。手前の物理の地面は平らなので、この内側の破片はプールへ
  // M1（spec §16）: 爆心 [x, z]（放った瞬間の主人公の位置。setCentre）。穴・球のつぶれ・破片の外向きはここから
  let bc = [0, 0];
  const fromC = (p) => Math.hypot(p[0] - bc[0], p[2] - bc[1]);
  const crushing = []; // { id, target, color, at }

  const isNear = (c) => focus && Math.hypot(c[0] - focus[0], c[1] - focus[1], c[2] - focus[2]) <= NEAR_RANGE;

  function emit(center, dims, vel, color) {
    const half = dims.map((v) => v / 2);
    if (isNear(center) && fromC(center) >= hole) {
      const box = { min: center.map((v, i) => v - half[i]), max: center.map((v, i) => v + half[i]), color };
      if (near.add(box, vel)) return;
    }
    pool.spawn({ pos: center, vel, size: Math.max(...dims), dims, color });
  }

  const shade = () => 0.8 + 0.3 * rng();
  // 押しつぶされたビルの破片の初速: 縁のすぐ外まで穴があれば、半分ほどは穴の中へ崩れ落ちる（底や斜面の瓦礫になる）
  const crushOrSlump = (p, frac = SLUMP_FRAC) => {
    const c = pool.crater;
    return c > 0 && fromC(p) <= c * 1.05 + 2 && rng() < frac ? slumpVelocity(p, rng, bc) : crushVelocity(p, rng, bc);
  };

  return {
    pool, near, rubble,
    // 直前の update で落ちて止まり、瓦礫になった破片（{ pos, dims, size, … }。次の update で入れ替わる）
    get lastSettled() { return lastSettled; },
    // 最後の一発の直前（まだ何も壊れていない）へ戻す: 破片・手前の物理・瓦礫・つぶれ待ちを消し、乱数を巻き戻す。
    // 戻したあと同じ命中と同じ進め方を与えると、同じ破片と瓦礫になる（リプレイ）
    reset() {
      rng.reseed();
      pool.clear(); near.clear(); rubble.clear();
      crushing.length = 0; settled.length = 0; lastSettled.length = 0; pendingDust = [];
      hole = 0; time = 0;
    },
    setPhysicsFocus(pos) { focus = pos ? [pos[0], pos[1], pos[2]] : null; },
    // M1: 爆心 { x, z }（省けば原点）。リプレイでも同じ爆心のまま（reset で戻さない）
    setCentre(c) {
      bc = [c?.x ?? 0, c?.z ?? 0];
      pool.setCentre(bc); rubble.setCentre(bc);
    },
    get centre() { return { x: bc[0], z: bc[1] }; },
    // S8: 高架で起きたこと（transitView の events）。脱線した車両が落ちた（land）ら破片と土煙。次の update で粉を返す
    onTransit(events) {
      for (const e of events) if (e.kind === 'land') trainDebris(e.target, pendingDust);
    },
    // game の 'hit' を受ける
    onHit({ hit, target }) {
      const tier = getTier();
      pool.setLimit(tier.debrisMax);
      near.setBudget(tier.nearPhysicsMax);
      if (tier.rubbleMax !== rubbleLimit) { rubbleLimit = tier.rubbleMax; pendingDust.push(...rubble.setLimit(rubbleLimit)); }
      const id = Number(hit.id.slice(1));
      const isBuilding = hit.id[0] === 'b';
      // S8: 高架の橋桁の一区間（'x' 高速 / 'r' 線路）。ビルと同じく、少しつぶれた形を見せてから破片になる
      const isTransit = hit.id[0] === 'x' || hit.id[0] === 'r';
      if (hit.kind === 'vaporize') { // 溶ける演出は Task 9
        if (isTransit) cityView.hideTransit?.(hit.id);
        else if (isBuilding) cityView.hideBuilding(id); else cityView.hideProp(id);
        return;
      }
      if (isTransit) {
        const delay = CRUSH_DELAY[0] + (CRUSH_DELAY[1] - CRUSH_DELAY[0]) * rng();
        cityView.crushTransit?.(hit.id, delay);
        crushing.push({ id: hit.id, target, color: [0.42, 0.42, 0.44], at: time + delay, transit: true });
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
          emit(center, [s, s * (0.6 + 0.6 * rng()), s], pushVelocity(center, Math.hypot(target.x - bc[0], target.z - bc[1]), rng, bc), color);
        }
      }
    },
    // 進める。fronts は今の球の半径の一覧（cityView のシェーダーと同じもの）。粉に変わった地点（DustEvent）を返す
    update(dt, fronts = []) {
      time += dt;
      hole = fronts.length ? Math.max(...fronts) : 0;
      const dust = pool.update(dt, settled);
      if (pendingDust.length) { dust.push(...pendingDust); pendingDust = []; }
      // 穴が広がって下の地面がなくなった瓦礫は消える。止まった破片を瓦礫として置く
      dust.push(...rubble.sweep(pool.crater));
      lastSettled.length = 0;
      for (const p of settled) {
        p.color = p.color.map((v, i) => v * RUBBLE_TINT + RUBBLE_DUST[i]);
        rubble.add(p, dust);
        lastSettled.push(p);
      }
      settled.length = 0;
      for (let i = crushing.length - 1; i >= 0; i--) {
        if (crushing[i].at > time + 1e-9) continue;
        const c = crushing[i];
        crushing.splice(i, 1);
        if (c.transit) fractureSpan(c, fronts, dust); else fractureCrushed(c, fronts, dust);
      }
      if (near.bodies.length) dust.push(...near.step(dt));
      return dust;
    },
  };

  // S8: つぶれきった橋桁の一区間を隠し、橋桁に沿って割れた板と土煙を出す（橋脚の根元からも）
  function fractureSpan({ id, target: s, color }, fronts, dust) {
    const tier = getTier();
    cityView.hideTransit?.(id);
    const n = Math.max(3, Math.round(tier.piecesPerBuilding * 0.6));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n + (rng() - 0.5) * 0.3 / n;
      const across = (rng() - 0.5) * s.width * 0.8;
      const x = s.a[0] + (s.b[0] - s.a[0]) * u - Math.sin(s.heading) * across, z = s.a[1] + (s.b[1] - s.a[1]) * u + Math.cos(s.heading) * across;
      const p = crushPoint([x, s.y - s.thick / 2, z], fronts, 1, bc);
      const L = Math.min(BIG_MAX, s.len / n * (0.8 + 0.5 * rng()));
      const k = shade();
      pool.spawn({ pos: p, vel: crushOrSlump(p), size: L, dims: [L, s.thick * (0.6 + 0.5 * rng()), s.width * (0.25 + 0.3 * rng())], color: [color[0] * k, color[1] * k, color[2] * k], keep: i % 3 === 0 });
    }
    for (let i = 0; i < 2; i++) {
      const p = crushPoint([s.a[0] + (s.b[0] - s.a[0]) * rng(), rng() * s.y * 0.5, s.a[1] + (s.b[1] - s.a[1]) * rng()], fronts, 1, bc);
      dust.push({ pos: p, size: s.width * 0.7 });
    }
  }

  // 電車の一両が脱線して落ちた・溶けた（transitView の events。target: { x, y, z, w, d, h, heading, color }）: 車体の破片と土煙
  function trainDebris(t, dust) {
    const tier = getTier();
    const n = Math.max(3, Math.round(tier.piecesPerBuilding * 0.5));
    for (let i = 0; i < n; i++) {
      const u = (rng() - 0.5) * t.w;
      const p = [t.x + Math.cos(t.heading) * u, Math.max(0.5, t.y + 1 + rng() * 2), t.z + Math.sin(t.heading) * u];
      const s = 1 + 2.2 * rng(), k = shade();
      pool.spawn({ pos: p, vel: pushVelocity(p, t.dist, rng, bc), size: s * 1.6, dims: [s * 1.6, s * 0.6, s], color: [t.color[0] * k, t.color[1] * k, t.color[2] * k], keep: i === 0 });
    }
    dust.push({ pos: [t.x, Math.max(0, t.y), t.z], size: 8 });
  }

  // つぶれきったビルを隠し、つぶれた形（crushPoint の k=1）の上から破片と土煙を出す
  function fractureCrushed({ id, target, color }, fronts, dust) {
    const tier = getTier();
    cityView.hideBuilding(id);
    const at = (lx, ly, lz) => crushPoint([target.x + lx, ly, target.z + lz], fronts, 1, bc);
    const chunks = fractureBox(target, tier.piecesPerBuilding, id * 7919 + 13);
    for (const ch of chunks) {
      const dims = [ch.max[0] - ch.min[0], ch.max[1] - ch.min[1], ch.max[2] - ch.min[2]];
      // つぶれた分だけ縦を縮めた箱にする
      const cx = (ch.min[0] + ch.max[0]) / 2, cz = (ch.min[2] + ch.max[2]) / 2;
      const top = at(cx, ch.max[1], cz), bottom = at(cx, ch.min[1], cz);
      const center = at(cx, (ch.min[1] + ch.max[1]) / 2, cz);
      dims[1] = Math.max(0.5, Math.min(dims[1], Math.hypot(top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2])));
      const k = shade();
      emit(center, dims, crushOrSlump(center), [color[0] * k, color[1] * k, color[2] * k]);
    }
    // 小さい破片（壁のかけら）を表面のあちこちから
    const chips = Math.round(tier.piecesPerBuilding * CHIP_RATIO);
    for (let i = 0; i < chips; i++) {
      const s = CHIP_SIZE[0] + (CHIP_SIZE[1] - CHIP_SIZE[0]) * rng();
      const p = at((rng() - 0.5) * target.w, rng() * target.h, (rng() - 0.5) * target.d);
      const k = shade() * 0.9;
      pool.spawn({ pos: p, vel: crushOrSlump(p), size: s, dims: [s, s * (0.5 + 0.7 * rng()), s * (0.6 + 0.6 * rng())], color: [color[0] * k, color[1] * k, color[2] * k] });
    }
    // 大きな塊: 瓦礫として残す（keep）。重いのでゆっくり崩れ落ちる
    const big = bigChunks(tier);
    for (let i = 0; i < big; i++) {
      const dims = [
        Math.min(BIG_MAX, target.w * (0.45 + 0.25 * rng())),
        Math.min(BIG_MAX * 0.5, Math.max(2, target.h * (0.08 + 0.1 * rng()))),
        Math.min(BIG_MAX, target.d * (0.45 + 0.25 * rng())),
      ];
      const p = at((rng() - 0.5) * target.w * 0.4, rng() * target.h * 0.3, (rng() - 0.5) * target.d * 0.4);
      const v = crushOrSlump(p, 0.8).map((x) => x * 0.6);
      const k = shade() * 0.85;
      pool.spawn({ pos: p, vel: v, size: Math.max(...dims), dims, color: [color[0] * k, color[1] * k, color[2] * k], keep: true });
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
