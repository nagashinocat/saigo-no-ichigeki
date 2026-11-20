import * as THREE from 'three';
import { NOISE_GLSL } from './glslNoise.js';

// 光に溶ける演出: 爆心近くの建物や props を、端から光る粒に変えてほどく（ディゾルブ）。
// 溶ける箱（固定数の InstancedMesh）と、そこから立ちのぼる光の粒（Points）からなる。

const DURATION = [1.1, 1.8]; // s
const SPARK_LIFE = [0.7, 1.6];

const BOX_VERT = /* glsl */`
attribute vec4 aInfo;  // x: 始まった時刻, y: 長さ, z: 種, w: 未使用
attribute vec3 aColor;
attribute vec3 aDims;
uniform float uTime;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec4 vInfo;
varying vec3 vColor;
varying vec3 vDims;
varying vec3 vWorld;
void main() {
  vLocal = position * aDims;
  vInfo = aInfo;
  vColor = aColor;
  vDims = aDims;
  vNormalW = normal;
  float p = clamp((uTime - aInfo.x) / aInfo.y, 0.0, 1.0);
  if (uTime < aInfo.x || p >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 wp = modelMatrix * instanceMatrix * vec4(vLocal, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BOX_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uHot;
uniform vec3 uEdge;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec4 vInfo;
varying vec3 vColor;
varying vec3 vDims;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float p = clamp((uTime - vInfo.x) / vInfo.y, 0.0, 1.0);
  // 面の上での「いちばん近い辺までの距離」(m)。3軸のうち2番目に小さい値が、その面の縁までの距離
  vec3 e = vec3(vDims.x * 0.5 - abs(vLocal.x), min(vLocal.y, vDims.y - vLocal.y), vDims.z * 0.5 - abs(vLocal.z));
  float lo = min(e.x, min(e.y, e.z)), hi = max(e.x, max(e.y, e.z));
  float edgeDist = e.x + e.y + e.z - lo - hi;
  float n = xnoise3(vWorld * 0.35 + vInfo.z * 17.0) * 0.6 + xnoise3(vWorld * 1.3) * 0.4;
  float reach = max(vDims.x, max(vDims.y * 0.5, vDims.z)) * 0.5 + 3.0;
  float v = edgeDist + n * 4.0;
  float th = p * reach * 1.1 - 0.3;
  if (v < th) discard;
  float rim = 1.0 - smoothstep(0.0, 0.45, v - th);
  // 熱で白く光り、溶ける縁は強く光る（bloom がにじませる）
  // 光を背にした影絵: 暗い本体と、溶ける縁の強い光（bloom がにじませる）
  vec3 lit = vColor * (0.05 + 0.05 * max(vNormalW.y, 0.0)) + uHot * 0.03;
  vec3 col = lit + uEdge * rim * 3.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SPARK_VERT = /* glsl */`
