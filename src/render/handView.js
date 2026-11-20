import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { NOISE_GLSL } from './glslNoise.js';
import { TOON_RAMP, TOON_LIGHTS } from './style.js';
import { poseFor, HAND_JOINTS, CLASP_POSE, TREMOR_FROM } from './handPose.js';

// 手の画面: 主人公自身の目から見た両手（handModel.js で組み立てた右手と、それを鏡に映した左手）と、その間に浮かぶ力の球。
// 両手は向かい合わせで、手のひらを球に向ける。貯めるほど指を開いてこわばらせ、両手の間も少し広がる。
// 放つと両手が中央へ寄って手のひらを合わせ、指を互い違いに組む。組み合わさった瞬間に光が弾ける。
// 光は球が主役（球の色の点光源）で、夕暮れの淡い縁の光と、手の形を見せる光を足す。肌には街と同じ暗い紫の輪郭線。
// 背景は暗いグラデーション。
// 球は爆発（explosionView.js）と同じ力: 白い芯 → 淡い金 → 琥珀、縁だけ冷たい青紫〜水色。

const HAND_SCALE = 10;           // 手のモデル（メートル。手首から中指の先まで約 20cm）を、この場面の単位で約 2 にする
const ORB_R = [0.13, 0.4];       // level 0 と 1 の球の半径
const PALM_D = [1.0, 1.5];     // 球の中心から各手のひらの中心まで（貯めるほど両手の間が広がる）
const ORB_C = new THREE.Vector3(0, 0, 0);
// 構え（右手で書く。左手は x を鏡に映す）: 手のひらから球への向きと、指先の向き。
// 手のひらはほぼ垂直に立て、左右から真横に球へ向ける（親指が上、小指が下）。わずかに下・奥へ傾けて、
// 見下ろす目から手の甲の側が少しだけ見え、指の側面がはっきり見えるようにする。指先は前（少し上）で、前腕は画面の下から入る
const STANCE_N = new THREE.Vector3(-1, -0.3, -0.3);
const STANCE_F = new THREE.Vector3(-0.2, 0.15, -1);
// 組み合わさった形: 手のひらをまっすぐ向かい合わせ、指先は前へ（少し上）。右手の手のひらの中心の位置（少し手前へ引き寄せる）。
// 指を互い違いに組むため、両手を親指〜小指の向きへ指の間隔の半分だけずらす（右手は小指の側へ、左手も自分の小指の側へ）
const JOIN_N = new THREE.Vector3(-1, 0, 0);
const JOIN_F = new THREE.Vector3(0, 0.25, -1);
const JOIN_AT = new THREE.Vector3(0.06, -0.3, 0.45);
const HALO_BACK = 1.0;           // 組み合わさったとき、光の板を手の向こうへ下げる距離
const LIGHT_OUT = new THREE.Vector3(0, 0.5, 0.6); // 組み合わさったときの光源の逃がし先
const JOIN_STAGGER = 0.0053 * HAND_SCALE; // 手の空間の X（小指の側）へ。指の間隔（約 2.1cm）の 1/4 ずつ、合わせて半分
// 目の位置と見る所。手のひらを真横に向けても手の甲の側が目へ向くよう、目は少し高く・後ろに置く
const EYE = new THREE.Vector3(0, 3.0, 3.9);
const LOOK = new THREE.Vector3(0, 0.2, 0);
// 縦の画角と、確保する横の画角（度）。下の横長の帯（約 1.3:1〜5:1）では、帯が細いほど縦の画角 FOV で寄り、
// 帯が四角に近いほど横の画角 FOV_H_MIN を確保して両手の指先が横で切れないようにする
const FOV = 32, FOV_MAX = 72, FOV_H_MIN = 48;
const KEY_LIGHT = 2.0;
const JOIN_SEC = 0.25;           // 放ってから両手が合わさりきるまで
const SMALL_HOLD_SEC = 0.05;     // 小さな一発: 合わさったまま止まる時間
const SMALL_BACK_SEC = 0.35;     // 小さな一発: 合わさった手が構えへ戻るまで（止まる時間と合わせて約 0.4 秒）
const BIG_BACK_SEC = 0.55;       // 大きな一発: 演出が明けてから構えへ戻るまで
const REFORM_SEC = 0.5;          // 球がまた生まれるまで
const FLASH_SEC = 0.14;

