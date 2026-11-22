import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { groundHeight } from './sphereDeform.js';
import { srgb } from './figureGeo.js';
import { buildHeroBody, HERO_WIND } from './heroBody.js';
import { buildRiderBikeGeometry, RIDER } from './hoverBike.js';
import { bikePose, BIKE } from './bikePose.js';
import { createSearchlight } from './searchlight.js';

const STAGGER_SEC = CONFIG.enemy.stagger?.sec ?? 0.5;

// 街の中の人の姿: 浮遊バイクに乗った謎の軍勢（InstancedMesh、かがむ・手を伸ばす動きは頂点シェーダー）と、広場に浮く主人公。
// 軍勢は揃いの暗い装備で、顔はヘルメットと覆面でほぼ隠れ、目の部分だけ開いている。目は光を受けて光る。
// バイクの置き方（浮く高さ・掴むときの位置・吹き飛び）は bikePose.js。真下の地面には、浮いているのがわかる影と推進の光の溜まりを落とす。
// 上空カメラ（広場まで約 110m）でも 2m の人は 6px ほどにしかならないので、遠いほど大きく描き（最大 ENEMY_LOOK.maxBoost 倍）、
// ビルに隠れた者は、隠れた部分だけ暗い青の影絵で上に重ねる（深さが奥のときだけ描くもう一つのパス）。
// スピード感（持ち主の要望 2026-11-21「バイクのスピード感出して」）: 尾の輪から後ろへ伸びる推進の光の尾（速さに比例、曲がる道すじに
// 沿って曲がる）と、乗り手の肩の脇を流れる風の細い線を、全部のバイクで一つの instanced の網（加算）で描く。乗り手は速いほど前へかがみ、
// 地面の光の溜まりも後ろへ伸びる。

