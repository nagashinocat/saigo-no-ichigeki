import * as THREE from 'three';
import { TIERS } from './quality.js';
import { GRID } from '../world/cityGen.js';
import { CONFIG } from '../config.js';

// 作風「写実的なアニメ調」: 夕方の空、強い一方向の太陽、3段に量子化した陰影、空を映す窓、遠景は空の色へ溶ける。

// 太陽は低い夕日。カメラから見て右手にあり、見えている東向きの面を照らし、長い影を左手前へ落とす。
const SUN_DIR = new THREE.Vector3(0.86, 0.50, -0.26).normalize();
const SUN_COLOR = new THREE.Color(1.0, 0.66, 0.40);
const SKY_FILL = new THREE.Color(0.46, 0.54, 1.0);    // 影側に回る空の青紫
const GROUND_FILL = new THREE.Color(0.55, 0.40, 0.42); // 地面からの照り返し
const FOG_DENSITY = 0.0011;
const FOG_START = 320;

// sRGB で決めた色をシェーダーの線形値へ（見た目の色で調整しやすくするため）
const GLSL_COMMON = /* glsl */`
uniform vec3 uSunDir;
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
  vec3 zenith = srgb(vec3(0.12, 0.17, 0.40));
  vec3 upper = srgb(vec3(0.30, 0.40, 0.72));
  vec3 band = mix(srgb(vec3(0.70, 0.58, 0.80)), srgb(vec3(1.00, 0.66, 0.52)), pow(toSun, 2.0));
  vec3 horizon = mix(srgb(vec3(0.86, 0.62, 0.70)), srgb(vec3(1.00, 0.72, 0.42)), pow(toSun, 3.0));
  float t = max(h, 0.0);
  vec3 c = mix(horizon, band, smoothstep(0.0, 0.10, t));
  c = mix(c, upper, smoothstep(0.08, 0.38, t));
  c = mix(c, zenith, smoothstep(0.35, 1.0, t));
  float sd = max(dot(d, uSunDir), 0.0);
  c += srgb(vec3(1.0, 0.62, 0.32)) * (pow(sd, 6.0) * 0.55 + pow(sd, 40.0) * 0.6);
  return c;
}
// 遠くほど、その方向の地平の空の色へ溶かす（空とつながる大気遠近）
vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 v = worldPos - cameraPosition;
  float dist = length(v);
  // 上空カメラから街までの約400mは澄ませ、その先から霞ませる
  float f = 1.0 - exp(-pow(max(dist - ${FOG_START.toFixed(1)}, 0.0) * ${FOG_DENSITY.toFixed(5)}, 1.6));
  vec2 hz = v.xz + uSunDir.xz * 1e-3;
  vec3 fc = skyColor(normalize(vec3(hz, 0.015 * length(hz))));
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
const TOON_RAMP = /* glsl */`
float toonRamp(float x) {
  float s = 0.5 * smoothstep(0.03, 0.10, x) + 0.5 * smoothstep(0.38, 0.46, x);
  return mix(s, x, 0.15);
}
`;
const TOON_LIGHTS = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
  'vec3 irradiance = dotNL * directLight.color;',
  'vec3 irradiance = toonRamp( dotNL ) * directLight.color;',
);

function patchCommon(shader, uniforms) {
  shader.uniforms.uSunDir = uniforms.uSunDir;
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', 'varying vec3 vFogW;')
    .replace('#include <fog_vertex>', FOG_VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', GLSL_COMMON + TOON_RAMP)
    .replace('#include <fog_fragment>', '')
    .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogW);\n#include <tonemapping_fragment>')
    .replace('#include <lights_physical_pars_fragment>', TOON_LIGHTS);
}

// 種類ごとのファサード（窓の格子）の決め方。単位は m。
const FACADE = {
  house: { bay: 3.4, floor: 2.9, ground: 0.8, corner: 0.9, top: 0.9, wx: 0.42, wy: 0.46, refl: 0.30, lit: 0.34, shop: 0.0, glass: [0.10, 0.11, 0.14] },
  office: { bay: 3.1, floor: 3.6, ground: 4.6, corner: 1.2, top: 1.4, wx: 0.66, wy: 0.52, refl: 0.55, lit: 0.22, shop: 0.65, glass: [0.08, 0.11, 0.17] },
  tower: { bay: 1.7, floor: 3.9, ground: 6.0, corner: 0.8, top: 3.0, wx: 0.86, wy: 0.74, refl: 0.85, lit: 0.13, shop: 0.8, glass: [0.06, 0.12, 0.17] },
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

  // 窓の階ごと・部屋ごとの点灯（夕方なので一部だけ灯る）
  vec2 cell = vec2(floor(cx), floor(cy)) + n.xz * 37.0 + vSeed * 113.0;
  float floorLit = hash12(vec2(floor(cy), vSeed * 71.0 + n.x * 5.0 + n.z * 9.0));
  float lit = step(hash12(cell), ${f(p.lit)} * (0.25 + 1.5 * floorLit));
  float warm = hash12(cell + 7.7);
  vec3 lampC = mix(srgb(vec3(1.0, 0.78, 0.46)), srgb(vec3(0.86, 0.93, 1.0)), step(0.8, warm)) * (0.9 + 0.8 * hash12(cell + 3.3));
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
  winEmis = (skyR * (1.0 - lit) + lampC * lit * 1.1) * m + srgb(vec3(1.0, 0.82, 0.58)) * shopLit * shopM * 1.25 + skyR * shopM * (1.0 - shopLit);

  // 屋上: 落ち着いたコンクリート、縁の立ち上がりは明るく
  float roof = step(0.5, n.y);
  float edge = min(vSize.x * 0.5 - abs(vB.x), vSize.z * 0.5 - abs(vB.z));
  vec3 roofC = mix(srgb(vec3(0.62, 0.60, 0.62)), diffuseColor.rgb, 0.25) * mix(1.0, 0.88, vnoise(vB.xz * 0.35));
  roofC = mix(srgb(vec3(0.78, 0.74, 0.72)), roofC, smoothstep(0.45, 0.7, edge));
  diffuseColor.rgb = mix(diffuseColor.rgb, roofC, roof);
  glassM *= 1.0 - roof; winEmis *= 1.0 - roof;
}
`;
}

