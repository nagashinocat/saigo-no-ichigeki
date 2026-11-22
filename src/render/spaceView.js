import * as THREE from 'three';
import { createRng } from '../rng.js';
import { SKY_SUN } from './style.js';

// 宇宙からのカメラ（絵コンテ 4〜5）: 夕暮れの地球の丸み、昼と夜の境目、雲、豆粒ほどの街の灯。
// その街から光の半球がふくらみ、衝撃波の輪が雲の上を走る。最後に半球は両側から押しつぶされて縦に伸び、縦一線の光（光の柱）に
// なって細り、消える（R1b、持ち主 08:24「横一線になって消えるところ、縦一線に消えた方がいいかも」）。
// 大きさは誇張している（地球の半径 RE = 1000 単位。光の半球は最大で数十単位）。
// 地球の中心は (0, -RE, 0)、街は地球のてっぺん (0, 0, 0)。

export const RE = 1000;

const EARTH_VERT = /* glsl */`
varying vec3 vN, vW;
void main() {
  vN = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const NOISE = /* glsl */`
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// 段数は uOct（画質の段で変わる。MAX_OCT までで打ち切る）
uniform int uOct;
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < MAX_OCT; i++) { if (i >= uOct) break; v += a * n3(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}`;

const EARTH_FRAG = /* glsl */`
uniform vec3 uSun, uCity;
uniform float uTime, uDome, uGlowR, uRing, uRingI, uScar;
varying vec3 vN, vW;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(n, uSun);
  // 大陸と海（海岸線は細かく）
  float landN = fbm(n * 9.0 + vec3(7.3,0.0,3.1)) + (n3(n * 60.0) - 0.5) * 0.08;
  float land = smoothstep(0.52, 0.535, landN);
  vec3 ocean = vec3(0.01, 0.04, 0.1);
  vec3 ground = mix(vec3(0.08, 0.085, 0.045), vec3(0.16, 0.12, 0.07), n3(n * 90.0));
  vec3 surf = mix(ocean, ground, land);
  // 雲: 渦を巻くようにゆがめた fbm。衝撃波の輪の内側は押しのけられて薄くなり、輪の上に寄せ集まる
  vec3 wq = vec3(fbm(n * 9.0), fbm(n * 9.0 + 5.2), 0.0) * 1.6;
  float cl = fbm(n * 30.0 + wq + vec3(0.0, 0.0, uTime * 0.02));
  cl += (n3(n * 160.0) - 0.5) * 0.12;
  float ang = acos(clamp(dot(n, uCity), -1.0, 1.0));
  // 輪の前の縁は鋭く、後ろへ尾を引く。雲の濃いところほど明るく、ちぎれる
  float dr = ang - uRing;
  float ring = (dr > 0.0 ? exp(-pow(dr / 0.0012, 2.0)) : exp(dr / 0.0025)) * uRingI;
  ring *= 0.45 + 0.55 * smoothstep(0.3, 0.7, n3(n * 260.0 + vec3(uTime * 0.3)));
  float wake = smoothstep(uRing, uRing - 0.03, ang) * uRingI;
  float cloud = smoothstep(0.46, 0.7, cl) * (1.0 - 0.8 * wake);
  cloud = max(cloud, ring * 0.9);
  // 昼・夕暮れ・夜
  float day = smoothstep(-0.02, 0.22, ndl);
  float tw = exp(-pow((ndl - 0.0) / 0.045, 2.0));
  vec3 dayC = mix(surf * 1.5, vec3(0.9, 0.92, 0.96), cloud) * (0.18 + 1.0 * max(ndl, 0.0));
  vec3 dusk = vec3(1.0, 0.36, 0.13) * cloud * tw * 0.9 + vec3(0.06, 0.02, 0.01) * tw;
  vec3 night = mix(surf * 0.06, vec3(0.02, 0.026, 0.05), cloud);
  // 夜の街の灯: 陸の上の細かな点
  vec3 gp = n * 700.0, g = floor(gp);
  vec3 off = vec3(h31(g + 1.0), h31(g + 2.0), h31(g + 4.0)) * 0.6 + 0.2;
  float pt = 1.0 - smoothstep(0.08, 0.2, length(fract(gp) - off));
  float lights = step(0.9, h31(g)) * pt * land * smoothstep(0.4, 0.62, n3(n * 25.0)) * (1.0 - cloud * 0.85);
  night += vec3(1.0, 0.68, 0.32) * lights * (0.6 + 1.2 * h31(g + 3.0));
  vec3 col = mix(night, dayC, day) + dusk;
  // 海に映る低い太陽
  float glint = pow(max(dot(reflect(-V, n), uSun), 0.0), 40.0) * (1.0 - land) * (1.0 - cloud) * smoothstep(-0.05, 0.05, ndl);
  col += vec3(1.0, 0.6, 0.3) * glint * 1.5;
  // 光の半球が雲と地表を照らす（下から照らされた雲は熱く光る）
  float glow = exp(-ang / max(uGlowR, 1e-4)) * uDome;
  glow *= glow > 0.0 ? 1.0 : 0.0;
  col += vec3(1.0, 0.5, 0.2) * glow * (0.25 + 1.4 * cloud);
  col += vec3(1.0, 0.95, 0.9) * glow * glow * 0.5;
  // 衝撃波の輪: 雲の上を走る白い輪と、その外の淡い光
  col += vec3(0.9, 0.95, 1.0) * ring * (0.35 + 2.2 * cloud) * 1.4;
  col += vec3(1.0, 0.62, 0.32) * exp(-pow((ang - uRing) / 0.012, 2.0)) * uRingI * (0.15 + 0.5 * cloud);
  // 消えたあとに残る、焼けた街の灯
  col += vec3(1.0, 0.35, 0.08) * exp(-ang / 0.009) * uScar;
  // 大気のかすみ（縁ほど空の色）
  float fres = pow(1.0 - max(dot(n, V), 0.0), 7.0);
  vec3 haze = vec3(0.22, 0.42, 0.95) * smoothstep(0.0, 0.3, ndl) * 0.9 + vec3(1.0, 0.36, 0.12) * exp(-pow(ndl / 0.06, 2.0)) * 0.7;
  col = mix(col, haze, fres * 0.5);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 大気の殻（裏側を描く）。縁で明るく、日の当たる側は青、境目は橙、夜は消える
const ATMO_VERT = /* glsl */`
varying vec3 vN, vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ATMO_FRAG = /* glsl */`
uniform vec3 uSun, uCenter;
uniform float uRadius, uShell;
varying vec3 vN, vW;
void main() {
  // 視線が地球の中心をどれだけ離れて通るか（地表の半径 = 1、殻の外 = uShell）
  vec3 D = normalize(vW - cameraPosition);
  vec3 oc = cameraPosition - uCenter;
  float tc = -dot(oc, D);
  float b = length(oc + D * tc) / uRadius;
  float k = clamp((uShell - b) / (uShell - 1.0), 0.0, 1.0);
  float rim = pow(k, 2.2) * smoothstep(1.0, 0.985, b + 0.0) * 0.0 + pow(k, 2.5);
  vec3 limb = normalize(oc + D * tc);
  float s = dot(limb, uSun);
  vec3 c = mix(vec3(1.0, 0.36, 0.1), vec3(0.32, 0.58, 1.0), smoothstep(-0.02, 0.3, s));
  c = mix(c, vec3(1.0, 0.75, 0.45), exp(-pow((s - 0.02) / 0.08, 2.0)) * 0.6);
  float lit = smoothstep(-0.28, 0.1, s);
  gl_FragColor = vec4(c * rim * lit * 2.2, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */`
attribute float aB;
varying float vB;
void main() {
  vB = aB;
  gl_PointSize = 1.0 + aB * 1.6;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;
const STAR_FRAG = /* glsl */`
uniform float uFade;
varying float vB;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  gl_FragColor = vec4(vec3(0.8, 0.85, 1.0) * (1.0 - smoothstep(0.3, 1.0, r)) * vB * uFade, 0.0);
}`;

// 太陽: 地平の向こうから昇りかけの光（地球が手前をふさぐので、縁からこぼれる光になる）
const SUN_FRAG = /* glsl */`
varying vec2 vUv;
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  float core = exp(-d * d * 260.0) * 30.0;
  float halo = exp(-d * 7.0) * 1.3 + exp(-d * 2.4) * 0.25;
  float ang = atan(q.y, q.x);
  float rays = pow(abs(cos(ang * 3.0)), 40.0) * exp(-d * 3.5) * 0.8;
  vec3 col = vec3(1.0, 0.92, 0.8) * core + vec3(1.0, 0.62, 0.3) * halo + vec3(1.0, 0.8, 0.6) * rays;
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 光の半球: 中心は白く、縁ほど金から橙、輪郭に熱く光る線。押しつぶされると細く高い光の柱になる（R1b）
const DOME_VERT = /* glsl */`
varying vec3 vN, vW, vL;
void main() {
  vL = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DOME_FRAG = /* glsl */`
uniform float uI, uTime, uFlat;
varying vec3 vN, vW, vL;
${NOISE}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float mu = abs(dot(normalize(vN), V));
  vec3 d = normalize(vL);
  float n = fbm(d * 6.0 + vec3(0.0, -uTime * 0.8, 0.0));
  // 中は白く、縁へ金・橙。表面に流れる熱の模様、根元は地面に押し付けられて一番明るい
  vec3 core = vec3(1.0, 0.95, 0.88) * 1.15;
  vec3 edge = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.75, 0.4), n) * 1.6;
  vec3 col = mix(edge, core, smoothstep(0.15, 0.85, mu) * (0.75 + 0.25 * n));
  col += vec3(1.0, 0.85, 0.6) * smoothstep(0.12, 0.0, d.y) * 2.0 * (1.0 - uFlat);
  // 押しつぶされるほど、縁から溶けて縦の光の柱（真ん中の軸）へ吸い込まれる
  col *= 1.0 - uFlat * smoothstep(0.3, 0.95, length(vL.xz));
  // 輪郭の冷たく細い光
  col += vec3(0.7, 0.82, 1.0) * pow(1.0 - mu, 8.0) * 3.0 * (1.0 - uFlat);
  gl_FragColor = vec4(col * uI, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 縦一線の光（R1b）: 街から真上へ立つ細い光の柱（カメラの向きに合わせた板。板の縦 vUv.y が柱の長さ、0 が街の足もと）。
// uThin で細くなる。上へ行くほど淡く、足もとは街に押し当てた明るい根
const LINE_FRAG = /* glsl */`
uniform float uI, uThin;
varying vec2 vUv;
void main() {
  float x = (vUv.x - 0.5) * 2.0, y = vUv.y;
  float w = mix(0.22, 0.012, uThin);
  float along = smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.45, 1.0, y));
  float core = exp(-pow(x / w, 2.0)) * along;
  float glow = exp(-abs(x) / (w * 6.0)) * smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.15, 0.9, y)) * 0.35;
  float root = exp(-pow(x / (w * 3.0), 2.0)) * exp(-pow((y - 0.05) / 0.05, 2.0)) * 1.5;
  vec3 col = vec3(1.0, 0.97, 0.92) * (core * 6.0 + root) + vec3(1.0, 0.6, 0.3) * glow;
  gl_FragColor = vec4(col * uI, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const PLAIN_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const additive = (opts) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, ...opts,
});

// 段ごとの重さ: 雲の fbm の段数、球の分割、星の数
const TIER = {
  high: { oct: 5, seg: 160, stars: 1800 },
  mid: { oct: 4, seg: 112, stars: 1000 },
  low: { oct: 3, seg: 72, stars: 500 },
};

// tier: 作るときの段（球の分割と、星・雲の段数の上限）。setTier で、それより軽い段へ下げられる
export function createSpaceView(tier = 'high') {
  const T = TIER[tier] ?? TIER.mid;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 30000);
  // 太陽: 街のすぐ地平の下（日が沈んだ直後）。街の空に見える夕日と同じ方角・同じ低さ（style.js の SKY_SUN。カメラから見て右奥）
  const sun = SKY_SUN.clone();
  const city = new THREE.Vector3(0, 1, 0);
  const center = new THREE.Vector3(0, -RE, 0);

  const earthU = {
    uSun: { value: sun }, uCity: { value: city }, uTime: { value: 0 },
    uDome: { value: 0 }, uGlowR: { value: 0.02 }, uRing: { value: 0 }, uRingI: { value: 0 }, uScar: { value: 0 },
    uOct: { value: T.oct },
  };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(RE, T.seg, T.seg / 2),
    new THREE.ShaderMaterial({ uniforms: earthU, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG, defines: { MAX_OCT: T.oct } }));
  earth.position.copy(center);
  scene.add(earth);

  const SHELL = 1.009;
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(RE * SHELL, T.seg / 2, T.seg / 4),
    additive({ uniforms: { uSun: { value: sun }, uCenter: { value: center }, uRadius: { value: RE }, uShell: { value: SHELL } }, vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide }));
  atmo.position.copy(center);
  scene.add(atmo);

  // 星
  const rng = createRng(0x57a5);
  const sp = new Float32Array(T.stars * 3), sb = new Float32Array(T.stars);
  for (let i = 0; i < T.stars; i++) {
    const u = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    sp.set([Math.cos(a) * r * 20000, u * 20000, Math.sin(a) * r * 20000], i * 3);
    sb[i] = rng() ** 3;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  starGeo.setAttribute('aB', new THREE.Float32BufferAttribute(sb, 1));
  const starU = { uFade: { value: 1 } };
  const stars = new THREE.Points(starGeo, additive({ uniforms: starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG }));
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  scene.add(stars);

  const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive({ vertexShader: PLAIN_VERT, fragmentShader: SUN_FRAG, depthTest: true }));
  sunMesh.position.copy(sun).multiplyScalar(18000);
  sunMesh.scale.setScalar(4200);
  sunMesh.renderOrder = 1;
  scene.add(sunMesh);

  const domeU = { uI: { value: 0 }, uTime: { value: 0 }, uFlat: { value: 0 }, uOct: { value: 3 } };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    additive({ uniforms: domeU, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, defines: { MAX_OCT: 3 }, side: THREE.DoubleSide }));
  dome.renderOrder = 2;
  dome.position.set(0, -0.3, 0);
  scene.add(dome);

  // 衝撃波の殻（半球のまわりにふくらむ薄い光の膜。縁だけが光る）
  const shellU = { uI: { value: 0 } };
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), additive({
    uniforms: shellU, side: THREE.DoubleSide,
    vertexShader: DOME_VERT,
    fragmentShader: `uniform float uI; varying vec3 vN, vW, vL;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float mu = abs(dot(normalize(vN), V));
        float rim = pow(1.0 - mu, 4.0);
        vec3 col = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.75, 0.5), rim) * (rim * 1.4 + 0.05);
        gl_FragColor = vec4(col * uI, 0.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  shell.renderOrder = 2;
  shell.position.set(0, -0.3, 0);
  scene.add(shell);

  const lineU = { uI: { value: 0 }, uThin: { value: 0 } };
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive({ uniforms: lineU, vertexShader: PLAIN_VERT, fragmentShader: LINE_FRAG, depthTest: false }));
  line.renderOrder = 3;
  line.frustumCulled = false;
  scene.add(line);

  // fix1: 街を見回る軍勢の光（緑の点）と、光の半球に飲まれた瞬間の火花（宇宙からも「街じゅうの軍勢が消える」のが読める）
  const SPARK_MAX = 128;
  const spPos = new THREE.BufferAttribute(new Float32Array(SPARK_MAX * 3), 3), spAge = new THREE.BufferAttribute(new Float32Array(SPARK_MAX), 1);
  spPos.setUsage(THREE.DynamicDrawUsage); spAge.setUsage(THREE.DynamicDrawUsage);
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', spPos); spGeo.setAttribute('aAge', spAge); spGeo.setDrawRange(0, 0);
  const sparks = new THREE.Points(spGeo, additive({
    uniforms: { uPR: { value: 1 } }, depthTest: false,
    vertexShader: `attribute float aAge; uniform float uPR; varying float vA; varying float vF;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        if (aAge < 0.0) { vA = 0.75; vF = 0.0; gl_PointSize = 2.6 * uPR; }
        else { float u = clamp(aAge / 0.7, 0.0, 1.0); vA = (1.0 - u) * (1.0 - u); vF = 1.0; gl_PointSize = (6.0 + 22.0 * sqrt(u)) * uPR; }
      }`,
    fragmentShader: `varying float vA; varying float vF;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
        vec3 g = vec3(0.45, 1.0, 0.7);
        vec3 c = mix(g * (exp(-r * 8.0) * 1.4 + exp(-r * 2.5) * 0.4), vec3(1.0, 1.0, 0.92) * exp(-r * 6.0) * 2.0 + g * exp(-r * 2.0) * 0.5, vF);
        gl_FragColor = vec4(c * vA, 0.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sparks.renderOrder = 4;
  sparks.frustumCulled = false;
  scene.add(sparks);

  const _qz = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _dir = new THREE.Vector3(), _look = new THREE.Vector3(), _upL = new THREE.Vector3();
  let camRoll = 0;

  return {
    scene, camera,
    sunDir: sun,
    // カメラの置き方: 街から地平の方へ dist だけ離れ、高さ alt から、街の少し先の地平を見る。
    // 縦長の画面では横の画角を、横長の画面では縦の画角を決める。roll: 地平の傾き（ラジアン）
    aim({ aspect, dist, alt, lookAhead, lookUp, fovH = 50, fovV = 30, roll = 0 }) {
      camera.aspect = aspect;
      const vf = aspect < 1 ? 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fovH) / 2) / aspect) : THREE.MathUtils.degToRad(fovV);
      camera.fov = THREE.MathUtils.radToDeg(vf);
      // カメラは街の手前（+z）、見る先は街の向こう（-z）。地球の丸みに沿って高さを付ける
      const dir = _dir.set(0, 0, dist).sub(center).normalize();
      camera.position.copy(center).addScaledVector(dir, RE + alt);
      camera.up.copy(dir);
      camera.lookAt(_look.set(0, lookUp, -lookAhead));
      camera.rotateZ(roll);
      camRoll = roll;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    },
    // 光の半球の大きさ r（単位）、押しつぶし flat 0〜1（R1b: 1 で幅 0。両側から押されて縦へ伸び、光の柱になる）、明るさ I。
    // stretch（R1d）: 押しつぶしきったときの高さの伸び（高さ r·(1 + stretch·flat)。縦長の画面で上の端を越えないよう演出が決める）
    setDome(r, flat, I, time, stretch = 2.5) {
      const f = Math.min(1, Math.max(0, flat));
      const wide = Math.max(0.002, 1 - f);
      const h = 1 + f * Math.max(0, stretch);
      dome.scale.set(r * wide, r * h, r * wide);
      dome.visible = I > 0.001 && r > 0.01;
      domeU.uI.value = I;
      domeU.uTime.value = time;
      domeU.uFlat.value = flat;
      earthU.uTime.value = time;
      earthU.uDome.value = I * Math.min(1, r / 6) * (1 - 0.5 * flat);
      earthU.uGlowR.value = Math.max(0.002, (r * wide) / RE * 0.7);
    },
    // 衝撃波の輪: 半径 r（単位、地表に沿った距離）、強さ I
    setRing(r, I) {
      earthU.uRing.value = r / RE;
      earthU.uRingI.value = I;
    },
    // 縦一線の光（R1b）: 長さ len、太さ thick（単位）、細くなる thin 0〜1、明るさ I。画面にまっすぐ立つよう、カメラの傾きを戻した
    // 縦向きに置き、下の端を街（の少し下）に当てて上へ伸ばす
    setLine(len, thick, thin, I) {
      line.visible = I > 0.001;
      lineU.uI.value = I;
      lineU.uThin.value = thin;
      // 画面に向けた板を、カメラの傾きの分だけ戻す（地平に垂直に）
      line.quaternion.copy(camera.quaternion).multiply(_qz.setFromAxisAngle(_z, -camRoll));
      _upL.set(0, 1, 0).applyQuaternion(line.quaternion);
      line.position.copy(_upL).multiplyScalar(len * 0.47);
      line.scale.set(thick, len, 1);
    },
    setScar(I) { earthU.uScar.value = I; },
    // list: [{ x, z, age }]（宇宙の座標。age は飲まれてからの秒、生きていれば -1）、pixelRatio: 画素比
    setSparks(list, pixelRatio = 1) {
      const n = Math.min(SPARK_MAX, list.length);
      for (let i = 0; i < n; i++) { spPos.setXYZ(i, list[i].x, 0.15, list[i].z); spAge.setX(i, list[i].age); }
      spGeo.setDrawRange(0, n);
      spPos.needsUpdate = spAge.needsUpdate = true;
      sparks.material.uniforms.uPR.value = pixelRatio;
    },
    // 衝撃波の殻: 半径 r（単位）、明るさ I
    setShell(r, I) {
      shell.visible = I > 0.001;
      shell.scale.set(r, r * 0.85, r);
      shellU.uI.value = I;
    },
    setStars(f) { starU.uFade.value = f; },
    // 画質の段を合わせる（作ったときの段より重くはしない）: 雲の fbm の段数と、描く星の数
    setTier(t) {
      const U = TIER[t] ?? TIER.mid;
      earthU.uOct.value = Math.min(T.oct, U.oct);
      starGeo.setDrawRange(0, Math.min(T.stars, U.stars));
    },
    get tierInfo() { return { oct: earthU.uOct.value, stars: starGeo.drawRange.count === Infinity ? T.stars : starGeo.drawRange.count }; },
    warmup(renderer) {
      dome.visible = line.visible = shell.visible = true;
      renderer.compile(scene, camera);
    },
  };
}
