import * as THREE from 'three';

// 人の姿（軍勢・浮遊バイク・主人公）を組み立てる小さな道具。部位ごとに番号（aPart）・回す付け根（aPivot）・色（aCol）を付ける。
// 部位の番号: 0 胴, 1 頭, 2 左腕, 3 右腕, 4 脚（座った形で動かない）, 6 目, 7 バイクの車体, 8 推進の光。10 以上は動かない（主人公）

export const srgb = (hex) => new THREE.Color(hex).convertSRGBToLinear();

export function part(geo, id, pivot, color) {
  const g = geo;
  const n = g.attributes.position.count;
  const c = srgb(color);
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
  const pv = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pv.set(pivot, i * 3); col.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
export const at = (geo, x, y, z) => geo.translate(x, y, z);
export const capsule = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 3, seg);
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const ball = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
