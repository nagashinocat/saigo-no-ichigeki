import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { part, at, capsule, box, ball } from './figureGeo.js';

// 軍勢の一人と、その浮遊バイク（1つの形。+z が前、バイクの底が y=0）。
// バイク: 低く平たい六角の車体。鼻先と尾の先に水平の輪があり、輪の中の円板が推進の光（淡い緑）で光る。
// 車体の両脇に細い光の線、尾に外へ開く小さな安定板。座席は細い柱の上の鞍で、短い柱の先に横一本の握り。
// 乗り手: 揃いの暗い装備、ヘルメットと覆面で顔はほぼ隠れ、目の部分だけ開いている。膝をついて前へかがむ騎手の姿勢。
// 乗り手の上半身・腕は頂点シェーダーで RIDER の付け根まわりに回す（前へかがむ・右手を伸ばす）。

export const RIDER = {
  hip: [0, 0.78, -0.3],  // 上半身を傾ける付け根
  lean: 0.45,            // 走るときの前かがみ（rad）
  armRide: -0.69,        // 握りへ伸ばす腕の角度（rad、前へ）
};

export const SUIT = '#2c3133', PLATE = '#3b4240', DARK = '#191c1f', HELM = '#30363c', BOOT = '#141617';
export const HULL = '#8e9389', DECK = '#b5b8ab', BELLY = '#23272a', HOUSING = '#2a2f31', GLOW = '#ffffff';

// focus: 演出で大きく映る一人のバイク（riderBody.js）。ここでは輪と推進の光だけを返し（尾の輪は細かく丸く、脇の光の線は丸い棒）、
// 車体・座席・安定板・握り・足の板は riderBody.js が距離の場と丸い形で組み直す
export function bikeParts({ focus = false } = {}) {
  const B = (g) => part(g, 7, [0, 0, 0], HULL);
  const hex = (sx, h, sz) => new THREE.CylinderGeometry(1, 1, h, 6).scale(sx, 1, sz);
  const ring = (r, tube) => new THREE.TorusGeometry(r, tube, 4, 14).rotateX(Math.PI / 2);
  // 光る円板: 上向きと下向きの円（側面は輪の外枠に隠れる）
  const disc = (r) => mergeGeometries([
    new THREE.CircleGeometry(r, 12).rotateX(-Math.PI / 2).translate(0, 0.015, 0),
    new THREE.CircleGeometry(r, 12).rotateX(Math.PI / 2).translate(0, -0.015, 0),
  ]);
  const glow = (g) => part(g, 8, [0, 0, 0], GLOW);
  const rings = [
    // 鼻先と尾の輪（外枠）と、その中の光る円板
    part(at(focus ? new THREE.TorusGeometry(0.22, 0.045, 10, 28).rotateX(Math.PI / 2) : ring(0.22, 0.045), 0, 0.3, 1.2), 7, [0, 0, 0], HOUSING),
    part(at(focus ? new THREE.TorusGeometry(0.3, 0.055, 12, 36).rotateX(Math.PI / 2) : ring(0.3, 0.055), 0, 0.3, -1.32), 7, [0, 0, 0], HOUSING),
    glow(at(disc(0.19), 0, 0.3, 1.2)),
    glow(at(disc(0.26), 0, 0.3, -1.32)),
  ];
  if (focus) {
    // 両脇の細い光の線（丸い棒）
    const line = (x) => glow(at(new THREE.CapsuleGeometry(0.016, 0.88, 3, 8).rotateX(Math.PI / 2), x, 0.3, 0));
    return [...rings, line(0.335), line(-0.335)];
  }
  return [
    B(at(hex(0.38, 0.26, 1.05), 0, 0.3, 0)),
    part(at(hex(0.3, 0.12, 0.85), 0, 0.12, 0), 7, [0, 0, 0], BELLY),
    part(at(hex(0.27, 0.04, 0.74), 0, 0.45, 0.05), 7, [0, 0, 0], DECK),
    ...rings,
    part(at(box(0.1, 0.06, 0.3), 0, 0.3, 1.0), 7, [0, 0, 0], HOUSING), // 輪をつなぐ腕
    part(at(box(0.12, 0.07, 0.36), 0, 0.3, -1.05), 7, [0, 0, 0], HOUSING),
    // 両脇の細い光の線
    glow(at(box(0.02, 0.03, 0.9), 0.335, 0.3, 0)),
    glow(at(box(0.02, 0.03, 0.9), -0.335, 0.3, 0)),
    // 尾の安定板（外へ開く）
    B(at(box(0.03, 0.24, 0.36).rotateZ(-0.45), 0.25, 0.5, -0.82)),
    B(at(box(0.03, 0.24, 0.36).rotateZ(0.45), -0.25, 0.5, -0.82)),
    // 座席: 柱の上の鞍
    part(at(box(0.16, 0.26, 0.3), 0, 0.56, -0.32), 7, [0, 0, 0], HOUSING),
    part(at(box(0.3, 0.1, 0.5), 0, 0.71, -0.32), 7, [0, 0, 0], BELLY),
    // 握り: 短い柱と横一本の棒
    part(at(box(0.07, 0.56, 0.07).rotateX(-0.25), 0, 0.72, 0.48), 7, [0, 0, 0], HOUSING),
    part(at(box(0.62, 0.05, 0.06), 0, 0.98, 0.42), 7, [0, 0, 0], BELLY),
    // 足を載せる板
    B(at(box(0.14, 0.04, 0.28), 0.27, 0.38, 0.08)),
    B(at(box(0.14, 0.04, 0.28), -0.27, 0.38, 0.08)),
  ];
}

