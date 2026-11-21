import * as THREE from 'three';
import { GRID } from '../world/cityGen.js';

// リプレイの「どこから撮るか」を決める純粋な関数（描画は知らない）。放つ直前の街（壊れていないビル）から決める。
//   street: 爆心へまっすぐ向かう通りの真ん中、両側のビルが高いところ（見上げると、谷底から光の壁が来る）
//   side:   street と違う向きの、前線に沿って走るカメラの高さ（屋根より上、でもなるべく低く）
//   top:    真上のカメラの回り始めの向き
//   hero:   主人公を斜め前から見上げる向き
export const REPLAY_PLAN = {
  streetFrac: 0.4, streetMin: 40, streetMax: 170,
  eye: 1.7,             // m。通りのカメラの高さ（人の目）
  flankAlong: 45,       // 通りに沿ってこの範囲のビルの高さで、谷の深さを測る
  flankAcross: 30,
  sideOffsets: [1.0, -1.0, 1.4, -1.4, 1.8, -1.8],
  sideMinH: 34,         // 前線に沿うカメラの最低の高さ
  sideAbove: 14,        // 屋根からこれだけ上
  sideClear: 26,        // 道の左右この距離のビルの屋根を見る
  heroAz: 1.15,         // 主人公の向きからこれだけ回った向き（ほぼ横顔。影の輪郭が読める）
};

const roadCenter = GRID.PITCH / 2; // 原点に一番近い道路の真ん中（格子の区画の中心は PITCH の倍数）

// 原点からの向き az（x = cos, z = sin）の、半径 r の点
const polar = (r, az) => [Math.cos(az) * r, Math.sin(az) * r];

export function planReplay({ radius, buildings, heroYaw = 0 }, P = REPLAY_PLAN) {
  // ---- street ----
  const want = Math.min(P.streetMax, Math.max(P.streetMin, P.streetFrac * radius));
  // 区画の真ん中の高さ（交差点を避ける）
  const along = Math.max(GRID.PITCH, Math.round(want / GRID.PITCH) * GRID.PITCH);
  let street = null;
  for (const axis of ['x', 'z']) {
    for (const sign of [1, -1]) {
      for (const off of [roadCenter, -roadCenter]) {
        const pos = axis === 'x' ? [sign * along, P.eye, off] : [off, P.eye, sign * along];
        const dir = axis === 'x' ? [-sign, 0] : [0, -sign]; // 爆心の方
        let depth = 0, blocked = false;
        for (const b of buildings) {
          const a = axis === 'x' ? b.x * sign : b.z * sign, c = axis === 'x' ? b.z : b.x;
          if (Math.abs(pos[0] - b.x) < b.w / 2 + 1.5 && Math.abs(pos[2] - b.z) < b.d / 2 + 1.5) blocked = true;
          if (Math.abs(a - along) < P.flankAlong && Math.abs(c - off) < P.flankAcross && a < along + 10) depth += b.h;
        }
        if (blocked) continue;
        if (!street || depth > street.depth) street = { pos, dir, depth, dist: Math.hypot(pos[0], pos[2]), az: Math.atan2(pos[2], pos[0]) };
      }
    }
  }
  // ---- side ----
  const r0 = Math.max(10, Math.min(radius * 0.8, street.dist - 3)), r1 = radius * 1.05 + 40;
  let side = null;
  for (const o of P.sideOffsets) {
    const az = street.az + o;
    let top = 0;
    for (const b of buildings) {
      const r = Math.hypot(b.x, b.z);
      if (r < r0 - 20 || r > r1 + 20) continue;
      // 道（半径方向の線）からの横の距離
      const [ux, uz] = polar(1, az);
      const t = b.x * ux + b.z * uz, across = Math.abs(-b.x * uz + b.z * ux);
      if (t > 0 && across < P.sideClear + Math.max(b.w, b.d) / 2) top = Math.max(top, b.h);
    }
    const height = Math.max(P.sideMinH, top + P.sideAbove);
    if (!side || height < side.height - 1e-6) side = { az, height, look: o > 0 ? 1 : -1 };
  }
  return {
    street,
    side,
    top: { az: street.az + Math.PI / 2 },
    hero: { az: heroYaw + P.heroAz },
  };
}

