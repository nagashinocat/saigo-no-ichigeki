import * as THREE from 'three';

// 時間切れの結末（ブラックホール）を画面全体で撮るカメラ（純粋な計算）。
// 主人公（黒い球）の向こうに夕日が来る向き（少しだけ右へずらす）から、ビルの上の高さで見下ろす。
// 黒い球は画面の下寄り（heroNdc）、その上に地平線と夕焼けの空、いちばん上に夕日。街・空・夕日・地平線が一枚に入り、
// 重力レンズで順に引き伸ばされて飲まれていくのが見える。夕日が画面に入るまで画角を広げる（maxFov まで）。
export const BH_CAMERA = {
  hero: [0, 1.2, 0],       // 黒い球の中心（主人公の胸のあたり）
  // S8: 広い街では 300 m あたりのビルが高い（街の高さの山が外へ広がった）ので、高さの上限を 170 → 250 m に
  dist: 300, minH: 70, maxH: 250, stepH: 10, clear: 15, above: 8,
  // 夕日を真上からずらす（左右対称にしない）。手前のビルが視線をふさぐなら、次の向き・高さを試す
  yawOffsetsDeg: [10, -10, 18, -18, 26, -26, 4],
  sightTo: 110,             // 視線を確かめる範囲: カメラから、主人公の手前この距離まで（街の中ほどのビルは黒い球に重なってよい）
  sightMargin: 4,
  heroNdc: { portrait: -0.3, landscape: -0.45 }, // 横長は縦が狭いので、黒い球を下げて夕日まで入れる
  sunNdcMax: 0.85,
  portraitHFov: 54, landscapeVFov: 58, maxFov: 100,
};

const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _sun = new THREE.Vector3();

// カメラ（px, h, pz）から主人公の手前 sightTo m までの視線が、どのビルの屋上よりも上を通るか
function sightClear(px, h, pz, buildings, C) {
  const L = Math.hypot(px, pz);
  const n = Math.ceil((L - C.sightTo) / 4);
  for (let i = 0; i <= n; i++) {
    const s = Math.min(1, (i * 4) / L); // カメラからの割合
    if (s > 1 - C.sightTo / L) break;
    const x = px * (1 - s), z = pz * (1 - s), y = h + (C.hero[1] - h) * s;
    for (const b of buildings) {
      if (Math.abs(x - b.x) < b.w / 2 + 2 && Math.abs(z - b.z) < b.d / 2 + 2 && b.h + C.sightMargin > y) return false;
    }
  }
  return true;
}

// 夕日の向きから少しずらした向きごとに、カメラの近くのビルより上で、視線が手前のビルにふさがれない一番低い高さを探す
function placeCamera(sunDir, buildings, C) {
  const base = Math.atan2(sunDir.x, -sunDir.z);
  let fallback = null;
  for (const off of C.yawOffsetsDeg) {
    const yaw = base + THREE.MathUtils.degToRad(off);
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const px = -fx * C.dist, pz = -fz * C.dist;
    let h0 = C.minH;
    for (const b of buildings) {
      if (Math.abs(px - b.x) < b.w / 2 + C.clear && Math.abs(pz - b.z) < b.d / 2 + C.clear) h0 = Math.max(h0, b.h + C.above);
    }
    for (let h = h0; h <= C.maxH; h += C.stepH) {
      if (sightClear(px, h, pz, buildings, C)) return { fx, fz, px, pz, h };
    }
    fallback ??= { fx, fz, px, pz, h: Math.max(h0, C.maxH) };
  }
  return fallback;
}

export function planBlackholeCamera({ aspect, sunDir, buildings = [] }, C = BH_CAMERA) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  // 主人公から見てカメラは夕日と反対の側（カメラ → 主人公の向きが夕日の向き）
  const { fx, fz, px, pz, h } = placeCamera(sunDir, buildings, C);
  _pos.set(px, h, pz);
  const heroElev = Math.atan2(C.hero[1] - h, C.dist);
  const heroNdc = a < 1 ? C.heroNdc.portrait : C.heroNdc.landscape;
  const base = a < 1
    ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(C.portraitHFov / 2)) / a))
    : C.landscapeVFov;
  const cam = new THREE.PerspectiveCamera(base, a, 1, 6000);
  let fov = Math.min(C.maxFov, base), look = null;
  for (; ; fov = Math.min(C.maxFov, fov + 2)) {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    // 主人公が画面の高さ heroNdc に来る見上げの角度
    const pitch = heroElev + Math.atan(-heroNdc * tanHalf);
    _look.set(px + fx * Math.cos(pitch) * 100, h + Math.sin(pitch) * 100, pz + fz * Math.cos(pitch) * 100);
    cam.fov = fov; cam.updateProjectionMatrix();
    cam.position.copy(_pos); cam.lookAt(_look); cam.updateMatrixWorld();
    _sun.copy(sunDir).multiplyScalar(3000).add(_pos).project(cam);
    look = _look.toArray();
    if ((_sun.y < C.sunNdcMax && Math.abs(_sun.x) < 0.8) || fov >= C.maxFov) break;
  }
  return { pos: _pos.toArray(), look, fov };
}
