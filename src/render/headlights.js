import * as THREE from 'three';
import { CONFIG } from '../config.js';

// M2（持ち主 09:11「敵の前方ライトを少し広くして」、spec §16）: 軍勢の前方ライトを、地面に落ちるやわらかい光の扇として描く（上空カメラから
// 見える）。見つける判定と同じ扇（spotDist m、半分の角 spotHalfAngle）。全部で一つの InstancedMesh（加算、深さは書かない。乗り手ごとの
// 光源は使わない: 中くらいの Android で 30 fps を保つ）。色: 探している者は淡い白、知らされて最後に見えた所へ向かう者は琥珀、追う者は赤み。
// 見つけた・知らせを伝えた瞬間（callT が alert.flashSec より小さい間）は扇が明るく光り、その者から知らせの輪（alert.radius まで広がる薄い輪）が出る。
// R1 の見直しの持ち越し（種類を色だけでなく形でも）: 吸う者の足元に、2 Hz で脈打つ輪（画面で少なくとも KIND_RING.minPx px）
export const CONE = { seg: 14, gain: 0.55, flash: 1.6, near: 160 };
export const KIND_RING = { minPx: 9, minM: 1.6, hz: 2 };
const TINT = { search: [1.0, 0.93, 0.78], heard: [1.0, 0.68, 0.22], chase: [1.0, 0.36, 0.24] };

// 扇の形（向きは +z、半径 1）: 頂点ごとに aR（0 要 → 1 縁）と aA（扇の中の角 −1〜1）
export function buildConeGeometry(halfAngle = CONFIG.enemy.spotHalfAngle, seg = CONE.seg) {
  const pos = [0, 0, 0], r = [0], a = [0], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = -1 + (2 * i) / seg, ang = u * halfAngle;
    pos.push(Math.sin(ang), 0, Math.cos(ang)); r.push(1); a.push(u);
    if (i > 0) idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(r, 1));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(a, 1));
  g.setIndex(idx);
  return g;
}

const CONE_VERT = /* glsl */`
attribute float aR, aA;
attribute vec4 aCone; // xyz: 色, w: 明るさ
varying float vR, vA;
varying vec4 vC;
void main() {
  vR = aR; vA = aA; vC = aCone;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const CONE_FRAG = /* glsl */`
varying float vR, vA;
varying vec4 vC;
void main() {
  // 要の近くが明るく、遠くへ向かってやわらかく消える。扇の縁もぼかす
  float fall = pow(1.0 - clamp(vR, 0.0, 1.0), 1.35);
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(vA));
  float a = fall * edge * vC.w;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC.rgb * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 輪（知らせの輪・吸う者の輪）。aRing: x 半径 m（0 なら画面の大きさの決まりで）, y 不透明度, z 種類（0 知らせ, 1 吸う者の脈打ち）
const RING_VERT = /* glsl */`
attribute vec3 aRing;
uniform float uPx, uMinPx, uMinM;
varying float vA, vK, vU;
varying vec2 vP;
void main() {
  vec3 o = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float dist = max(1.0, distance(o, cameraPosition));
  float r = aRing.x > 0.0 ? aRing.x : max(uMinM, uMinPx * dist / max(uPx, 1.0));
  vA = aRing.y; vK = aRing.z; vP = position.xz;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position * r, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const RING_FRAG = /* glsl */`