attribute vec4 aVel;   // xyz: 速さ, w: 生まれた時刻
attribute vec2 aLife;  // x: 寿命, y: 大きさ
uniform float uTime;
uniform float uScale;
varying float vAge;
void main() {
  float t = uTime - aVel.w;
  vAge = t / aLife.x;
  if (t < 0.0 || vAge > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 p = position + aVel.xyz * t + vec3(0.0, 4.0 * t * t, 0.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aLife.y * uScale * (1.0 - vAge * 0.7) / max(1.0, -mv.z);
}`;

const SPARK_FRAG = /* glsl */`
uniform vec3 uSpark;
varying float vAge;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float a = (1.0 - d) * (1.0 - vAge);
  vec3 c = mix(uSpark * 2.2, uSpark * vec3(0.8, 0.55, 1.1), vAge);
  gl_FragColor = vec4(c * a, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createVaporizeView({ boxes = 96, sparks = 1600, sparksPer = 40, rng = Math.random } = {}) {
  const group = new THREE.Group();
  group.name = 'vaporize';

  // 溶ける箱
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const info = new THREE.InstancedBufferAttribute(new Float32Array(boxes * 4), 4);
  const color = new THREE.InstancedBufferAttribute(new Float32Array(boxes * 3), 3);
  const dims = new THREE.InstancedBufferAttribute(new Float32Array(boxes * 3), 3);
  for (let i = 0; i < boxes; i++) { info.array[i * 4] = -1e6; info.array[i * 4 + 1] = 1; }
  geo.setAttribute('aInfo', info);
  geo.setAttribute('aColor', color);
  geo.setAttribute('aDims', dims);
  const uniforms = {
    uTime: { value: 0 },
    uHot: { value: new THREE.Color(1.0, 0.62, 0.36).multiplyScalar(1.3) },
    uEdge: { value: new THREE.Color(1.0, 0.92, 0.78) },
    uSpark: { value: new THREE.Color(1.0, 0.86, 0.62) },
    uScale: { value: 600 },
  };
  // 溶ける対象は球の中にあるが、光の手前に影絵として見せる（球より後に、深度は書いて描く）
  const boxMat = new THREE.ShaderMaterial({ uniforms, vertexShader: BOX_VERT, fragmentShader: BOX_FRAG, transparent: true, depthWrite: true });
  const boxMesh = new THREE.InstancedMesh(geo, boxMat, boxes);
  boxMesh.frustumCulled = false;
  boxMesh.renderOrder = 7;
  boxMesh.count = 0;
  group.add(boxMesh);

  // 光の粒
  const sGeo = new THREE.BufferGeometry();
  const sPos = new THREE.BufferAttribute(new Float32Array(sparks * 3), 3);
  const sVel = new THREE.BufferAttribute(new Float32Array(sparks * 4), 4);
  const sLife = new THREE.BufferAttribute(new Float32Array(sparks * 2), 2);
  for (let i = 0; i < sparks; i++) { sVel.array[i * 4 + 3] = -1e6; sLife.array[i * 2] = 1; }
  sGeo.setAttribute('position', sPos);
  sGeo.setAttribute('aVel', sVel);
  sGeo.setAttribute('aLife', sLife);
  sGeo.setDrawRange(0, 0);
  const sMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const points = new THREE.Points(sGeo, sMat);
  points.frustumCulled = false;
  points.renderOrder = 8;
  group.add(points);

  const m = new THREE.Matrix4();
  let nextBox = 0, nextSpark = 0, sparkUsed = 0, lastEnd = -Infinity, dirty = false;
  const span = ([a, b]) => a + (b - a) * rng();

  return {
    group, uniforms,
    busy(time) { return time < lastEnd; },
    // target: { x, z, w, d, h, color:[r,g,b] }
    add(time, target) {
      const i = nextBox;
      nextBox = (nextBox + 1) % boxes;
      boxMesh.count = Math.max(boxMesh.count, i + 1);
      const dur = span(DURATION);
      boxMesh.setMatrixAt(i, m.makeTranslation(target.x, 0, target.z));
      info.array.set([time, dur, rng(), 0], i * 4);
      color.array.set(target.color ?? [0.7, 0.7, 0.7], i * 3);
      dims.array.set([target.w, target.h, target.d], i * 3);
      // 粒は箱の表面から、溶ける進みに合わせて少しずつ出る
      const n = Math.max(4, Math.min(sparksPer, Math.round(sparksPer * Math.sqrt((target.w * target.h * target.d) / 6000))));
      for (let k = 0; k < n; k++) {
        const j = nextSpark;
        nextSpark = (nextSpark + 1) % sparks;
        sparkUsed = Math.max(sparkUsed, j + 1);
        const fx = rng() - 0.5, fz = rng() - 0.5, side = rng() < 0.5;
        const x = target.x + (side ? Math.sign(fx) * 0.5 : fx) * target.w;
        const z = target.z + (side ? fz : Math.sign(fz) * 0.5) * target.d;
        const y = rng() * target.h;
        const out = Math.hypot(x, z) || 1;
        const life = span(SPARK_LIFE);
        sPos.array.set([x, y, z], j * 3);
        sVel.array.set([x / out * (3 + 6 * rng()), 2 + 6 * rng(), z / out * (3 + 6 * rng()), time + dur * rng() * 0.9], j * 4);
        sLife.array.set([life, 1.2 + 2.2 * rng()], j * 2);
        lastEnd = Math.max(lastEnd, time + dur + life);
      }
      lastEnd = Math.max(lastEnd, time + dur);
      dirty = true;
    },
    update(time, pointScale) {
      uniforms.uTime.value = time;
      uniforms.uScale.value = pointScale; // 点の大きさを m から画面の画素へ
      if (!dirty) return;
      boxMesh.instanceMatrix.needsUpdate = true;
      info.needsUpdate = color.needsUpdate = dims.needsUpdate = true;
      sPos.needsUpdate = sVel.needsUpdate = sLife.needsUpdate = true;
      sGeo.setDrawRange(0, sparkUsed);
      dirty = false;
    },
  };
}
