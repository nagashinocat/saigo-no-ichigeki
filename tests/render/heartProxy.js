import * as THREE from 'three';

// ハートに見えないかの画面での代わりの測り方（S10 / S6 fix1。tests/render/handView.test.js と introHands.test.js が使う）
const FINGER_TIPS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
// overlap: 左右の指先の群れの横の重なり（手の幅に対する割合。正で交差）、near: 左右の指先どうしの一番近い距離（手の幅に対する割合、
// 画面の縦横をそろえて）、apex: 上 15% の帯の幅（手の幅に対する割合）、thumb: 親指の先の付け根の節からの高さ（手の高さに対する割合）、
// shape: 縦横の比（画面の縦横をそろえて。S10 の 390:295 の画面で 1.25 ≒ 0.95）
export function heartFrames(m, view, aspect, joints) {
  const sp = (s, n) => m[s].bones[n].getWorldPosition(new THREE.Vector3()).project(view.camera);
  const pts = [];
  for (const s of ['right', 'left']) for (const n of joints) if (n !== 'wrist') pts.push(sp(s, n));
  const ys = pts.map((p) => p.y), xs = pts.map((p) => p.x);
  const H = Math.max(...ys) - Math.min(...ys), W = Math.max(...xs) - Math.min(...xs);
  const R = FINGER_TIPS.map((n) => sp('right', n)), L = FINGER_TIPS.map((n) => sp('left', n));
  const overlap = (Math.max(...L.map((p) => p.x)) - Math.min(...R.map((p) => p.x))) / W;
  let near = Infinity;
  for (const a of R) for (const b of L) near = Math.min(near, Math.hypot(a.x - b.x, (a.y - b.y) / aspect) / W); // 画面の縦横をそろえて
  const top = Math.max(...ys);
  const band = xs.filter((x, i) => ys[i] > top - 0.15 * H);
  const apex = (Math.max(...band) - Math.min(...band)) / W;
  const thumb = Math.max(...['right', 'left'].map((s) => (sp(s, 'thumb-tip').y - sp(s, 'thumb-phalanx-proximal').y) / H));
  return { overlap, near, apex, thumb, H, W, shape: (H / W) / aspect };
}

