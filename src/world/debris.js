// 破片の演出用の動き（物理ではなく、決めた式で動かす）。three には依存しない。
// 手前の破片だけは nearPhysics.js の物理を使う。
import { groundHeight, PILLAR } from '../render/sphereDeform.js';

export const DEBRIS = {
  gravity: 9.8 * 1.5,       // 「アニメの重さ」: 少し強めの重力
  restitution: 0.3,
  maxBounce: 8,             // m/s。深い穴の底に落ちても跳ね上がりすぎない
  reposeTan: Math.tan(50 * Math.PI / 180), // 穴の壁がこれより急なところでは、破片は止まらず底の方へ滑り落ちる
  slideFriction: 0.985,     // 急な壁を滑り落ちる間、面に沿った速さへ毎フレーム掛ける
  groundFriction: 0.55,     // 地面に触れるたびに横の速さへ掛ける
  maxTravel: 60,            // m。これ以上飛んだら粉に変わる
  maxAge: 4,                // s
  maxAgeFalling: 14,        // s。えぐれた穴の上を落ちていく破片・建物の大きな塊は、底に着くまで待つ
  maxRest: 1.2,             // s。地面で止まってからの時間
  horizontal: [25, 60],     // m/s
  upward: [8, 30],          // m/s
  crushHorizontal: [8, 25], // m/s。球の線で押しつぶされたビルの破片（表面に沿ってゆっくり外へ流れる）
  crushUpward: [2, 10],     // m/s
  slumpHorizontal: [3, 18], // m/s。押しつぶされたビルの破片のうち、穴の中へ崩れ落ちるもの（内向き）
  slumpUpward: [0, 4],      // m/s
  explosionCenter: [0, 0],  // 爆心は常に主人公の位置
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 中心から外向き（水平）の単位ベクトルを、少しばらした向きで返す
function outward(c, rng) {
  const dx = c[0] - DEBRIS.explosionCenter[0], dz = c[2] - DEBRIS.explosionCenter[1];
  const len = Math.hypot(dx, dz);
  let ux, uz;
  if (len < 1e-6) { const a = rng() * Math.PI * 2; ux = Math.cos(a); uz = Math.sin(a); } else { ux = dx / len; uz = dz / len; }
  const spread = (rng() - 0.5) * 0.7; // ラジアン
  const cs = Math.cos(spread), sn = Math.sin(spread);
  return [ux * cs - uz * sn, ux * sn + uz * cs];
}

// 破片の初速。中心から外向き（水平）と上向き。blastFront が大きい（大きな一発）ほど速くなりやすい。
export function pushVelocity(chunkCenter, blastFront, rng) {
  const [dirX, dirZ] = outward(chunkCenter, rng);
  const t = clamp01(0.25 + 0.5 * (blastFront / 440) + (rng() - 0.5) * 0.5);
  const h = DEBRIS.horizontal[0] + (DEBRIS.horizontal[1] - DEBRIS.horizontal[0]) * t;
  const up = DEBRIS.upward[0] + (DEBRIS.upward[1] - DEBRIS.upward[0]) * rng();
  return [dirX * h, up, dirZ * h];
}

// 球の線で押しつぶされたビルの破片の初速。飛び散らず、表面に沿って外へ崩れ流れる遅さ。
export function crushVelocity(chunkCenter, rng) {
  const [dirX, dirZ] = outward(chunkCenter, rng);
  const [h0, h1] = DEBRIS.crushHorizontal, [u0, u1] = DEBRIS.crushUpward;
  const h = h0 + (h1 - h0) * rng();
  const up = u0 + (u1 - u0) * rng();
  return [dirX * h, up, dirZ * h];
}

// 穴の縁で押しつぶされたビルの破片が、穴の中へ崩れ落ちる初速（中心へ向かう）。底や斜面に瓦礫として積もる
export function slumpVelocity(chunkCenter, rng) {
  const [dirX, dirZ] = outward(chunkCenter, rng);
  const [h0, h1] = DEBRIS.slumpHorizontal, [u0, u1] = DEBRIS.slumpUpward;
  const h = h0 + (h1 - h0) * rng();
  const up = u0 + (u1 - u0) * rng();
  return [-dirX * h, up, -dirZ * h];
}

// 固定容量の破片プール。active[0..count) が生きている破片の slot。
// spawn: { pos, vel, size, dims?: [w,h,d], color?: [r,g,b], keep? }
// 止まった破片は、穴の中（えぐれた半径の内側）なら瓦礫として update の settled へ渡す（土煙にしない）。
// keep（建物の大きな塊）は穴の外でも瓦礫として残す。主人公の柱の上（r < 4m）で止まったものは足元を空けるため土煙にする。塔の斜面には瓦礫が残る。
export function createDebrisPool(capacity, rng) {
  const F = (n = capacity) => new Float32Array(n);
  const data = {
    px: F(), py: F(), pz: F(), vx: F(), vy: F(), vz: F(),
    rx: F(), ry: F(), rz: F(), wx: F(), wy: F(), wz: F(),
    sx: F(), sy: F(), sz: F(), ox: F(), oy: F(), oz: F(),
    age: F(), rest: F(), cr: F(), cg: F(), cb: F(), size: F(),
  };
  const keep = new Uint8Array(capacity);
  const seq = new Uint32Array(capacity); // 0 = 空き
  const where = new Int32Array(capacity).fill(-1); // slot -> active 内の位置
  const active = new Int32Array(capacity);
  const free = [];
  for (let i = capacity - 1; i >= 0; i--) free.push(i);
  const fifo = new Int32Array(capacity * 2 + 2); // 古い順の slot 番号（リング）
  const fifoSeq = new Uint32Array(capacity * 2 + 2);
  let head = 0, tail = 0, fifoLen = 0, counter = 0, count = 0, limit = capacity;
  let crater = 0; // えぐれた地面の半径（原点中心の球の下半分が穴になる）
  let craterList = []; // groundHeight に渡す球の一覧（[crater]）
  let evicted = []; // 上限で置き換えた破片。途中で消えたように見えないよう、次の update で粉にする

  const release = (s) => {
    const i = where[s];
    const last = active[count - 1];
    active[i] = last; where[last] = i;
    where[s] = -1; seq[s] = 0;
    count--;
    free.push(s);
  };

  // 置き換える破片: 一番古いもの。ただし瓦礫として残す大きな塊（keep）は、ほかに置き換えられる破片がある限り飛ばして後ろへ回す
  function oldest() {
    let skips = count;
    while (fifoLen > 0) {
      const s = fifo[head], q = fifoSeq[head];
      head = (head + 1) % fifo.length; fifoLen--;
      if (seq[s] !== q) continue;
      if (keep[s] && skips-- > 0) {
        fifo[tail] = s; fifoSeq[tail] = q; tail = (tail + 1) % fifo.length; fifoLen++;
        continue;
      }
      return s;
    }
    return -1;
  }

  const pool = {
    data, active,
    get count() { return count; },
    get capacity() { return capacity; },
    get crater() { return crater; },
    // 画質が下がったときに使う上限（確保済みの容量より大きくはできない）
    setLimit(n) { limit = Math.max(1, Math.min(capacity, Math.floor(n))); },
    // 地面のえぐれ（半径）。穴の上の破片は球の面まで落ちる
    setCrater(r) {
      const c = Math.max(0, r);
      if (c !== crater) { crater = c; craterList = c > 0 ? [c] : []; }
    },
    spawn(p) {
      let s;
      if (count >= limit) {
        s = oldest();
        if (s < 0) return;
        evicted.push({ pos: [data.px[s], data.py[s], data.pz[s]], size: data.size[s] });
        release(s);
      }
      s = free.pop();
      const d = data;
      d.px[s] = d.ox[s] = p.pos[0]; d.py[s] = d.oy[s] = p.pos[1]; d.pz[s] = d.oz[s] = p.pos[2];
      d.vx[s] = p.vel[0]; d.vy[s] = p.vel[1]; d.vz[s] = p.vel[2];
      const dims = p.dims ?? [p.size, p.size, p.size];
      d.sx[s] = dims[0]; d.sy[s] = dims[1]; d.sz[s] = dims[2];
      d.size[s] = p.size;
      d.rx[s] = rng() * 6.28; d.ry[s] = rng() * 6.28; d.rz[s] = rng() * 6.28;
      const spin = 2 + 6 * rng();
      d.wx[s] = (rng() - 0.5) * 2 * spin; d.wy[s] = (rng() - 0.5) * 2 * spin; d.wz[s] = (rng() - 0.5) * 2 * spin;
      d.age[s] = 0; d.rest[s] = 0;
      keep[s] = p.keep ? 1 : 0;
      const c = p.color ?? [0.7, 0.7, 0.7];
      d.cr[s] = c[0]; d.cg[s] = c[1]; d.cb[s] = c[2];
      seq[s] = ++counter;
      where[s] = count; active[count++] = s;
      fifo[tail] = s; fifoSeq[tail] = counter; tail = (tail + 1) % fifo.length;
      if (++fifoLen > fifo.length) { head = (head + 1) % fifo.length; fifoLen--; }
    },
    // 進める。粉に変わった破片の DustEvent を返す。settled（配列）を渡すと、瓦礫として残す破片をそこへ足す
    // （{ pos, rot, dims, size, color }）。渡さなければ止まった破片はすべて土煙
    update(dt, settled) {
      const dust = evicted;
      evicted = [];
      const d = data;
      const g = DEBRIS.gravity * dt;
      const top = PILLAR.radius; // 主人公の柱の上（ここで止まった破片は瓦礫にしない）
      for (let i = count - 1; i >= 0; i--) {
        const s = active[i];
        d.age[s] += dt;
        d.vy[s] -= g;
        d.px[s] += d.vx[s] * dt; d.py[s] += d.vy[s] * dt; d.pz[s] += d.vz[s] * dt;
        d.rx[s] += d.wx[s] * dt; d.ry[s] += d.wy[s] * dt; d.rz[s] += d.wz[s] * dt;
        const half = Math.min(d.sx[s], d.sy[s], d.sz[s]) * 0.5;
        // 穴の中（地面より下）では、穴の面（球の面から厚みの半分だけ内側）に当てる。外向きの速さを消し（強く当たれば少し跳ね）、
        // 面に沿った重力で滑る。壁が急（reposeTan より急）なところでは止まらずに底の方へ滑り落ち、ゆるいところで擦れて止まる
        let wall = false, steep = false;
        if (crater > 0 && d.py[s] < 0) {
          const R = crater - half, dd = Math.hypot(d.px[s], d.py[s], d.pz[s]);
          if (R > 0 && dd >= R) {
            const k = R / dd;
            d.px[s] *= k; d.py[s] *= k; d.pz[s] *= k;
            const nx = d.px[s] / R, ny = d.py[s] / R, nz = d.pz[s] / R;
            const vn = d.vx[s] * nx + d.vy[s] * ny + d.vz[s] * nz;
            if (vn > 0) {
              const j = vn + (vn > 2 ? Math.min(vn * DEBRIS.restitution, DEBRIS.maxBounce) : 0);
              d.vx[s] -= j * nx; d.vy[s] -= j * ny; d.vz[s] -= j * nz;
            }
            const rr = Math.hypot(d.px[s], d.pz[s]);
            steep = rr > top && rr / Math.max(1e-6, -d.py[s]) > DEBRIS.reposeTan;
            const fr = steep ? DEBRIS.slideFriction : DEBRIS.groundFriction;
            // 面に沿った速さに摩擦を掛ける
            const vt = d.vx[s] * nx + d.vy[s] * ny + d.vz[s] * nz;
            const tx = d.vx[s] - vt * nx, ty = d.vy[s] - vt * ny, tz = d.vz[s] - vt * nz;
            d.vx[s] = vt * nx + tx * fr; d.vy[s] = vt * ny + ty * fr; d.vz[s] = vt * nz + tz * fr;
            d.wx[s] *= 0.6; d.wy[s] *= 0.6; d.wz[s] *= 0.6;
            // ゆるいところでは、遅くなったら止まる（少しずつ滑り続けない）
            if (!steep && Math.hypot(d.vx[s], d.vy[s], d.vz[s]) < 0.5) { d.vx[s] = 0; d.vy[s] = 0; d.vz[s] = 0; }
            wall = true;
          }
        }
        const r = Math.hypot(d.px[s], d.pz[s]);
        const overHole = r < crater;
        // 穴の外（主人公の柱・縁の盛り上がり・平らな地面）は地面のシェーダーと同じ groundHeight の上に止まる
        const floor = half + groundHeight(r, craterList);
        let onGround = false;
        if (d.py[s] <= floor) {
          d.py[s] = floor;
          if (d.vy[s] < -2) d.vy[s] = Math.min(-d.vy[s] * DEBRIS.restitution, DEBRIS.maxBounce); else d.vy[s] = 0;
          d.vx[s] *= DEBRIS.groundFriction; d.vz[s] *= DEBRIS.groundFriction;
          d.wx[s] *= 0.6; d.wy[s] *= 0.6; d.wz[s] *= 0.6;
          onGround = d.vy[s] === 0;
        }
        const speed = Math.hypot(d.vx[s], d.vy[s], d.vz[s]);
        d.rest[s] = (onGround || (wall && !steep)) && speed < 1.5 ? d.rest[s] + dt : 0;
        // 穴の中へ落ちた破片は距離では消さない（底まで落ち、壁を滑り落ちる。時間の上限 maxAgeFalling だけ）
        const tx = d.px[s] - d.ox[s], ty = d.py[s] - d.oy[s], tz = d.pz[s] - d.oz[s];
        const far = !overHole && tx * tx + ty * ty + tz * tz > DEBRIS.maxTravel ** 2;
        const maxAge = overHole || keep[s] ? DEBRIS.maxAgeFalling : DEBRIS.maxAge;
        if (d.rest[s] > DEBRIS.maxRest && settled && (overHole || keep[s]) && r >= top) {
          settled.push({
            pos: [d.px[s], d.py[s], d.pz[s]], rot: [d.rx[s], d.ry[s], d.rz[s]],
            dims: [d.sx[s], d.sy[s], d.sz[s]], size: d.size[s], color: [d.cr[s], d.cg[s], d.cb[s]],
            floor: Math.min(d.py[s] - half, groundHeight(r, craterList)),
          });
          release(s);
        } else if (d.age[s] > maxAge || d.rest[s] > DEBRIS.maxRest || far) {
          dust.push({ pos: [d.px[s], d.py[s], d.pz[s]], size: d.size[s] });
          release(s);
        }
      }
      return dust;
    },
  };
  return pool;
}
