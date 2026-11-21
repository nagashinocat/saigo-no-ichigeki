import * as THREE from 'three';
import { TIERS } from './quality.js';
import { GRID } from '../world/cityGen.js';
import { CONFIG } from '../config.js';
import { SPHERE_DEFORM_GLSL, MAX_FRONTS, CRATER_LIP } from './sphereDeform.js';

// 作風「写実的なアニメ調」: 暗めの夕方（日が沈んだ直後）の空、弱く低い一方向の光、3段に量子化した陰影、
// 多く灯る窓の明かりと街灯、遠景は地平の茜色へ溶ける。暗い街の上で浮遊バイクの推進の光が映える。

// 光の方角: カメラから見て右奥。直射光は低く弱い深い橙（沈んだ夕日の名残り）で、長い影を左手前へ落とす。
// アニメ調の3段の陰影が残るよう、光そのものは地平の少し上から当てる（空に見える夕日は地平の下: SKY_SUN）
const SUN_DIR = new THREE.Vector3(0.80, 0.30, -0.45).normalize();
// 空に見える夕日（光の名残りの中心）: 光と同じ方角の、地平のすぐ下。宇宙から見た地球の夕日も同じ（spaceView）
const SKY_SUN_Y = -0.07;
export const SKY_SUN = (() => {
  const h = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize().multiplyScalar(Math.sqrt(1 - SKY_SUN_Y * SKY_SUN_Y));
  return new THREE.Vector3(h.x, SKY_SUN_Y, h.y);
})();
const SUN_COLOR = new THREE.Color(1.0, 0.50, 0.30);
const SUN_INTENSITY = 2.1;
const SKY_FILL = new THREE.Color(0.30, 0.36, 0.85);    // 影側に回る空の群青
const GROUND_FILL = new THREE.Color(0.42, 0.26, 0.30); // 地面からの照り返し（暗い茜）
const FILL_INTENSITY = 1.0;
const GROUND_DUSK = 0.78; // 地面の色を沈める割合

// 夕方の光の色（軍勢・主人公の陰影は enemyView の自前のシェーダーなので、tintFigures で uniform の値を合わせる）
export const DUSK = {
  // 姿は暗い街の上でも形が読めるよう、建物よりわずかに明るめに当てる（縁の光も夕日の側から）
  figureSun: new THREE.Color(1.0, 0.52, 0.32),
  figureSky: new THREE.Color(0.45, 0.52, 1.0),
  figureGround: new THREE.Color(0.46, 0.30, 0.36),
  // 浮遊バイクの推進の光（淡い緑のまま明るく。窓の明かりより明るく、bloom の閾値を超える）
  thrust: new THREE.Color(0.55, 1.0, 0.82).multiplyScalar(1.6),
  // low の段（bloom なし）: 淡い緑のまま明るくするとトーンマップで白く飛ぶので、飽和した緑へ寄せ、明るさは控える（にじまなくても緑に読める）
  thrustLow: new THREE.Color(0.12, 1.0, 0.38),
};

