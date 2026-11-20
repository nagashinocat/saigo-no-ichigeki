import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight } from './sphereDeform.js';

// 街の中の人の姿: 謎の軍勢（InstancedMesh、歩く・しがみつく動きは頂点シェーダー）と、広場に立つ主人公。
// 軍勢は揃いの暗い装備で、顔はヘルメットと覆面でほぼ隠れ、目の部分だけ開いている。目は光を受けて光る。
// 上空カメラ（約 380m 先）では 2m の人は 2px ほどにしかならないので、遠いほど少し大きく描き（最大 ENEMY_LOOK.maxBoost 倍）、
// ビルに隠れた者は、隠れた部分だけ暗い青の影絵で上に重ねる（深さが奥のときだけ描くもう一つのパス）。

export const ENEMY_LOOK = {
  height: 1.8,      // m
  minPx: 9,         // 画面の上でこの高さ（px）より小さければ大きく描く
  maxBoost: 2.6,
  clingRadius: 0.55, // 掴んでいる者は主人公のこの距離にしがみつく（m）
  deadFling: 1.1,    // 倒れた者が吹き飛んで消えるまで（s）
};
const CAPACITY = 160;
const WALK_RATE = 9.0; // rad/s。走る足の運び

// 軍勢の位置。angle はワールドの x 軸から z 軸へ回る向き
export function enemyXZ(e, dist = e.dist) {
  return [Math.cos(e.angle) * dist, Math.sin(e.angle) * dist];
}

const srgb = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// 部位: 0 胴, 1 頭, 2 左腕, 3 右腕, 4 左脚, 5 右脚, 6 目。10 以上は動かない（主人公）
function part(geo, id, pivot, color) {
  const g = geo;
  const n = g.attributes.position.count;
  const c = srgb(color);
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
  const pv = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pv.set(pivot, i * 3); col.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
const at = (geo, x, y, z) => geo.translate(x, y, z);
const capsule = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 3, seg);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);

