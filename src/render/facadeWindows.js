import { FACADE } from './style.js';

// ビルの一つの壁の窓の位置と大きさ。style.js のビルのシェーダー（buildingFragment）と同じ計算で、
// 描かれている窓の格子にぴったり重なる（演出で、その窓のガラスを砕き、光を通すため）。
// b: { x, z, w, d, h, kind }、normal: 壁の外向き [nx, 0, nz]（軸に沿った単位ベクトル）
// 戻り値: [{ center: [x,y,z], w, h, row, col }]（下の階から）

const fract = (x) => x - Math.floor(x);
// GLSL の hash12 と同じ
export function hash12(px, py) {
  let x = fract(px * 0.1031), y = fract(py * 0.1031), z = fract(px * 0.1031);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

export function facadeWindows(b, normal) {
  const p = FACADE[b.kind] ?? FACADE.office;
  const seed = hash12(b.x * 0.137 + 3.1, b.z * 0.137 + 3.1);
  const sA = fract(seed * 7.13), sB = fract(seed * 3.71), sC = fract(seed * 5.19);
  const bay = p.bay * (0.8 + (1.35 - 0.8) * sA);
  const wx = Math.min(0.92, Math.max(0.28, p.wx + (sB - 0.5) * 0.28));
  const wy = Math.min(0.9, Math.max(0.3, p.wy + (sC - 0.5) * 0.3));
  const alongX = Math.abs(normal[0]) > 0.5;
  const faceW = alongX ? b.d : b.w;
  const usable = faceW - 2 * p.corner;
  const nb = Math.max(1, Math.floor(usable / bay));
  const cell = usable / nb;
  const nf = Math.max(0, Math.floor((b.h - p.top - p.ground) / p.floor));
  const out = [];
  for (let j = 0; j < nf; j++) {
    for (let k = 0; k < nb; k++) {
      const u = (k + 0.5) * cell + p.corner - faceW / 2; // 壁の横の位置（シェーダーの fu.x）
      const y = p.ground + (j + 0.42) * p.floor;
      let x, z;
      if (alongX) { x = b.x + Math.sign(normal[0]) * b.w / 2; z = b.z + u * Math.sign(normal[0]); }
      else { x = b.x - u * Math.sign(normal[2]); z = b.z + Math.sign(normal[2]) * b.d / 2; }
      out.push({ center: [x, y, z], w: wx * cell, h: wy * p.floor, row: j, col: k });
    }
  }
  return out;
}
