import * as THREE from 'three';
import { CONFIG } from '../config.js';

// 持ち主 2026-11-24「無敵は短く、払うを強く」: 払った瞬間の衝撃波（game の puff.shock）を見せる。地面に太い光の帯が、払うの前線の大きさ
// （puff.radius × from）から衝撃波の半径（puff.shock.radius）まで sec 秒で一気に広がり（ease-out）、薄れて消える。
// 網は 1 つ（加算、深さは書かない、光源なし）。守りの輪（guardRing.js）とは別（こちらは一瞬）
export const SHOCK_RING = { sec: 0.5, from: 1, width: 6, endWidth: 2, alpha: 1, pow: 3, y: 0.5 };

// 見た目（描かずに決める）。t: 払ってからの秒、radius: 衝撃波の半径
export function shockRingLook(t, radius, R = SHOCK_RING, cfg = CONFIG) {
  if (!(t >= 0) || t > R.sec) return { visible: false, radius: 0, width: 0, alpha: 0 };
  const u = t / R.sec, e = 1 - (1 - u) ** R.pow;
  const r0 = cfg.puff.radius * R.from;
  return { visible: true, radius: r0 + (radius - r0) * e, width: R.width + (R.endWidth - R.width) * u, alpha: R.alpha * (1 - u) ** 2 };
}

export function createShockRing(scene, R = SHOCK_RING) {
  // 帯（内と外の半径 m）。見せるのは払ってから sec 秒だけ（1 回のゲームで 3 回）なので、毎フレーム作り直す
  const band = (r, w) => { const g = new THREE.RingGeometry(Math.max(0.1, r - w / 2), r + w / 2, 96, 1); g.rotateX(-Math.PI / 2); return g; };
  let geo = band(1, 0.1);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.86, 0.55), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  scene.add(mesh);
  let t = Infinity, radius = 0;
  return {
    mesh,
    // 払った所（{ x, z }）と衝撃波の半径
    begin(at, r) { t = 0; radius = r; mesh.position.set(at.x, R.y, at.z); },
    reset() { t = Infinity; mesh.visible = false; },
    update(dt) {
      if (t === Infinity) { mesh.visible = false; return null; }
      t += dt;
      const L = shockRingLook(t, radius, R);
      mesh.visible = L.visible;
      if (!L.visible) { t = Infinity; return L; }
      mat.opacity = L.alpha;
      geo.dispose();
      geo = mesh.geometry = band(L.radius, L.width);
      return L;
    },
  };
}