// 兵士。+z が前、足元が y=0。体の色は暗い灰緑の上下、胸と肩の板、黒い覆面、鈍い色のヘルメット。
export function buildSoldierGeometry() {
  const SUIT = '#2c3133', PLATE = '#3b4240', DARK = '#191c1f', HELM = '#30363c', BOOT = '#141617';
  const hip = [0, 0.95, 0], neck = [0, 1.5, 0];
  const parts = [
    // 胴: 上着・胸の板・背の箱・腰のベルト
    part(at(capsule(0.17, 0.36), 0, 1.2, 0).scale(1.25, 1, 0.8), 0, hip, SUIT),
    part(at(box(0.4, 0.3, 0.12), 0, 1.3, 0.1), 0, hip, PLATE),
    part(at(box(0.32, 0.36, 0.16), 0, 1.25, -0.18), 0, hip, DARK),
    part(at(box(0.42, 0.07, 0.3), 0, 0.98, 0), 0, hip, DARK),
    part(at(box(0.16, 0.08, 0.28), 0.22, 1.42, 0), 0, hip, PLATE), // 肩の板
    part(at(box(0.16, 0.08, 0.28), -0.22, 1.42, 0), 0, hip, PLATE),
    // 頭: 覆面の頭とヘルメット（前のつばが目の上にかぶさる）
    part(at(ball(0.115).scale(1, 1.15, 1.05), 0, 1.63, 0), 1, neck, DARK),
    part(at(ball(0.135, 14, 8).scale(1.05, 0.8, 1.12), 0, 1.7, -0.01), 1, neck, HELM),
    part(at(box(0.25, 0.035, 0.08), 0, 1.675, 0.1), 1, neck, HELM),
    // 目（覆面の細い開きから見える）
    part(at(box(0.04, 0.016, 0.02), 0.04, 1.648, 0.118), 6, neck, '#ffffff'),
    part(at(box(0.04, 0.016, 0.02), -0.04, 1.648, 0.118), 6, neck, '#ffffff'),
    // 腕（肩から下へ）と手袋
    part(at(capsule(0.06, 0.5), 0.27, 1.13, 0), 2, [0.27, 1.42, 0], SUIT),
    part(at(capsule(0.06, 0.5), -0.27, 1.13, 0), 3, [-0.27, 1.42, 0], SUIT),
    part(at(ball(0.06), 0.27, 0.83, 0.01), 2, [0.27, 1.42, 0], DARK),
    part(at(ball(0.06), -0.27, 0.83, 0.01), 3, [-0.27, 1.42, 0], DARK),
    // 脚と長靴
    part(at(capsule(0.085, 0.62), 0.11, 0.55, 0), 4, [0.11, 0.92, 0], SUIT),
    part(at(capsule(0.085, 0.62), -0.11, 0.55, 0), 5, [-0.11, 0.92, 0], SUIT),
    part(at(box(0.13, 0.16, 0.26), 0.11, 0.08, 0.04), 4, [0.11, 0.92, 0], BOOT),
    part(at(box(0.13, 0.16, 0.26), -0.11, 0.08, 0.04), 5, [-0.11, 0.92, 0], BOOT),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

// 主人公: 黒に近い紺の上着、薄い色の襟巻き。両腕を前へ出し、胸の前で両手の手のひらを向き合わせて立つ（動かない）。+z が前
export function buildHeroGeometry() {
  const COAT = '#2a2840', PANTS = '#23252c', SCARF = '#d9d2c4', SKIN = '#c99a7f', HAIR = '#1a1714';
  const parts = [
    part(at(capsule(0.17, 0.42), 0, 1.15, 0).scale(1.2, 1, 0.75), 10, [0, 0, 0], COAT),
    part(at(box(0.44, 0.5, 0.26), 0, 0.82, 0), 10, [0, 0, 0], COAT), // 上着の裾
    part(at(capsule(0.1, 0.1), 0, 1.47, 0).scale(1.4, 1, 1.3), 10, [0, 0, 0], SCARF),
    part(at(ball(0.11), 0, 1.66, 0), 10, [0, 0, 0], SKIN),
    part(at(ball(0.122, 12, 8).scale(1.02, 0.9, 1.08), 0, 1.71, -0.02), 10, [0, 0, 0], HAIR),
    // 両腕: 肩から前へ、少し内へ
    part(at(capsule(0.055, 0.46).rotateX(-1.2).rotateY(-0.35), 0.19, 1.3, 0.22), 10, [0, 0, 0], COAT),
    part(at(capsule(0.055, 0.46).rotateX(-1.2).rotateY(0.35), -0.19, 1.3, 0.22), 10, [0, 0, 0], COAT),
    part(at(ball(0.06).scale(0.6, 1.1, 1), 0.07, 1.38, 0.46), 10, [0, 0, 0], SKIN),
    part(at(ball(0.06).scale(0.6, 1.1, 1), -0.07, 1.38, 0.46), 10, [0, 0, 0], SKIN),
    part(at(capsule(0.08, 0.66), 0.1, 0.42, 0), 10, [0, 0, 0], PANTS),
    part(at(capsule(0.08, 0.66), -0.1, 0.42, 0.02), 10, [0, 0, 0], PANTS),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

const FIGURE_VERT = /* glsl */`
attribute float aPart;
attribute vec3 aPivot;
attribute vec3 aCol;
attribute vec4 aAnim; // x: 足の運びの位相, y: しがみつき 0〜1, z: 大きさ, w: 残り（倒れて消える）
uniform float uTime, uPx, uMinPx, uMaxBoost, uHeight;
varying vec3 vN, vW, vCol;
varying float vPart, vFar;
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
void main() {
  vec3 p = position, n = normal;
  float ph = aAnim.x + uTime * ${WALK_RATE.toFixed(2)};
  float s = sin(ph), g = aAnim.y, walk = 1.0 - g;
  if (aPart < 9.5) {
    // 手足を付け根で回す
    float a = 0.0;
    if (aPart > 1.5 && aPart < 2.5) a = -s * 0.65 * walk - 1.5 * g;
    if (aPart > 2.5 && aPart < 3.5) a = s * 0.65 * walk - 1.5 * g;
    if (aPart > 3.5 && aPart < 4.5) a = s * 0.75 * walk - 0.45 * g;
    if (aPart > 4.5 && aPart < 5.5) a = -s * 0.75 * walk - 0.3 * g;
    if (a != 0.0) { p = aPivot + rotX(p - aPivot, a); n = rotX(n, a); }
    // 上半身は前へ傾く（走る、しがみつく）
    bool upper = aPart < 3.5 || aPart > 5.5;
    if (upper) {
      float lean = 0.2 * walk + 0.55 * g;
      vec3 hip = vec3(0.0, 0.95, 0.0);
      p = hip + rotX(p - hip, lean);
      n = rotX(n, lean);
    }
    p.y += abs(cos(ph)) * 0.05 * walk;
  }
  // 遠くで小さすぎる者は、足元を中心に大きく描く
  vec4 base = modelMatrix * instanceMatrix * vec4(0.0, uHeight * 0.5, 0.0, 1.0);
  float dist = max(1.0, distance(base.xyz, cameraPosition));
  float px = uHeight * aAnim.z * uPx / dist;
  float boost = clamp(uMinPx / max(px, 1e-3), 1.0, uMaxBoost);
  vFar = smoothstep(uMinPx * 4.0, uMinPx * 1.5, px);
  p *= aAnim.z * boost * aAnim.w;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vCol = aCol;
  vPart = aPart;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FIGURE_FRAG = /* glsl */`
uniform vec3 uSunDir, uSun, uSky, uGround, uBlast, uEye;
uniform float uGlow;
varying vec3 vN, vW, vCol;
varying float vPart, vFar;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(N, uSunDir);
  float sun = 0.5 * smoothstep(0.02, 0.1, ndl) + 0.5 * smoothstep(0.38, 0.46, ndl);
  vec3 toC = normalize(vec3(0.0, 6.0, 0.0) - vW);
  float blast = max(dot(N, toC), 0.0) * uGlow;
  vec3 light = mix(uGround, uSky, N.y * 0.5 + 0.5) * 0.55 + uSun * sun * 1.1 + uBlast * blast * 2.4;
  vec3 col = vCol * light;
  // 縁の光（夕日の側と、爆心の側）
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += (uSun * max(ndl, 0.0) * 0.5 + uBlast * uGlow * 0.8) * rim * 0.6;
  if (vPart > 5.5 && vPart < 6.5) {
    // 目: 光を受けて光る（夕日と爆心の光で強くなる）
    col = uEye * (1.4 + 1.6 * vFar + 3.5 * uGlow + 0.8 * max(ndl, 0.0));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ビルに隠れた部分だけを描く影絵（遠くの者だけ。近くでは自分の体の重なりが透けて見えるので消す）
const XRAY_FRAG = /* glsl */`
uniform vec3 uXray, uEye;
uniform float uGlow;
varying float vPart, vFar;
void main() {
  bool eye = vPart > 5.5 && vPart < 6.5;
  vec3 col = eye ? uEye * (1.2 + 2.0 * uGlow) : uXray;
  gl_FragColor = vec4(col, (eye ? 0.9 : 0.55) * vFar);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 遠くの者の目印: 頭の位置に、画面の上で決まった大きさの暗い丸と、光る目の横線。
// 見えている者は濃く、ビルに隠れた者は薄く（深さが奥のときだけ描くもう一つのパス）。近くでは消える。
const MARKER_VERT = /* glsl */`
uniform float uPx, uMinPx, uHeight, uMarker;
varying float vFar;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = max(1.0, distance(wp.xyz, cameraPosition));
  float px = uHeight * uPx / dist;
  vFar = smoothstep(uMinPx * 3.0, uMinPx * 1.2, px);
  gl_PointSize = uMarker * vFar;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const MARKER_FRAG = /* glsl */`
uniform vec3 uEye;
uniform float uAlpha, uGlow;
varying float vFar;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float rim = smoothstep(0.7, 0.85, r) * (1.0 - smoothstep(0.92, 1.0, r));
  vec3 col = mix(vec3(0.03, 0.035, 0.05), vec3(0.75, 0.8, 0.95), rim);
  float eye = (1.0 - smoothstep(0.1, 0.22, abs(q.y + 0.05))) * (1.0 - smoothstep(0.45, 0.6, abs(q.x))) * step(0.08, abs(q.x));
  col = mix(col, uEye * (2.0 + 2.0 * uGlow), eye);
  gl_FragColor = vec4(col, uAlpha * vFar * (1.0 - smoothstep(0.92, 1.0, r)));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function figureUniforms(sunDir) {
  return {
    uTime: { value: 0 }, uPx: { value: 500 }, uMinPx: { value: ENEMY_LOOK.minPx }, uMaxBoost: { value: ENEMY_LOOK.maxBoost },
    uHeight: { value: ENEMY_LOOK.height }, uGlow: { value: 0 },
    uSunDir: { value: sunDir.clone() },
    uSun: { value: new THREE.Color(1.0, 0.66, 0.4) }, uSky: { value: new THREE.Color(0.46, 0.54, 1.0) },
    uGround: { value: new THREE.Color(0.55, 0.4, 0.42) }, uBlast: { value: new THREE.Color(1.0, 0.78, 0.5) },
    uEye: { value: new THREE.Color(1.0, 0.93, 0.8) }, uXray: { value: srgb('#5d6f95') },
    uMarker: { value: 11 },
  };
}

// ---- 目のアップ（演出で、ガラスなどに映る）。2:1 の板に、ヘルメットのつば・覆面・目の開きを描く ----
const EYE_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const EYE_FRAG = /* glsl */`
uniform float uTime, uSeed, uOpen, uGlow, uLook;
uniform vec3 uIris, uSkin;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
// 片目。q は目の中心からの位置（横 ±0.36 が目の幅）。side: 外側（目じり）の向き。
// uOpen 0: 重く平らな上まぶたを目頭へ下げた、細く硬いにらみ。1: 黒目の上下に白目が見える、凍りついた見開き。
vec4 eye(vec2 q, float side, inout vec3 col) {
  float x = q.x * side; // 正が目じり
  float a = 0.36;
  float t = clamp(x / a, -1.0, 1.0);
  float w = max(1.0 - t * t, 0.0);
  float up = mix(0.045, 0.15, uOpen) * pow(w, 0.35) + mix(0.06, 0.02, uOpen) * t - mix(0.012, 0.0, uOpen);
  float lo = -mix(0.05, 0.1, uOpen) * pow(w, 0.8) + 0.015 * t;
  float inside = step(abs(x), a) * step(lo, q.y) * step(q.y, up);
  // 上まぶたの太く平らな線（目じりで跳ねずに切れる）と、まぶたの影
  float upLine = (1.0 - smoothstep(0.0, 0.016 + 0.01 * w, abs(q.y - up - 0.008))) * smoothstep(a + 0.02, a - 0.04, abs(x));
  float loLine = (1.0 - smoothstep(0.0, 0.006, abs(q.y - lo))) * smoothstep(a, a * 0.2, abs(x)) * 0.8;
  // 白目: くすんだ色。上まぶたの影、目じりと目頭に細い血の筋
  vec3 white = mix(vec3(0.42, 0.42, 0.44), vec3(0.78, 0.76, 0.72), smoothstep(up, up - 0.1, q.y));
  float vein = smoothstep(0.86, 0.97, vn(vec2(q.x * 46.0 + side * 3.0, q.y * 14.0 + uSeed * 9.0))) * smoothstep(0.35, 0.95, abs(t));
  white = mix(white, vec3(0.55, 0.12, 0.1), vein * 0.75);
  vec3 c = white;
  // 黒目は小さく、瞳は光が迫るほど点になる。細かく震える
  vec2 ic = vec2(uLook * 0.04 * side, -0.004);
  float ri = 0.074;
  vec2 d = (q - ic) * vec2(side, 1.0);
  float r = length(d) / ri;
  if (r < 1.0) {
    vec3 iris = mix(uIris * 0.3, uIris * 0.95, smoothstep(0.7, -0.8, d.y / ri));
    float ang = atan(d.y, d.x);
    iris *= 0.8 + 0.3 * vn(vec2(ang * 9.0, r * 4.0));
    iris = mix(iris, vec3(0.02), smoothstep(0.75, 0.97, r)); // 縁の黒い輪
    float pr = mix(0.4, 0.14, uGlow);
    iris = mix(vec3(0.008), iris, smoothstep(pr - 0.05, pr + 0.05, r));
    c = iris;
  }
  // 小さく鋭い光ひとつ（左上）と、迫る爆発の橙の点（育つ）
  c = mix(c, vec3(2.6), 1.0 - smoothstep(0.008, 0.012, length(d - vec2(-0.03, 0.03))));
  float ob = 1.0 - smoothstep(0.003 + 0.016 * uGlow, 0.006 + 0.02 * uGlow, length(d - vec2(0.022, -0.02)));
  c = mix(c, vec3(4.0, 1.9, 0.6) * (0.6 + uGlow), ob * (0.3 + 0.7 * uGlow));
  c *= 1.0 - 0.7 * smoothstep(up - 0.045, up, q.y); // 上まぶたが落とす濃い影
  col = mix(col, c, inside);
  col = mix(col, vec3(0.02, 0.015, 0.018), clamp(upLine, 0.0, 1.0));
  col = mix(col, uSkin * 0.3, loLine);
  // 下まぶたの下の暗いくま
  float bag = smoothstep(0.0, -0.03, q.y - lo) * smoothstep(-0.11, -0.03, q.y - lo) * smoothstep(a, 0.0, abs(x));
  col *= 1.0 - 0.45 * bag;
  return vec4(col, inside);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(2.0, 1.0); // x: -1..1, y: -0.5..0.5
  p += vec2(sin(uTime * 61.0), cos(uTime * 47.0)) * 0.0025 * (0.4 + uGlow); // こわばった細かい震え
  // ヘルメットのつばの下端と、覆面の上端（目の開きの上下）。ゆるい弧
  float top = 0.24 - 0.05 * p.x * p.x;
  float bot = -0.2 + 0.06 * p.x * p.x;
  // 目の開きの中: 肌。上はつばの影で暗く、下から爆発の光
  vec3 sk = mix(uSkin, vec3(dot(uSkin, vec3(0.3, 0.59, 0.11))), 0.45); // くすんだ肌
  vec3 skin = sk * mix(0.4, 0.8, smoothstep(top, bot, p.y));
  skin += vec3(1.0, 0.6, 0.3) * uGlow * 0.35 * smoothstep(0.0, bot, p.y);
  vec3 col = skin;
  // 目（左右）
  vec4 e1 = eye(p - vec2(-0.43, 0.0), -1.0, col);
  vec4 e2 = eye(p - vec2(0.43, 0.0), 1.0, col);
  // 目の開きの上下の縁の陰
  col *= mix(0.4, 1.0, smoothstep(top, top - 0.08, p.y)) * mix(0.5, 1.0, smoothstep(bot, bot + 0.05, p.y));
  // ヘルメット: 鈍い金属。つばの縁に細い光の線、上へ向かって暗く
  if (p.y > top) {
    float k = (p.y - top) / (0.5 - top);
    vec3 helm = mix(vec3(0.04, 0.045, 0.055), vec3(0.015, 0.017, 0.02), k);
    helm += vec3(1.0, 0.7, 0.45) * (0.5 + 1.5 * uGlow) * (1.0 - smoothstep(0.0, 0.025, p.y - top)) * (0.6 + 0.4 * p.x);
    helm += vec3(0.4, 0.45, 0.6) * 0.12 * smoothstep(0.6, 0.0, abs(k - 0.55 + 0.2 * p.x));
    col = helm;
  }
  // 覆面: 黒い布。織り目と、しわ
  if (p.y < bot) {
    float k = (bot - p.y) / (bot + 0.5);
    float weave = 0.85 + 0.15 * vn(vUv * vec2(260.0, 130.0));
    float fold = 0.8 + 0.2 * sin(p.x * 9.0 + vn(p * 4.0) * 3.0);
    vec3 mask = vec3(0.045, 0.045, 0.05) * weave * fold * (1.0 - 0.4 * k);
    mask += vec3(1.0, 0.65, 0.35) * uGlow * 0.12 * (1.0 - smoothstep(0.0, 0.1, bot - p.y));
    col = mask;
  }
  // 周りを暗く絞り、全体の色を少し抜く（爆発の橙の点だけが色を持つ）
  col *= 1.0 - 0.45 * smoothstep(0.5, 1.05, length(p * vec2(0.85, 1.5)));
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  float hot = smoothstep(0.6, 1.4, col.r - col.b);
  col = mix(mix(col, vec3(lum), 0.3), col, hot);
  gl_FragColor = vec4(col, 1.0);
}`;

const IRIS = ['#5a3b24', '#3f4a52', '#6b5a33', '#2f2a26', '#4b5a48'];
const SKIN = ['#b98468', '#a8755c', '#c99a7f', '#8e6450', '#d1a58c'];

// 目のアップの板（2×1、正面が +z）。uniforms の uOpen（目の開き 0〜1）・uGlow（爆発の光 0〜1）・uLook・uTime を演出が動かす
export function buildEyeCloseup(enemyId) {
  const h = enemyId == null ? 0.37 : hash(enemyId);
  const uniforms = {
    uTime: { value: 0 }, uSeed: { value: h }, uOpen: { value: 0.55 }, uGlow: { value: 0 }, uLook: { value: 0 },
    uIris: { value: srgb(IRIS[Math.floor(h * IRIS.length)]) },
    uSkin: { value: srgb(SKIN[Math.floor(hash(h * 91 + 3) * SKIN.length)]) },
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.ShaderMaterial({ uniforms, vertexShader: EYE_VERT, fragmentShader: EYE_FRAG }));
  mesh.name = 'eyeCloseup';
  mesh.userData.enemyId = enemyId;
  return mesh;
}

export function createEnemyView(scene, tier, { sunDir = new THREE.Vector3(0.8, 0.42, -0.45).normalize() } = {}) {
  const uniforms = figureUniforms(sunDir);
  const group = new THREE.Group();
  group.name = 'figures';
  scene.add(group);

  const geo = buildSoldierGeometry();
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAnim', anim);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: FIGURE_VERT, fragmentShader: FIGURE_FRAG });
  const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.name = 'soldiers';
  const xray = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader: FIGURE_VERT, fragmentShader: XRAY_FRAG,
    transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
  }), CAPACITY);
  xray.instanceMatrix = mesh.instanceMatrix;
  xray.frustumCulled = false;
  xray.count = 0;
  xray.renderOrder = 8;
  xray.name = 'soldiers-xray';
  group.add(mesh, xray);

  // 遠くの者の目印（見えている者と、隠れた者）
  const markerPos = new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3);
  markerPos.setUsage(THREE.DynamicDrawUsage);
  const markerGeo = new THREE.BufferGeometry().setAttribute('position', markerPos);
  const markerMat = (alpha, hidden) => new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uAlpha: { value: alpha } }, vertexShader: MARKER_VERT, fragmentShader: MARKER_FRAG,
    transparent: true, depthWrite: false, depthFunc: hidden ? THREE.GreaterDepth : THREE.LessEqualDepth,
  });
  const markers = new THREE.Points(markerGeo, markerMat(0.95, false));
  const markersHidden = new THREE.Points(markerGeo, markerMat(0.5, true));
  for (const m of [markers, markersHidden]) { m.frustumCulled = false; m.renderOrder = 9; group.add(m); }
  markers.name = 'soldier-markers';
  markersHidden.name = 'soldier-markers-hidden';

  // 主人公（1体だけのインスタンスにして、同じ材質を使う）
  const heroGeo = buildHeroGeometry();
  heroGeo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 1, 1]), 4));
  const hero = new THREE.InstancedMesh(heroGeo, mat, 1);
  hero.frustumCulled = false;
  hero.name = 'hero';
  const heroXray = new THREE.InstancedMesh(heroGeo, xray.material, 1);
  heroXray.instanceMatrix = hero.instanceMatrix;
  heroXray.frustumCulled = false;
  heroXray.renderOrder = 8;
  group.add(hero, heroXray);

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
  const closeups = new Map();
  let time = 0, heroYaw = 0;

  return {
    group, hero, mesh, tier, // 形は軽いので、画質の段では変えない
    // 毎フレーム: 軍勢の一覧を姿に写す。fronts は地面と同じ球の一覧（えぐれた地面の上に立つ）、
    // pointScale は 1m を画素へ直す係数（距離 1m のとき）、glow は爆発の明るさ（0〜1）
    sync(enemies, { fronts = [], pointScale = 500, glow = 0, dt = 0, pixelRatio = 1 } = {}) {
      time += dt;
      uniforms.uTime.value = time;
      uniforms.uMarker.value = 11 * pixelRatio;
      uniforms.uPx.value = pointScale;
      uniforms.uGlow.value = glow;
      let n = 0;
      const a = anim.array;
      for (const e of enemies) {
        if (n >= CAPACITY) break;
        let r = e.dist, lift = 0, fall = 0, keep = 1;
        if (e.state === 'grab') r = ENEMY_LOOK.clingRadius;
        if (e.state === 'dead') {
          const k = (e.deadTime ?? 0) / ENEMY_LOOK.deadFling;
          if (k >= 1) continue;
          r = e.dist + 26 * k;
          lift = 14 * k - 10 * k * k;
          fall = 5 * k;
          keep = 1 - k * k;
        }
        const [x, z] = enemyXZ(e, r);
        const yaw = Math.atan2(-Math.cos(e.angle), -Math.sin(e.angle)); // 主人公の方を向く
        _p.set(x, (e.state === 'grab' ? 0 : groundHeight(r, fronts)) + lift, z); // しがみつく者は浮いた主人公と同じ高さ
        _q.setFromEuler(_e.set(-fall, yaw, 0, 'YXZ'));
        mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
        markerPos.setXYZ(n, _p.x, _p.y + ENEMY_LOOK.height * (e.state === 'grab' ? 1.6 : 2.2), _p.z);
        const h = hash(e.id);
        a[n * 4] = h * 6.283;
        a[n * 4 + 1] = e.state === 'grab' ? 1 : 0;
        a[n * 4 + 2] = 0.95 + 0.1 * hash(e.id + 17);
        a[n * 4 + 3] = keep;
        n++;
      }
      mesh.count = xray.count = n;
      markerGeo.setDrawRange(0, n);
      markerPos.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      anim.needsUpdate = true;
      _p.set(0, groundHeight(0, fronts), 0);
      hero.setMatrixAt(0, _m.compose(_p, _q.setFromEuler(_e.set(0, heroYaw, 0)), _s));
      hero.instanceMatrix.needsUpdate = true;
    },
    // 主人公の向き（y 軸まわり。0 で +z を向く）
    setHeroYaw(yaw) { heroYaw = yaw; },
    // 目のアップ（演出がレンダーターゲットに描く）。同じ人は同じ顔
    eyeCloseup(enemyId) {
      const key = enemyId ?? 'none';
      if (!closeups.has(key)) closeups.set(key, buildEyeCloseup(enemyId));
      return closeups.get(key);
    },
  };
}