// 窓の明かり（sRGB で決めた色。シェーダーの srgb() と同じく線形へ直して明るさを測る）
const LAMP_WARM = [1.0, 0.78, 0.46], LAMP_COOL = [0.86, 0.93, 1.0], SHOP = [1.0, 0.82, 0.58];
const LAMP_GAIN = 0.85, LAMP_VAR = [0.7, 0.5]; // 部屋ごとの明るさ: GAIN * (VAR[0] + VAR[1] * 乱数)
const SHOP_GAIN = 1.2;
const linLum = (c) => { const [r, g, b] = c.map((x) => x ** 2.2); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// いちばん明るい窓の灯りの輝度（bloom の閾値より下に保ち、にじむのはバイクの光・爆発・街灯の頭だけにする）
export const WINDOW_LAMP_MAX = Math.max(
  Math.max(linLum(LAMP_WARM), linLum(LAMP_COOL)) * LAMP_GAIN * (LAMP_VAR[0] + LAMP_VAR[1]),
  linLum(SHOP) * SHOP_GAIN,
);
const FOG_DENSITY = 0.0015;
const FOG_START = 320;

// sRGB で決めた色をシェーダーの線形値へ（見た目の色で調整しやすくするため）
const GLSL_COMMON = /* glsl */`
uniform vec3 uSunDir, uSkySun;
uniform float uFogStart; // 霞み始める距離（ふだんは FOG_START。リプレイの真上のカメラは遠いので延ばす）
varying vec3 vFogW;
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
vec3 skyColor(vec3 d) {
  float h = d.y;
  vec2 dh = normalize(d.xz + 1e-5), sh = normalize(uSunDir.xz);
  float toSun = dot(dh, sh) * 0.5 + 0.5;
  // 日が沈んだ直後: 上は濃い藍、その下に群青、地平近くに茜色の帯（夕日の方ほど赤橙に明るい）
  vec3 zenith = srgb(vec3(0.045, 0.055, 0.17));
  vec3 upper = srgb(vec3(0.11, 0.15, 0.37));
  vec3 band = mix(srgb(vec3(0.30, 0.22, 0.42)), srgb(vec3(0.74, 0.34, 0.30)), pow(toSun, 2.0));
  vec3 horizon = mix(srgb(vec3(0.44, 0.27, 0.38)), srgb(vec3(0.98, 0.46, 0.22)), pow(toSun, 3.0));
  float t = max(h, 0.0);
  vec3 c = mix(horizon, band, smoothstep(0.0, 0.07, t));
  c = mix(c, upper, smoothstep(0.06, 0.30, t));
  c = mix(c, zenith, smoothstep(0.28, 0.9, t));
  // 地平の下に沈んだ夕日の名残り（円盤はなく、地平の上へにじむ光だけ）
  float sd = max(dot(d, uSkySun), 0.0);
  c += srgb(vec3(1.0, 0.50, 0.22)) * (pow(sd, 5.0) * 0.38 + pow(sd, 30.0) * 0.45) * smoothstep(-0.12, 0.02, h);
  return c;
}
// 遠くほど、その方向の地平の空の色へ溶かす（空とつながる大気遠近）
vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 v = worldPos - cameraPosition;
  float dist = length(v);
  // 上空カメラから街までの約400mは澄ませ、その先から霞ませる
  float f = 1.0 - exp(-pow(max(dist - uFogStart, 0.0) * ${FOG_DENSITY.toFixed(5)}, 1.6));
  vec2 hz = v.xz + uSunDir.xz * 1e-3;
  vec3 fc = skyColor(normalize(vec3(hz.x, 0.015 * length(hz), hz.y)));
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

const FOG_VERTEX = /* glsl */`
{
  vec4 fw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fw = instanceMatrix * fw;
  #endif
  vFogW = (modelMatrix * fw).xyz;
}
`;

// 直接光を3段（影・中間・日なた）に量子化し、元のなめらかさを少しだけ混ぜる
export const TOON_RAMP = /* glsl */`
float toonRamp(float x) {
  float s = 0.5 * smoothstep(0.03, 0.10, x) + 0.5 * smoothstep(0.38, 0.46, x);
  return mix(s, x, 0.15);
}
`;
export const TOON_LIGHTS = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
  'vec3 irradiance = dotNL * directLight.color;',
  'vec3 irradiance = toonRamp( dotNL ) * directLight.color;',
);

function patchCommon(shader, uniforms) {
  shader.uniforms.uSunDir = uniforms.uSunDir;
  shader.uniforms.uSkySun = uniforms.uSkySun;
  shader.uniforms.uFogStart = uniforms.uFogStart;
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', 'varying vec3 vFogW;')
    .replace('#include <fog_vertex>', FOG_VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', GLSL_COMMON + TOON_RAMP)
    .replace('#include <fog_fragment>', '')
    .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogW);\n#include <tonemapping_fragment>')
    .replace('#include <lights_physical_pars_fragment>', TOON_LIGHTS);
}

// 爆発の球に沿ったゆがみ（sphereDeform.js の式）を使うシェーダーへ、共有の uniform を渡す
const DEFORM_UNIFORMS = ['uFronts', 'uFrontCount', 'uTime', 'uHeat', 'uEmber', 'uCrater', 'uRingStep'];
function patchDeform(shader, uniforms) {
  for (const k of DEFORM_UNIFORMS) shader.uniforms[k] = uniforms[k];
}
const DEFORM_VERT_PARS = SPHERE_DEFORM_GLSL + /* glsl */`
uniform float uTime;
attribute vec2 aCrush; // x: つぶれ始めた時刻, y: つぶれきるまでの秒（0 はつぶれていない）
float dfHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// 押し付けられた壁のしわ（なめらかな値ノイズ -0.5〜0.5）
float dfWrinkle(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dfHash(i), dfHash(i + vec3(1, 0, 0)), f.x), mix(dfHash(i + vec3(0, 1, 0)), dfHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dfHash(i + vec3(0, 0, 1)), dfHash(i + vec3(1, 0, 1)), f.x), mix(dfHash(i + vec3(0, 1, 1)), dfHash(i + vec3(1, 1, 1)), f.x), f.y), f.z) - 0.5;
}
`;

// ビルの頂点を、球の内側に入ったら球の面へ押し出し（deformPoint）、当たったあとは高さを押しつぶす（crushPoint）。
// transformed（箱のローカル座標）を書き換えるので、後に続く投影・影・霧の計算はそのまま使える。
// withNormal: 押し付けられた面の向きを球の面の向きへ寄せる（陰影がある材質だけ）
function buildingDeform(withNormal) {
  return /* glsl */`
