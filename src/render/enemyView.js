import * as THREE from 'three';
import { groundHeight } from './sphereDeform.js';
import { srgb } from './figureGeo.js';
import { buildHeroBody, HERO_WIND } from './heroBody.js';
import { buildRiderBikeGeometry, RIDER } from './hoverBike.js';
import { bikePose, BIKE } from './bikePose.js';

// 街の中の人の姿: 浮遊バイクに乗った謎の軍勢（InstancedMesh、かがむ・手を伸ばす動きは頂点シェーダー）と、広場に浮く主人公。
// 軍勢は揃いの暗い装備で、顔はヘルメットと覆面でほぼ隠れ、目の部分だけ開いている。目は光を受けて光る。
// バイクの置き方（浮く高さ・掴むときの位置・吹き飛び）は bikePose.js。真下の地面には、浮いているのがわかる影と推進の光の溜まりを落とす。
// 上空カメラ（広場まで約 110m）でも 2m の人は 6px ほどにしかならないので、遠いほど大きく描き（最大 ENEMY_LOOK.maxBoost 倍）、
// ビルに隠れた者は、隠れた部分だけ暗い青の影絵で上に重ねる（深さが奥のときだけ描くもう一つのパス）。

export const ENEMY_LOOK = {
  height: 1.8,      // m
  minPx: 16,         // 画面の上でこの高さ（CSS の px）より小さければ大きく描く
  maxBoost: 3,
};
const CAPACITY = 160;

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// 大きく描く: 遠くで小さすぎる者は boost 倍。中心は自分の足元だが、主人公の横に寄った者（aPose.x → 1）は主人公（原点）を中心にする
// （主人公も同じだけ大きく描かれるので、並びが崩れず、主人公にめり込まない）
const BOOST_GLSL = /* glsl */`
float boostFor(vec3 base) {
  float dist = max(1.0, distance(base, cameraPosition));
  float px = uHeight * uPx / dist;
  return clamp(uMinPx / max(px, 1e-3), 1.0, uMaxBoost);
}`;

const FIGURE_VERT = /* glsl */`
attribute float aPart;
attribute vec3 aPivot;
attribute vec3 aCol;
attribute vec4 aAnim; // x: 揺れの位相, y: 手を伸ばす 0〜1, z: 大きさ, w: 残り（倒れて消える）
attribute vec2 aPose; // x: 大きく描く中心を主人公へ寄せる 0〜1, y: 推進の光 0〜1
uniform float uTime, uPx, uMinPx, uMaxBoost, uHeight;
varying vec3 vN, vW, vCol;
varying float vPart, vFar, vThrust;
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 rotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
${BOOST_GLSL}
void main() {
  vec3 p = position, n = normal;
  float g = aAnim.y, ride = 1.0 - g;
  // 乗り手の上半身と腕（脚・バイク・主人公は動かない）
  bool upper = aPart < 3.5 || (aPart > 5.5 && aPart < 6.5);
  if (upper) {
    float a = 0.0, b = 0.0;
    if (aPart > 1.5 && aPart < 2.5) a = ${RIDER.armRide.toFixed(4)} + 0.04 * sin(uTime * 3.0 + aAnim.x);        // 左手は握りのまま
    if (aPart > 2.5 && aPart < 3.5) {                                                         // 右手: 握り → 主人公へ伸ばす
      a = mix(${RIDER.armRide.toFixed(4)}, -0.35, g);
      b = -1.35 * g + 0.1 * g * sin(uTime * 9.0 + aAnim.x);
    }
    if (a != 0.0 || b != 0.0) { p = aPivot + rotZ(rotX(p - aPivot, a), b); n = rotZ(rotX(n, a), b); }
    vec3 hip = vec3(${RIDER.hip.map((v) => v.toFixed(4)).join(', ')});
    float lean = mix(${RIDER.lean.toFixed(4)}, 0.15, g) + 0.03 * sin(uTime * 2.3 + aAnim.x);
    float side = 0.32 * g; // 主人公（右手側 -x）へ身を乗り出す
    p = hip + rotZ(rotX(p - hip, lean), side);
    n = rotZ(rotX(n, lean), side);
  }
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float boost = boostFor((modelMatrix * instanceMatrix * vec4(0.0, uHeight * 0.5, 0.0, 1.0)).xyz);
  float px = uHeight * aAnim.z * uPx / max(1.0, distance(origin, cameraPosition));
  vFar = smoothstep(uMinPx * 4.0, uMinPx * 1.5, px);
  p *= aAnim.z * boost * aAnim.w;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec3 anchor = mix(origin, (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, aPose.x);
  wp.xyz += (origin - anchor) * (boost - 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vCol = aCol;
  vPart = aPart;
  vThrust = aPose.y * (0.85 + 0.15 * sin(uTime * 31.0 + aAnim.x * 7.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FIGURE_FRAG = /* glsl */`