export const ENEMY_LOOK = {
  height: 1.8,      // m
  minPx: 16,         // 画面の上でこの高さ（CSS の px）より小さければ大きく描く
  maxBoost: 3,
};
// 描ける数: 主人公を探す者（60 秒で約 100 人。倒れた者も 3 秒残る）の上限 HUNT_CAPACITY と、街を見回る者の全員
export const HUNT_CAPACITY = 130;
export const CAPACITY = HUNT_CAPACITY + CONFIG.enemy.patrol.count;

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
attribute vec3 aPose; // x: 大きく描く中心を主人公へ寄せる 0〜1, y: 推進の光 0〜1, z: 頭の向き（首まわり、rad。演出の一人だけ）
attribute vec2 aMove; // x: 速さ（探す速さを 1）, y: 尾の曲がり（1/m）
attribute float aOnly; // R1: 部品の出る種類（hoverBike の ONLY。0 どの者にも, 1 装甲の者だけ, 2 大物だけ）
attribute vec2 aKind;  // R1: x 種類（KIND_CODE。0 ふつう, 1 重い者, 2 吸う者, 3 大物）, y 払いが当たった光（よろめき 1 → 0）
uniform float uTime, uPx, uMinPx, uMaxBoost, uHeight;
varying vec3 vN, vW, vCol;
varying float vPart, vFar, vThrust, vKind, vHit;
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 rotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
${BOOST_GLSL}
void main() {
  vec3 p = position, n = normal;
  float g = aAnim.y, ride = 1.0 - g;
  // R1: 種類に合わない部品は潰す。装甲の者（重い者・大物）はバイクを横へ広げ、胴を少し太く
  bool armored = (aKind.x > 0.5 && aKind.x < 1.5) || aKind.x > 2.5;
  if ((aOnly > 0.5 && aOnly < 1.5 && !armored) || (aOnly > 1.5 && aKind.x < 2.5)) p = vec3(0.0);
  if (armored && aPart > 6.5 && aPart < 9.5) p.x *= 1.22;
  if (armored && aPart < 0.5) p.x *= 1.12;
  // 乗り手の上半身と腕（脚・バイク・主人公は動かない）
  bool upper = aPart < 3.5 || (aPart > 5.5 && aPart < 6.5);
  if (upper) {
    // 頭（と目）は首を軸に横を向く
    if (aPose.z != 0.0 && ((aPart > 0.5 && aPart < 1.5) || (aPart > 5.5 && aPart < 6.5))) { p = aPivot + rotY(p - aPivot, aPose.z); n = rotY(n, aPose.z); }
    float a = 0.0, b = 0.0;
    if (aPart > 1.5 && aPart < 2.5) a = ${RIDER.armRide.toFixed(4)} + 0.04 * sin(uTime * 3.0 + aAnim.x);        // 左手は握りのまま
    if (aPart > 2.5 && aPart < 3.5) {                                                         // 右手: 握り → 主人公へ伸ばす
      a = mix(${RIDER.armRide.toFixed(4)}, -0.35, g);
      b = -1.35 * g + 0.1 * g * sin(uTime * 9.0 + aAnim.x);
    }
    if (a != 0.0 || b != 0.0) { p = aPivot + rotZ(rotX(p - aPivot, a), b); n = rotZ(rotX(n, a), b); }
    vec3 hip = vec3(${RIDER.hip.map((v) => v.toFixed(4)).join(', ')});
    float lean = mix(${RIDER.lean.toFixed(4)}, 0.15, g) + 0.03 * sin(uTime * 2.3 + aAnim.x) + 0.32 * clamp(aMove.x, 0.0, 1.2) * ride; // 速いほど前へかがむ
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
  vKind = aKind.x; vHit = aKind.y;
  vThrust = aPose.y * (0.85 + 0.15 * sin(uTime * 31.0 + aAnim.x * 7.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FIGURE_FRAG = /* glsl */`
uniform vec3 uSunDir, uSun, uSky, uGround, uBlast, uEye, uThrust, uDrain, uTrim, uHeavy;
uniform float uGlow, uTime;
varying vec3 vN, vW, vCol;
varying float vPart, vFar, vThrust, vKind, vHit;
vec3 kindThrust(float k) { // R1: 推進の光の色（重い者は琥珀、吸う者は赤紫で脈打つ、ほかは緑）
  if (k > 1.5 && k < 2.5) return uDrain * (0.7 + 0.5 * sin(uTime * 8.0));
  if (k > 0.5 && k < 1.5) return uHeavy;
  return uThrust;
}
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
  // 推進の光（R1: 吸う者は赤紫で、吸うように脈打つ）
  vec3 thrust = kindThrust(vKind);
  if (vPart > 7.5 && vPart < 8.5) col = mix(vCol * light * 0.3, thrust * (1.6 + 1.2 * vFar), vThrust);
  if (vPart > 8.5 && vPart < 9.5) col = uTrim * (1.7 + 1.5 * vFar); // R1: 装甲の縁の琥珀の光
  if (vPart > 12.5 && vPart < 13.5) col = vec3(1.0, 0.95, 0.84) * 7.0; // R1: 大物の探照灯のレンズ
  // R1: 払いが当たってよろめく間、体が白熱して光る（倒れなかった手ごたえ）
  if (vPart < 9.5 && !(vPart > 5.5 && vPart < 6.5)) col += vec3(1.0, 0.72, 0.42) * vHit * vHit * 1.6;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 浮いている者の真下の地面: やわらかい影と、推進の光が落ちる淡い緑の溜まり（前後の輪の下）。浮くほど影は広く薄い
const SHADOW_VERT = /* glsl */`
attribute vec4 aShadow; // x: 地面からの高さ, y: 大きく描く中心を主人公へ寄せる, z: 推進の光, w: 残り
attribute vec2 aMove;
attribute vec2 aKind;
uniform float uPx, uMinPx, uMaxBoost, uHeight;
varying vec2 vUv;
varying vec3 vS;
varying float vBack, vTrail, vKind;
${BOOST_GLSL}
void main() {
  vUv = uv * 2.0 - 1.0;
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float boost = boostFor(origin + vec3(0.0, aShadow.x + uHeight * 0.5, 0.0));
  float spread = 1.0 + 0.12 * aShadow.x;
  // 速いほど、板の後ろ半分を後ろへ伸ばす（光の溜まりが尾を引く）
  vTrail = clamp(aMove.x, 0.0, 1.2);
  vBack = clamp(-position.z / 1.5, 0.0, 1.0);
  vec3 q = position;
  if (q.z < 0.0) q.z *= 1.0 + 1.6 * vTrail;
  vec4 wp = modelMatrix * instanceMatrix * vec4(q * boost * spread * aShadow.w, 1.0);
  vec3 anchor = mix(origin, vec3(0.0, origin.y, 0.0), aShadow.y);
  wp.xyz += (origin - anchor) * (boost - 1.0);
  vS = aShadow.xyz;
  vKind = aKind.x;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SHADOW_FRAG = /* glsl */`
uniform vec3 uThrust, uDrain, uHeavy;
uniform float uPool, uTime; // 光の溜まりの大きさと明るさ（low の段は bloom がないので大きく明るく）
varying vec2 vUv;
varying vec3 vS;
varying float vBack, vTrail, vKind;
vec3 kindThrust(float k) { // R1: 推進の光の色（重い者は琥珀、吸う者は赤紫で脈打つ、ほかは緑）
  if (k > 1.5 && k < 2.5) return uDrain * (0.7 + 0.5 * sin(uTime * 8.0));
  if (k > 0.5 && k < 1.5) return uHeavy;
  return uThrust;
}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float fade = 1.0 / (1.0 + 0.35 * vS.x);
  float shade = (1.0 - smoothstep(0.2, 1.0, r)) * 0.5 * fade * (1.0 - 0.5 * vTrail * vBack);
  // 前後の輪の真下（板の長い向きが前後）
  float pool = 0.0, ps = sqrt(uPool);
  pool += 1.0 - smoothstep(0.0, 0.32 * ps, length(vUv - vec2(0.0, 0.46)));
  pool += 1.0 - smoothstep(0.0, 0.38 * ps, length(vUv - vec2(0.0, -0.5)));
  // 速いときは、後ろへ伸びた半分に細い光の筋（尾が地面に落とす光）
  pool += vTrail * vBack * (1.0 - smoothstep(0.08, 0.35, abs(vUv.x))) * (1.0 - smoothstep(0.6, 1.0, vBack)) * 0.8;
  float glow = pool * vS.z * (0.5 + 0.5 * fade) * uPool;
  vec3 tc = kindThrust(vKind);
  gl_FragColor = vec4(tc * glow * 0.9, shade + glow * 0.35);
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
varying float vPart, vFar, vThrust, vKind, vHit;
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
  vKind = 0.0; vHit = 0.0;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SIL_FROM = 'gl_FragColor = vec4(col, 1.0);';
if (!FIGURE_FRAG.includes(SIL_FROM) || !FIGURE_FRAG.includes('uniform float uGlow, uTime;')) throw new Error('FIGURE_FRAG の形が変わった（HERO_FRAG を直す）');
const HERO_FRAG = FIGURE_FRAG.replace('uniform float uGlow, uTime;', 'uniform float uGlow, uTime, uSil;\nuniform vec3 uRim;').replace(SIL_FROM, /* glsl */`// 影絵: 光を背にした真っ黒な姿。輪郭の縁だけ、向こうの光がわずかににじむ
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
attribute float aMk; // R1: 種類（KIND_CODE）
uniform float uPx, uMinPx, uMaxBoost, uHeight, uMarker;
varying float vFar, vMk;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = max(1.0, distance(wp.xyz, cameraPosition));
  float px = uHeight * uPx / dist;
  // 大きく描いても小さいままの遠い者だけ（大きく描いた姿が読める近さでは消す）
  vFar = smoothstep(uMinPx * 1.0, uMinPx * 0.6, px * uMaxBoost);
  vMk = aMk;
  gl_PointSize = uMarker * vFar * (aMk > 2.5 ? 1.7 : 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const MARKER_FRAG = /* glsl */`
uniform vec3 uEye, uDrain, uTrim;
uniform float uAlpha, uGlow;
varying float vFar, vMk;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float rim = smoothstep(0.7, 0.85, r) * (1.0 - smoothstep(0.92, 1.0, r));
  // R1: 縁の色で種類（重い者・大物は琥珀、吸う者は赤紫）
  vec3 rimC = vMk > 2.5 ? uTrim * 1.6 : vMk > 1.5 ? uDrain : vMk > 0.5 ? uTrim : vec3(0.75, 0.8, 0.95);
  vec3 col = mix(vec3(0.03, 0.035, 0.05), rimC, rim);
  float eye = (1.0 - smoothstep(0.1, 0.22, abs(q.y + 0.05))) * (1.0 - smoothstep(0.45, 0.6, abs(q.x))) * step(0.08, abs(q.x));
  col = mix(col, uEye * (2.0 + 2.0 * uGlow), eye);
  gl_FragColor = vec4(col, uAlpha * vFar * (1.0 - smoothstep(0.92, 1.0, r)));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 推進の光の尾と風の線（加算）。形はバイクの空間の帯で、aTr（x: 尾の付け根 0 → 先 1, y: 帯の横 -1〜1, z: 種類）から頂点シェーダーで組む。
// 種類 0 / 1: 尾の輪から後ろへ伸びる光の尾（0 は水平の帯で上空から、1 は縦の帯で横から見える）。長さは速さに比例（大きく描いても
// 長さは本当の m のまま、幅だけ大きく描く）。曲がるときは、通ってきた道すじ（横へ 曲がり · 距離² / 2）に沿って曲がる。
// 種類 2: 乗り手の肩の脇を後ろへ流れる風の細い線（速いときだけ）
export const TRAIL = { len: 7.5, width: 0.3, wind: 0.55 };
const TRAIL_VERT = /* glsl */`
attribute vec3 aTr;
attribute vec4 aAnim;
attribute vec3 aPose;
attribute vec2 aMove;
attribute vec2 aKind;
uniform float uTime, uPx, uMinPx, uMaxBoost, uHeight;
varying float vT, vSide, vKind, vA, vSort;
${BOOST_GLSL}
void main() {
  float sp = clamp(aMove.x, 0.0, 1.2);
  float t = aTr.x, side = aTr.y, kind = aTr.z;
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float boost = boostFor((modelMatrix * instanceMatrix * vec4(0.0, uHeight * 0.5, 0.0, 1.0)).xyz);
  float k = aAnim.z * boost * aAnim.w;
  vec3 p;
  if (kind < 1.5) {
    // 尾: 尾の輪（0, 0.3, -1.32）から後ろへ
    float len = ${TRAIL.len.toFixed(3)} * sp;
    float s = t * len;
    float w = ${TRAIL.width.toFixed(3)} * mix(1.0, 0.25, t) * k;
    vec3 base = vec3(0.0, 0.3, -1.32) * k;
    // 曲がる道すじ（曲がり aMove.y 1/m）の円弧に沿って後ろへ（主人公のまわりを回る者の尾が輪に沿う。曲がりが小さければ放物線と同じ）
    float a = aMove.y * s;
    vec2 arc = abs(aMove.y) > 1e-3 ? vec2(-(1.0 - cos(a)) / aMove.y, -sin(a) / aMove.y) : vec2(-0.5 * aMove.y * s * s, -s);
    p = base + vec3(arc.x, 0.0, arc.y);
    if (kind < 0.5) p.x += side * w; else p.y += side * w;
    vA = smoothstep(0.05, 0.25, sp);
  } else {
    // 風の線: 肩の脇（±0.42, 0.95）を、前から後ろへ流れる細い線（速いときだけ。時間で流れる）
    float len = ${TRAIL.len.toFixed(3)} * ${TRAIL.wind.toFixed(3)} * sp;
    float s = t * len;
    float x = (side > 0.0 ? 0.42 : -0.42) * k;
    p = vec3(x - 0.5 * aMove.y * s * s, 0.95 * k + 0.012 * k * (abs(side) - 1.5) * 4.0, 0.5 * k - s);
    vA = smoothstep(0.55, 0.95, sp);
  }
  vT = t; vSide = side; vKind = kind; vSort = aKind.x;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec3 anchor = mix(origin, (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, aPose.x);
  wp.xyz += (origin - anchor) * (boost - 1.0);
  vA *= aAnim.w * clamp(aPose.y, 0.0, 1.5);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const TRAIL_FRAG = /* glsl */`
uniform vec3 uThrust, uDrain, uHeavy;
uniform float uTime, uTrailGain;
varying float vT, vSide, vKind, vA, vSort;
vec3 kindThrust(float k) { // R1: 推進の光の色（重い者は琥珀、吸う者は赤紫で脈打つ、ほかは緑）
  if (k > 1.5 && k < 2.5) return uDrain * (0.7 + 0.5 * sin(uTime * 8.0));
  if (k > 0.5 && k < 1.5) return uHeavy;
  return uThrust;
}
void main() {
  float a, t = clamp(vT, 0.0, 1.0); // 補間で 1 をわずかに超えると pow が NaN になり、bloom が画面全体へ広げてしまう
  if (vKind < 1.5) {
    // 付け根が明るく、先へ向かって消える。帯の中心が明るい
    float core = 1.0 - smoothstep(0.0, 1.0, abs(vSide));
    a = pow(1.0 - t, 1.6) * core * (0.75 + 0.25 * sin(uTime * 40.0 - t * 18.0));
  } else {
    // 風の線: 流れる切れ目（前から後ろへ）
    float dash = smoothstep(0.2, 0.6, fract(t * 3.0 - uTime * 6.0));
    a = 0.35 * (1.0 - t) * dash;
  }
  a *= vA;
  // R1: 吸う者の尾は赤紫で、脈打つ玉の列（ふつうの者の滑らかな緑の尾と見分ける）
  bool drainer = vSort > 1.5 && vSort < 2.5;
  if (drainer && vKind < 1.5) a *= 0.2 + 1.1 * smoothstep(0.3, 0.55, fract(t * 4.0 - uTime * 3.0));
  if (!(a >= 0.003)) discard;
  gl_FragColor = vec4(kindThrust(vSort) * uTrailGain * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 尾と風の線の形（1 台分）: 種類 0・1 の帯は付け根から先へ TRAIL_SEG 区切り、種類 2 は左右の 2 本の細い帯
const TRAIL_SEG = 8;
function buildTrailGeometry() {
  const tr = [], idx = [];
  const strip = (kind, s0, s1) => {
    const first = tr.length / 3;
    for (let i = 0; i <= TRAIL_SEG; i++) { const t = i / TRAIL_SEG; tr.push(t, s0, kind, t, s1, kind); }
    for (let i = 0; i < TRAIL_SEG; i++) { const a = first + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  };
  strip(0, -1, 1); strip(1, -1, 1);
  strip(2, 1, 2); strip(2, -1, -2); // 風の線（side の符号で左右、|side| 1〜2 で細い幅）
  const g = new THREE.BufferGeometry();
  const n = tr.length / 3;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // 位置は aTr から組む
  g.setAttribute('aTr', new THREE.BufferAttribute(new Float32Array(tr), 3));
  g.setIndex(idx);
  return g;
}

function figureUniforms(sunDir) {
  return {
    uTime: { value: 0 }, uPx: { value: 500 }, uMinPx: { value: ENEMY_LOOK.minPx }, uMaxBoost: { value: ENEMY_LOOK.maxBoost },
    uHeight: { value: ENEMY_LOOK.height }, uGlow: { value: 0 },
    uSunDir: { value: sunDir.clone() },
    uSun: { value: new THREE.Color(1.0, 0.66, 0.4) }, uSky: { value: new THREE.Color(0.46, 0.54, 1.0) },
    uGround: { value: new THREE.Color(0.55, 0.4, 0.42) }, uBlast: { value: new THREE.Color(1.0, 0.78, 0.5) },
    uEye: { value: new THREE.Color(1.0, 0.93, 0.8) }, uXray: { value: srgb('#5d6f95') },
    uMarker: { value: 11 }, uThrust: { value: new THREE.Color(0.55, 1.0, 0.82) },
    uPool: { value: 1 }, uTrailGain: { value: 1 },
    // R1: 吸う者の推進の光（赤紫。バイクの緑ともネオンのマゼンタ・赤とも離した深い赤紫で、脈打つ）と、装甲の縁の琥珀
    uDrain: { value: new THREE.Color(...DRAIN_COLOR.high) }, uTrim: { value: new THREE.Color(1.0, 0.55, 0.12).multiplyScalar(1.3) },
    uHeavy: { value: new THREE.Color(...HEAVY_COLOR.high) },
  };
}

// heroBody: 主人公の体（buildHeroBody の戻り値）。省けば画質の段の細かさで組み立てる
// low の段は bloom がないので、地面の光の溜まりを大きく明るくし、尾も少し明るくする（推進の光の色は style.tintFigures が飽和した緑へ寄せる）
const POOL = { low: 1.9, mid: 1, high: 1 };
// 吸う者の推進の光（線形の色。high / mid は bloom の閾値を超える明るさ、low は飽和した色で控えめに）
// sRGB (1.0, 0.08, 0.36)、色相 約 342°（ネオンのマゼンタ 323°・赤 2° の間で、どちらからも 19° 以上。バイクの緑から 160° 以上）。
// 見分けは色だけでなく、脈打つ明るさと、尾の玉の列（ネオンは光り続け、尾を引かない）
export const DRAIN_SRGB = [1.0, 0.08, 0.36];
export const DRAIN_COLOR = { high: new THREE.Color().setRGB(...DRAIN_SRGB, THREE.SRGBColorSpace).multiplyScalar(1.5).toArray(), low: new THREE.Color().setRGB(...DRAIN_SRGB, THREE.SRGBColorSpace).toArray() };
// 重い者の推進の光（琥珀。装甲の縁の光と同じ色みで、上空の画面でも緑の尾と見分ける）
export const HEAVY_SRGB = [1.0, 0.56, 0.1];
export const HEAVY_COLOR = { high: new THREE.Color().setRGB(...HEAVY_SRGB, THREE.SRGBColorSpace).multiplyScalar(1.5).toArray(), low: new THREE.Color().setRGB(...HEAVY_SRGB, THREE.SRGBColorSpace).toArray() };
// 種類の番号（aKind.x）と、大きさ（aAnim.z）。ふつうの者は 0.95〜1.05 のばらつき
export const KIND_CODE = { heavy: 1, drainer: 2, boss: 3 };
export const KIND_SCALE = { heavy: 1.06, boss: 1.6 };
const TRAIL_GAIN = { low: 1.25, mid: 0.9, high: 0.9 };

export function createEnemyView(scene, tier, { sunDir = new THREE.Vector3(0.8, 0.42, -0.45).normalize(), heroBody = null } = {}) {
  const uniforms = figureUniforms(sunDir);
  const group = new THREE.Group();
  group.name = 'figures';
  scene.add(group);

  const geo = buildRiderBikeGeometry();
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAnim', anim);
  const pose = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  pose.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPose', pose);
  const move = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2);
  move.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aMove', move);
  const kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2);
  kindAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aKind', kindAttr);
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
  let curTier = tier, aidsOn = true;
  xray.visible = xrayFor(tier);
  group.add(mesh, xray);
  const applyTier = (t) => { uniforms.uPool.value = POOL[t] ?? 1; uniforms.uTrailGain.value = TRAIL_GAIN[t] ?? 1; uniforms.uDrain.value.setRGB(...(t === 'low' ? DRAIN_COLOR.low : DRAIN_COLOR.high)); uniforms.uHeavy.value.setRGB(...(t === 'low' ? HEAVY_COLOR.low : HEAVY_COLOR.high)); };
  applyTier(tier);

  // 推進の光の尾と風の線（全部のバイクで一つの網。軍勢と同じ位置・同じ属性を使う）
  const trailGeo = buildTrailGeometry();
  trailGeo.setAttribute('aAnim', anim);
  trailGeo.setAttribute('aPose', pose);
  trailGeo.setAttribute('aMove', move);
  trailGeo.setAttribute('aKind', kindAttr);
  const trails = new THREE.InstancedMesh(trailGeo, new THREE.ShaderMaterial({
    uniforms, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), CAPACITY);
  trails.instanceMatrix = mesh.instanceMatrix;
  trails.frustumCulled = false;
  trails.count = 0;
  trails.renderOrder = 2;
  trails.name = 'bike-trails';
  group.add(trails);

  // 浮いている者の真下の影と推進の光の溜まり（地面に貼る板。長い向きが前後）
  const shadowGeo = new THREE.PlaneGeometry(1.3, 3.0).rotateX(-Math.PI / 2);
  const shadowAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  shadowAttr.setUsage(THREE.DynamicDrawUsage);
  shadowGeo.setAttribute('aShadow', shadowAttr);
  shadowGeo.setAttribute('aMove', move);
  shadowGeo.setAttribute('aKind', kindAttr);
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

  // R1: 大物の探照灯
  const searchlight = createSearchlight(group);

  // 遠くの者の目印（見えている者と、隠れた者）
  const markerPos = new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3);
  markerPos.setUsage(THREE.DynamicDrawUsage);
  const markerKind = new THREE.BufferAttribute(new Float32Array(CAPACITY), 1);
  markerKind.setUsage(THREE.DynamicDrawUsage);
  const markerGeo = new THREE.BufferGeometry().setAttribute('position', markerPos).setAttribute('aMk', markerKind);
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
  let body = heroBody ?? buildHeroBody({ detail: tier });
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
  let time = 0, heroYaw = 0, heroLift = 0;
  // 演出の一人（最後の一発の軍勢の後ろのカットのいちばん手前の乗り手）: { id, pose, group }。その一人（と group の乗り手）は本当の場所ではなく pose で描く（cinematic.js が決める）
  let focus = null, focusIds = null;
  // その一人の専用の体（riderBody.js、距離の場の網。setRiderBody で渡す）。同じ材質で、インスタンス 1 つ
  let focusMesh = null, focusAnim = null, focusPose = null;

  return {
    group, hero, mesh, shadows, trails, tier, searchlight, // 形は画質の段では変えない（透かしの重ねだけ high のみ。low は光の溜まりを大きく明るく）
    heroBuildMs: body.buildMs, // 主人公の体を組み立てた時間（ms。同じ段の 2 回目からは組み立てずに使い回す）
    // 画質の段が途中で下がったとき（主人公の体は起動したときの段の細かさのまま。組み直さない）
    setTier(t) { curTier = t; xray.visible = aidsOn && xrayFor(t); applyTier(t); },
    // 主人公の体を差し替える（起動時は粗い体で始め、細かい体ができたら差し替える）。
    // 属性は同じなので材質（シェーダー）はそのまま。前の体の GPU の buffer は手放す（体のデータは buildHeroBody が覚えている）
    setHeroBody(b) {
      if (b === body) return;
      const old = hero.geometry;
      hero.geometry = b.geometry;
      heroXray.geometry = b.geometry;
      body = b;
      this.heroBuildMs = b.buildMs;
      old.dispose();
    },
    get heroBody() { return body; },
    // 毎フレーム: 軍勢の一覧を姿に写す。fronts は地面と同じ球の一覧（えぐれた地面の上に立つ）、
    // pointScale は 1m を画素へ直す係数（距離 1m のとき）、glow は爆発の明るさ（0〜1）、
    // silhouette は主人公を光を背にした影絵にする強さ（0〜1。リプレイの最後のカット）、
    // aids は上空カメラ用の補助表示（目印・隠れた者の目印・建物の陰の透かし・主人公の透かし）を出すか（最後の一発の演出・リプレイの間は false）
    // extra: 決まった姿勢で描くバイク（S6 の導入。bikePose の戻り値と同じ形に id を足したもの）。軍勢の一覧のあとに並べる
    sync(enemies, { fronts = [], pointScale = 500, glow = 0, dt = 0, pixelRatio = 1, silhouette = 0, aids = true, extra = null } = {}) {
      time += dt;
      aidsOn = aids;
      markers.visible = markersHidden.visible = heroXray.visible = aids;
      xray.visible = aids && xrayFor(curTier);
      heroUniforms.uSil.value = Math.min(1, silhouette * 1.2); // リプレイの影絵（0.9）で真っ黒に
      heroUniforms.uWindK.value = 1 + 0.5 * silhouette; // 光の中では熱風が強い
      uniforms.uTime.value = time;
      uniforms.uMarker.value = 11 * pixelRatio;
      uniforms.uPx.value = pointScale;
      uniforms.uMinPx.value = ENEMY_LOOK.minPx * pixelRatio; // pointScale は画素の px なので、基準も CSS の px から直す
      uniforms.uGlow.value = glow;
      let n = 0;
      const a = anim.array, po = pose.array, sh = shadowAttr.array, mo = move.array, ki = kindAttr.array, mk = markerKind.array;
      // kind: 種類（e.kind）、hit: 払いが当たった光（0〜1）
      const place = (b, id, fade, kind = null, hit = 0) => {
        _p.set(b.x, b.y, b.z);
        _q.setFromEuler(_e.set(b.pitch, b.yaw, b.roll, 'YXZ'));
        mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
        markerPos.setXYZ(n, b.x, b.y + ENEMY_LOOK.height * 1.9, b.z);
        const ground = groundHeight(Math.hypot(b.x, b.z), fronts);
        _p.set(b.x, ground + 0.06, b.z);
        shadows.setMatrixAt(n, _m.compose(_p, _q.setFromEuler(_e.set(0, b.yaw, 0)), _s));
        const h = hash(id);
        a[n * 4] = h * 6.283;
        a[n * 4 + 1] = b.reach;
        a[n * 4 + 2] = KIND_SCALE[kind] ?? 0.95 + 0.1 * hash(id + 17);
        ki[n * 2] = mk[n] = KIND_CODE[kind] ?? 0;
        ki[n * 2 + 1] = hit;
        a[n * 4 + 3] = b.keep;
        po[n * 3] = b.anchor;
        po[n * 3 + 1] = b.thrust;
        po[n * 3 + 2] = b.head ?? 0;
        mo[n * 2] = b.trail ?? 0;
        mo[n * 2 + 1] = b.curve ?? 0;
        sh[n * 4] = Math.max(0, b.y - ground);
        sh[n * 4 + 1] = b.anchor;
        sh[n * 4 + 2] = b.thrust;
        sh[n * 4 + 3] = b.keep * fade;
        n++;
      };
      // 主人公を探す者を先に、街を見回る者（S8、e.patrol）をあとに並べる。目印と透かし（上空カメラの補助）は探す者だけ
      // （見回る者は主人公を狙わないので、目印で脅威に見せない）
      let nHunt = 0, bossPose = null;
      for (const pass of [false, true]) {
        for (const e of enemies) {
          if (n >= CAPACITY) break;
          if (!!e.patrol !== pass) continue;
          if (focus && (e.id === focus.id || focusIds?.has(e.id))) continue; // 演出の乗り手は下で、演出の姿勢で描く
          const b = bikePose(e, fronts, time);
          if (!b) continue; // 吹き飛んで消えた
          place(b, e.id, e.state === 'dead' ? 1 - (e.deadTime ?? 0) / BIKE.deadFling : 1, e.kind ?? null, e.state === 'stagger' ? 1 - Math.min(1, (e.staggerT ?? 0) / STAGGER_SEC) : 0);
          if (e.kind === 'boss') bossPose = { e, b };
        }
        if (!pass) nHunt = n;
      }
      if (extra) for (const b of extra) if (n < CAPACITY) place({ anchor: 0, reach: 0, keep: 1, ...b }, b.id, 1);
      // R0b: 演出の一人の前に並ぶ乗り手（focus.group）は instanced の体で、演出の姿勢で描く（名もない者は番号から決まった見た目）
      if (focus?.group) focus.group.forEach((g, i) => { if (g.pose.keep > 0 && n < CAPACITY) place({ anchor: 0, ...g.pose }, g.id ?? 0.37 + i * 0.11, 1); });
      // 演出の一人: 専用の体（setRiderBody）があればその網で、なければ instanced の体で
      const fp = focus?.pose;
      if (focusMesh) focusMesh.visible = !!(fp && fp.keep > 0);
      if (fp && fp.keep > 0) {
        if (focusMesh) {
          _p.set(fp.x, fp.y, fp.z);
          _q.setFromEuler(_e.set(fp.pitch, fp.yaw, fp.roll, 'YXZ'));
          focusMesh.setMatrixAt(0, _m.compose(_p, _q, _s));
          focusMesh.instanceMatrix.needsUpdate = true;
          const h = hash(focus.id ?? 0.5);
          focusAnim.setXYZW(0, h * 6.283, fp.reach ?? 0, 1, fp.keep);
          focusPose.setXYZ(0, 0, fp.thrust ?? 1, fp.head ?? 0);
          focusAnim.needsUpdate = focusPose.needsUpdate = true;
        } else if (n < CAPACITY) place({ anchor: 0, ...fp }, focus.id ?? 0.5, 1);
      }
      mesh.count = shadows.count = trails.count = n;
      xray.count = nHunt;
      markerGeo.setDrawRange(0, nHunt);
      markerPos.needsUpdate = markerKind.needsUpdate = kindAttr.needsUpdate = true;
      searchlight.update(bossPose && { ...bossPose, scale: KIND_SCALE.boss }, time);
      mesh.instanceMatrix.needsUpdate = true;
      shadows.instanceMatrix.needsUpdate = true;
      anim.needsUpdate = pose.needsUpdate = shadowAttr.needsUpdate = move.needsUpdate = true;
      _p.set(0, heroLift, 0); // 主人公は浮いている（足元の地面が下がっても y=0。導入の TAP START のあとだけ下から浮き上がる）
      hero.setMatrixAt(0, _m.compose(_p, _q.setFromEuler(_e.set(0, heroYaw, 0)), _s));
      hero.instanceMatrix.needsUpdate = true;
    },
    // 演出の一人: { id, pose: { x, y, z, yaw, pitch, roll, reach, thrust, keep, head } }（pose は毎フレーム読む）。null でやめる。
    // id が null（軍勢がいない）でも、名もない一人を描く
    // R0b: f.group（[{ id, pose }]）があれば、その乗り手たちも演出の姿勢で描く（本当の場所には描かない）
    setFocus(f) { focus = f; focusIds = f?.group ? new Set(f.group.map((g) => g.id).filter((x) => x !== null && x !== undefined)) : null; },
    // 演出の一人の専用の体（riderBody の戻り値）。大きく映っても箱の寄せ集めに見えない
    setRiderBody(b) {
      if (focusMesh?.geometry === b.geometry) return;
      const g = b.geometry;
      focusAnim = new THREE.InstancedBufferAttribute(new Float32Array(4), 4);
      focusPose = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
      g.setAttribute('aAnim', focusAnim);
      g.setAttribute('aPose', focusPose);
      g.setAttribute('aMove', new THREE.InstancedBufferAttribute(new Float32Array(2), 2)); // 演出の一人は尾を引かず、前かがみは決めた姿勢のまま
      if (!focusMesh) {
        focusMesh = new THREE.InstancedMesh(g, mat, 1);
        focusMesh.frustumCulled = false;
        focusMesh.name = 'focus-rider';
        focusMesh.visible = false;
        group.add(focusMesh);
      } else focusMesh.geometry = g;
    },
    get focusMesh() { return focusMesh; },
    get focus() { return focus; },
    // 主人公の向き（y 軸まわり。0 で +z を向く）
    setHeroYaw(yaw) { heroYaw = yaw; },
    // 主人公の高さのずれ（m。S6 の TAP START で浮き上がる間だけ。ふだん 0）
    setHeroLift(y) { heroLift = Number.isFinite(y) ? y : 0; },
    get heroYaw() { return heroYaw; },
  };
}