#ifdef USE_INSTANCING
{
  vec3 dS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 w0 = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  float ck = aCrush.y > 0.0 ? clamp((uTime - aCrush.x) / aCrush.y, 0.0, 1.0) : 0.0;
  vec3 sq = crushSquash(w0, ck);
  vec3 w1 = deformPoint(sq);
  float pushed = length(w1 - sq);
  // 見た目だけ: 押し付けられた面は、光の球の表面の波打ち（±2%）より少し外に置き、球に埋もれないようにする。
  // さらに、押し付けられた量とつぶれの進みに応じて、壁をしわくちゃにする
  if (pushed > 0.0) {
    float crumple = min(pushed, 10.0) * (0.45 + 0.5 * ck);
    w1 *= 1.0 + 0.022 * smoothstep(0.0, 2.0, pushed) + crumple * dfWrinkle(w0 * 0.22) / max(length(w1), 1.0);
    w1.y = max(w1.y + crumple * 0.5 * dfWrinkle(w0 * 0.3 + 7.0), 0.0);
  }
  if (dS.y > 1e-4 && (ck > 0.0 || pushed > 0.0)) transformed = (w1 - instanceMatrix[3].xyz) / dS;
  ${withNormal ? `vPress = max(smoothstep(0.0, 3.0, pushed), ck * 0.6);
  if (pushed > 0.0) vNormal = normalize(mix(vNormal, normalize((viewMatrix * vec4(normalize(w1), 0.0)).xyz), smoothstep(0.0, 3.0, pushed) * 0.8));` : ''}
}
#endif
`;
}

// 種類ごとのファサード（窓の格子）の決め方。単位は m。
export const FACADE = {
  house: { bay: 3.4, floor: 2.9, ground: 0.8, corner: 0.9, top: 0.9, wx: 0.42, wy: 0.46, refl: 0.30, lit: 0.60, shop: 0.0, glass: [0.10, 0.11, 0.14] },
  office: { bay: 3.1, floor: 3.6, ground: 4.6, corner: 1.2, top: 1.4, wx: 0.66, wy: 0.52, refl: 0.55, lit: 0.50, shop: 0.65, glass: [0.08, 0.11, 0.17] },
  tower: { bay: 1.7, floor: 3.9, ground: 6.0, corner: 0.8, top: 3.0, wx: 0.86, wy: 0.74, refl: 0.85, lit: 0.42, shop: 0.8, glass: [0.06, 0.12, 0.17] },
};
const f = (x) => Number(x).toFixed(4);

const BUILDING_VERTEX = /* glsl */`
#include <begin_vertex>
{
  vec3 bS = vec3(1.0); vec2 bO = vec2(0.0);
  #ifdef USE_INSTANCING
    bS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    bO = instanceMatrix[3].xz;
  #endif
  vSize = bS; vB = position * bS; vObjN = normal;
  vSeed = hash12(bO * 0.137 + 3.1);
  vPress = 0.0;
}
`;

function buildingFragment(p) {
  return /* glsl */`
