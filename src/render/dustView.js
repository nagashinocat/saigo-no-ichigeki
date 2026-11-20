import * as THREE from 'three';
import { NOISE_GLSL } from './glslNoise.js';

// 土煙・粉の粒。ふくらんで薄れる、輪郭がやわらかく不揃いな「塊」の板を、固定の数（dustMax）だけ持つ。
// 動きは生まれたときの値と時刻だけで決まり、シェーダーが毎フレームの位置と大きさを計算する（CPU は生まれるときだけ）。
// spawn: { pos:[x,y,z], vel:[x,y,z], drag, rise, size, grow, life, tint:[r,g,b] }

const VERT = /* glsl */`
attribute vec3 aPos;
attribute vec4 aVel;   // xyz: 初速, w: 抵抗
attribute vec4 aLife;  // x: 生まれた時刻, y: 寿命, z: 大きさ, w: ふくらみ
attribute vec4 aTint;  // rgb: 色, a: 上昇の速さ
uniform float uTime;
varying vec2 vUv;
varying float vAge;
varying vec3 vTint;
varying float vSeed;
varying vec3 vWorld;
void main() {
  float age = (uTime - aLife.x) / aLife.y;
  vUv = uv;
  vAge = age;
  vTint = aTint.rgb;
  vSeed = fract(aLife.x * 13.17 + aPos.x * 0.37 + aPos.z * 0.11);
  if (age < 0.0 || age > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float t = age * aLife.y;
  float k = max(aVel.w, 1e-3);
  vec3 c = aPos + aVel.xyz * (1.0 - exp(-k * t)) / k + vec3(0.0, aTint.a * t, 0.0);
  c.y = max(c.y, 0.0);
  float size = aLife.z * (1.0 + aLife.w * (1.0 - pow(1.0 - age, 2.2)));
  vWorld = c;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float rot = vSeed * 6.283 + age * 0.25;
  vec2 o = position.xy * size;
  mv.xy += vec2(cos(rot) * o.x - sin(rot) * o.y, sin(rot) * o.x + cos(rot) * o.y);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform vec3 uSunView;
uniform vec3 uGlowColor;
uniform float uFront;   // 今いちばん大きな球の半径（中に入った粒は光に呑まれて見えなくする）
uniform float uGlow;
uniform float uCover;  // 球の不透明さ（消えていく球の中の粒は、だんだん見えてくる）
varying vec2 vUv;
varying float vAge;
varying vec3 vTint;
varying float vSeed;
varying vec3 vWorld;
${NOISE_GLSL}
vec3 srgbl(vec3 c) { return pow(c, vec3(2.2)); }
// 塊の輪郭: いくつかの丸を重ねた形（カリフラワーのような土煙）。返り値 xy: その丸の中心, z: 縁までの余裕
vec3 lobes(vec2 q, float seed) {
  vec3 best = vec3(0.0, 0.0, -1e3);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float a = seed * 6.283 + fi * 2.39996;
    float rr = i == 0 ? 0.0 : 0.38 + 0.12 * xhash12(vec2(seed * 91.0, fi));
    vec2 c = vec2(cos(a), sin(a)) * rr;
    float rad = i == 0 ? 0.55 : 0.36 + 0.14 * xhash12(vec2(fi, seed * 57.0));
    float m = rad - length(q - c);
    if (m > best.z) best = vec3(c, m / rad);
  }
  return best;
}
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  vec3 lb = lobes(q, vSeed);
  // 縁は筆で塗ったように少し揺らす。年をとるほど縁から細ってほどける
  float wob = (xnoise2(q * 6.0 + vSeed * 40.0) - 0.5) * 0.22;
  float m = lb.z + wob - smoothstep(0.45, 1.0, vAge) * 0.55;
  float edge = smoothstep(0.0, 0.3, m);
  if (edge <= 0.01) discard;
  // 丸ごとに夕日の側を明るく。3段の陰影（アニメの塗り）
  vec2 lq = (q - lb.xy) * 1.6;
  vec3 n = normalize(vec3(lq, sqrt(max(0.05, 1.0 - dot(lq, lq)))));
  float l = dot(n, uSunView) * 0.5 + 0.5;
  float cel = l > 0.6 ? 1.0 : (l > 0.4 ? 0.6 : 0.3);
  vec3 shadow = srgbl(vec3(0.5, 0.46, 0.6));
  vec3 lit = srgbl(vec3(1.0, 0.78, 0.6));
  vec3 col = vTint * mix(shadow, lit, cel);
  // 球の近くにいる粒は、球の側から照らされる
  float dc = length(vWorld);
  float near = uGlow * exp(-max(dc - uFront, 0.0) / 40.0);
  col += uGlowColor * near * 0.6 * (0.5 + 0.5 * cel);
  float alpha = edge * smoothstep(0.0, 0.06, vAge) * (1.0 - smoothstep(0.6, 1.0, vAge)) * 0.8;
  // 球の内側に入った粒は光に溶けて見えなくなる
  alpha *= mix(1.0, smoothstep(uFront * 0.92, uFront * 1.02, dc), uCover);
  gl_FragColor = vec4(col * alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createDustView(capacity) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const attr = (n) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const aPos = attr(3), aVel = attr(4), aLife = attr(4), aTint = attr(4);
  aLife.array.fill(-1e6); // 生まれていない粒は寿命の外
  for (let i = 0; i < capacity; i++) aLife.array[i * 4 + 1] = 1;
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aVel', aVel);
  geo.setAttribute('aLife', aLife);
  geo.setAttribute('aTint', aTint);
  geo.instanceCount = 0;

  const uniforms = {
    uTime: { value: 0 },
    uSunView: { value: new THREE.Vector3(0.6, 0.5, 0.6).normalize() },
    uGlowColor: { value: new THREE.Color(1.0, 0.62, 0.32).multiplyScalar(1.6) },
    uFront: { value: 0 },
    uGlow: { value: 0 },
    uCover: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = 'dust';

  let next = 0, used = 0, dirty = false, lastDeath = -Infinity;
  const sunWorld = new THREE.Vector3();

  return {
    mesh, uniforms, capacity,
    // 生きている粒があるか（最後の粒の寿命まで）
    alive(time) { return time < lastDeath; },
    spawn(time, p) {
      const i = next;
      next = (next + 1) % capacity;
      used = Math.max(used, i + 1);
      aPos.array.set(p.pos, i * 3);
      aVel.array.set([p.vel[0], p.vel[1], p.vel[2], p.drag ?? 1], i * 4);
      aLife.array.set([time, p.life, p.size, p.grow ?? 2], i * 4);
      aTint.array.set([p.tint[0], p.tint[1], p.tint[2], p.rise ?? 1], i * 4);
      lastDeath = Math.max(lastDeath, time + p.life);
      dirty = true;
    },
    update(time, camera, sunDir) {
      uniforms.uTime.value = time;
      if (sunDir && camera) uniforms.uSunView.value.copy(sunWorld.copy(sunDir).transformDirection(camera.matrixWorldInverse));
      if (dirty) {
        for (const a of [aPos, aVel, aLife, aTint]) a.needsUpdate = true;
        geo.instanceCount = used;
        dirty = false;
      }
    },
  };
}
