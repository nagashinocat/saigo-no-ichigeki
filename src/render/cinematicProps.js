import * as THREE from 'three';
import { createRng } from '../rng.js';
import { NOISE_GLSL } from './glslNoise.js';

// 最後の一発の演出の小道具（街の場面に置く）: ガラスの一拍（持ち主の絵コンテ 2026-11-21 09:40）で、迫る光の壁の側から
// 瓦礫（コンクリート片・鉄骨の切れ端・粉塵）にまじって割れた窓ガラスがゆっくり回りながらこちらへ飛んでくる。
// 目が映る大きなガラス片がひとつ、手前を横切る。
// 瓦礫・ガラス片・塵は「体感時間」P（finaleTimeline.perceivedTime: 白が晴れた瞬間が 0、一拍の間はほとんど進まない）で動く。
// 目が映るガラス片の置き方は演出の秒 t で、演出（cinematic.js）が決める（目が合う一瞬に向きがそろうように）。

// 光の壁の球の、前線からの外への張り出し（m）
const WALL_OUT = 0.9;
const HERO_ASPECT = 0.62; // 目が映るガラス片の高さ / 幅（目の画像 1.6:1 が収まる）
const TIER_COUNTS = {
  high: { shards: 110, chunks: 70, bars: 22, motes: 420 },
  mid: { shards: 70, chunks: 44, bars: 14, motes: 240 },
  low: { shards: 36, chunks: 24, bars: 8, motes: 90 },
};

