import { groundHeight } from './sphereDeform.js';
import { facadeWindows } from './facadeWindows.js';

// 最後の一発の演出の「どこで撮るか」を決める純粋な関数（描画は知らない）。
// 軍勢の一人の目線: 広場を囲むビルのうち、その一人の向きのビルを選び、爆心と反対側の壁の前の通りにカメラを置く。
// 前線がそのビルに届くと、こちら側の窓ガラスが光に押されてカメラの方へ砕け、その一片がカメラの前で止まる。
// 時間が戻ると、カメラはその通りから上へ・外へ、追ってくる爆発から逃げる（retreat の道）。

export const PLAN = {
  innerDist: 48,         // 広場を囲むビル: 中心までの距離がこれより近いもの
  enemyNear: 120,        // この距離までの生きた軍勢から、目が映る一人を選ぶ
  camAlong: [5, 7, 9, 11, 14, 17, 21], // ビルの外の端から、通りに沿って外へ（m）
  camOff: [6, 7.5, 5, 9, 4], // 横の壁から通りの中へ（m）
  centerY: 6,            // 広場の中心のこの高さへの見通し（迫る光の壁が見える）
  lookY: 6.5,
  camHeight: 2.4,        // カメラの高さ（地面から。浮遊バイクの乗り手の目の高さ）
  clearance: 2.2,        // カメラはビルからこの距離より離れる
  riderClear: 3.0,       // カメラのすぐ前に軍勢がいない
  shardAhead: 2.3,       // 目が映るガラス片は、カメラのこの距離の前で止まる（m）
  // 逃げる道: 横に x 引いたときの高さ = 始めの高さ + rise·(1 − e^(−x/riseLen)) + slope·x
  rises: [8, 14, 22, 32, 45, 60, 80, 105, 135, 170, 210],
  flats: [110, 70, 40, 20, 0], // 通りの高さのまま飛ぶ長さ（m）の候補。長いほどよい
  riseLen: 7,
  slope: 0.2,
  pathClear: 4,
  azOffsets: [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9],
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len2 = (a) => Math.hypot(a[0], a[2]);
const inBox = (p, b, m) => Math.abs(p[0] - b.x) < b.w / 2 + m && Math.abs(p[2] - b.z) < b.d / 2 + m && p[1] < b.h + m;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const enemyPos = (e) => [Math.cos(e.angle) * e.dist, 3, Math.sin(e.angle) * e.dist];

// 原点（爆心）から箱までの地面の上の最短距離（前線がその箱に届く距離）
export function nearDist(b) {
  const dx = Math.max(0, Math.abs(b.x) - b.w / 2), dz = Math.max(0, Math.abs(b.z) - b.d / 2);
  return Math.hypot(dx, dz);
}

// 線分 a→c がビルの箱（margin 付き）を通るか（スラブ法）
export function segHitsBox(a, c, b, m = 0) {
  const lo = [b.x - b.w / 2 - m, -1e9, b.z - b.d / 2 - m], hi = [b.x + b.w / 2 + m, b.h + m, b.z + b.d / 2 + m];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = c[i] - a[i];
    if (Math.abs(d) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return false; continue; }
    let u = (lo[i] - a[i]) / d, v = (hi[i] - a[i]) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}

// 逃げる道がビルから離れる距離: 始まり（通りの中のカメラ）は clearance、上がるにつれて pathClear へ
export const pathMargin = (x) => Math.min(PLAN.pathClear, PLAN.clearance - 0.2 + x * 0.4);
// 道の上の x の点が、ビルから離れる距離（低く飛ぶ間は通りの中なので clearance）
export const retreatMargin = (path, x) => (x < (path.flat ?? 0) ? PLAN.clearance - 0.2 : pathMargin(x - (path.flat ?? 0)));

// 逃げる道の上の、横に x 引いた点。はじめの flat m は通りの高さのまま低く飛び、そこから上がる
export function retreatPoint(path, x) {
  const u = Math.max(0, x - (path.flat ?? 0));
  const y = path.origin[1] + path.rise * (1 - Math.exp(-u / path.riseLen)) + path.slope * u;
  return [path.origin[0] + path.dir[0] * x, y, path.origin[2] + path.dir[1] * x];
}

function pickRider(enemies, rng) {
  const alive = enemies.filter((e) => e.state !== 'dead' && e.dist <= PLAN.enemyNear);
  return alive.length ? alive[Math.floor(rng() * alive.length)] : null;
}

// 候補のビル: 広場を囲むビルを、その一人の向きに近い順に（撮れる場所が見つかるまで順に試す）
function rankBuildings(buildings, angle) {
  const inner = buildings.filter((b) => b.dist <= PLAN.innerDist && b.h > 6);
  const pool = inner.length ? inner : buildings.slice().sort((a, b) => a.dist - b.dist).slice(0, 8);
  const score = (b) => angDiff(Math.atan2(b.z, b.x), angle) + b.dist * 0.004;
  return pool.map((b) => [score(b), b]).sort((a, b) => a[0] - b[0]).map(([, b]) => b);
}

function camClear(p, buildings, ground, riders) {
  if (p[1] <= ground(p) + 1) return false;
  if (buildings.some((o) => inBox(p, o, PLAN.clearance))) return false;
  if (riders.some((r) => Math.hypot(r[0] - p[0], r[2] - p[2]) < PLAN.riderClear)) return false;
  return true;
}

// カメラ: ビルの横の壁に沿った通りの、ビルより外側。通りの先（広場）に迫る光の壁が見え、横の壁の窓が手前へ並ぶ。
// 壁ごと・離れ方ごとに候補を作り、ビルの中でなく、広場の中心と壁への見通しがあるものから選ぶ
function findCamera(b, buildings, ground, riders) {
  const others = buildings.filter((o) => o !== b && o.id !== b.id);
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  const center = [0, PLAN.centerY, 0];
  let best = null;
  for (const n of faces) {
    const alongX = Math.abs(n[0]) > 0.5;
    const half = alongX ? b.w / 2 : b.d / 2;      // 壁までの距離（中心から法線の向き）
    const faceW = alongX ? b.d : b.w;
    const fc = [b.x + n[0] * half, 0, b.z + n[2] * half];
    // 壁に沿った向きのうち、爆心から離れる向き（通りの外側）
    let t = [-n[2], 0, n[0]];
    if (t[0] * b.x + t[2] * b.z < 0) t = [-t[0], 0, -t[2]];
    // 外へ向かう壁でないと、通りの先に広場が見えない
    const outward = (t[0] * b.x + t[2] * b.z) / (Math.hypot(b.x, b.z) || 1);
    if (outward < 0.5) continue;
    const end = [fc[0] + t[0] * faceW / 2, 0, fc[2] + t[2] * faceW / 2]; // 壁の外の端
    for (const offR of PLAN.camAlong) {
      for (const offN of PLAN.camOff) {
        const p = [end[0] + t[0] * offR + n[0] * offN, 0, end[2] + t[2] * offR + n[2] * offN];
        p[1] = ground(p) + PLAN.camHeight;
        if (!camClear(p, buildings, ground, riders)) continue;
        const wallMid = [fc[0], b.h * 0.6, fc[2]];
        const look = [fc[0] + (center[0] - fc[0]) * 0.45 - t[0] * faceW * 0.1, PLAN.lookY, fc[2] + (center[2] - fc[2]) * 0.45 - t[2] * faceW * 0.1];
        const pts = [center, wallMid, look];
        if (pts.some((q) => others.some((o) => segHitsBox(p, q, o)))) continue;
        if (segHitsBox(p, center, b, 0.5)) continue;
        const score = Math.abs(offR - 9) * 0.6 + Math.abs(offN - 7.5) + (1 - outward) * 8;
        if (!best || score < best.score) best = { pos: p, look, wall: wallMid, normal: n, score };
      }
    }
  }
  return best;
}

// 逃げる道: 見ている向きと反対（通りに沿って外へ）を基準に、低い順に、ビルを通らない道を探す。
// 向きと「低く飛ぶ長さ」ごとに、道の上の各点で越えなければならない高さを先に求めておく（放つ瞬間に止まらないように）
const STEP = 0.75;
function findRetreat(origin, base, buildings, ground, radius, lead) {
  const radial = Math.atan2(origin[2], origin[0]);
  const len = Math.max(60, radius + lead + 20 - len2(origin)) + 10;
  const n = Math.ceil((len - 0.5) / STEP) + 1;
  const xs = Array.from({ length: n }, (_, i) => 0.5 + i * STEP);
  let best = null;
  for (const off of PLAN.azOffsets) {
    // 外へ向かう向き（爆心から離れていく）だけ
    const az = base + off;
    if (Math.cos(az - radial) < 0.35) continue;
    const dir = [Math.cos(az), Math.sin(az)];
    // 道の近く（横に 30 m 以内）のビルだけ
    const corridor = buildings.filter((o) => {
      const rx = o.x - origin[0], rz = o.z - origin[2];
      const along = rx * dir[0] + rz * dir[1], across = Math.abs(-rx * dir[1] + rz * dir[0]);
      return along > -20 && along < len + 20 && across < 30 + Math.max(o.w, o.d);
    });
    const floorY = xs.map((x) => ground([origin[0] + dir[0] * x, 0, origin[2] + dir[1] * x]) + 1);
    for (const flat of PLAN.flats) {
      const probe = { flat };
      // 各点で越えなければならない高さ（ビルの箱を margin だけ広げた中に入るなら、その屋上 + margin）
      const need = xs.map((x, i) => {
        const m = retreatMargin(probe, x), px = origin[0] + dir[0] * x, pz = origin[2] + dir[1] * x;
        let h = floorY[i];
        for (const o of corridor) if (Math.abs(px - o.x) < o.w / 2 + m && Math.abs(pz - o.z) < o.d / 2 + m) h = Math.max(h, o.h + m);
        return h;
      });
      let found = false;
      for (const rise of PLAN.rises) {
        const path = { origin, dir, rise, riseLen: PLAN.riseLen, slope: PLAN.slope, flat };
        if (!xs.every((x, i) => retreatPoint(path, x)[1] > need[i])) continue;
        const score = rise * 0.5 - flat * 0.6 + Math.abs(off) * 40;
        if (!best || score < best.score) best = { path, score };
        found = true;
        break;
      }
      if (found) break;
    }
  }
  return best ? best.path : { origin, dir: [Math.cos(radial), Math.sin(radial)], rise: 260, riseLen: PLAN.riseLen, slope: PLAN.slope, flat: 0 };
}

const groundFor = (crater) => (p) => groundHeight(Math.hypot(p[0], p[2]), crater > 0 ? [crater] : []);

// 逃げる道だけを探す（planFinale の retreat: false で後回しにしたとき、演出の白〜一拍の間に呼ぶ）。
// plan: planFinale の戻り値、ほかは planFinale に渡したものと同じ（radius は shot.radius）
export function planRetreat(plan, { buildings, crater = 0, radius, lead = 0 }) {
  const { camPos: c, look: l } = plan;
  return findRetreat(c, Math.atan2(c[2] - l[2], c[0] - l[0]), buildings, groundFor(crater), radius, lead);
}

// 目が映る一人: ビルの向き（angle から maxAng 以内）にいる生きた軍勢のうち、カメラにいちばん近い一人（カメラはその一人の目線）
export const RIDER_MAX_ANG = 1.2;
function nearestRider(enemies, pos, angle) {
  let best = null, bd = Infinity;
  for (const e of enemies) {
    if (e.state === 'dead' || angDiff(e.angle, angle) >= RIDER_MAX_ANG) continue;
    const p = enemyPos(e), d = Math.hypot(p[0] - pos[0], p[2] - pos[2]);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// shot: 最後の一発（radius）、buildings: 残っているビル、enemies: 軍勢、crater: 地面のえぐれ
// lead: 逃げる道を確かめる長さに足す、前線の先を行く距離（m、半径 radius のとき）
// retreat: false なら逃げる道は探さず null（放つ瞬間を軽くする。あとで planRetreat で求める）
export function planFinale({ shot, buildings, enemies = [], rng, crater = 0, lead = 0, retreat = true }) {
  const ground = groundFor(crater);
  const rider = pickRider(enemies, rng);
  const angle = rider ? rider.angle : rng() * Math.PI * 2;
  const riders = enemies.filter((e) => e.state !== 'dead').map(enemyPos);
  let cam = null, n = null, b = null;
  for (const c of rankBuildings(buildings, angle)) {
    cam = findCamera(c, buildings, ground, riders);
    if (cam) { b = c; n = cam.normal; break; }
  }
  let building = b, windows = [];
  if (!cam) {
    // ビルがない・撮れる場所がない: 何もない通りの上で、光の壁を見上げる
    building = null;
    n = [Math.cos(angle), 0, Math.sin(angle)];
    const p = [n[0] * 40, 0, n[2] * 40];
    p[1] = ground(p) + PLAN.camHeight + 6;
    cam = { pos: p, look: [n[0] * 20, 10, n[2] * 20] };
  } else {
    windows = facadeWindows(b, n);
  }
  const hitDist = building ? nearDist(building) : 20;
  // 目が映るガラス片はカメラの前。背に光の壁ではなく、ビルの暗い壁が来る向き（映った目が読める）
  const wall = cam.wall ?? cam.look;
  const toLook = sub(cam.look, cam.pos), toWall = sub(wall, cam.pos);
  const nl = Math.hypot(...toLook), nw = Math.hypot(...toWall);
  const f = [toLook[0] / nl * 0.35 + toWall[0] / nw * 0.65, toLook[1] / nl * 0.35 + toWall[1] / nw * 0.65, toLook[2] / nl * 0.35 + toWall[2] / nw * 0.65];
  const fl = Math.hypot(f[0], f[1], f[2]);
  const fwd = [f[0] / fl, f[1] / fl, f[2] / fl];
  const right = [-fwd[2], 0, fwd[0]], rl = Math.hypot(right[0], right[2]) || 1;
  const side = rng() < 0.5 ? -1 : 1;
  const shardPos = [
    cam.pos[0] + fwd[0] * PLAN.shardAhead + right[0] / rl * 0.08 * side,
    cam.pos[1] + fwd[1] * PLAN.shardAhead + 0.1,
    cam.pos[2] + fwd[2] * PLAN.shardAhead + right[2] / rl * 0.08 * side,
  ];
  const eyeOf = rider ? (building ? nearestRider(enemies, cam.pos, Math.atan2(building.z, building.x)) : null) ?? rider : null;
  const plan = {
    riderId: eyeOf ? eyeOf.id : null,
    buildingId: building ? building.id : null,
    building: building ? { x: building.x, z: building.z, w: building.w, d: building.d, h: building.h, kind: building.kind, dist: building.dist } : null,
    normal: n,
    hitDist,
    camPos: cam.pos,
    look: cam.look,
    shardPos,
    windows,
    retreat: null,
  };
  if (retreat) plan.retreat = planRetreat(plan, { buildings, crater, radius: shot.radius, lead });
  return plan;
}
