// 破片の演出用の動き（物理ではなく、決めた式で動かす）。three には依存しない。
// 手前の破片だけは nearPhysics.js の物理を使う。

export const DEBRIS = {
  gravity: 9.8 * 1.5,       // 「アニメの重さ」: 少し強めの重力
  restitution: 0.3,
  groundFriction: 0.55,     // 地面に触れるたびに横の速さへ掛ける
  maxTravel: 60,            // m。これ以上飛んだら粉に変わる
  maxAge: 4,                // s
  maxRest: 1.2,             // s。地面で止まってからの時間
  horizontal: [25, 60],     // m/s
  upward: [8, 30],          // m/s
  explosionCenter: [0, 0],  // 爆心は常に主人公の位置
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 破片の初速。中心から外向き（水平）と上向き。blastFront が大きい（大きな一発）ほど速くなりやすい。
export function pushVelocity(chunkCenter, blastFront, rng) {
  const dx = chunkCenter[0] - DEBRIS.explosionCenter[0], dz = chunkCenter[2] - DEBRIS.explosionCenter[1];
  const len = Math.hypot(dx, dz);
  let ux, uz;
  if (len < 1e-6) { const a = rng() * Math.PI * 2; ux = Math.cos(a); uz = Math.sin(a); } else { ux = dx / len; uz = dz / len; }
  const spread = (rng() - 0.5) * 0.7; // 向きを少しばらす（ラジアン）
  const cs = Math.cos(spread), sn = Math.sin(spread);
  const dirX = ux * cs - uz * sn, dirZ = ux * sn + uz * cs;
  const t = clamp01(0.25 + 0.5 * (blastFront / 440) + (rng() - 0.5) * 0.5);
  const h = DEBRIS.horizontal[0] + (DEBRIS.horizontal[1] - DEBRIS.horizontal[0]) * t;
  const up = DEBRIS.upward[0] + (DEBRIS.upward[1] - DEBRIS.upward[0]) * rng();
  return [dirX * h, up, dirZ * h];
}

// 固定容量の破片プール。active[0..count) が生きている破片の slot。
// spawn: { pos, vel, size, dims?: [w,h,d], color?: [r,g,b] }
export function createDebrisPool(capacity, rng) {
  const F = (n = capacity) => new Float32Array(n);
  const data = {
    px: F(), py: F(), pz: F(), vx: F(), vy: F(), vz: F(),
    rx: F(), ry: F(), rz: F(), wx: F(), wy: F(), wz: F(),
    sx: F(), sy: F(), sz: F(), ox: F(), oy: F(), oz: F(),
    age: F(), rest: F(), cr: F(), cg: F(), cb: F(), size: F(),
  };
  const seq = new Uint32Array(capacity); // 0 = 空き
  const where = new Int32Array(capacity).fill(-1); // slot -> active 内の位置
  const active = new Int32Array(capacity);
  const free = [];
  for (let i = capacity - 1; i >= 0; i--) free.push(i);
  const fifo = new Int32Array(capacity * 2 + 2); // 古い順の slot 番号（リング）
  const fifoSeq = new Uint32Array(capacity * 2 + 2);
  let head = 0, tail = 0, fifoLen = 0, counter = 0, count = 0, limit = capacity;
  let evicted = []; // 上限で置き換えた破片。途中で消えたように見えないよう、次の update で粉にする

  const release = (s) => {
    const i = where[s];
    const last = active[count - 1];
    active[i] = last; where[last] = i;
    where[s] = -1; seq[s] = 0;
    count--;
    free.push(s);
  };

  function oldest() {
    while (fifoLen > 0) {
      const s = fifo[head], q = fifoSeq[head];
      head = (head + 1) % fifo.length; fifoLen--;
      if (seq[s] === q) return s;
    }
    return -1;
  }

  const pool = {
    data, active,
    get count() { return count; },
    get capacity() { return capacity; },
    // 画質が下がったときに使う上限（確保済みの容量より大きくはできない）
    setLimit(n) { limit = Math.max(1, Math.min(capacity, Math.floor(n))); },
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
      const c = p.color ?? [0.7, 0.7, 0.7];
      d.cr[s] = c[0]; d.cg[s] = c[1]; d.cb[s] = c[2];
      seq[s] = ++counter;
      where[s] = count; active[count++] = s;
      fifo[tail] = s; fifoSeq[tail] = counter; tail = (tail + 1) % fifo.length;
      if (++fifoLen > fifo.length) { head = (head + 1) % fifo.length; fifoLen--; }
    },
    // 進める。粉に変わった破片の DustEvent を返す。
    update(dt) {
      const dust = evicted;
      evicted = [];
      const d = data;
      const g = DEBRIS.gravity * dt;
      for (let i = count - 1; i >= 0; i--) {
        const s = active[i];
        d.age[s] += dt;
        d.vy[s] -= g;
        d.px[s] += d.vx[s] * dt; d.py[s] += d.vy[s] * dt; d.pz[s] += d.vz[s] * dt;
        d.rx[s] += d.wx[s] * dt; d.ry[s] += d.wy[s] * dt; d.rz[s] += d.wz[s] * dt;
        const floor = Math.min(d.sx[s], d.sy[s], d.sz[s]) * 0.5;
        if (d.py[s] < floor) {
          d.py[s] = floor;
          if (d.vy[s] < -2) d.vy[s] = -d.vy[s] * DEBRIS.restitution; else d.vy[s] = 0;
          d.vx[s] *= DEBRIS.groundFriction; d.vz[s] *= DEBRIS.groundFriction;
          d.wx[s] *= 0.6; d.wy[s] *= 0.6; d.wz[s] *= 0.6;
        }
        const onGround = d.py[s] <= floor + 1e-3 && d.vy[s] === 0;
        d.rest[s] = onGround && Math.hypot(d.vx[s], d.vz[s]) < 1.5 ? d.rest[s] + dt : 0;
        const tx = d.px[s] - d.ox[s], ty = d.py[s] - d.oy[s], tz = d.pz[s] - d.oz[s];
        if (d.age[s] > DEBRIS.maxAge || d.rest[s] > DEBRIS.maxRest || tx * tx + ty * ty + tz * tz > DEBRIS.maxTravel ** 2) {
          dust.push({ pos: [d.px[s], d.py[s], d.pz[s]], size: d.size[s] });
          release(s);
        }
      }
      return dust;
    },
  };
  return pool;
}
