import * as THREE from 'three';
import { TIERS } from './quality.js';

// 浮いている主人公の体のまわりの、かすかな力のゆらぎ。
// - 薄い光の粒: 体のまわりをゆっくり回りながら昇る（Points。数は画質の段 auraMax で抑える）
// - 熱かげろう風の揺れ: 体を包む薄い殻（縁だけがうっすら光り、輪郭が波打つ）。low では出さない
// 動きはすべて頂点シェーダーで、CPU は時間を進めるだけ。
const CENTER_Y = 1.0; // 主人公の胴のあたり（m。足元 y=0 から頭まで約 1.8m）
const MOTES_MAX = Math.max(...Object.values(TIERS).map((t) => t.auraMax));

const MOTE_VERT = /* glsl */`
uniform float uTime, uPx;
attribute vec4 aSeed; // x: 向きの初期値, y: 半径, z: 昇る速さ, w: 位相
varying float vA;
void main() {
  float life = fract(aSeed.w + uTime * aSeed.z);
  float ang = aSeed.x * 6.2832 + uTime * (0.35 + aSeed.z) + life * 1.5;
  float rad = aSeed.y * (0.8 + 0.5 * sin(life * 3.1416));
  vec3 p = vec3(cos(ang) * rad, ${(-0.3).toFixed(2)} + life * 2.6, sin(ang) * rad);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = length(mv.xyz);
  vA = sin(life * 3.1416) * 0.7 * smoothstep(0.6, 2.0, dist); // 目のカメラの近くでは消える
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * 0.05 / max(0.1, dist), 2.0, 22.0);
}`;
const MOTE_FRAG = /* glsl */`
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, d)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.62, 0.78, 1.0), a);
}`;
// 遠くからでも主人公の居場所が分かる、ごくうすいぼんやりした光（1点）
const HALO_VERT = /* glsl */`
uniform float uTime, uPx;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.2, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = length(mv.xyz);
  gl_PointSize = clamp(uPx * 4.0 / max(0.1, dist), 8.0, 120.0) * (0.95 + 0.05 * sin(uTime * 1.6));
}`;
const HALO_FRAG = /* glsl */`
uniform float uFade;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(1.0 - smoothstep(0.0, 1.0, d), 2.0) * 0.3 * uFade;
  gl_FragColor = vec4(vec3(0.62, 0.78, 1.0), a);
}`;
const SHELL_VERT = /* glsl */`
uniform float uTime;
varying float vRim;
void main() {
  vec3 p = position;
  float w = sin(p.y * 5.0 + uTime * 2.1) * 0.05 + sin(p.x * 7.0 - p.z * 6.0 + uTime * 1.7) * 0.035;
  p += normal * w * (0.6 + 0.4 * p.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vRim = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 2.2) * (0.5 + 0.5 * sin(p.y * 4.0 - uTime * 1.3));
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FRAG = /* glsl */`
uniform float uFade;
varying float vRim;
void main() {
  float a = clamp(vRim, 0.0, 1.0) * 0.3 * uFade;
  gl_FragColor = vec4(vec3(0.7, 0.82, 1.0), a);
}`;

export function createHeroAura(tierName = 'mid') {
  const group = new THREE.Group();
  group.name = 'heroAura';
  group.position.y = CENTER_Y;
  const uniforms = { uTime: { value: 0 }, uPx: { value: 500 }, uFade: { value: 1 } };
  const blend = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  const seeds = new Float32Array(MOTES_MAX * 4);
  for (let i = 0; i < MOTES_MAX; i++) {
    const h = (k) => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    seeds.set([h(1), 0.55 + 0.7 * h(2), 0.07 + 0.08 * h(3), h(4)], i * 4);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES_MAX * 3), 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const motes = new THREE.Points(moteGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, ...blend }));
  motes.frustumCulled = false;
  motes.renderOrder = 9;

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14).scale(0.95, 1.5, 0.95),
    new THREE.ShaderMaterial({ uniforms, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, ...blend, side: THREE.FrontSide }),
  );
  shell.frustumCulled = false;
  shell.renderOrder = 9;
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const halo = new THREE.Points(haloGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, ...blend }));
  halo.frustumCulled = false;
  halo.renderOrder = 9;
  group.add(halo, motes, shell);

  const api = {
    group, motes, shell, halo,
    setTier(name) {
      const t = TIERS[name] ?? TIERS.mid;
      moteGeo.setDrawRange(0, t.auraMax);
      shell.visible = !!t.auraShell;
    },
    // 時間を進める。pointScale: 1m を画素へ直す係数（距離 1m のとき）
    // silhouette: 主人公が光を背にした影絵になる強さ（0〜1）。殻と遠目の光は消す（加算の青い縁が黒い影を明るくしてしまう）
    update(dt, pointScale = 500, silhouette = 0) {
      uniforms.uTime.value += dt;
      uniforms.uPx.value = pointScale;
      uniforms.uFade.value = Math.max(0, 1 - silhouette * 1.2);
    },
  };
  api.setTier(tierName);
  return api;
}
