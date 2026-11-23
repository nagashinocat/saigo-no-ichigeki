import * as THREE from 'three';

// Fix round 1（見直し Important 5「払うの守りが遊ぶ人に見えない」）: 払ったあとの守り（game.guardLeft）の間、主人公のまわりの地面に
// 薄い輪（ゆらめく盾）を出す。残りが減るほど薄く、弾いた瞬間（guardHit）は太く明るく脈打つ。網は 1 つ（加算、深さは書かない、光源なし）
export const GUARD_RING = { radius: 3.4, width: 0.35, alpha: 0.55, minAlpha: 0.12, hitSec: 0.25, hitWiden: 1.25, hitBright: 0.45, shimmerHz: 7, shimmer: 0.12, y: 0.45 };

// 見た目（描かずに決める）。left: 守りの残り秒、total: 守りの長さ、sinceHit: 最後に弾いてからの秒、t: 時刻
export function guardRingLook({ left, total, sinceHit = Infinity, t = 0 }, R = GUARD_RING) {
  if (!(left > 0)) return { visible: false, alpha: 0, radius: R.radius, width: R.width };
  const k = Math.min(1, left / Math.max(1e-6, total));
  const hit = sinceHit < R.hitSec ? 1 - sinceHit / R.hitSec : 0;
  const shimmer = 1 + R.shimmer * Math.sin(t * Math.PI * 2 * R.shimmerHz);
  const alpha = Math.min(1, (R.minAlpha + (R.alpha - R.minAlpha) * k) * shimmer + R.hitBright * hit);
  return { visible: true, alpha, radius: R.radius * (1 + (R.hitWiden - 1) * hit), width: R.width * (1 + hit) };
}

export function createGuardRing(scene, R = GUARD_RING) {
  const geo = new THREE.RingGeometry(0.94, 1.06, 72, 1); // 半径 1 の細い帯（radius 倍に広げる）
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.95, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.renderOrder = 5;
  scene.add(mesh);
  let sinceHit = Infinity, t = 0;
  return {
    mesh,
    hit() { sinceHit = 0; },
    reset() { sinceHit = Infinity; mesh.visible = false; },
    // hero: { x, z }、left / total: 守りの残りと長さ
    update(dt, hero, left, total) {
      t += dt; sinceHit += dt;
      const L = guardRingLook({ left, total, sinceHit, t }, R);
      mesh.visible = L.visible;
      if (!L.visible) return L;
      mat.opacity = L.alpha;
      mesh.scale.set(L.radius, 1, L.radius);
      mesh.position.set(hero.x, R.y, hero.z);
      geo.boundingSphere = null;
      return L;
    },
  };
}