uniform vec3 uSunDir, uSun, uSky, uGround, uBlast, uEye, uThrust;
uniform float uGlow;
varying vec3 vN, vW, vCol;
varying float vPart, vFar, vThrust;
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
  if (vPart > 7.5 && vPart < 8.5) col = mix(vCol * light * 0.3, uThrust * (1.6 + 1.2 * vFar), vThrust); // 推進の光
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 浮いている者の真下の地面: やわらかい影と、推進の光が落ちる淡い緑の溜まり（前後の輪の下）。浮くほど影は広く薄い
const SHADOW_VERT = /* glsl */`
attribute vec4 aShadow; // x: 地面からの高さ, y: 大きく描く中心を主人公へ寄せる, z: 推進の光, w: 残り
uniform float uPx, uMinPx, uMaxBoost, uHeight;
varying vec2 vUv;
varying vec3 vS;
${BOOST_GLSL}
void main() {
  vUv = uv * 2.0 - 1.0;
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float boost = boostFor(origin + vec3(0.0, aShadow.x + uHeight * 0.5, 0.0));
  float spread = 1.0 + 0.12 * aShadow.x;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position * boost * spread * aShadow.w, 1.0);
  vec3 anchor = mix(origin, vec3(0.0, origin.y, 0.0), aShadow.y);
  wp.xyz += (origin - anchor) * (boost - 1.0);
  vS = aShadow.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SHADOW_FRAG = /* glsl */`
uniform vec3 uThrust;
varying vec2 vUv;
varying vec3 vS;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float fade = 1.0 / (1.0 + 0.35 * vS.x);
  float shade = (1.0 - smoothstep(0.2, 1.0, r)) * 0.5 * fade;
  // 前後の輪の真下（板の長い向きが前後）
  float pool = 0.0;
  pool += 1.0 - smoothstep(0.0, 0.32, length(vUv - vec2(0.0, 0.46)));
  pool += 1.0 - smoothstep(0.0, 0.38, length(vUv - vec2(0.0, -0.5)));
  float glow = pool * vS.z * (0.5 + 0.5 * fade);
  gl_FragColor = vec4(uThrust * glow * 0.9, shade + glow * 0.35);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 主人公（heroBody の体）: 髪・上着の裾・襟巻きの尾が熱風の向き（体の空間の uWind）になびき、体はゆっくり上下にただよう。
