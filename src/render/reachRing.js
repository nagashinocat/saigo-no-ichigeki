import * as THREE from 'three';

// R2（spec §15 届く範囲の輪）: 上空の画面だけに、主人公のまわりの地面へ、今の一撃の届く範囲（radiusFor(力)）の細い輪を描く。
// 網は 1 つ（細い帯の頂点だけ。加算、深さは書かず、ビルにも隠れない。光源なし: 中くらいの Android で 30 fps）。
// 太さは画面で REACH_RING.px px（カメラからの距離で m を決め直す）。届かない数（reach.js）が減った＝輪が軍勢をまたいだら脈打つ。
// 0 体（今なら全滅できる）で琥珀から白金へ。輪が画面の外へ出たら（画面の四隅の地面がみな輪の内）offscreen を返し、HUD が画面の縁を光らせる
export const REACH_RING = { px: 3, seg: 192, pulseSec: 0.6, pulseWiden: 2.2, alpha: 0.75, y: 0.4 };
const AMBER = new THREE.Color(1.0, 0.62, 0.22);
const READY = new THREE.Color(1.0, 0.93, 0.7);

// カメラから dist m の所で px px になる太さ（m）。fovDeg は縦の画角、viewPx は描く画面の縦の px
export const ringWidthM = (dist, fovDeg, viewPx, px = REACH_RING.px) => px * 2 * dist * Math.tan(fovDeg * Math.PI / 360) / Math.max(1, viewPx);

// 画面の四隅（NDC ±1）から地面（y = 0）への点。地平より上を向く隅は、遠く（カメラの far）で打ち切る
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
const NDC = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
// out: 毎フレーム同じ 4 つの点を使い回す（省けば新しく作る）
export function groundCorners(camera, out = NDC.map(() => new THREE.Vector3())) {
  camera.updateMatrixWorld();
  _o.setFromMatrixPosition(camera.matrixWorld);
  NDC.forEach(([x, y], i) => {
    _d.set(x, y, 0.5).unproject(camera).sub(_o).normalize();
    const t = _d.y < -1e-6 ? -_o.y / _d.y : camera.far;
    out[i].set(_o.x + _d.x * t, 0, _o.z + _d.z * t);
  });
  return out;
}
// 輪が画面の外（四隅の地面がみな輪の内 = 画面に輪の線が一つも映らない）
export const ringOffscreen = (radius, hero, corners) => corners.every((p) => Math.hypot(p.x - hero.x, p.z - hero.z) < radius);

// 細い帯（半径 1 の輪の内と外。aSide −1 内、+1 外）
function buildBand(seg) {
  const pos = [], side = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c, 0, s, c, 0, s); side.push(-1, 1);
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */`
attribute float aSide;
uniform float uR, uW;
varying float vSide;
void main() {
  vSide = aSide;
  vec3 p = vec3(position.x * (uR + aSide * uW * 0.5), 0.0, position.z * (uR + aSide * uW * 0.5));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha, uPulse;
varying float vSide;
void main() {
  // 帯の真ん中が明るく、縁はやわらかく
  float a = (1.0 - vSide * vSide) * uAlpha * (1.0 + 1.2 * uPulse);
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createReachRing(scene, R = REACH_RING) {
  const uniforms = { uR: { value: 1 }, uW: { value: 1 }, uColor: { value: AMBER.clone() }, uAlpha: { value: R.alpha }, uPulse: { value: 0 } };
  const mesh = new THREE.Mesh(buildBand(R.seg), new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = 'reach-ring'; mesh.visible = false;
  scene.add(mesh);
  let lastLeft = null, pulse = 0;
  const _c = new THREE.Vector3(), corners = NDC.map(() => new THREE.Vector3());
  return {
    mesh,
    // hero: { x, z }、radius: 輪の半径 m、left: 届かない数、visible: 上空の画面で遊んでいる間、camera: 上空カメラ、viewPx: 街の画面の縦の px。
    // 返す: { pulse 0〜1, ready（0 体）, offscreen（輪が画面の外）}
    update({ hero, radius, left, visible, dt = 0, camera, viewPx }) {
      pulse = Math.max(0, pulse - Math.max(0, dt) / R.pulseSec);
      if (!visible) { lastLeft = null; pulse = 0; }
      else if (lastLeft != null && left < lastLeft) pulse = 1;
      if (visible) lastLeft = left;
      mesh.visible = !!visible;
      const ready = left === 0;
      const out = { pulse, ready, offscreen: false };
      if (!visible) { uniforms.uPulse.value = 0; return out; }
      mesh.position.set(hero.x, R.y, hero.z);
      uniforms.uR.value = radius;
      // 太さ: 輪の上の、カメラに一番近い点までの距離で（画面に映る所が細い線に見える）
      _c.setFromMatrixPosition(camera.matrixWorld);
      const hd = Math.abs(Math.hypot(_c.x - hero.x, _c.z - hero.z) - radius);
      const dist = Math.max(1, Math.hypot(hd, _c.y - R.y));
      uniforms.uW.value = ringWidthM(dist, camera.fov, viewPx, R.px) * (1 + (R.pulseWiden - 1) * pulse);
      uniforms.uColor.value.copy(ready ? READY : AMBER);
      uniforms.uPulse.value = pulse;
      out.offscreen = ringOffscreen(radius, hero, groundCorners(camera, corners));
      return out;
    },
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); },
  };
}