#include <color_fragment>
float glassM = 0.0; vec3 winEmis = vec3(0.0);
{
  vec3 n = vec3(round(vObjN.x), round(vObjN.y), round(vObjN.z));
  // 建物ごとのばらつき（窓の間隔・大きさ・ガラスの色）
  float sA = fract(vSeed * 7.13), sB = fract(vSeed * 3.71), sC = fract(vSeed * 5.19);
  float bay = ${f(p.bay)} * mix(0.8, 1.35, sA);
  float wxV = clamp(${f(p.wx)} + (sB - 0.5) * 0.28, 0.28, 0.92);
  float wyV = clamp(${f(p.wy)} + (sC - 0.5) * 0.3, 0.3, 0.9);
  float side = 1.0 - step(0.5, abs(n.y));
  // 壁の明るさ: 足元は暗く（接地の陰）、上へ少し明るく
  float ao = mix(0.55, 1.0, smoothstep(0.0, 7.0, vB.y));
  float lift = mix(0.94, 1.06, smoothstep(0.0, max(vSize.y, 1.0), vB.y));
  vec3 wall = diffuseColor.rgb * ao * lift;

  vec2 fu = abs(n.x) > 0.5 ? vec2(vB.z * sign(n.x), vB.y) : vec2(-vB.x * sign(n.z), vB.y);
  float faceW = abs(n.x) > 0.5 ? vSize.z : vSize.x;
  float usable = faceW - 2.0 * ${f(p.corner)};
  float nb = max(1.0, floor(usable / bay));
  float cx = (fu.x + faceW * 0.5 - ${f(p.corner)}) / (usable / nb);
  float vTop = vSize.y - ${f(p.top)};
  float nf = max(0.0, floor((vTop - ${f(p.ground)}) / ${f(p.floor)}));
  float cy = (fu.y - ${f(p.ground)}) / ${f(p.floor)};
  float inGrid = step(0.0, cx) * step(cx, nb) * step(0.0, cy) * step(cy, nf);

  float wxA = fwidth(cx) * 0.8, wyA = fwidth(cy) * 0.8;
  float fx = fract(cx), fy = fract(cy);
  float hx = wxV * 0.5, hy = wyV * 0.5;
  float mx = smoothstep(0.5 - hx - wxA, 0.5 - hx + wxA, fx) * (1.0 - smoothstep(0.5 + hx - wxA, 0.5 + hx + wxA, fx));
  float my = smoothstep(0.42 - hy - wyA, 0.42 - hy + wyA, fy) * (1.0 - smoothstep(0.42 + hy - wyA, 0.42 + hy + wyA, fy));
  float m = mx * my;
  // 遠くで格子が細かくなりすぎたら平均の濃さに置き換える（ちらつき防止）
  m = mix(m, wxV * wyV, smoothstep(0.25, 0.6, max(wxA, wyA)));
  m *= inGrid * side;

  // 1階の店先（office / tower）
  float shopM = 0.0;
  #if ${p.shop > 0 ? 1 : 0}
  {
    float sx = fract((fu.x + faceW * 0.5) / 4.0);
    float sa = fwidth(fu.x) * 0.25;
    float band = smoothstep(0.5, 0.7, fu.y) * (1.0 - smoothstep(${f(p.ground - 1.2)}, ${f(p.ground - 0.9)}, fu.y));
    float mull = smoothstep(0.04 - sa, 0.04 + sa, sx) * (1.0 - smoothstep(0.96 - sa, 0.96 + sa, sx));
    shopM = band * mix(mull, 0.92, smoothstep(0.2, 0.5, sa * 4.0)) * side * step(abs(fu.x), faceW * 0.5 - 0.6);
  }
  #endif

  // 窓の階ごと・部屋ごとの点灯（暗めの夕方なので多くの部屋が灯る）
  vec2 cell = vec2(floor(cx), floor(cy)) + n.xz * 37.0 + vSeed * 113.0;
  float floorLit = hash12(vec2(floor(cy), vSeed * 71.0 + n.x * 5.0 + n.z * 9.0));
  float lit = step(hash12(cell), ${f(p.lit)} * (0.25 + 1.5 * floorLit));
  float warm = hash12(cell + 7.7);
  vec3 lampC = mix(srgb(vec3(${LAMP_WARM.map(f).join(',')})), srgb(vec3(${LAMP_COOL.map(f).join(',')})), step(0.8, warm)) * (${f(LAMP_VAR[0])} + ${f(LAMP_VAR[1])} * hash12(cell + 3.3));
  float shopLit = step(hash12(vec2(floor((fu.x + faceW * 0.5) / 4.0), vSeed * 19.0 + n.x * 3.0 + n.z)), ${f(p.shop)});

  // ガラス: 暗い地の色に、空をわずかに映す
  vec3 V = normalize(cameraPosition - vFogW);
  vec3 R = reflect(-V, n);
  // 下向きの反射も地平付近の空として映す（夕焼けを窓に映すアニメ的な誇張）
  R.y = abs(R.y) * 0.2 + 0.02;
  float fres = 0.35 + 0.65 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 skyR = skyColor(normalize(R)) * fres * ${f(p.refl)};

  glassM = clamp(m + shopM, 0.0, 1.0);
  vec3 glassBase = srgb(vec3(${p.glass.map(f).join(',')}));
  glassBase = mix(glassBase, sC < 0.33 ? srgb(vec3(0.24, 0.19, 0.15)) : sC < 0.66 ? srgb(vec3(0.15, 0.22, 0.24)) : srgb(vec3(0.18, 0.19, 0.24)), 0.6);
  diffuseColor.rgb = mix(wall, glassBase, glassM);
  winEmis = (skyR * (1.0 - lit) + lampC * lit * ${f(LAMP_GAIN)}) * m + srgb(vec3(${SHOP.map(f).join(',')})) * shopLit * shopM * ${f(SHOP_GAIN)} + skyR * shopM * (1.0 - shopLit);

  // 屋上: 落ち着いたコンクリート、縁の立ち上がりは明るく
  float roof = step(0.5, n.y);
  float edge = min(vSize.x * 0.5 - abs(vB.x), vSize.z * 0.5 - abs(vB.z));
  vec3 roofC = mix(srgb(vec3(0.52, 0.50, 0.54)), diffuseColor.rgb, 0.25) * mix(1.0, 0.88, vnoise(vB.xz * 0.35));
  roofC = mix(srgb(vec3(0.66, 0.62, 0.62)), roofC, smoothstep(0.45, 0.7, edge));
  diffuseColor.rgb = mix(diffuseColor.rgb, roofC, roof);
  glassM *= 1.0 - roof; winEmis *= 1.0 - roof;

  // 球の面に押し付けられたところは焦げて暗く、球の熱で赤く光る
  diffuseColor.rgb *= mix(1.0, 0.6, vPress);
  winEmis = winEmis * (1.0 - 0.5 * vPress) + srgb(vec3(1.0, 0.42, 0.14)) * vPress * (0.08 + 0.45 * uHeat);
}
`;
}

function makeBuildingMaterial(kind, uniforms) {
  const p = FACADE[kind];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    patchCommon(shader, uniforms);
    patchDeform(shader, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vB; flat varying vec3 vSize; varying vec3 vObjN; flat varying float vSeed; varying float vPress;\nfloat hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }\n' + DEFORM_VERT_PARS)
      .replace('#include <begin_vertex>', BUILDING_VERTEX + buildingDeform(true));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vB; flat varying vec3 vSize; varying vec3 vObjN; flat varying float vSeed; varying float vPress;\nuniform float uHeat;')
      .replace('#include <color_fragment>', buildingFragment(p))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.18, glassM);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += winEmis;');
  };
  mat.customProgramCacheKey = () => 'building-' + kind;
  return mat;
}

// 影の地図へ描くときも、つぶれた形で描く
function makeBuildingDepthMaterial(uniforms) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    patchDeform(shader, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + DEFORM_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + buildingDeform(false));
  };
  mat.customProgramCacheKey = () => 'building-depth';
  return mat;
}

// 地面のえぐれ: 最大の球（uFronts[0]）の下半分の形に掘り下げ、縁の外に盛り上がりを作る。
// 縁にいちばん近い輪の頂点を縁の上へ寄せて、縁がきれいな円になるようにする（uRingStep: 輪の間隔）。
const GROUND_VERTEX = /* glsl */`
vec3 gPos = position;
vec3 objectNormal = vec3(0.0, 1.0, 0.0);
if (uFrontCount > 0) {
  float F = uFronts[0];
  float r = length(gPos.xz);
  if (abs(r - F) < uRingStep * 0.5) { gPos.xz *= F / r; r = F; }
  float d = craterDepth(r);
  gPos.y = groundHeight(r); // 敵や主人公が立つ高さ（sphereDeform.js の groundHeight）と同じ式
  vec2 rad = r > 1e-3 ? gPos.xz / r : vec2(0.0);
  if (d > 0.0) {
    objectNormal = normalize(-gPos); // 穴の面は球の中心を向く
  } else {
    float L = ${f(CRATER_LIP.height)} * F + 0.5, W = ${f(CRATER_LIP.width)} * F + 3.0;
    float x = (r - F) / W, e = exp(1.0 - x);
    float slope = L / W * e * (1.0 - x);
    objectNormal = normalize(vec3(-slope * rad.x, 1.0, -slope * rad.y));
  }
}
`;

// 地面: 道路の格子（車道・歩道・中央線・横断歩道）、主人公の立つ広場、街の外は野原へ
function makeGroundMaterial(uniforms, detail) {
  const { BLOCK, PITCH } = GRID;
  const R = CONFIG.cityRadius, plaza = CONFIG.plazaRadius;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    patchCommon(shader, uniforms);
    patchDeform(shader, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + SPHERE_DEFORM_GLSL + 'uniform float uRingStep;')
      .replace('#include <beginnormal_vertex>', GROUND_VERTEX)
      .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCrater, uHeat, uEmber, uTime;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += groundEmis;')
      .replace('applyFog(gl_FragColor.rgb, vFogW)', 'applyFog(gl_FragColor.rgb, cameraPosition + (vFogW - cameraPosition) * groundFogK)')
      .replace('#include <color_fragment>', /* glsl */`