// 揺れの大きさと位相は頂点ごとの aFlut（付け根 0、先ほど大きい）。遠くでは軍勢と同じく大きく描く。
// 陰影は軍勢と同じ（FIGURE_FRAG）。リプレイの最後のカットでは uSil で、光を背にした真っ黒な影絵にし、縁だけ光をにじませる
const HERO_VERT = /* glsl */`
attribute vec3 aCol;
attribute vec2 aFlut; // x: 揺れの大きさ（m）, y: 位相
uniform float uTime, uPx, uMinPx, uMaxBoost, uHeight, uWindK;
uniform vec3 uWind;
varying vec3 vN, vW, vCol;
varying float vPart, vFar, vThrust;
${BOOST_GLSL}
void main() {
  vec3 p = position;
  float A = aFlut.x * uWindK;
  if (A > 0.0) {
    vec3 S = normalize(cross(uWind, vec3(0.0, 1.0, 0.0)));
    vec3 U = normalize(cross(S, uWind));
    float s = aFlut.y;
    // 先へ向かって進む波（ばたつき）と、ゆっくりした突風のうねり
    float gust = 0.7 + 0.3 * sin(uTime * 1.3 + 0.4) * sin(uTime * 0.71 + s * 0.2);
    float w1 = sin(uTime * 7.3 - s), w2 = sin(uTime * 12.1 - s * 1.7 + 0.9);
    p += (U * (0.75 * w1 + 0.3 * w2) * gust + S * (0.45 * w2 + 0.2 * w1) + uWind * (gust - 0.7) * 1.2) * A;
  }
  // ゆっくり上下にただよう（いちばん低いつま先でも地面より上）
  p.y += 0.032 * sin(uTime * 0.85) + 0.01 * sin(uTime * 1.9 + 1.3);
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float boost = boostFor((modelMatrix * instanceMatrix * vec4(0.0, uHeight * 0.5, 0.0, 1.0)).xyz);
  float px = uHeight * uPx / max(1.0, distance(origin, cameraPosition));
  vFar = smoothstep(uMinPx * 4.0, uMinPx * 1.5, px);
  vec4 wp = modelMatrix * instanceMatrix * vec4(p * boost, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vCol = aCol;
  vPart = 10.0;
  vThrust = 0.0;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SIL_FROM = 'gl_FragColor = vec4(col, 1.0);';
if (!FIGURE_FRAG.includes(SIL_FROM) || !FIGURE_FRAG.includes('uniform float uGlow;')) throw new Error('FIGURE_FRAG の形が変わった（HERO_FRAG を直す）');
const HERO_FRAG = FIGURE_FRAG.replace('uniform float uGlow;', 'uniform float uGlow, uSil;\nuniform vec3 uRim;').replace(SIL_FROM, /* glsl */`// 影絵: 光を背にした真っ黒な姿。輪郭の縁だけ、向こうの光がわずかににじむ
  float edge = pow(1.0 - abs(dot(N, V)), 6.0);
  col = mix(col, vec3(0.004) + uRim * edge * 0.22, uSil);
  ${SIL_FROM}`);

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
uniform float uPx, uMinPx, uMaxBoost, uHeight, uMarker;
varying float vFar;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = max(1.0, distance(wp.xyz, cameraPosition));
  float px = uHeight * uPx / dist;
  // 大きく描いても小さいままの遠い者だけ（大きく描いた姿が読める近さでは消す）
  vFar = smoothstep(uMinPx * 1.0, uMinPx * 0.6, px * uMaxBoost);
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
    uMarker: { value: 11 }, uThrust: { value: new THREE.Color(0.55, 1.0, 0.82) },
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

// heroBody: 主人公の体（buildHeroBody の戻り値）。省けば画質の段の細かさで組み立てる
export function createEnemyView(scene, tier, { sunDir = new THREE.Vector3(0.8, 0.42, -0.45).normalize(), heroBody = null } = {}) {
  const uniforms = figureUniforms(sunDir);
  const group = new THREE.Group();
  group.name = 'figures';
  scene.add(group);

  const geo = buildRiderBikeGeometry();
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAnim', anim);
  const pose = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2);
  pose.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPose', pose);
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
  // 透かしの重ねはバイクの頂点（1 台 6000 弱）をもう一度描くので high だけ。mid / low では隠れた者は目印の点（markersHidden）で示す
  const xrayFor = (t) => t === 'high';
  xray.visible = xrayFor(tier);
  group.add(mesh, xray);

  // 浮いている者の真下の影と推進の光の溜まり（地面に貼る板。長い向きが前後）
  const shadowGeo = new THREE.PlaneGeometry(1.3, 3.0).rotateX(-Math.PI / 2);
  const shadowAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  shadowAttr.setUsage(THREE.DynamicDrawUsage);
  shadowGeo.setAttribute('aShadow', shadowAttr);
  const shadows = new THREE.InstancedMesh(shadowGeo, new THREE.ShaderMaterial({
    uniforms, vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG,
    transparent: true, premultipliedAlpha: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }), CAPACITY);
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.frustumCulled = false;
  shadows.count = 0;
  shadows.renderOrder = 1;
  shadows.name = 'bike-shadows';
  group.add(shadows);

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

  // 主人公（1体だけのインスタンス）。体の細かさは画質の段で決める（組み立ては段ごとに 1 回）
  const body = heroBody ?? buildHeroBody({ detail: tier });
  const heroGeo = body.geometry;
  const heroUniforms = { ...uniforms, uSil: { value: 0 }, uWindK: { value: 1 }, uWind: { value: new THREE.Vector3(...HERO_WIND) }, uRim: { value: new THREE.Color(1.0, 0.72, 0.45) } };
  const hero = new THREE.InstancedMesh(heroGeo, new THREE.ShaderMaterial({ uniforms: heroUniforms, vertexShader: HERO_VERT, fragmentShader: HERO_FRAG }), 1);
  hero.frustumCulled = false;
  hero.name = 'hero';
  const heroXray = new THREE.InstancedMesh(heroGeo, new THREE.ShaderMaterial({
    uniforms: heroUniforms, vertexShader: HERO_VERT, fragmentShader: XRAY_FRAG,
    transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
  }), 1);
  heroXray.name = 'hero-xray';
  heroXray.instanceMatrix = hero.instanceMatrix;
  heroXray.frustumCulled = false;
  heroXray.renderOrder = 8;
  group.add(hero, heroXray);

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
  const closeups = new Map();
  let time = 0, heroYaw = 0;

  return {
    group, hero, mesh, shadows, tier, // 形は画質の段では変えない（透かしの重ねだけ high のみ）
    heroBuildMs: body.buildMs, // 主人公の体を組み立てた時間（ms。同じ段の 2 回目からは組み立てずに使い回す）
    // 画質の段が途中で下がったとき
    setTier(t) { xray.visible = xrayFor(t); },
    // 毎フレーム: 軍勢の一覧を姿に写す。fronts は地面と同じ球の一覧（えぐれた地面の上に立つ）、
    // pointScale は 1m を画素へ直す係数（距離 1m のとき）、glow は爆発の明るさ（0〜1）、
    // silhouette は主人公を光を背にした影絵にする強さ（0〜1。リプレイの最後のカット）
    sync(enemies, { fronts = [], pointScale = 500, glow = 0, dt = 0, pixelRatio = 1, silhouette = 0 } = {}) {
      time += dt;
      heroUniforms.uSil.value = Math.min(1, silhouette * 1.2); // リプレイの影絵（0.9）で真っ黒に
      heroUniforms.uWindK.value = 1 + 0.5 * silhouette; // 光の中では熱風が強い
      uniforms.uTime.value = time;
      uniforms.uMarker.value = 11 * pixelRatio;
      uniforms.uPx.value = pointScale;
      uniforms.uMinPx.value = ENEMY_LOOK.minPx * pixelRatio; // pointScale は画素の px なので、基準も CSS の px から直す
      uniforms.uGlow.value = glow;
      let n = 0;
      const a = anim.array, po = pose.array, sh = shadowAttr.array;
      for (const e of enemies) {
        if (n >= CAPACITY) break;
        const b = bikePose(e, fronts, time);
        if (!b) continue; // 吹き飛んで消えた
        _p.set(b.x, b.y, b.z);
        _q.setFromEuler(_e.set(b.pitch, b.yaw, b.roll, 'YXZ'));
        mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
        markerPos.setXYZ(n, b.x, b.y + ENEMY_LOOK.height * 1.9, b.z);
        const ground = groundHeight(Math.hypot(b.x, b.z), fronts);
        _p.set(b.x, ground + 0.06, b.z);
        shadows.setMatrixAt(n, _m.compose(_p, _q.setFromEuler(_e.set(0, b.yaw, 0)), _s));
        const h = hash(e.id);
        a[n * 4] = h * 6.283;
        a[n * 4 + 1] = b.reach;
        a[n * 4 + 2] = 0.95 + 0.1 * hash(e.id + 17);
        a[n * 4 + 3] = b.keep;
        po[n * 2] = b.anchor;
        po[n * 2 + 1] = b.thrust;
        sh[n * 4] = Math.max(0, b.y - ground);
        sh[n * 4 + 1] = b.anchor;
        sh[n * 4 + 2] = b.thrust;
        sh[n * 4 + 3] = b.keep * (e.state === 'dead' ? 1 - (e.deadTime ?? 0) / BIKE.deadFling : 1);
        n++;
      }
      mesh.count = xray.count = shadows.count = n;
      markerGeo.setDrawRange(0, n);
      markerPos.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      shadows.instanceMatrix.needsUpdate = true;
      anim.needsUpdate = pose.needsUpdate = shadowAttr.needsUpdate = true;
      _p.set(0, 0, 0); // 主人公は浮いている（足元の地面が下がっても y=0）
      hero.setMatrixAt(0, _m.compose(_p, _q.setFromEuler(_e.set(0, heroYaw, 0)), _s));
      hero.instanceMatrix.needsUpdate = true;
    },
    // 主人公の向き（y 軸まわり。0 で +z を向く）
    setHeroYaw(yaw) { heroYaw = yaw; },
    get heroYaw() { return heroYaw; },
    // 目のアップ（演出がレンダーターゲットに描く）。同じ人は同じ顔
    eyeCloseup(enemyId) {
      const key = enemyId ?? 'none';
      if (!closeups.has(key)) closeups.set(key, buildEyeCloseup(enemyId));
      return closeups.get(key);
    },
  };
}
