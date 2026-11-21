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


// 指を組む（持ち主 18:27）: 指の並びの向き（右手の人差し指の付け根 → 小指の付け根）に 8 本の指先を並べたとき、左右が交互になる回数
// alternations（7 で完全に交互）、右手の指先の群れと左手の指先の群れの、指の面に直角な向きのずれ depthGap（手の大きさに対する割合。
// 0 に近いほど同じ面で組んでいる）、どちらかの手の指先がもう一方の手の付け根を越えて届いているか reach
const KNUCKLES = ['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal'];
export function interlace(m) {
  const wp = (s, n) => m[s].bones[n].getWorldPosition(new THREE.Vector3());
  const ax = wp('right', KNUCKLES[3]).sub(wp('right', KNUCKLES[0])).normalize();
  const tips = [];
  for (const s of ['right', 'left']) for (const n of FINGER_TIPS) tips.push({ s, c: wp(s, n).dot(ax) });
  tips.sort((a, b) => a.c - b.c);
  let alternations = 0;
  for (let k = 1; k < tips.length; k++) if (tips[k].s !== tips[k - 1].s) alternations++;
  const dir = wp('right', 'middle-finger-tip').sub(wp('right', KNUCKLES[1])).normalize();
  const nrm = new THREE.Vector3().crossVectors(ax, dir).normalize();
  const mean = (s) => FINGER_TIPS.reduce((a, n) => a + wp(s, n).dot(nrm), 0) / 4;
  const size = wp('right', 'middle-finger-tip').distanceTo(wp('right', 'wrist'));
  const reach = Math.min(...FINGER_TIPS.map((n) => wp('right', n).x)) < Math.max(...KNUCKLES.map((n) => wp('left', n).x))
    || Math.max(...FINGER_TIPS.map((n) => wp('left', n).x)) > Math.min(...KNUCKLES.map((n) => wp('right', n).x));
  return { alternations, depthGap: (mean('right') - mean('left')) / size, reach };
}

// 光る窓（S6 fix2）: 両手に囲まれた、手の映らない所（球の光が見える窓）の形。球のまわりの画面を格子で調べ、手に当たらない点のうち
// 左右と上下のどれにも手がある点を「囲まれた窓」とする。下の縁が尖る（V）かを、窓の下 2 割の幅と、上 2 割・真ん中の広い方の幅の比で測る。
// 窓がない（4 点未満）なら ratio = 1
export function litWindow(view, m, N = 36) {
  const cam = view.camera, { center } = view.orbSphere;
  const meshes = [];
  for (const s of ['right', 'left']) m[s].root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  view.scene.updateMatrixWorld(true);
  const c = center.clone().project(cam);
  const e = center.clone().add(new THREE.Vector3(0.39, 0, 0).applyQuaternion(cam.quaternion)).project(cam); // 構えの球の 3 倍ほどの広さ
  const rN = Math.hypot(e.x - c.x, e.y - c.y);
  const rc = new THREE.Raycaster(), hit = [];
  for (let i = 0; i < N; i++) {
    hit.push([]);
    for (let j = 0; j < N; j++) {
      rc.setFromCamera(new THREE.Vector2(c.x + rN * ((i + 0.5) / N * 2 - 1), c.y + rN * cam.aspect * ((j + 0.5) / N * 2 - 1)), cam);
      hit[i].push(rc.intersectObjects(meshes, false).length > 0);
    }
  }
  const win = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (hit[i][j]) continue;
    let l = false, r = false, u = false, d = false;
    for (let k = 0; k < i; k++) l ||= hit[k][j];
    for (let k = i + 1; k < N; k++) r ||= hit[k][j];
    for (let k = 0; k < j; k++) d ||= hit[i][k];
    for (let k = j + 1; k < N; k++) u ||= hit[i][k];
    if (l && r && u && d) win.push({ i, j });
  }
  if (win.length < 4) return { n: win.length, ratio: 1 };
  const js = win.map((p) => p.j), j0 = Math.min(...js), j1 = Math.max(...js), H = j1 - j0 + 1;
  const span = (a, b) => { const is = win.filter((p) => p.j >= a && p.j <= b).map((p) => p.i); return is.length ? Math.max(...is) - Math.min(...is) + 1 : 0; };
  const bottom = span(j0, j0 + Math.floor(0.2 * H));
  const top = Math.max(span(j1 - Math.floor(0.2 * H), j1), span(j0 + Math.floor(0.4 * H), j0 + Math.floor(0.6 * H)));
  return { n: win.length, bottom, top, ratio: bottom / Math.max(1, top) };
}
