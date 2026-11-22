// R1f（持ち主 19:47「見つけたらビル貫通してバイクがくるよ」）: 追う軍勢がビルを避けて通り・広場を回り込むための、安い道しるべ。
// 街を cell m の升に分け、ビルの足元（pad m 広げた四角）にかかる升を「通れない」にする（街ごとに一度）。
// 道しるべ（build）は、目標（主人公）の升から、まわり half m の窓の内を 8 方向の幅優先でたどり（角は、両どなりが通れるときだけ斜めに抜ける）、
// どの升からも目標へ一歩近づく升（next）を覚える。窓は 2·half / cell 升四方（既定 128 m / 2 m = 65 升四方、約 4200 升）。
// ahead(x, z, k) は、その所から道しるべを k 升たどった先の点（目標に着けば目標そのもの）。窓の外・たどれない所は null。
// 描画も DOM も知らない（enemies.js が使う）

export function createNavGrid(buildings, { cell = 2, pad = 0.9 } = {}) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of buildings) {
    x0 = Math.min(x0, b.x - b.w / 2); x1 = Math.max(x1, b.x + b.w / 2);
    z0 = Math.min(z0, b.z - b.d / 2); z1 = Math.max(z1, b.z + b.d / 2);
  }
  if (!buildings.length) { x0 = z0 = -1; x1 = z1 = 1; }
  const m = 4 * cell; // 端のまわりに少し余白（そこは通れる）
  x0 -= m; z0 -= m; x1 += m; z1 += m;
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  const blocked = new Uint8Array(nx * nz);
  // 升の中心が足元（pad m 広げた四角）の内なら通れない
  for (const b of buildings) {
    const bx0 = b.x - b.w / 2 - pad, bx1 = b.x + b.w / 2 + pad, bz0 = b.z - b.d / 2 - pad, bz1 = b.z + b.d / 2 + pad;
    const i0 = Math.max(0, Math.ceil((bx0 - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((bx1 - x0) / cell - 0.5));
    const j0 = Math.max(0, Math.ceil((bz0 - z0) / cell - 0.5)), j1 = Math.min(nz - 1, Math.floor((bz1 - z0) / cell - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * nx + i] = 1;
  }
  const ci = (x) => Math.floor((x - x0) / cell), cj = (z) => Math.floor((z - z0) / cell);
  return {
    cell, nx, nz, x0, z0,
    ci, cj,
    // 升の中心
    cx: (i) => x0 + (i + 0.5) * cell, cz: (j) => z0 + (j + 0.5) * cell,
    // 升 (i, j) を通れないか（街の外の升は通れる）
    isBlocked: (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz ? false : blocked[j * nx + i] === 1),
  };
}

const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function createFlowField(nav, { half = 64 } = {}) {
  const H = Math.ceil(half / nav.cell);
  const S = 2 * H + 1, N = S * S;
  const dist = new Int32Array(N), next = new Int32Array(N), queue = new Int32Array(N), blk = new Uint8Array(N);
  let oi = 0, oj = 0, target = null, builds = 0, ti = 0, tj = 0;
  const local = (i, j) => { const a = i - oi, b = j - oj; return a < 0 || b < 0 || a >= S || b >= S ? -1 : b * S + a; };
  const free = (k) => k >= 0 && blk[k] === 0;

  function build(tx, tz) {
    builds++;
    target = { x: tx, z: tz };
    ti = nav.ci(tx); tj = nav.cj(tz);
    oi = ti - H; oj = tj - H;
    for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) blk[b * S + a] = nav.isBlocked(oi + a, oj + b) ? 1 : 0;
    dist.fill(-1); next.fill(-1);
    // 目標の升が足元の余白にかかるときは、目標の升そのものから始める（主人公はいつも足元の外にいる）
    const t = local(ti, tj);
    blk[t] = 0;
    let head = 0, tail = 0;
    dist[t] = 0; next[t] = t; queue[tail++] = t;
    while (head < tail) {
      const k = queue[head++], a = k % S, b = (k - a) / S;
      for (const [da, db] of D8) {
        const na = a + da, nb = b + db;
        if (na < 0 || nb < 0 || na >= S || nb >= S) continue;
        const n = nb * S + na;
        if (dist[n] >= 0 || blk[n]) continue;
        if (da && db && (blk[b * S + na] || blk[nb * S + a])) continue; // 角を斜めに抜けない
        dist[n] = dist[k] + 1; next[n] = k; queue[tail++] = n;
      }
    }
  }

  // (x, z) から k 升たどった先の点 { x, z }（目標に着けば目標そのもの）。窓の外・たどれない所は null
  function ahead(x, z, k = 3) {
    if (!target) return null;
    let c = local(nav.ci(x), nav.cj(z));
    if (c < 0) return null;
    if (dist[c] < 0) { // 足元の余白の升（押し出された直後など）: となりのたどれる升から
      let best = -1;
      const a = c % S, b = (c - a) / S;
      for (const [da, db] of D8) {
        const na = a + da, nb = b + db;
        if (na < 0 || nb < 0 || na >= S || nb >= S) continue;
        const n = nb * S + na;
        if (dist[n] >= 0 && (best < 0 || dist[n] < dist[best])) best = n;
      }
      if (best < 0) return null;
      c = best;
    }
    for (let s = 0; s < k && dist[c] > 0; s++) c = next[c];
    if (dist[c] === 0) return { x: target.x, z: target.z };
    const a = c % S, b = (c - a) / S;
    return { x: nav.cx(oi + a), z: nav.cz(oj + b) };
  }
  // 道のりの升の数（たどれなければ -1）
  const steps = (x, z) => { const c = local(nav.ci(x), nav.cj(z)); return c < 0 ? -1 : dist[c]; };

  return {
    build, ahead, steps,
    get target() { return target; },
    get builds() { return builds; },
    get cells() { return N; },
    free: (x, z) => free(local(nav.ci(x), nav.cj(z))),
  };
}