#include <color_fragment>
vec3 groundEmis = vec3(0.0);
float groundFogK = 1.0; // 穴の中は霞を薄くして、深さと岩肌を見せる
{
  vec2 p = vFogW.xz;
  float px = max(fwidth(p.x), fwidth(p.y));
  vec2 q = mod(p + ${f(PITCH / 2)}, ${f(PITCH)}) - ${f(PITCH / 2)};
  vec2 a = abs(q);
  vec2 blockId = floor((p + ${f(PITCH / 2)}) / ${f(PITCH)});
  float hb = ${f(BLOCK / 2)};
  float aa = px * 0.75;
  float inBlock = (1.0 - smoothstep(hb - aa, hb + aa, a.x)) * (1.0 - smoothstep(hb - aa, hb + aa, a.y));
  float lot = (1.0 - smoothstep(hb - 2.4 - aa, hb - 2.4 + aa, a.x)) * (1.0 - smoothstep(hb - 2.4 - aa, hb - 2.4 + aa, a.y));

  float bh = hash12(blockId + 17.0);
  vec3 asphalt = srgb(vec3(0.31, 0.31, 0.37)) * mix(0.92, 1.06, vnoise(p * 0.15));
  vec3 walk = srgb(vec3(0.66, 0.63, 0.62));
  vec3 lotC = bh < 0.16 ? srgb(vec3(0.33, 0.46, 0.27)) * mix(0.85, 1.1, vnoise(p * 0.4)) : srgb(vec3(0.50, 0.49, 0.50)) * mix(0.9, 1.05, vnoise(p * 0.3));
  vec3 c = mix(asphalt, mix(walk, lotC, lot), inBlock);

  // 道路の中央の破線と、交差点手前の横断歩道
  float lineFade = 1.0 - smoothstep(0.08, 0.25, px);
  vec3 paint = srgb(vec3(0.88, 0.86, 0.78));
  float midX = (1.0 - smoothstep(0.12 - aa, 0.12 + aa, abs(a.x - ${f(PITCH / 2)}))) * step(a.y, hb) * step(0.5, fract(p.y / 6.0));
  float midZ = (1.0 - smoothstep(0.12 - aa, 0.12 + aa, abs(a.y - ${f(PITCH / 2)}))) * step(a.x, hb) * step(0.5, fract(p.x / 6.0));
  float crossX = step(hb, a.x) * step(hb - 3.0, a.y) * step(a.y, hb - 0.6) * step(0.5, fract(q.x * 1.0)) * step(a.x, ${f(PITCH / 2 - 0.4)});
  float crossZ = step(hb, a.y) * step(hb - 3.0, a.x) * step(a.x, hb - 0.6) * step(0.5, fract(q.y * 1.0)) * step(a.y, ${f(PITCH / 2 - 0.4)});
  float marks = max(max(midX, midZ), max(crossX, crossZ) * (1.0 - smoothstep(0.15, 0.4, px)));
  c = mix(c, paint, marks * lineFade * 0.85);
  // 縁石の細い影
  float curb = (1.0 - smoothstep(0.0, 0.25 + aa, abs(max(a.x, a.y) - hb))) * (1.0 - smoothstep(0.1, 0.3, px));
  c *= 1.0 - curb * 0.25 * step(min(a.x, a.y), hb);

  // 主人公の広場（同心円の石畳）
  float r = length(p);
  vec3 stone = srgb(vec3(0.74, 0.68, 0.62)) * mix(0.93, 1.03, hash12(floor(vec2(atan(p.y, p.x) * 6.0, r * 0.8))));
  float ring = 1.0 - smoothstep(0.08, 0.18, abs(fract(r / 4.0) - 0.5) * 4.0 - 1.8);
  stone *= 1.0 - 0.18 * (1.0 - smoothstep(0.1, 0.2, abs(r - ${f(plaza * 0.5)}))) - 0.2 * (1.0 - smoothstep(0.1, 0.25, abs(r - ${f(plaza)})));
  c = mix(c, stone, 1.0 - smoothstep(${f(plaza + 1.0)}, ${f(plaza + 1.6)}, r));

  // 街の外: 野原と畑へ
  vec3 field = mix(srgb(vec3(0.36, 0.42, 0.26)), srgb(vec3(0.50, 0.46, 0.30)), step(0.55, vnoise(p * 0.012))) * mix(0.85, 1.05, vnoise(p * 0.08));
  c = mix(c, field, smoothstep(${f(R + 20)}, ${f(R + 70)}, r));
  // 暗めの夕方: 地面は全体に一段沈める（窓・街灯・推進の光が浮かぶように）
  c *= ${f(GROUND_DUSK)};

  // 爆発のえぐれ（球の下半分の穴）: 焼けた岩肌、縁の外は掘り返された明るい土の盛り上がりと放射状の焦げ跡、
  // 縁に明るい筋。球が光っている間は割れ目が溶けて光り、消えたあとは熾火になって冷える。
  // 重い模様は、穴の中（inC > 0）と縁の外の帯（焦げ跡が届く範囲）だけで計算する。それより外の地面では何もしない
  if (uCrater > 0.0) {
    float F = uCrater, y = vFogW.y;
    float W = ${f(CRATER_LIP.width)} * F + 3.0;
    float rw = max(0.7, F * 0.005) + px * 1.5;
    float inLo = F - 0.3 - px;
    float inC = 1.0 - smoothstep(inLo, F - 0.05, r);
    float bandOut = F * 1.35 + W * 1.5; // 焦げ跡（最大 0.34F）と土の盛り上がり（1.3W）の外
    // 穴の面の模様は、球の面の向きで3つの平面から取って混ぜる（壁で模様が伸びないように）
    vec3 tw = vFogW / F; tw *= tw; tw /= tw.x + tw.y + tw.z + 1e-4;
    #define TRI(s, o) (vnoise(vFogW.xz * (s) + (o)) * tw.y + vnoise(vFogW.xy * (s) + (o)) * tw.z + vnoise(vFogW.zy * (s) + (o)) * tw.x)
    vec2 cq = vFogW.xz;
    float ang = atan(p.y, p.x);
    // 縁の外: 掘り返された明るい土の盛り上がりと放射状の焦げ跡（穴の中だけのピクセルでは計算しない）
    if (inC < 1.0 && r < bandOut) {
      float xo = max(r - F, 0.0);
      float rays = smoothstep(0.45, 0.8, vnoise(vec2(ang * 14.0, 3.0)) * 0.7 + vnoise(vec2(ang * 45.0, 7.0)) * 0.3);
      float ejecta = (1.0 - smoothstep(0.0, F * (0.06 + 0.28 * rays), xo)) * (1.0 - inC);
      c = mix(c, srgb(vec3(0.22, 0.17, 0.16)), ejecta * 0.75);
      float soil = (1.0 - smoothstep(W * 0.3, W * 1.3, xo)) * (1.0 - inC);
      if (soil > 0.0) {
        #ifdef CRATER_DETAIL
        float sg = TRI(0.11, 0.0);
        #else
        float sg = 0.5;
        #endif
        c = mix(c, srgb(vec3(0.60, 0.49, 0.41)) * mix(0.9, 1.05, sg), soil * 0.8);
      }
    }
    // 穴の中: 焼けた岩肌、溶けた割れ目と熾火
    if (inC > 0.0) {
      float dn = clamp(-y / F, 0.0, 1.0);
      #ifdef CRATER_DETAIL
      float strata = vnoise(vec2(y * 0.045, ang * 2.0 + vnoise(p * 0.015) * 3.0));
      float grain = TRI(0.11, 0.0);
      #else
      float strata = 0.5 + 0.5 * sin(y * 0.14);
      float grain = 0.5;
      #endif
      vec3 rock = mix(srgb(vec3(0.56, 0.43, 0.35)), srgb(vec3(0.30, 0.23, 0.23)), smoothstep(0.0, 0.7, dn));
      rock *= mix(0.82, 1.08, smoothstep(0.35, 0.65, strata)) * mix(0.88, 1.06, grain);
      c = mix(c, rock, inC);
      groundFogK = mix(1.0, 0.35, inC);
      #ifdef CRATER_DETAIL
      float cr = abs(TRI(0.025, 0.0) - 0.5);
      float crack = (1.0 - smoothstep(0.0, 0.03 + px * 0.01, cr)) * inC * smoothstep(0.03, 0.12, dn) * smoothstep(0.45, 0.65, TRI(0.006, 5.0));
      float ember = smoothstep(0.78, 0.88, TRI(0.12, 11.0)) * inC;
      #else
      float crack = (1.0 - smoothstep(0.0, 0.03 + px * 0.01, abs(vnoise(cq * 0.025) - 0.5))) * inC * smoothstep(0.03, 0.12, dn);
      float ember = smoothstep(0.78, 0.88, vnoise(cq * 0.12 + 11.0)) * inC;
      #endif
      float flick = 0.7 + 0.3 * sin(uTime * 3.0 + grain * 12.0);
      groundEmis += srgb(vec3(1.0, 0.34, 0.07)) * (crack * (1.8 * uHeat + 0.8 * uEmber) + ember * uEmber * flick * 1.1);
      // 球が光っている間は、穴の奥まで内側から照らされる
      groundEmis += srgb(vec3(1.0, 0.52, 0.22)) * inC * uHeat * 0.3;
    }
    // 縁の明るい筋
    float rim = 1.0 - smoothstep(0.0, rw, abs(r - F));
    c = mix(c, srgb(vec3(1.0, 0.88, 0.74)), rim * 0.9);
    groundEmis += srgb(vec3(1.0, 0.72, 0.48)) * rim * (0.3 + 1.4 * uHeat);
    #undef TRI
  }
  diffuseColor.rgb = c;
}
`);
  };
  if (detail) mat.defines = { CRATER_DETAIL: '' };
  mat.customProgramCacheKey = () => 'ground' + (detail ? '-detail' : '');
  return mat;
}

// 街灯の下の道路に落ちる光の溜まり（地面すれすれの板に加算で描く。中心ほど明るく、縁はやわらかく消える）
function makeLampPoolMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.62, 0.30).multiplyScalar(0.30) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        float k = (1.0 - smoothstep(0.0, 1.0, r)) * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.35, r)));
        gl_FragColor = vec4(uColor * k, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function makeToonMaterial(name, uniforms, params) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.0, ...params });
  mat.onBeforeCompile = (shader) => patchCommon(shader, uniforms);
  mat.customProgramCacheKey = () => 'toon-' + name;
  return mat;
}

function makeGlowMaterial(name, uniforms, params) {
  const mat = new THREE.MeshBasicMaterial(params);
  mat.onBeforeCompile = (shader) => patchCommon(shader, uniforms);
  mat.customProgramCacheKey = () => 'glow-' + name;
  return mat;
}

// 高画質だけの縁取り線: 箱の角で平均した法線方向へ少し膨らませ、裏面だけを暗い色で描く。
// 太さは距離に比例させ、画面上でほぼ一定（約1px）にする。
function makeOutlineMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uSunDir: uniforms.uSunDir, uSkySun: uniforms.uSkySun, uFogStart: uniforms.uFogStart, uWidth: { value: 0.0016 }, uFronts: uniforms.uFronts, uFrontCount: uniforms.uFrontCount, uTime: uniforms.uTime },
    vertexShader: /* glsl */`
      uniform float uWidth;
      varying vec3 vFogW;
      ${DEFORM_VERT_PARS}
      void main() {
        vec3 s = vec3(1.0); vec3 o = vec3(0.0);
        vec3 transformed = position;
        ${buildingDeform(false)}
        #ifdef USE_INSTANCING
          s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          o = instanceMatrix[3].xyz;
        #endif
        vec4 wp = modelMatrix * vec4(o + transformed * s, 1.0);
        vec3 nAvg = normalize(sign(position - vec3(0.0, 0.5, 0.0)));
        float dist = length(cameraPosition - wp.xyz);
        wp.xyz += nAvg * min(dist * uWidth, 0.9) * step(1e-4, s.y);
        vFogW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      void main() {
        vec3 c = applyFog(srgb(vec3(0.14, 0.10, 0.17)), vFogW);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// 影の地図を使わない画質向け: 建物の箱を太陽の方向へ地面に押しつぶして、平面の影を描く。
// 重なりで二重に濃くならないよう、ステンシルで1画素1回にする。
function makePlanarShadowMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uSun: { value: SUN_DIR.clone() }, uFronts: uniforms.uFronts, uFrontCount: uniforms.uFrontCount, uTime: uniforms.uTime },
    vertexShader: /* glsl */`
      uniform vec3 uSun;
      varying float vFade;
      ${DEFORM_VERT_PARS}
      void main() {
        vec3 transformed = position;
        ${buildingDeform(false)}
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        wp.xz -= uSun.xz * (wp.y / uSun.y);
        vFade = 1.0 - smoothstep(600.0, 900.0, length(wp.xz));
        wp.y = 0.03 - craterDepth(length(wp.xz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying float vFade;
      void main() { gl_FragColor = vec4(0.10, 0.08, 0.22, 0.50 * vFade); }`,
  });
}

