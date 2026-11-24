import * as THREE from 'three';

// Fix round 2（まとめ役の裁定「閃光の残りを画面で見せる」）: 払うの閃光の残り（game.haze: { x, z, r, left, total }。その内の探す者は主人公を見つけられない）の間、
// 払った所を中心に半径 r の薄い光のドーム（平たい半球。縁ほど明るい）を出して、安全な所を見せる。出始めは riseSec 秒で立ち上がり、
// 残り warnSec 秒からは blinkHz で脈打ちながら薄れて、尽きれば消える。網は 1 つ（加算、深さは書かない、光源なし）
export const HAZE_DOME = { alpha: 0.32, rim: 2.2, height: 0.22, riseSec: 0.35, warnSec: 2, blinkHz: 3, y: 0.3 };

// 見た目（描かずに決める）。h: { left, total }（無ければ null）、t: 時刻（脈打ち）
export function hazeLook(h, t = 0, D = HAZE_DOME) {
  if (!h || !(h.left > 0)) return { visible: false, alpha: 0 };
  const since = Math.max(0, (h.total ?? h.left) - h.left);
  const rise = Math.min(1, since / D.riseSec);
  let k = 1;
  if (h.left < D.warnSec) {
    const fade = h.left / D.warnSec; // 1 → 0
    k = fade * (0.55 + 0.45 * Math.cos(t * Math.PI * 2 * D.blinkHz));
  }
  return { visible: true, alpha: D.alpha * rise * k };
}

const VERT = /* glsl */`
varying float vRim;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 v = normalize(cameraPosition - wp.xyz);
  vRim = 1.0 - abs(dot(n, v));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */`
uniform float uAlpha;
uniform float uRim;
varying float vRim;
void main() {
  float a = uAlpha * (0.25 + uRim * vRim * vRim);
  gl_FragColor = vec4(vec3(0.7, 0.9, 1.0) * a, a);
}`;

export function createHazeDome(scene, D = HAZE_DOME) {
  const geo = new THREE.SphereGeometry(1, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2); // 半球（半径 1 を r 倍、高さは height 倍）
  const mat = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 }, uRim: { value: D.rim } }, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  scene.add(mesh);
  let t = 0;
  return {
    mesh,
    reset() { mesh.visible = false; },
    // h: game.haze（{ x, z, r, left, total } か null）
    update(dt, h) {
      t += dt;
      const L = hazeLook(h, t, D);
      mesh.visible = L.visible;
      if (!L.visible) return L;
      mat.uniforms.uAlpha.value = L.alpha;
      mesh.position.set(h.x, D.y, h.z);
      mesh.scale.set(h.r, h.r * D.height, h.r);
      return L;
    },
  };
}