// S9（撃退失敗のとき、生き残った軍勢の光が爆発のあとの街に残って見える）: 生き残りを見せる引きの絵。
// 爆心と生き残り全員（たいてい街の外側の見回る者）を斜め上から見下ろす。fix1: 結果画面では見出しが上に、ボタンが下に
// 乗るので、全員をその間の帯（画面の縦 fitBot〜fitTop、NDC）に収める（爆心は真ん中より下になる）。
// 帯に収まる距離まで決まった刻みで引き、その距離で、カメラを縦に傾けて点の縦の広がりを帯の真ん中へ合わせる
// （x 軸まわりの回転は、カメラから見た縦の角度をそのままずらすので、帯に合うかは角度の幅だけで決まる）。
// survivors: [{ x, z }]、aspect: 画面の縦横比、az: 見る向き（爆心から見たカメラの方角）、radius: 一発の半径（省けば穴は見ない）。
// 戻り値 { pos, look, fov }
// 持ち主 23:01（全体を撮るカメラはもう少し引く）: 生き残りに加えて、爆発の穴の縁（半径 radius の輪を ring 倍）も帯に収め、
// 横の余白を広げた（fitX 0.84 → 0.74）
export const AFTERMATH = { elev: 0.98, fov: { portrait: 58, landscape: 40 }, fitX: 0.74, fitTop: 0.26, fitBot: -0.52, minDist: 320, maxDist: 7600, ring: 1.08, ringN: 12 };
const _cam = new THREE.PerspectiveCamera(), _v = new THREE.Vector3(), _l = new THREE.Vector3(), _f = new THREE.Vector3();
export function aftermathView({ survivors, aspect, az = 0, radius = 0 }, A = AFTERMATH) {
  const rim = radius > 0 ? Array.from({ length: A.ringN }, (_, k) => ({ x: Math.cos(k / A.ringN * 2 * Math.PI) * radius * A.ring, z: Math.sin(k / A.ringN * 2 * Math.PI) * radius * A.ring })) : [];
  let x0 = 0, x1 = 0, z0 = 0, z1 = 0;
  for (const s of [...survivors, ...rim]) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
  const c = [(x0 + x1) / 2, 0, (z0 + z1) / 2];
  const fov = aspect < 1 ? A.fov.portrait : A.fov.landscape;
  const dir = [Math.cos(A.elev) * Math.cos(az), Math.sin(A.elev), Math.cos(A.elev) * Math.sin(az)];
  _cam.fov = fov; _cam.aspect = aspect; _cam.near = 1; _cam.far = 9000; _cam.updateProjectionMatrix();
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const aTop = Math.atan(A.fitTop * tanV), aBot = Math.atan(A.fitBot * tanV);
  _l.fromArray(c);
  const pts = [{ x: 0, z: 0 }, ...survivors, ...rim];
  const fits = () => {
    for (const s of pts) {
      _v.set(s.x, 3, s.z).project(_cam);
      if (Math.abs(_v.x) > A.fitX || _v.y > A.fitTop + 1e-3 || _v.y < A.fitBot - 1e-3) return false;
    }
    return true;
  };
  let D = A.minDist;
  for (; ; D *= 1.04) {
    const last = D * 1.04 >= A.maxDist;
    if (last) D = A.maxDist;
    _cam.position.set(c[0] + dir[0] * D, c[1] + dir[1] * D, c[2] + dir[2] * D);
    _cam.up.set(0, 1, 0);
    _cam.lookAt(_l);
    _cam.updateMatrixWorld();
    let lo = Infinity, hi = -Infinity;
    for (const s of pts) {
      _v.set(s.x, 3, s.z).applyMatrix4(_cam.matrixWorldInverse);
      const a = Math.atan2(_v.y, -_v.z);
      lo = Math.min(lo, a); hi = Math.max(hi, a);
    }
    if (hi - lo <= aTop - aBot || last) {
      _cam.rotateX((hi + lo) / 2 - (aTop + aBot) / 2); // 縦の広がりの真ん中を帯の真ん中へ
      _cam.updateMatrixWorld();
      if (fits() || last) break;
    }
  }
  _cam.getWorldDirection(_f);
  const p = _cam.position;
  return { pos: [p.x, p.y, p.z], look: [p.x + _f.x * D, p.y + _f.y * D, p.z + _f.z * D], fov };
}