function makeBuildingMaterial(kind, uniforms) {
  const p = FACADE[kind];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    patchCommon(shader, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vB; flat varying vec3 vSize; varying vec3 vObjN; flat varying float vSeed;\nfloat hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }')
      .replace('#include <begin_vertex>', BUILDING_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vB; flat varying vec3 vSize; varying vec3 vObjN; flat varying float vSeed;')
      .replace('#include <color_fragment>', buildingFragment(p))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.18, glassM);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += winEmis;');
  };
  mat.customProgramCacheKey = () => 'building-' + kind;
  return mat;
}

// 地面: 道路の格子（車道・歩道・中央線・横断歩道）、主人公の立つ広場、街の外は野原へ
function makeGroundMaterial(uniforms) {
  const { BLOCK, PITCH } = GRID;
  const R = CONFIG.cityRadius, plaza = CONFIG.plazaRadius;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    patchCommon(shader, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
#include <color_fragment>
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
  diffuseColor.rgb = c;
}
`);
  };
  mat.customProgramCacheKey = () => 'ground';
  return mat;
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
    uniforms: { uSunDir: uniforms.uSunDir, uWidth: { value: 0.0016 } },
    vertexShader: /* glsl */`
      uniform float uWidth;
      varying vec3 vFogW;
      void main() {
        vec3 s = vec3(1.0); vec3 o = vec3(0.0);
        #ifdef USE_INSTANCING
          s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          o = instanceMatrix[3].xyz;
        #endif
        vec4 wp = modelMatrix * vec4(o + position * s, 1.0);
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
function makePlanarShadowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uSun: { value: SUN_DIR.clone() } },
    vertexShader: /* glsl */`
      uniform vec3 uSun;
      varying float vFade;
      void main() {
        vec4 wp = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        wp.xz -= uSun.xz * (wp.y / uSun.y);
        vFade = 1.0 - smoothstep(600.0, 900.0, length(wp.xz));
        wp.y = 0.03;
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
    uniforms: { uSunDir: uniforms.uSunDir },
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
          vec3 body = mix(srgb(vec3(0.40, 0.38, 0.62)), srgb(vec3(0.66, 0.46, 0.60)), toSun * 0.8);
          vec3 rim = mix(srgb(vec3(1.0, 0.74, 0.76)), srgb(vec3(1.0, 0.84, 0.56)), toSun);
          vec3 cloudC = mix(body, rim, edge * (0.45 + 0.55 * toSun));
          c = mix(c, cloudC, cl * 0.92);
          // 高い空の薄いすじ雲
          float streak = smoothstep(0.62, 0.75, fbm(vec2(uv.x * 0.25, uv.y * 1.4) + 9.0)) * smoothstep(0.2, 0.5, d.y) * 0.35;
          c = mix(c, srgb(vec3(1.0, 0.80, 0.78)), streak);
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
  const uniforms = { uSunDir: { value: SUN_DIR.clone() } };

  const sun = new THREE.DirectionalLight(SUN_COLOR, 4.2);
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
  const fill = new THREE.HemisphereLight(SKY_FILL, GROUND_FILL, 1.6);

  const buildingMats = {};
  const building = (kind) => (buildingMats[kind] ??= makeBuildingMaterial(kind, uniforms));

  return {
    tier: tierName,
    sunDir: SUN_DIR.clone(),
    uniforms,
    building,
    kindColors: KIND_COLORS,
    ground: makeGroundMaterial(uniforms),
    sky: makeSky(uniforms),
    lights: [sun, sun.target, fill],
    shadows: !!tier.shadows,
    outline: tier.shadows ? makeOutlineMaterial(uniforms) : null,
    planarShadow: tier.shadows ? null : makePlanarShadowMaterial(),
    props: {
      body: makeToonMaterial('car', uniforms, { color: 0xffffff, roughness: 0.35 }),
      metal: makeToonMaterial('metal', uniforms, { color: 0x4a4d57, roughness: 0.6 }),
      roofBox: makeToonMaterial('roofBox', uniforms, { color: 0xb8b6b4, roughness: 0.85 }),
      lampHead: makeGlowMaterial('lamp', uniforms, { color: new THREE.Color(1.0, 0.82, 0.55).multiplyScalar(1.6) }),
      signPanel: makeGlowMaterial('sign', uniforms, { color: 0xffffff }),
      beacon: makeGlowMaterial('beacon', uniforms, { color: new THREE.Color(1.0, 0.15, 0.1).multiplyScalar(2.0) }),
    },
  };
}