function riderParts() {
  const [hx, hy, hz] = RIDER.hip;
  const dy = hy - 0.95, dz = hz; // 立った兵士の腰（0.95）から、鞍の上の腰へ
  const up = (geo, id, pivot, color) => part(at(geo, 0, dy, dz), id, [pivot[0] + hx, pivot[1] + dy, pivot[2] + dz], color);
  const neck = [0, 1.5, 0], hip = [0, 0.95, 0];
  const thigh = (x) => capsule(0.085, 0.34, 6).rotateX(Math.PI / 2 + 0.12).translate(x, hy - 0.04, hz + 0.24);
  const shin = (x) => capsule(0.08, 0.24, 6).rotateX(0.15).translate(x, 0.56, 0.12);
  return [
    // 胴: 上着・胸の板・背の箱・腰のベルト・肩の板
    up(at(capsule(0.17, 0.36), 0, 1.2, 0).scale(1.25, 1, 0.8), 0, hip, SUIT),
    up(at(box(0.4, 0.3, 0.12), 0, 1.3, 0.1), 0, hip, PLATE),
    up(at(box(0.32, 0.36, 0.16), 0, 1.25, -0.18), 0, hip, DARK),
    up(at(box(0.42, 0.07, 0.3), 0, 0.98, 0), 0, hip, DARK),
    up(at(box(0.16, 0.08, 0.28), 0.22, 1.42, 0), 0, hip, PLATE),
    up(at(box(0.16, 0.08, 0.28), -0.22, 1.42, 0), 0, hip, PLATE),
    // 頭: 覆面の頭とヘルメット（前のつばが目の上にかぶさる）
    up(at(ball(0.115).scale(1, 1.15, 1.05), 0, 1.63, 0), 1, neck, DARK),
    up(at(ball(0.135, 14, 8).scale(1.05, 0.8, 1.12), 0, 1.7, -0.01), 1, neck, HELM),
    up(at(box(0.25, 0.035, 0.08), 0, 1.675, 0.1), 1, neck, HELM),
    // 目（覆面の細い開きから見える）
    up(at(box(0.04, 0.016, 0.02), 0.04, 1.648, 0.118), 6, neck, '#ffffff'),
    up(at(box(0.04, 0.016, 0.02), -0.04, 1.648, 0.118), 6, neck, '#ffffff'),
    // 腕（肩から下へ）と手袋。2 が左（+x）、3 が右（-x）
    up(at(capsule(0.06, 0.5), 0.27, 1.13, 0), 2, [0.27, 1.42, 0], SUIT),
    up(at(capsule(0.06, 0.5), -0.27, 1.13, 0), 3, [-0.27, 1.42, 0], SUIT),
    up(at(ball(0.06), 0.27, 0.83, 0.01), 2, [0.27, 1.42, 0], DARK),
    up(at(ball(0.06), -0.27, 0.83, 0.01), 3, [-0.27, 1.42, 0], DARK),
    // 脚: 腿は前へ、すねは足の板へ下ろす（騎手の姿勢）
    part(thigh(0.14), 4, [0, 0, 0], SUIT),
    part(thigh(-0.14), 4, [0, 0, 0], SUIT),
    part(shin(0.2), 4, [0, 0, 0], SUIT),
    part(shin(-0.2), 4, [0, 0, 0], SUIT),
    part(at(box(0.13, 0.12, 0.26), 0.24, 0.45, 0.14), 4, [0, 0, 0], BOOT),
    part(at(box(0.13, 0.12, 0.26), -0.24, 0.45, 0.14), 4, [0, 0, 0], BOOT),
  ];
}

export function buildRiderBikeGeometry() {
  return mergeGeometries([...bikeParts(), ...riderParts()].map((g) => g.toNonIndexed()));
}