function makeSky(uniforms) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSunDir: uniforms.uSunDir, uSkySun: uniforms.uSkySun, uFogStart: uniforms.uFogStart },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww; }`,
    fragmentShader: GLSL_COMMON.replace('varying vec3 vFogW;', '') + /* glsl */`
      varying vec3 vDir;
      // アニメ調の雲: 地平に近い帯の中に、輪郭のはっきりした塊を置き、太陽側の縁を明るくする
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        if (d.y > 0.005) {
          vec2 uv = d.xz / (d.y + 0.22) * 1.1 + vec2(4.0, 1.0);
          float dens = fbm(uv);
          float band = smoothstep(0.015, 0.06, d.y) * (1.0 - smoothstep(0.22, 0.42, d.y));
          float th = 0.60 - 0.05 * band;
          float cl = smoothstep(th, th + 0.025, dens) * band;
          // 縁ほど明るい（逆光の縁取り）。太陽の方角ほど金色に強く光る
          float edge = 1.0 - smoothstep(th + 0.01, th + 0.13, dens);
          float toSun = dot(normalize(d.xz), normalize(uSunDir.xz)) * 0.5 + 0.5;
          // 沈んだ日に下から照らされる雲: 本体は暗い藍紫、縁は茜〜橙
          vec3 body = mix(srgb(vec3(0.16, 0.14, 0.30)), srgb(vec3(0.36, 0.20, 0.30)), toSun * 0.8);
          vec3 rim = mix(srgb(vec3(0.62, 0.36, 0.50)), srgb(vec3(1.0, 0.52, 0.30)), toSun);
          vec3 cloudC = mix(body, rim, edge * (0.45 + 0.55 * toSun));
          c = mix(c, cloudC, cl * 0.92);
          // 高い空の薄いすじ雲
          float streak = smoothstep(0.62, 0.75, fbm(vec2(uv.x * 0.25, uv.y * 1.4) + 9.0)) * smoothstep(0.2, 0.5, d.y) * 0.35;
          c = mix(c, srgb(vec3(0.52, 0.34, 0.50)), streak);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

const KIND_COLORS = {
  house: ['#efe3cf', '#e9d2b4', '#d8c7b8', '#c9a58b', '#f2ede4', '#c7cfd6', '#d9b9a3'],
  office: ['#d9d4cb', '#c8c4bd', '#e6dfd2', '#b9b8b4', '#cdbfa9', '#bfc6c4', '#e2d6c0'],
  tower: ['#8d97a3', '#7d8a90', '#9aa2a8', '#6f7a86', '#a59b8f', '#8a9a9c'],
};

export function createStyle(tierName) {
  const tier = TIERS[tierName] ?? TIERS.mid;
  const uniforms = {
    uSunDir: { value: SUN_DIR.clone() },
    uSkySun: { value: SKY_SUN.clone() },
    uFogStart: { value: FOG_START },
    // 爆発の球（cityView.update が毎フレーム書く）
    uFronts: { value: new Float32Array(MAX_FRONTS) }, uFrontCount: { value: 0 }, uTime: { value: 0 },
    uHeat: { value: 0 }, uEmber: { value: 0 }, uCrater: { value: 0 }, uRingStep: { value: 1 },
  };

  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.position.copy(SUN_DIR).multiplyScalar(600);
  sun.target.position.set(0, 0, 0);
  if (tier.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -470; s.right = 470; s.top = 470; s.bottom = -470; s.near = 50; s.far = 1300;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
  }
  const fill = new THREE.HemisphereLight(SKY_FILL, GROUND_FILL, FILL_INTENSITY);

  const buildingMats = {};
  const building = (kind) => (buildingMats[kind] ??= makeBuildingMaterial(kind, uniforms));

  return {
    tier: tierName,
    sunDir: SUN_DIR.clone(),
    skySun: SKY_SUN.clone(),
    fogStart: FOG_START,
    uniforms,
    building,
    kindColors: KIND_COLORS,
    ground: makeGroundMaterial(uniforms, tierName !== 'low'),
    sky: makeSky(uniforms),
    lights: [sun, sun.target, fill],
    shadows: !!tier.shadows,
    outline: tier.shadows ? makeOutlineMaterial(uniforms) : null,
    planarShadow: tier.shadows ? null : makePlanarShadowMaterial(uniforms),
    buildingDepth: tier.shadows ? makeBuildingDepthMaterial(uniforms) : null,
    props: {
      body: makeToonMaterial('car', uniforms, { color: 0xffffff, roughness: 0.35 }),
      metal: makeToonMaterial('metal', uniforms, { color: 0x4a4d57, roughness: 0.6 }),
      debris: makeToonMaterial('debris', uniforms, { color: 0xffffff, roughness: 0.9 }),
      roofBox: makeToonMaterial('roofBox', uniforms, { color: 0xb8b6b4, roughness: 0.85 }),
      lampHead: makeGlowMaterial('lamp', uniforms, { color: new THREE.Color(1.0, 0.82, 0.55).multiplyScalar(1.6) }),
      signPanel: makeGlowMaterial('sign', uniforms, { color: 0xffffff }),
      beacon: makeGlowMaterial('beacon', uniforms, { color: new THREE.Color(1.0, 0.15, 0.1).multiplyScalar(2.0) }),
      lampPool: makeLampPoolMaterial(),
    },
    // 軍勢・主人公の陰影の色（enemyView の uniform。材質どうしで共有しているので値だけ書き換える）を夕方の光に合わせる
    // t: 画質の段（省けば作ったときの段）。途中で段が下がったときは、その段を渡して合わせ直す
    tintFigures(u, t = tierName) {
      const set = (k, c) => { if (u[k]?.value?.isColor) u[k].value.copy(c); };
      set('uSun', DUSK.figureSun); set('uSky', DUSK.figureSky); set('uGround', DUSK.figureGround);
      set('uThrust', t === 'low' ? DUSK.thrustLow : DUSK.thrust);
    },
  };
}
