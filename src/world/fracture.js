import { createRng } from '../rng.js';

const vol = (c) => (c.max[0] - c.min[0]) * (c.max[1] - c.min[1]) * (c.max[2] - c.min[2]);

// 箱を pieces 個に割る。一番大きい箱の最も長い軸を 30〜70% の位置で割る。
// 座標はビルのローカル（底面中心が原点）。
export function fractureBox({ w, h, d }, pieces, seed) {
  const rng = createRng(seed);
  const chunks = [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] }];
  while (chunks.length < pieces) {
    let bi = 0;
    for (let i = 1; i < chunks.length; i++) if (vol(chunks[i]) > vol(chunks[bi])) bi = i;
    const c = chunks[bi];
    let axis = 0;
    for (let a = 1; a < 3; a++) if (c.max[a] - c.min[a] > c.max[axis] - c.min[axis]) axis = a;
    const at = c.min[axis] + (c.max[axis] - c.min[axis]) * (0.3 + 0.4 * rng());
    const lo = { min: [...c.min], max: [...c.max] };
    const hi = { min: [...c.min], max: [...c.max] };
    lo.max[axis] = at;
    hi.min[axis] = at;
    chunks.splice(bi, 1, lo, hi);
  }
  return chunks;
}