const srgb = (r, g, b, k = 1) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace).multiplyScalar(k);
const PAL = {
  core: srgb(1.0, 0.99, 0.95), deep: srgb(0.78, 0.16, 0.05), inner: srgb(0.98, 0.42, 0.07), band: srgb(1.0, 0.86, 0.48),
  rimA: srgb(0.5, 0.78, 1.0), rimB: srgb(0.72, 0.52, 1.0),
  light: srgb(1.0, 0.78, 0.52),     // 球から手を照らす光（芯の白と金の間）
  skin: srgb(0.80, 0.58, 0.48),
  nail: srgb(0.95, 0.78, 0.72),     // 爪: 肌より明るく、少し白い
  skinShade: srgb(0.20, 0.12, 0.17), // 影の側に回る、夕暮れの紫がかった暗い肌
  dusk: srgb(0.62, 0.50, 0.95),      // 縁の光（夕空の青紫）
  sss: srgb(1.0, 0.36, 0.16),        // 球の光が肌を透ける赤み
};

const BG_FRAG = /* glsl */`
uniform vec3 uGlow;
varying vec3 vDir;
void main(){
  float t = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(vec3(0.010, 0.008, 0.018), vec3(0.06, 0.05, 0.11), smoothstep(0.2, 0.9, t));
  c += vec3(0.10, 0.04, 0.02) * pow(max(0.0, 1.0 - length(vDir.xy - vec2(0.0, -0.1)) * 1.4), 3.0);
  // 球の光が奥の闇をわずかに染める
  c += uGlow * pow(max(0.0, 1.0 - length(vDir.xy - vec2(0.0, 0.05)) * 1.2), 2.0);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const ORB_VERT = /* glsl */`