// 瓦礫（コンクリート片・鉄骨の切れ端）: 迫る光の壁の側から照らされ、こちらを向いた面は暗く、縁が熱く光る（逆光のかけら）
const DEBRIS_VERT = /* glsl */`
varying vec3 vN, vW;
varying float vTone;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vTone = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DEBRIS_FRAG = /* glsl */`
uniform vec3 uBase, uCore;
uniform float uLight, uFade, uMetal;
varying vec3 vN, vW;
varying float vTone;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(uCore - vW);
  vec3 hot = vec3(1.0, 0.6, 0.3);
  float ndl = max(dot(N, L), 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  float back = pow(max(dot(-V, L), 0.0), 3.0);
  vec3 base = uBase * (0.75 + 0.5 * vTone);
  vec3 col = base * (0.06 + 0.05 * max(N.y, 0.0));
  col += base * hot * ndl * uLight * 2.6 * (1.0 - 0.7 * uMetal);
  col += hot * rim * (0.25 + back) * uLight * (1.0 + uMetal * 1.5);
  gl_FragColor = vec4(col * uFade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SHARD_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN, vW;
varying float vEdge;
attribute float aEdge;
void main() {
  vUv = uv;
  vEdge = aEdge;
  vec4 lp = vec4(position, 1.0);
  vec3 ln = normal;
  #ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  ln = mat3(instanceMatrix) * ln;
  #endif
  vec4 wp = modelMatrix * lp;
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * ln);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SHARD_FRAG = /* glsl */`
uniform sampler2D tEye;
uniform float uReflect, uLight, uFade;
uniform vec2 uSlide;
uniform vec3 uBlast, uSunDir;
varying vec2 vUv;
varying vec3 vN, vW;
varying float vEdge;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  if (dot(N, V) < 0.0) N = -N;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 R = reflect(-V, N);
  // 夕方の暗い空と、背後から迫る光の映り込み
  vec3 toB = normalize(uBlast - vW);
  vec3 sky = mix(vec3(0.35, 0.16, 0.12), vec3(0.04, 0.05, 0.12), smoothstep(-0.1, 0.6, R.y));
  float glint = pow(max(dot(R, toB), 0.0), 18.0) * 6.0 + pow(max(dot(R, toB), 0.0), 3.0) * 0.6;
  vec3 col = vec3(0.015, 0.018, 0.024) + sky * (0.1 + 0.6 * fres) + vec3(1.0, 0.7, 0.42) * glint * uLight;
  // 光に透かされたガラスの縁: 光の方を向くほど熱い色
  float back = max(dot(-V, toB), 0.0);
  col += vec3(1.0, 0.62, 0.3) * pow(back, 6.0) * uLight * 0.6;
  float a = mix(0.25, 0.85, fres) + glint * 0.2;
  #ifdef EYE
  // 映った目（鏡なので左右が逆）。uSlide: ガラス片が回ると像がずれて縁から抜けていく（向きがそろった一瞬だけ目が合う）。
  // ガラスのわずかなゆがみで像がゆれ、縁ほど色がずれる
  vec2 e = vec2(1.0 - vUv.x, vUv.y) + uSlide;
  float inImg = smoothstep(0.0, 0.1, e.x) * smoothstep(1.0, 0.9, e.x) * smoothstep(0.0, 0.1, e.y) * smoothstep(1.0, 0.9, e.y);
  vec2 wob = vec2(sin(vUv.y * 17.0 + vUv.x * 5.0) * 0.006, sin(vUv.x * 13.0 - vUv.y * 4.0) * 0.005);
  float ca = 0.004 + 0.012 * (1.0 - smoothstep(0.0, 0.35, vEdge));
  vec2 dir = normalize(e - 0.5 + 1e-4);
  vec3 eye = vec3(texture2D(tEye, clamp(e + wob + dir * ca, 0.0, 1.0)).r,
                  texture2D(tEye, clamp(e + wob, 0.0, 1.0)).g,
                  texture2D(tEye, clamp(e + wob - dir * ca, 0.0, 1.0)).b);
  float k = uReflect * inImg;
  eye = pow(eye, vec3(1.2)) * 1.5;
  col = col * (1.0 - 0.85 * k) + eye * k;
  // 映り込みとして読ませる: 目の上に、迫る光の壁の照り返し（ガラスが回ると流れる帯）と空がうっすら重なる
  float band = exp(-pow((vUv.x * 0.8 + vUv.y * 0.6 - 0.7 - uSlide.x * 1.6) * 4.0, 2.0));
  col += vec3(1.0, 0.68, 0.4) * band * (0.06 + 0.16 * uLight) * (0.4 + 0.6 * uReflect);
  col += sky * fres * 0.35 * k;
  a = mix(a, 0.94, k);
  // ひび（像の上を走る細い線）
  vec2 c1 = vUv - vec2(0.66, 0.36);
  float crack = (1.0 - smoothstep(0.0, 0.003, abs(dot(c1, normalize(vec2(0.8, -0.6)))))) * step(0.0, c1.x);
  vec2 c2 = vUv - vec2(0.2, 0.7);
  crack += (1.0 - smoothstep(0.0, 0.0025, abs(dot(c2, normalize(vec2(0.3, 0.95)))))) * step(c2.y, 0.0) * step(-0.25, c2.y);
  col += vec3(1.0, 0.9, 0.78) * crack * (0.5 + uLight);
  #endif
  // 割れた縁が光る
  float edge = 1.0 - smoothstep(0.0, 0.06, vEdge);
  col += vec3(1.0, 0.85, 0.62) * edge * (0.6 + 2.2 * uLight);
  a = max(a, edge);
  gl_FragColor = vec4(col * uFade, a * uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 宙に止まった塵（近いものほど大きくぼける）
const MOTE_VERT = /* glsl */`
attribute vec4 aMote; // x: 大きさ, y: 明るさ, z,w: 揺れの位相
uniform float uP, uP0, uScale;
uniform vec3 uFlow;
varying float vB, vSoft;
void main() {
  // 塵も光の壁に押されてこちらへ流れてくる（体感時間で。一拍の間はほとんど動かない）
  vec3 p = position + uFlow * (uP - uP0) * (0.4 + aMote.y) + vec3(sin(aMote.z + uP * 2.0), sin(aMote.w + uP * 1.7) * 0.6, cos(aMote.z * 1.3 + uP * 1.5)) * 0.08;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  float d = max(0.2, -mv.z);
  gl_PointSize = clamp(aMote.x * uScale / d, 1.0, 40.0);
  // 近いもの（ピントの外）ほど大きく淡い
  vSoft = smoothstep(4.0, 0.6, d);
  vB = aMote.y / (1.0 + vSoft * 5.0);
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */`
uniform float uLight;
varying float vB, vSoft;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float disc = mix(1.0 - smoothstep(0.15, 1.0, r), (1.0 - smoothstep(0.82, 1.0, r)) * (0.7 + 0.3 * smoothstep(0.5, 0.97, r)), vSoft);
  // 光の壁の前の粉塵: 小さく光る粒。近くのぼけた粒は淡く（明るい壁の上で画面を白く覆わない）
  vec3 col = vec3(1.0, 0.8, 0.56) * disc * vB * (0.25 + 0.9 * uLight) * (1.0 - 0.7 * vSoft);
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 割れたガラスの形: 中心から外へ伸びる扇（aEdge は縁で 0、中心で 1）。uv は外接する箱で 0〜1
function shardGeometry(rng, w, h, sides = 7, curve = 0) {
  const pos = [0, 0, 0], uv = [0.5, 0.5], edge = [1];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const r = 0.66 + 0.34 * rng();
    const x = Math.cos(a) * r * w / 2, y = Math.sin(a) * r * h / 2;
    pos.push(x, y, -curve * (x * x) / (w * w / 4));
    uv.push(x / w + 0.5, y / h + 0.5);
    edge.push(0);
  }
  const index = [];
  for (let i = 0; i < sides; i++) index.push(0, 1 + i, 1 + ((i + 1) % sides));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const additive = (opts) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, ...opts,
});

// でこぼこのコンクリート片（平らな面の多面体。頂点を位置ごとにずらし、つながった面はつながったまま）
function chunkGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.7 + 0.6 * (Math.sin(x * 12.9 + y * 78.2 + z * 37.7) * 0.5 + 0.5);
    p.setXYZ(i, x * k * 1.25, y * k * 0.8, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// 光の壁: 一拍の間、前線の球のすぐ外に重ねる燃える面（爆発の球は近くで斜めに見ると薄い灰色の膜になるので、
// この一拍だけは光の壁として描く）。ゆっくり渦巻く白熱の筋と橙の面、地面に近いほど・芯（爆心の方）ほど明るい。
// 体感時間でしか動かない（一拍の間はほとんど止まる）
const WALL_VERT = /* glsl */`
varying vec3 vDir, vW;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const WALL_FRAG = /* glsl */`
uniform float uP, uI, uFront;
varying vec3 vDir, vW;
${NOISE_GLSL}
// 画面いっぱいに描くので、画質の段で細かさを変える（WALL_Q 2: high、1: mid、0: low）
float fbm(vec3 p) {
  #if WALL_Q >= 1
  return xnoise3(p) * 0.55 + xnoise3(p * 2.03 + 3.1) * 0.3 + xnoise3(p * 4.1 + 7.7) * 0.15;
  #else
  return xnoise3(p) * 0.62 + xnoise3(p * 2.03 + 3.1) * 0.38;
  #endif
}
// 細い稜線（0.5 をまたぐ所が 1）
float ridge(float v, float w) { return pow(1.0 - min(1.0, abs(v - 0.5) * 2.0), w); }
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float face = max(dot(vDir, V), 0.0);
  // 模様の大きさは前線の大きさによらず数 m（近くで見る面）。大きなうねりの上に、細かく裂ける白熱の筋
  // 熱さは橙を中心に分け、白熱は山の所だけ（どの場所・どの一拍でも、画面いっぱいが白くならない）
  vec3 sp = vW * 0.15;
  float n = fbm(sp + vec3(0.0, -uP * 9.0, uP * 3.0));
  float w = fbm(sp * 2.4 + vec3(uP * 5.0, 0.0, -uP * 4.0) + n * 1.8);
  #if WALL_Q >= 2
  float f = fbm(sp * 6.0 + w * 1.2 + vec3(0.0, uP * 11.0, 0.0));
  #else
  float f = xnoise3(sp * 6.0 + w * 1.2 + vec3(0.0, uP * 11.0, 0.0));
  #endif
  float heat = clamp(0.42 + (n - 0.5) * 1.5 + (f - 0.5) * 0.3, 0.0, 1.0);
  vec3 col = mix(vec3(0.42, 0.06, 0.02), vec3(0.95, 0.3, 0.06), smoothstep(0.15, 0.45, heat));
  col = mix(col, vec3(1.0, 0.62, 0.2), smoothstep(0.45, 0.7, heat));
  col = mix(col, vec3(1.0, 0.9, 0.7) * 1.8, smoothstep(0.72, 0.92, heat));
  // 白熱の筋（大きいものと細かいもの）
  col += vec3(1.0, 0.85, 0.6) * (ridge(w, 14.0) * 1.6 + ridge(f, 24.0) * 0.7) * (0.4 + heat);
  // 芯（爆心の方）ほど明るく、斜めに見る縁ほど熱でにじむ。地面に触れる裾はわずかに明るい
  col *= 0.8 + 0.7 * pow(face, 5.0) + 0.3 * smoothstep(0.12, 0.0, vDir.y);
  col = mix(col, vec3(1.0, 0.7, 0.42) * 1.2, pow(1.0 - face, 4.0) * 0.45);
  // 不透明: 少しでも透けると、後ろのとても明るい爆発の球と、それをさえぎる街の影が壁の中に段々の板として見える
  gl_FragColor = vec4(col * uI, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// t: 演出の秒、P: 体感時間（finaleTimeline.perceivedTime）。瓦礫・ガラス片・塵は体感時間で動く（一拍の間はほとんど進まず、
// 時間が戻ると一気に飛び去る）。目が映るガラス片の置き方は演出（cinematic.js）が毎フレーム決める
export function createCinematicProps(scene, eyeTexture, { sunDir = new THREE.Vector3(0.8, 0.42, -0.45).normalize(), tier = 'high' } = {}) {
  const counts = TIER_COUNTS[tier] ?? TIER_COUNTS.mid;
  const group = new THREE.Group();
  group.name = 'cinematicProps';
  group.visible = false;
  scene.add(group);
  const rng = createRng(0xc1e7a);
  const blastPos = new THREE.Vector3(0, 6, 0);

  const shardUniforms = () => ({
    tEye: { value: eyeTexture }, uReflect: { value: 0 }, uLight: { value: 0 }, uFade: { value: 1 }, uSlide: { value: new THREE.Vector2() },
    uBlast: { value: blastPos }, uSunDir: { value: sunDir.clone() },
  });
  const shardMat = (defines) => new THREE.ShaderMaterial({
    uniforms: shardUniforms(), vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, defines,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });

  // 目が映るガラス片（幅 1 の形。大きさは演出が決める）
  const hero = new THREE.Mesh(shardGeometry(rng, 1, HERO_ASPECT, 7, 0.04), shardMat({ EYE: '' }));
  hero.frustumCulled = false;
  hero.name = 'cine-eye-glass';
  hero.renderOrder = 22;
  group.add(hero);

  // 飛んでくる割れた窓ガラス
  const small = new THREE.InstancedMesh(shardGeometry(rng, 1, 1, 5), shardMat({}), counts.shards);
  small.frustumCulled = false;
  small.name = 'cine-glass';
  small.renderOrder = 21;
  group.add(small);

  // コンクリート片と鉄骨の切れ端
  const debrisMat = (base, metal) => new THREE.ShaderMaterial({
    uniforms: { uBase: { value: new THREE.Color(...base) }, uCore: { value: blastPos }, uLight: { value: 0 }, uFade: { value: 1 }, uMetal: { value: metal } },
    vertexShader: DEBRIS_VERT, fragmentShader: DEBRIS_FRAG,
  });
  const chunks = new THREE.InstancedMesh(chunkGeometry(), debrisMat([0.34, 0.32, 0.3], 0), counts.chunks);
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), debrisMat([0.08, 0.075, 0.075], 1), counts.bars);
  for (const m of [chunks, bars]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); }
  small.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // 光の壁（上半分の球。大きさは毎フレームの前線）
  const wallUniforms = { uP: { value: 0 }, uI: { value: 0 }, uFront: { value: 10 } };
  const wall = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
    // 不透明で深さを書く: 不透明の物（街・乗り手・瓦礫）のあとに描き（renderOrder）、手前の物には隠れ、後ろのもの（とても明るい
    // 爆発の球と、それと深さを競う飲まれたビル）は壁の上に描かれない。前は半透明で深さを書かず、後ろの球と街の影が壁の中に
    // 段々の板として見えていた
    uniforms: wallUniforms, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, transparent: false, depthWrite: true,
    defines: { WALL_Q: tier === 'high' ? 2 : tier === 'mid' ? 1 : 0 },
  }));
  wall.frustumCulled = false;
  wall.name = 'cine-wall';
  wall.renderOrder = 17;
  group.add(wall);

  // 粉塵
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(counts.motes * 3), 3));
  const moteAttr = new Float32Array(counts.motes * 4);
  moteGeo.setAttribute('aMote', new THREE.BufferAttribute(moteAttr, 4));
  const moteUniforms = { uP: { value: 0 }, uP0: { value: 0 }, uScale: { value: 300 }, uLight: { value: 0 }, uFlow: { value: new THREE.Vector3() } };
  const motes = new THREE.Points(moteGeo, additive({ uniforms: moteUniforms, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG }));
  motes.frustumCulled = false;
  motes.name = 'cine-motes';
  motes.renderOrder = 23;
  group.add(motes);

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const V = (a) => new THREE.Vector3().fromArray(a);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  let lanes = { shards: [], chunks: [], bars: [] }, ready = false;

  // 線分 a→b と点 c の距離
  const segDist = (a, b, c) => {
    const ab = b.clone().sub(a), t = Math.min(1, Math.max(0, c.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
    return a.clone().addScaledVector(ab, t).distanceTo(c);
  };

  // 光の壁の側からカメラの後ろへ抜ける道。乗り手の体と、目が映るガラス片が通る所をよける
  function makeLane(view, o, size, aspect) {
    const cam = V(view.pos), F = V(view.fwd), R = V(view.right), U = V(view.up);
    const avoid = o.avoid.map(V), rider = [V(o.rider[0]), V(o.rider[1])];
    let S, E;
    for (let k = 0; k < 14; k++) {
      const zs = o.wallDepth + (rng() - 0.35) * 2.5;
      S = cam.clone().addScaledVector(F, zs).addScaledVector(R, (rng() - 0.5) * 2.4 * zs * view.tanH).addScaledVector(U, (rng() - 0.4) * 2.0 * zs * view.tanV);
      let xe = (rng() - 0.5) * 5, ye = (rng() - 0.5) * 4;
      if (Math.abs(xe) < 0.55 && Math.abs(ye) < 0.5) xe = Math.sign(xe || 1) * (0.55 + 0.5 * rng());
      E = cam.clone().addScaledVector(F, -2).addScaledVector(R, xe).addScaledVector(U, ye);
      const nearRider = segDist(S, E, rider[0]) < 0.6 || segDist(S, E, rider[1]) < 0.55 || segDist(S, E, rider[0].clone().lerp(rider[1], 0.5)) < 0.55;
      if (!nearRider && avoid.every((c) => segDist(S, E, c) > 0.55)) break;
    }
    // 一拍の間（体感時間の進みが slowRate）に T 秒かけてカメラの後ろへ抜ける速さ。生まれる時刻は大半が一拍の中
    const T = 1.3 + 2.4 * rng();
    // 白が晴れた直後に生まれたものは、時間が止まる前に飛び過ぎてカメラの前に居座らないよう、一拍のはじめまでに
    // 道の 3 割より先へ進まない速さにする
    const tb = rng() < 0.2 ? o.birth[0] + (o.birth[1] - o.birth[0]) * rng() : o.birth[1] + (o.birth[2] - o.birth[1]) * rng();
    const dir = E.clone().sub(S);
    const len = dir.length();
    dir.divideScalar(len);
    const Pb = o.perceived(tb);
    const speed = Math.min(len / (o.slowRate * T), 0.3 * len / Math.max(1e-6, o.contactP - Pb));
    return {
      S, dir, speed, len, Pb, size, aspect,
      axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      spin: (1.2 + 3.2 * rng()) / (o.slowRate * T), phase: rng() * 6.28,
    };
  }

  function placeLanes(mesh, list, P, front, shape) {
    let vis = 0;
    for (let i = 0; i < list.length; i++) {
      const L = list[i];
      const d = (P - L.Pb) * L.speed;
      if (d <= 0 || d > L.len + 4) { mesh.setMatrixAt(i, ZERO); continue; }
      _p.copy(L.S).addScaledVector(L.dir, d);
      // 光の壁の中のものは見えない（壁から押し出されて現れる）。生まれた直後は小さく
      if (_p.length() < front + WALL_OUT + 0.2) { mesh.setMatrixAt(i, ZERO); continue; }
      const grow = Math.min(1, d / Math.max(0.5, 0.12 * L.len));
      _q.setFromAxisAngle(L.axis, L.phase + L.spin * (P - L.Pb));
      shape(L, grow);
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      vis++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = vis > 0;
  }

  return {
    group,
    heroMesh: hero,
    get counts() { return { shards: small.count, chunks: chunks.count, bars: bars.count, motes: moteGeo.drawRange.count }; },
    // 演出の始まりに: 瓦礫・ガラス片・塵の道を並べる。
    // view: 肩越しのカメラ { pos, fwd, right, up, tanV, tanH }、
    // o: { wallDepth（カメラの前の光の壁までの奥行き）, rider: [バイクの中心, 頭]（よける）, avoid: [よける点...],
    //      perceived(t)（体感時間）, slowRate, birth: [早い, 一拍のはじめ, 遅い]（演出の秒）, contactP（一拍のはじめの体感時間）}
    // tier: 今の画質の段（数。作ったときの段より多くはしない）
    setup(view, o, tier = null) {
      group.visible = true;
      const want = TIER_COUNTS[tier] ?? counts;
      small.count = Math.min(counts.shards, want.shards);
      chunks.count = Math.min(counts.chunks, want.chunks);
      bars.count = Math.min(counts.bars, want.bars);
      const nMotes = Math.min(counts.motes, want.motes);
      moteGeo.setDrawRange(0, nMotes);
      lanes = {
        shards: Array.from({ length: small.count }, () => makeLane(view, o, 0.05 + 0.3 * rng() * rng(), 0.45 + rng())),
        chunks: Array.from({ length: chunks.count }, () => makeLane(view, o, 0.06 + 0.42 * rng() ** 2.2, 0.6 + 0.6 * rng())),
        bars: Array.from({ length: bars.count }, () => makeLane(view, o, 0.4 + 0.9 * rng(), 0.03 + 0.03 * rng())),
      };
      // 塵: カメラの前の空間（0.5〜15 m）。一拍のはじめにこの位置で、そこから光の壁に押されてこちらへ流れる
      const cam = V(view.pos), F = V(view.fwd), R = V(view.right), U = V(view.up);
      const pos = moteGeo.attributes.position;
      for (let i = 0; i < nMotes; i++) {
        const depth = 1.2 + 14 * rng() ** 1.6;
        const p = cam.clone().addScaledVector(F, depth).addScaledVector(R, (rng() - 0.5) * 2.4 * depth * view.tanH).addScaledVector(U, (rng() - 0.5) * 2.4 * depth * view.tanV);
        pos.setXYZ(i, p.x, p.y, p.z);
        moteAttr.set([0.022 + 0.07 * rng() ** 3, 0.3 + 0.7 * rng() ** 2, rng() * 6.28, rng() * 6.28], i * 4);
      }
      pos.needsUpdate = true;
      moteGeo.attributes.aMote.needsUpdate = true;
      moteUniforms.uP0.value = o.contactP;
      moteUniforms.uFlow.value.copy(F).multiplyScalar(-24);
      ready = true;
    },
    // t: 演出の秒、P: 体感時間、light: 光の強さ 0〜1、pointScale: 1 m を画素へ直す係数、fade: 全体の消え方、
    // front: 今の前線の半径（m）、camera: 今のカメラ、
    // hero: 目が映るガラス片 { pos, quat, width, reflect, slide: [x, y] }（null なら出さない）
    // wall: 光の壁の強さ（0 で出さない）
    update({ t, P, light, pointScale, fade = 1, front = 10, camera, hero: h = null, wall: wallI = 0 }) {
      if (!ready) return;
      wall.visible = wallI > 0;
      // 飲まれたビル（とその輪郭の殻）は球の面へ押し付けられるので、光の壁はそれより少し外に置く
      wall.scale.setScalar(front + WALL_OUT);
      wallUniforms.uP.value = P; wallUniforms.uI.value = wallI * fade; wallUniforms.uFront.value = front;
      moteUniforms.uP.value = P;
      moteUniforms.uLight.value = light * fade;
      moteUniforms.uScale.value = pointScale;
      for (const m of [small.material, hero.material, chunks.material, bars.material]) {
        m.uniforms.uLight.value = light;
        m.uniforms.uFade.value = fade;
      }
      placeLanes(small, lanes.shards, P, front, (L, g) => _s.set(L.size * g, L.size * L.aspect * g, 1));
      placeLanes(chunks, lanes.chunks, P, front, (L, g) => _s.set(L.size * g, L.size * L.aspect * g, L.size * g));
      placeLanes(bars, lanes.bars, P, front, (L, g) => _s.set(L.aspect, L.aspect, L.size * g));
      hero.visible = !!h;
      if (h) {
        hero.position.copy(h.pos);
        hero.quaternion.copy(h.quat);
        hero.scale.setScalar(h.width);
        hero.material.uniforms.uReflect.value = h.reflect;
        hero.material.uniforms.uSlide.value.set(h.slide[0], h.slide[1]);
      }
    },
    hide() { group.visible = false; ready = false; },
  };
}
