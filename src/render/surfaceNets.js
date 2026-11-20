// 距離の場（内側が負）から、その 0 の面を三角形の網にする（Surface Nets）。
// 格子は軸ごとの座標の配列で、間隔をそろえなくてよい（腕のようにまっすぐ伸びる所は粗くできる）。
// 返す面は外向き（反時計回り）。頂点は各セルの中の、辺と面の交点の平均に置く。

// 速さのため、まず B 点おきの粗い格子で場を測り、角の値がどれも面から十分遠い（|値| > L × 対角線）
// 塊は、中を測らずに角の値の符号で埋める（L: 場の傾きの上限）。
export function surfaceNets(field, xs, ys, zs, { lipschitz = 1.6, block = 4 } = {}) {
  const nx = xs.length, ny = ys.length, nz = zs.length;
  const F = new Float32Array(nx * ny * nz).fill(NaN);
  const at = (i, j, k) => i + nx * (j + ny * k);
  const val = (i, j, k) => { const g = at(i, j, k); if (Number.isNaN(F[g])) F[g] = field(xs[i], ys[j], zs[k]); return F[g]; };
  const B = block;
  for (let k0 = 0; k0 < nz - 1; k0 += B) for (let j0 = 0; j0 < ny - 1; j0 += B) for (let i0 = 0; i0 < nx - 1; i0 += B) {
    const i1 = Math.min(i0 + B, nx - 1), j1 = Math.min(j0 + B, ny - 1), k1 = Math.min(k0 + B, nz - 1);
    const diag = Math.sqrt((xs[i1] - xs[i0]) ** 2 + (ys[j1] - ys[j0]) ** 2 + (zs[k1] - zs[k0]) ** 2);
    // 塊のどの点も、どれかの角から対角線以内。その角の値が L × 対角線より遠ければ、その点も同じ側で面から離れている
    let far = true, sign = 0;
    for (let c = 0; c < 8 && far; c++) {
      const v = val(c & 1 ? i1 : i0, c & 2 ? j1 : j0, c & 4 ? k1 : k0);
      const s = v < 0 ? -1 : 1;
      if (Math.abs(v) <= lipschitz * diag * 1.05 || (sign && s !== sign)) far = false;
      sign = s;
    }
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const g = at(i, j, k);
      if (Number.isNaN(F[g])) F[g] = far ? sign * lipschitz * diag : field(xs[i], ys[j], zs[k]);
    }
  }

  const cx = nx - 1, cy = ny - 1;
  const cellAt = (i, j, k) => i + cx * (j + cy * k);
  const cellVert = new Int32Array(cx * cy * (nz - 1)).fill(-1);
  const pos = [];
  // セルの 12 本の辺（角の番号の組）。角の番号は bit0=x, bit1=y, bit2=z
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8), cp = new Float32Array(24);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const ii = i + (c & 1), jj = j + ((c >> 1) & 1), kk = k + ((c >> 2) & 1);
      v[c] = F[at(ii, jj, kk)];
      cp[c * 3] = xs[ii]; cp[c * 3 + 1] = ys[jj]; cp[c * 3 + 2] = zs[kk];
      if (v[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += cp[a * 3] + (cp[b * 3] - cp[a * 3]) * t;
      sy += cp[a * 3 + 1] + (cp[b * 3 + 1] - cp[a * 3 + 1]) * t;
      sz += cp[a * 3 + 2] + (cp[b * 3 + 2] - cp[a * 3 + 2]) * t;
      n++;
    }
    cellVert[cellAt(i, j, k)] = pos.length / 3;
    pos.push(sx / n, sy / n, sz / n);
  }

  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    // 短いほうの対角線で割る
    const d2 = (p, q) => (pos[p * 3] - pos[q * 3]) ** 2 + (pos[p * 3 + 1] - pos[q * 3 + 1]) ** 2 + (pos[p * 3 + 2] - pos[q * 3 + 2]) ** 2;
    if (d2(a, c) <= d2(b, d)) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  const cv = (i, j, k) => cellVert[cellAt(i, j, k)];
  // 符号の変わる格子の辺ごとに、その辺を囲む 4 つのセルの頂点で四角形を張る。
  // 内側が辺の手前の端なら、面は辺の向き（+x / +y / +z）を向く
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const inside = F[at(i, j, k)] < 0;
    const yIn = j >= 1 && j <= ny - 2, zIn = k >= 1 && k <= nz - 2, xIn = i >= 1 && i <= nx - 2;
    if (i < nx - 1 && yIn && zIn && inside !== (F[at(i + 1, j, k)] < 0))
      quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !inside);
    if (j < ny - 1 && xIn && zIn && inside !== (F[at(i, j + 1, k)] < 0))
      quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !inside);
    if (k < nz - 1 && xIn && yIn && inside !== (F[at(i, j, k + 1)] < 0))
      quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !inside);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