uniform float uTime, uLevel;
varying vec3 vN, vV, vObj;
${NOISE_GLSL}
void main() {
  vObj = normalize(position);
  // 力がこもるほど表面が荒れて、輪郭が沸き立つ
  float bump = xnoise3(vObj * 3.5 + vec3(0.0, -uTime * (1.0 + 3.0 * uLevel), uTime * 0.7)) - 0.5;
  vec3 p = position * (1.0 + bump * (0.03 + 0.1 * uLevel * uLevel));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const ORB_FRAG = /* glsl */`
uniform float uTime, uLevel, uPower, uFade;
uniform vec3 uCore, uDeep, uInner, uBand, uRimA, uRimB;
varying vec3 vN, vV, vObj;
${NOISE_GLSL}
void main() {
  float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0); // 1: 正面（芯）, 0: 縁
  float speed = 0.8 + 2.6 * uLevel;
  vec3 sp = vObj * (2.2 + 1.2 * uLevel);
  float n1 = xnoise3(sp + vec3(0.0, -uTime * speed, 0.0));
  float n2 = xnoise3(sp * 2.1 + vec3(uTime * 0.6, uTime * 0.35 * speed, -uTime * 0.4));
  #ifdef LOW
  float plasma = n1 * 0.65 + n2 * 0.35;
  #else
  float n3 = xnoise3(sp * 4.6 + vec3(-uTime * 1.1 * speed, 0.0, uTime * 0.8));
  float plasma = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
  #endif
  float core = pow(mu, 4.0 - 1.5 * uLevel);
  // 中身: 熱の模様を3段で塗る（深い橙 → 琥珀 → 淡い金）
  float tone = xcel(clamp(plasma * 1.2 - 0.15 + core * 0.55, 0.0, 0.999), 3.0, 0.06);
  vec3 body = mix(uDeep, uInner, smoothstep(0.2, 0.45, tone));
  body = mix(body, uBand, smoothstep(0.55, 0.8, tone));
  vec3 col = body * 1.1;
  // 模様の境目に走る光の筋。こもるほど太く明るい（ひび割れから漏れる光）
  float crack = 1.0 - smoothstep(0.0, 0.02 + 0.03 * uLevel, abs(plasma - 0.55));
  col = mix(col, uBand * 1.9, crack * (0.35 + 0.6 * uLevel));
  // 白い芯
  col = mix(col, uCore * 1.8, smoothstep(0.55, 1.0, core) * (0.6 + 0.4 * uLevel));
  // 縁: 冷たい青紫〜水色の帯
  float fringe = 1.0 - smoothstep(0.0, 0.42, mu);
  vec3 rim = mix(uRimA, uRimB, smoothstep(0.35, 0.65, n2));
  col = mix(col, rim * (1.4 + 1.2 * uLevel), fringe * 0.9);
  col *= uPower;
  gl_FragColor = vec4(col * uFade, uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 球を包む光のにじみと、外へ伸びる光の筋（カメラへ向けた板）
const HALO_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  // 板をいつもカメラへ向ける
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz);
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
}`;

const HALO_FRAG = /* glsl */`
uniform float uTime, uLevel, uPower, uOrbFrac, uFlash;
uniform vec3 uWarm, uRimA, uRimB, uCore;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float x = max(0.0, r - uOrbFrac) / max(1e-3, 1.0 - uOrbFrac); // 球の縁から外へ 0〜1
  float glow = exp(-x * 5.0) * smoothstep(1.0, 0.6, r);
  vec3 col = mix(uWarm, mix(uRimA, uRimB, 0.5), smoothstep(0.0, 0.2, x)) * glow * 0.45;
  #ifndef LOW
  // 外へ伸びる、ちぎれた光の筋（こもるほど長く、多く）
  float a = atan(vUv.y, vUv.x);
  float s = xnoise2(vec2(a * 5.0, uTime * 2.2)) * 0.6 + xnoise2(vec2(a * 13.0, -uTime * 3.7)) * 0.4;
  float len = (0.15 + 0.75 * uLevel) * smoothstep(0.45, 0.9, s);
  float streak = smoothstep(len, 0.0, x) * smoothstep(0.62, 0.75, s) * step(0.001, x);
  col += mix(uRimA, uCore, 0.35) * streak * (0.15 + 0.7 * uLevel);
  #endif
  col *= uPower;
  // 放つ瞬間の閃光: 板全体が白く飛ぶ
  col += uCore * uFlash * smoothstep(1.0, 0.0, r) * 2.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 輪郭線（街の縁取りと同じ暗い紫）: 肌の裏面を法線の向きへ少し膨らませて描く。
// 太さはカメラからの距離に比例させ、画面の上でほぼ一定にする。重なった指どうしの境目がはっきりする
const OUTLINE_WIDTH = 0.0032;
function makeOutlineMaterial() {
  const mat = new THREE.MeshBasicMaterial({ color: srgb(0.14, 0.10, 0.17), side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
mvPosition.xyz += normalize(normalMatrix * objectNormal) * (-mvPosition.z) * ${OUTLINE_WIDTH.toFixed(4)};
gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}

// 肌: 3段の陰影（style.js と同じ）に、夕暮れの縁の光と、球の光が肌を透ける赤み・球の色の縁取りを足す
function makeSkinMaterial(uniforms, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', TOON_RAMP + TOON_LIGHTS)
      .replace('#include <common>', `#include <common>
uniform vec3 uOrbPosV, uOrbColor, uRimDirV, uRimColor, uSss, uShade;
uniform float uOrbPower, uOrbR;`)
      .replace('#include <opaque_fragment>', /* glsl */`
{
  vec3 P = -vViewPosition;
  vec3 V = normalize(vViewPosition);
  float ndv = clamp(dot(normal, V), 0.0, 1.0);
  // 影の側も真っ黒にせず、紫がかった暗い肌の色を敷く
  outgoingLight = max(outgoingLight, uShade * diffuseColor.rgb * 1.2);
  // 夕暮れの縁の光: 輪郭の、光の来る側だけに細く
  float rimF = smoothstep(0.62, 0.8, 1.0 - ndv) * smoothstep(-0.1, 0.5, dot(normal, uRimDirV));
  outgoingLight += uRimColor * rimF;
  // 球の近く: 光が肌を透ける赤み（向きによらず回り込む）と、球の色の輪郭
  vec3 toOrb = uOrbPosV - P;
  float d = max(length(toOrb) - uOrbR, 0.0);
  float near = uOrbPower / (1.0 + d * d * 18.0);
  float wrap = clamp((dot(normal, normalize(toOrb)) + 0.7) / 1.7, 0.0, 1.0);
  outgoingLight += uSss * near * wrap * wrap * 0.35;
  outgoingLight += uOrbColor * near * smoothstep(0.55, 0.85, 1.0 - ndv) * smoothstep(0.0, 0.6, dot(normal, normalize(toOrb))) * 0.6;
}
#include <opaque_fragment>`);
  };
  return mat;
}