uniform vec3 uCall, uDrain;
uniform float uTime, uHz;
varying float vA, vK, vU;
varying vec2 vP;
void main() {
  float r = length(vP);
  float band = vK > 0.5 ? smoothstep(0.62, 0.78, r) * (1.0 - smoothstep(0.9, 1.0, r)) : smoothstep(0.9, 0.97, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float pulse = vK > 0.5 ? 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 6.2831853 * uHz)) : 1.0;
  float a = band * vA * pulse;
  if (a < 0.004) discard;
  vec3 c = vK > 0.5 ? uDrain : uCall;
  gl_FragColor = vec4(c * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createHeadlights(group, { capacity, drainColor = [1.0, 0.1, 0.4], cfg = CONFIG } = {}) {
  const E = cfg.enemy, AL = E.alert;
  const coneGeo = buildConeGeometry(E.spotHalfAngle);
  const coneAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  coneAttr.setUsage(THREE.DynamicDrawUsage);
  coneGeo.setAttribute('aCone', coneAttr);
  const cones = new THREE.InstancedMesh(coneGeo, new THREE.ShaderMaterial({
    vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }), capacity);
  cones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cones.frustumCulled = false; cones.count = 0; cones.renderOrder = 1; cones.name = 'headlight-cones';

  // 輪: 平らな輪の帯（内 0.6〜外 1。帯は frag で切る）。知らせの輪は 120 m まで広がるので、円板にせず帯だけを描いて塗る画素を減らす
  // （知らせの輪の帯は 0.9〜1 の所。内 0.6 より内は描かない）
  const ringGeo = new THREE.RingGeometry(0.6, 1, 64, 1).rotateX(-Math.PI / 2);
  const ringCap = capacity * 2;
  const ringAttr = new THREE.InstancedBufferAttribute(new Float32Array(ringCap * 3), 3);
  ringAttr.setUsage(THREE.DynamicDrawUsage);
  ringGeo.setAttribute('aRing', ringAttr);
  const ringUniforms = {
    uPx: { value: 500 }, uMinPx: { value: KIND_RING.minPx }, uMinM: { value: KIND_RING.minM }, uTime: { value: 0 }, uHz: { value: KIND_RING.hz },
    uCall: { value: new THREE.Color(1.0, 0.62, 0.3) }, uDrain: { value: new THREE.Color(...drainColor) },
  };
  const rings = new THREE.InstancedMesh(ringGeo, new THREE.ShaderMaterial({
    uniforms: ringUniforms, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }), ringCap);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.frustumCulled = false; rings.count = 0; rings.renderOrder = 2; rings.name = 'alert-rings';
  group.add(cones, rings);

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0);
  let nc = 0, nr = 0;
  const flashOf = (e) => (e.callT != null && e.callT < AL.flashSec ? 1 - e.callT / AL.flashSec : 0);
  return {
    cones, rings,
    begin(time, pointScale, pixelRatio = 1) {
      nc = 0; nr = 0;
      ringUniforms.uTime.value = time; ringUniforms.uPx.value = pointScale; ringUniforms.uMinPx.value = KIND_RING.minPx * pixelRatio;
    },
    // 一人ぶん: e（ゲームの軍勢）、b（bikePose の描く位置）、ground（足元の地面の高さ）、heroPos
    add(e, b, ground, heroPos, visible = true) {
      if (!visible || e.state === 'dead') return;
      const near = Math.hypot(b.x - heroPos.x, b.z - heroPos.z) < CONE.near;
      const fl = flashOf(e);
      if (near && (e.state === 'search' || e.state === 'chase') && nc < capacity) {
        const tint = e.state === 'chase' ? TINT.chase : e.heard ? TINT.heard : TINT.search;
        _p.set(b.x, ground + 0.07, b.z);
        _q.setFromAxisAngle(UP, b.yaw);
        _s.set(E.spotDist, 1, E.spotDist);
        cones.setMatrixAt(nc, _m.compose(_p, _q, _s));
        coneAttr.setXYZW(nc, tint[0], tint[1], tint[2], CONE.gain * (e.state === 'chase' ? 0.75 : 1) * (1 + CONE.flash * fl));
        nc++;
      }
      if (fl > 0 && nr < ringCap) { // 知らせの輪: 光った者から alert.radius まで広がって消える
        const u = 1 - fl;
        _p.set(b.x, ground + 0.09, b.z); _q.identity(); _s.set(1, 1, 1);
        rings.setMatrixAt(nr, _m.compose(_p, _q, _s));
        ringAttr.setXYZ(nr, Math.max(2, AL.radius * (1 - (1 - u) ** 2)), 0.5 * (1 - u), 0);
        nr++;
      }
      if (e.kind === 'drainer' && nr < ringCap) {
        _p.set(b.x, ground + 0.1, b.z); _q.identity(); _s.set(1, 1, 1);
        rings.setMatrixAt(nr, _m.compose(_p, _q, _s));
        ringAttr.setXYZ(nr, 0, 0.95 * (b.keep ?? 1), 1);
        nr++;
      }
    },
    end() {
      cones.count = nc; rings.count = nr;
      cones.instanceMatrix.needsUpdate = rings.instanceMatrix.needsUpdate = true;
      coneAttr.needsUpdate = ringAttr.needsUpdate = true;
    },
    setVisible(v) { cones.visible = rings.visible = v; },
  };
}