// 1つの手の向き: n は手のひらから球への向き、f は指先の向き（右手で書く。mirror が -1 なら x を鏡に映して左手）。
// 手の空間は -Y が手のひら、-Z が指先、X = Y × Z（左手は鏡に映した骨なので、同じ式で親指が正しい側に来る）
function handQuat(n0, f0, mirror) {
  const n = n0.clone().setX(n0.x * mirror).normalize();
  const f = f0.clone().setX(f0.x * mirror);
  f.addScaledVector(n, -f.dot(n)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(n, f), n.clone().negate(), f.clone().negate()));
}

// models: { right, left }（buildHandModel の右手と左手）。null なら球だけを描く
export function createHandView(models, tierName) {
  const low = tierName === 'low';
  const defines = low ? { LOW: 1 } : {};
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);

  // 背景
  const bgU = { uGlow: { value: new THREE.Color(0, 0, 0) } };
  const bg = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: bgU,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: BG_FRAG,
  }));
  bg.renderOrder = -1;
  scene.add(bg);

  // 光: 球の点光源（主役）、夕暮れの縁の光、手の形を見せる光、ごく弱い環境光
  const orbLight = new THREE.PointLight(PAL.light, 1, 0, 2);
  const rimLight = new THREE.DirectionalLight(PAL.dusk, 0.35);
  rimLight.position.set(-0.4, 1.0, -1.6);
  // 手の形を見せる光: 目の側の上から、夕焼けの暖かい色で（3段の陰影で関節の角が立つ）
  const keyLight = new THREE.DirectionalLight(srgb(1.0, 0.8, 0.78), KEY_LIGHT);
  keyLight.position.set(-0.5, 1.6, 1.0);
  const ambient = new THREE.HemisphereLight(srgb(0.30, 0.26, 0.46), srgb(0.20, 0.10, 0.08), 0.25);
  scene.add(orbLight, rimLight, rimLight.target, keyLight, keyLight.target, ambient);

  const skinU = {
    uOrbPosV: { value: new THREE.Vector3() }, uOrbColor: { value: PAL.rimA.clone().lerp(PAL.band, 0.4) },
    uRimDirV: { value: new THREE.Vector3() }, uRimColor: { value: PAL.dusk.clone().multiplyScalar(0.45) },
    uSss: { value: PAL.sss }, uShade: { value: PAL.skinShade }, uOrbPower: { value: 0 }, uOrbR: { value: 0.1 },
  };
  // 材質は両手で共有する（形が同じなのでシェーダーも1つ）
  const skinMats = models ? [makeSkinMaterial(skinU, PAL.skin), makeSkinMaterial(skinU, PAL.nail)] : null;
  const outlineMat = models ? makeOutlineMaterial() : null;

  // 両手: holder が手のひらの中心（場面の空間）にあり、その中で rig が手の模型を手のひらの中心が原点に来るよう置く
  const hands = [['right', 1], ['left', -1]].map(([side, mirror]) => {
    const model = models?.[side] ?? null;
    const holder = new THREE.Group(), rig = new THREE.Group();
    rig.scale.setScalar(HAND_SCALE);
    holder.add(rig);
    scene.add(holder);
    const palmLocal = new THREE.Vector3();
    if (model) {
      model.mesh.material = skinMats;
      // 輪郭線は同じ形・同じ骨のもう1枚（肌のまとまりだけ。爪には付けない）
      const g = model.mesh.geometry, skinGroup = g.groups[0];
      const lineGeo = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(g.attributes)) lineGeo.setAttribute(k, a);
      lineGeo.setIndex(g.index);
      lineGeo.setDrawRange(skinGroup.start, skinGroup.count);
      const outline = new THREE.SkinnedMesh(lineGeo, outlineMat);
      outline.frustumCulled = false;
      outline.bind(model.mesh.skeleton, model.mesh.bindMatrix);
      model.mesh.parent.add(outline);
      // 手の空間（model.root の中）での位置で測る
      model.root.updateMatrixWorld(true);
      const local = (n) => model.root.worldToLocal(model.bones[n].getWorldPosition(new THREE.Vector3()));
      palmLocal.copy(local('middle-finger-metacarpal')).lerp(local('middle-finger-phalanx-proximal'), 0.5).add(new THREE.Vector3(-0.004 * mirror, -0.014, 0));
      rig.add(model.root);
    }
    rig.position.copy(palmLocal).multiplyScalar(-HAND_SCALE); // 手のひらの中心を holder の原点へ
    return {
      side, mirror, model, holder,
      n: STANCE_N.clone().setX(STANCE_N.x * mirror).normalize(),
      qStance: handQuat(STANCE_N, STANCE_F, mirror), qJoin: handQuat(JOIN_N, JOIN_F, mirror),
      joinAt: JOIN_AT.clone().setX(JOIN_AT.x * mirror).add(new THREE.Vector3(JOIN_STAGGER, 0, 0).applyQuaternion(handQuat(JOIN_N, JOIN_F, mirror))),
      phase: mirror > 0 ? 0 : 2.3, // 震えを左右でそろえない
      trem: new THREE.Vector3(), pose: {},
    };
  });

  // 球
  const orbU = {
    uTime: { value: 0 }, uLevel: { value: 0 }, uPower: { value: 1 }, uFade: { value: 1 },
    uCore: { value: PAL.core }, uDeep: { value: PAL.deep }, uInner: { value: PAL.inner }, uBand: { value: PAL.band },
    uRimA: { value: PAL.rimA }, uRimB: { value: PAL.rimB },
  };
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(1, low ? 24 : 48, low ? 12 : 24),
    new THREE.ShaderMaterial({ uniforms: orbU, vertexShader: ORB_VERT, fragmentShader: ORB_FRAG, defines, transparent: true, depthWrite: false }),
  );
  orb.renderOrder = 1;
  const haloU = {
    uTime: orbU.uTime, uLevel: orbU.uLevel, uPower: { value: 1 }, uOrbFrac: { value: 0.3 }, uFlash: { value: 0 },
    uWarm: { value: PAL.band.clone().lerp(PAL.inner, 0.3) }, uRimA: { value: PAL.rimA }, uRimB: { value: PAL.rimB }, uCore: { value: PAL.core },
  };
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: haloU, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, defines,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.renderOrder = 2;
  halo.frustumCulled = false;
  scene.add(orb, halo);

  // 光が弾ける瞬間に画面全体へ掛ける閃光（カメラの前の板）
  const flashMat = new THREE.MeshBasicMaterial({ color: srgb(0.92, 0.9, 1.0), transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), flashMat);
  flash.position.set(0, 0, -0.5);
  flash.renderOrder = 10;
  flash.visible = false;
  camera.add(flash);
  scene.add(camera);

  // カメラ: 主人公自身の目。少し下を見て、両方の前腕が画面の下の左右から入る
  function frame(aspect) {
    camera.aspect = aspect;
    // 縦長の画面では、両手の指先が横で切れないように画角を広げる
    const hHalf = Math.tan(THREE.MathUtils.degToRad(FOV_H_MIN / 2));
    const vNeed = THREE.MathUtils.radToDeg(2 * Math.atan(hHalf / aspect));
    camera.fov = Math.max(FOV, Math.min(FOV_MAX, vNeed));
    camera.position.copy(EYE);
    camera.lookAt(LOOK);
    camera.updateProjectionMatrix();
  }
  frame(1);

  const blendPose = (a, b, k, out) => {
    for (const name of HAND_JOINTS) {
      const pa = a[name], pb = b[name], o = (out[name] ??= [0, 0, 0]);
      for (let i = 0; i < 3; i++) o[i] = pa[i] + (pb[i] - pa[i]) * k;
    }
    return out;
  };

  let clock = 0, lvl = 0;
  let rel = null; // { t, hold, back, strength }
  let fizzT = Infinity; // 足りずに離してからの秒（びくっと震えて光がしぼむ）
  const FIZZ_SEC = 0.55;
  let joined = 0, flashK = 0;
  // 時間切れの結末: 球が内側へつぶれ、両手が引き込まれる（0〜1。blackhole.js が毎フレーム決める）
  let collapse = 0;
  const hash = (x) => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };
  const _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _mid = new THREE.Vector3();

  return {
    scene, camera,
    // 両手がどれだけ組み合わさっているか（0: 構え, 1: 組み合わさった）
    get joined() { return joined; },
    // 光が弾ける閃光の強さ（0〜）
    get flash() { return flashK; },
    // 球の中心と半径（場面の空間）
    get orbSphere() { return { center: orb.position.clone(), radius: orb.scale.x }; },
    // 左右の手のひらの中心（場面の空間）
    get palms() { return { right: hands[0].holder.position.clone(), left: hands[1].holder.position.clone() }; },
    resize(aspect) { if (Number.isFinite(aspect) && aspect > 0) frame(aspect); },
    // level: 貯めた力（0〜1）, active: 長押し中, steady: 光の安定（0〜1。小さいと光が弱く不安定に瞬き、手も少し震える。掴まれている知らせ）
    update(rawDt, level = 0, active = false, rawSteady = 1) {
      const dt = Number.isFinite(rawDt) ? Math.max(rawDt, 0) : 0;
      const steady = Number.isFinite(rawSteady) ? rawSteady : 1;
      clock += dt;
      const target = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
      lvl += (target - lvl) * Math.min(1, dt * 14);
      const s = 1 - Math.pow(1 - lvl, 1.6);
      const amp = Math.min(1, Math.max(0, (lvl - TREMOR_FROM) / (1 - TREMOR_FROM)));
      // 掴まれている: 光は弱く不安定、手も少し震える
      const weak = 1 - THREE.MathUtils.smoothstep(steady, 0.08, 0.3);

      // 放ったあと: 両手が中央へ寄って手のひらを強く合わせ（だんだん速く）、合わさった瞬間に光が弾ける
      let squeeze = 0, orbBack = 1, recoil = 0;
      flashK = 0;
      if (rel) {
        rel.t += dt;
        const t = rel.t, k = Math.min(1, t / JOIN_SEC);
        const into = k * k;
        const back = THREE.MathUtils.smoothstep(t, JOIN_SEC + rel.hold, JOIN_SEC + rel.hold + rel.back);
        joined = into * (1 - back);
        squeeze = into;
        flashK = (t < JOIN_SEC ? Math.pow(k, 6) : Math.exp(-(t - JOIN_SEC) / FLASH_SEC)) * (0.5 + 0.7 * rel.strength);
        recoil = t < JOIN_SEC ? 0 : Math.exp(-(t - JOIN_SEC) / 0.07) * (0.03 + 0.06 * rel.strength);
        // 球は合わさった手の間でつぶれて消え、手が構えに戻ってからまた小さく生まれる
        const reformAt = JOIN_SEC + rel.hold + rel.back * 0.5;
        orbBack = THREE.MathUtils.smoothstep(t, reformAt, reformAt + REFORM_SEC);
        if (t > reformAt + REFORM_SEC) rel = null;
      } else joined = 0;
      const orbScale = rel ? Math.max(1 - squeeze, orbBack) : 1;

      // 両手の位置・向き・形
      const D = PALM_D[0] + (PALM_D[1] - PALM_D[0]) * s;
      fizzT += dt;
      const fizzK = fizzT < FIZZ_SEC ? Math.exp(-fizzT / 0.12) * (1 - fizzT / FIZZ_SEC) : 0;
      const pull = collapse * collapse;
      const trem = amp * 0.018 + weak * 0.006 + fizzK * 0.03 + collapse * 0.022;
      const bob = Math.sin(clock * 1.3) * 0.012;
      _mid.set(0, 0, 0);
      for (const h of hands) {
        const k = clock * 31 + h.phase;
        h.trem.set(
          trem * (Math.sin(k) * 0.6 + Math.sin(k * 2.3 + 1.7) * 0.4),
          trem * (Math.sin(k * 1.7 + 0.5) * 0.6 + Math.sin(k * 3.1) * 0.4) + bob,
          trem * 0.6 * Math.sin(k * 1.3 + 2.1),
        );
        // 構えの位置（球の中心から手のひらの向きの逆へ D）と、合わせた位置の間
        _c.copy(ORB_C).addScaledVector(h.n, -D).lerp(h.joinAt, joined).add(h.trem);
        _c.x += h.mirror * recoil; // 合わさった反動で、わずかに弾かれる
        // 引き込まれる: 球（黒い球）のほうへ寄りながら、渦の向きへねじれる
        if (collapse > 0) _c.lerp(ORB_C, 0.5 * pull);
        h.holder.position.copy(_c);
        _mid.addScaledVector(h.trem, 0.5);
        h.holder.quaternion.slerpQuaternions(h.qStance, h.qJoin, joined)
          .multiply(_q.setFromEuler(_e.set(trem * 0.5 * Math.sin(k * 0.9 + 0.3), pull * 0.5 * h.mirror, trem * 0.5 * Math.sin(k * 1.1 + 1.3) + pull * 0.35)));
        if (h.model) {
          // 寄っていく間は、放った瞬間のこわばった指のまま組む形へ移る（いったん力の抜けた手に戻らない）
          // 引き込まれる間は、指をこわばらせて開いたまま（あらがう手）
          const base = poseFor(Math.max(collapse, rel ? Math.max(lvl, rel.lvl * (1 - squeeze)) : lvl), clock + h.phase);
          h.model.setPose(joined > 0 ? blendPose(base, CLASP_POSE, joined, h.pose) : base);
        }
      }

      // 球: 両手の間の中央。組み合わさるときは、寄ってくる手のひらの間へ
      const rBase = ORB_R[0] + (ORB_R[1] - ORB_R[0]) * s;
      // 時間切れ: 球は内側へつぶれて消え（黒い球と光の輪は画面効果が描く）、つぶれるほど明るく燃える
      const implode = 1 - THREE.MathUtils.smoothstep(collapse, 0.05, 0.75);
      const r = rBase * orbScale * implode;
      orb.position.copy(ORB_C).add(_mid);
      if (joined > 0) orb.position.lerp(_c.copy(hands[0].holder.position).add(hands[1].holder.position).multiplyScalar(0.5), joined);
      orb.scale.setScalar(Math.max(r, 1e-3));

      // 明るさ: 貯めるほど強く。0.8 を超えるとちらつき、掴まれていると弱く不安定に瞬く
      const pulse = 1 + (active ? 0.06 + 0.08 * lvl : 0.04) * Math.sin(clock * (active ? 9 + 10 * lvl : 2.2));
      const stutter = weak * (0.25 + 0.45 * (hash(Math.floor(clock * 14)) > 0.55 ? 1 : 0));
      const crackle = amp * 0.18 * (hash(Math.floor(clock * 24) + 7.0) - 0.5);
      const orbFade = rel ? Math.max(1 - squeeze * squeeze, orbBack) : 1;
      const power = (0.65 + 0.35 * s) * (1 - 0.5 * weak) * (pulse - stutter + crackle) * orbFade * (1 - 0.6 * fizzK) * (1 + 1.8 * collapse);
      orbU.uTime.value = clock;
      orbU.uLevel.value = lvl;
      orbU.uPower.value = Math.max(0.05, power);
      orbU.uFade.value = orbFade;
      orb.visible = orbFade > 0.01 && r > 2e-3;

      const haloR = Math.max(r * (2.2 + 1.3 * s), 1e-3) + flashK * 2.5;
      // 組み合わさるときは光の板を手の向こうへ下げる: 光は合わせた手の間から奥へ弾け、手はその光を背にした影になる
      halo.position.copy(orb.position).addScaledVector(_c.copy(orb.position).sub(camera.position).normalize(), HALO_BACK * joined);
      halo.scale.setScalar(haloR);
      haloU.uOrbFrac.value = Math.min(0.9, r / haloR);
      haloU.uPower.value = Math.max(0, power) * (0.5 + 0.5 * s);
      haloU.uFlash.value = flashK;

      // 組み合わさった手の中に光源が入ると近すぎて肌が白く飛ぶので、手の外（目の側の上）へ出す
      orbLight.position.copy(orb.position).addScaledVector(LIGHT_OUT, joined);
      orbLight.intensity = (Math.max(0, power) * (0.35 + 1.1 * s) * orbFade + flashK * 1.2) * implode;
      bgU.uGlow.value.copy(PAL.inner).multiplyScalar((0.05 * Math.max(0, power) * s + 0.06 * flashK) * implode);

      flash.visible = flashK > 0.01;
      flashMat.opacity = Math.min(0.4, flashK * 0.25);

      // 肌のシェーダーへ、視点の空間での球の位置と縁の光の向き
      scene.updateMatrixWorld();
      const view = camera.matrixWorldInverse;
      skinU.uOrbPosV.value.copy(orb.position).applyMatrix4(view);
      skinU.uOrbR.value = Math.max(r, 0.02);
      skinU.uOrbPower.value = (Math.max(0, power) * (0.35 + 0.6 * s) * orbFade + flashK * 0.12) * implode;
      skinU.uRimDirV.value.copy(rimLight.position).normalize().transformDirection(view);
    },
    // 放つ瞬間: 両手が中央へ寄って組み合わさる（約 0.25 秒）。大きな一発は演出の間そのまま、小さな一発は約 0.4 秒で構えへ戻る
    // 足りずに離した: 放たず、両手がびくっと震えて球の光が一瞬しぼむ
    fizzle() { fizzT = 0; },
    // 時間切れの結末のつぶれ具合（0〜1）
    setCollapse(k) { collapse = Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0; },
    get collapse() { return collapse; },
    release(shot) {
      const strength = Math.min(1, (shot?.amount ?? 0) / CONFIG.power.max);
      // 組み合わさる途中・戻る途中にまた放ったら、今の合わさり具合から続けて寄る（手が跳ばない）
      const t = rel ? JOIN_SEC * Math.sqrt(joined) : 0;
      rel = shot?.isBig
        ? { t, hold: CONFIG.cinematic.freezeSec, back: BIG_BACK_SEC, strength, lvl }
        : { t, hold: SMALL_HOLD_SEC, back: SMALL_BACK_SEC, strength, lvl };
    },
  };
}
