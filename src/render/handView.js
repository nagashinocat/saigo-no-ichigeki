import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { NOISE_GLSL } from './glslNoise.js';
import { TOON_RAMP, TOON_LIGHTS } from './style.js';
import { poseFor, HAND_JOINTS, RELEASE_POSE, TREMOR_FROM } from './handPose.js';

// 手の画面: 主人公の右手（手のひらを上に、少し丸めてこちらへ向ける）と、その上に浮かぶ力の球。
// 光は球が主役（球の色の点光源）で、夕暮れの淡い縁の光を少しだけ足す。背景は暗いグラデーション。
// 球は爆発（explosionView.js）と同じ力: 白い芯 → 淡い金 → 琥珀、縁だけ冷たい青紫〜水色。

const HAND_SCALE = 10;           // 手のモデル（約 19cm）を、この場面の単位で約 1.9 にする
const ORB_R = [0.07, 0.29];      // level 0 と 1 の球の半径
const ORB_GAP = [0.07, 0.36];    // 手のひらの面から球の下端まで（貯めるほど浮き上がり、鉤爪の指が球の下に見える）
const INFLATE = 0.0022;          // 肌を法線の向きへ膨らませる量（モデルの単位 m）。細い指をたくましく見せる
const SNAP_SEC = 0.06;           // 放つとき、指が開き切るまで
const LINGER_SEC = 0.18;         // 小さな一発: 開いたまま止まる時間
const RELAX_SEC = 0.55;          // 開いた手が元の構えへ戻るまで
const REFORM_SEC = 0.5;          // 放ったあと、球がまた生まれるまで
const FLASH_SEC = 0.14;

const srgb = (r, g, b, k = 1) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace).multiplyScalar(k);
const PAL = {
  core: srgb(1.0, 0.99, 0.95), deep: srgb(0.78, 0.16, 0.05), inner: srgb(0.98, 0.42, 0.07), band: srgb(1.0, 0.86, 0.48),
  rimA: srgb(0.5, 0.78, 1.0), rimB: srgb(0.72, 0.52, 1.0),
  light: srgb(1.0, 0.78, 0.52),     // 球から手を照らす光（芯の白と金の間）
  skin: srgb(0.80, 0.58, 0.48),
  skinShade: srgb(0.20, 0.12, 0.17), // 影の側に回る、夕暮れの紫がかった暗い肌
  dusk: srgb(0.62, 0.50, 0.95),      // 縁の光（夕空の青紫）
  sss: srgb(1.0, 0.36, 0.16),        // 球の光が肌を透ける赤み
};

// 関節の親（手首から指先へ）
function parentOf(name) {
  if (name === 'wrist') return null;
  const m = name.match(/^(thumb|index-finger|middle-finger|ring-finger|pinky-finger)-(.+)$/);
  const parts = m[1] === 'thumb' ? ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip']
    : ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
  const i = parts.indexOf(m[2]);
  return i === 0 ? 'wrist' : `${m[1]}-${parts[i - 1]}`;
}

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

// 肌: 3段の陰影（style.js と同じ）に、夕暮れの縁の光と、球の光が肌を透ける赤み・球の色の縁取りを足す
function makeSkinMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: PAL.skin, roughness: 0.62, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
transformed += objectNormal * ${INFLATE.toFixed(4)};`);
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

// gltf は null でもよい（球だけを描く）。あとから attachModel(gltf) で手を付けられる
export function createHandView(gltf, tierName) {
  const low = tierName === 'low';
  const defines = low ? { LOW: 1 } : {};
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);

  // 背景
  const bgU = { uGlow: { value: new THREE.Color(0, 0, 0) } };
  const bg = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: bgU,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: BG_FRAG,
  }));
  bg.renderOrder = -1;
  scene.add(bg);

  // 光: 球の点光源（主役）、夕暮れの縁の光、ごく弱い環境光
  const orbLight = new THREE.PointLight(PAL.light, 1, 0, 2);
  const rimLight = new THREE.DirectionalLight(PAL.dusk, 0.35);
  rimLight.position.set(-1.2, 1.0, -1.6);
  const ambient = new THREE.HemisphereLight(srgb(0.30, 0.26, 0.46), srgb(0.20, 0.10, 0.08), 0.25);
  scene.add(orbLight, rimLight, rimLight.target, ambient);

  // 手の向き: 右手を前へ差し出し、指先は左奥へ。手のひらは上へ向けてこちらへ少し傾ける。
  // 斜めから見るので、曲がった指が球の横に輪郭として立ち上がって見える
  const F = new THREE.Vector3(-0.72, 0.12, -0.68).normalize();
  const N = new THREE.Vector3(0.12, 1, 0.38);
  N.addScaledVector(F, -N.dot(F)).normalize();
  const T = new THREE.Vector3().crossVectors(F, N);
  const rig = new THREE.Group();
  rig.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(N.clone().negate(), F.clone().negate(), T.clone().negate()));
  rig.scale.setScalar(HAND_SCALE);
  const root = new THREE.Group(); // 震え・反動はこの上で
  root.add(rig);
  scene.add(root);

  const skinU = {
    uOrbPosV: { value: new THREE.Vector3() }, uOrbColor: { value: PAL.rimA.clone().lerp(PAL.band, 0.4) },
    uRimDirV: { value: new THREE.Vector3() }, uRimColor: { value: PAL.dusk.clone().multiplyScalar(0.45) },
    uSss: { value: PAL.sss }, uShade: { value: PAL.skinShade }, uOrbPower: { value: 0 }, uOrbR: { value: 0.1 },
  };

  // 骨: WebXR の手は関節が平ら（すべて Armature の子）なので、手首から順に自分で FK する
  const bones = new Map(), localRest = new Map();
  const palmLocal = new THREE.Vector3(0.033, -0.004, 0.006); // モデルの空間での手のひらの中心
  const placeRig = () => rig.position.copy(palmLocal).multiplyScalar(-HAND_SCALE).applyQuaternion(rig.quaternion); // 手のひらの中心を原点へ
  placeRig();

  // 手のモデルを付ける（読み込みが遅れても、それまでは球だけで描ける）。2回目以降は何もしない
  function attachModel(model) {
    if (!model || bones.size) return;
    const rest = new Map();
    model.scene.traverse((o) => {
      if (o.isBone || HAND_JOINTS.includes(o.name)) bones.set(o.name, o);
      if (o.isSkinnedMesh || o.isMesh) {
        o.material = makeSkinMaterial(skinU);
        o.frustumCulled = false;
      }
    });
    for (const [name, b] of bones) rest.set(name, { p: b.position.clone(), q: b.quaternion.clone() });
    const mc = rest.get('middle-finger-metacarpal'), pp = rest.get('middle-finger-phalanx-proximal');
    if (mc && pp) palmLocal.copy(mc.p).lerp(pp.p, 0.55).add(new THREE.Vector3(-0.022, 0, 0));
    placeRig();
    // 親から見た休みの姿勢（骨ごとに1回だけ求める）
    for (const name of HAND_JOINTS) {
      const r = rest.get(name), par = parentOf(name);
      if (!r) continue;
      if (!par || !rest.get(par)) { localRest.set(name, { p: r.p.clone(), q: r.q.clone(), parent: null }); continue; }
      const pr = rest.get(par);
      const inv = pr.q.clone().invert();
      localRest.set(name, { p: r.p.clone().sub(pr.p).applyQuaternion(inv), q: inv.multiply(r.q), parent: par });
    }
    rig.add(model.scene);
  }
  attachModel(gltf);

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

  // 放つ瞬間に画面全体へ掛ける閃光（カメラの前の板）
  const flashMat = new THREE.MeshBasicMaterial({ color: srgb(0.92, 0.9, 1.0), transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), flashMat);
  flash.position.set(0, 0, -0.5);
  flash.renderOrder = 10;
  flash.visible = false;
  camera.add(flash);
  scene.add(camera);

  // カメラ: 手首の少し後ろ上から、手のひらと球を見下ろす
  const LOOK = new THREE.Vector3(-0.42, 0.42, -0.5);
  function frame(aspect) {
    camera.aspect = aspect;
    // 縦長の画面では少し引いて、指先と球の光の筋が切れないようにする
    const back = aspect < 1 ? 1 + (1 - aspect) * 0.7 : 1;
    camera.position.set(0.45, 1.05, 2.8).sub(LOOK).multiplyScalar(back).add(LOOK);
    camera.lookAt(LOOK);
    camera.updateProjectionMatrix();
  }
  frame(1);

  const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  const world = new Map(); // 関節ごとの Armature 空間の姿勢（FK の結果）
  for (const name of HAND_JOINTS) world.set(name, { p: new THREE.Vector3(), q: new THREE.Quaternion() });

  function applyPose(pose) {
    for (const name of HAND_JOINTS) {
      const lr = localRest.get(name);
      if (!lr) continue;
      const w = world.get(name), r = pose[name];
      tmpE.set(-r[0], r[1], r[2]);
      tmpQ.setFromEuler(tmpE);
      if (!lr.parent) { w.p.copy(lr.p); w.q.copy(lr.q).multiply(tmpQ); }
      else {
        const pw = world.get(lr.parent);
        w.p.copy(lr.p).applyQuaternion(pw.q).add(pw.p);
        w.q.copy(pw.q).multiply(lr.q).multiply(tmpQ);
      }
      const b = bones.get(name);
      b.position.copy(w.p);
      b.quaternion.copy(w.q);
    }
  }

  const blendPose = (a, b, k, out) => {
    for (const name of HAND_JOINTS) {
      const pa = a[name], pb = b[name], o = (out[name] ??= [0, 0, 0]);
      for (let i = 0; i < 3; i++) o[i] = pa[i] + (pb[i] - pa[i]) * k;
    }
    return out;
  };
  const snapPose = {}, curPose = {}, outPose = {};

  let clock = 0, lvl = 0;
  let rel = null; // { t, hold, strength }
  let openness = 0, relOpen = 0; // 放ったあとの手の開き具合（0: 元の構え, 1: 開き切った）
  const hash = (x) => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };
  const _palm = new THREE.Vector3(), _v = new THREE.Vector3();

  return {
    scene, camera,
    attachModel,
    // 放ったあと、手がどれだけ開いているか（0〜1）。演出の間開いたままかの確かめに使う
    get openness() { return openness; },
    resize(aspect) { if (Number.isFinite(aspect) && aspect > 0) frame(aspect); },
    // level: 貯めの量（0〜1）, active: 長押し中, reserveFrac: 器の残り（0〜1）
    update(rawDt, level = 0, active = false, rawReserve = 1) {
      const dt = Number.isFinite(rawDt) ? Math.max(rawDt, 0) : 0;
      const reserveFrac = Number.isFinite(rawReserve) ? rawReserve : 1;
      clock += dt;
      const target = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
      lvl += (target - lvl) * Math.min(1, dt * 14);
      const s = 1 - Math.pow(1 - lvl, 1.6);
      const amp = Math.min(1, Math.max(0, (lvl - TREMOR_FROM) / (1 - TREMOR_FROM)));
      // 器が残り少ない: 光は弱く不安定、手も少し震える（限界の知らせ）
      const weak = 1 - THREE.MathUtils.smoothstep(reserveFrac, 0.08, 0.3);

      // 手の形
      const base = poseFor(lvl, clock);
      Object.assign(curPose, base);
      let pose = curPose;
      let flashK = 0, orbScale = 1, orbFade = 1, recoil = 0;
      if (rel) {
        rel.t += dt;
        const t = rel.t, open = SNAP_SEC + rel.hold;
        const into = THREE.MathUtils.smoothstep(t, 0, SNAP_SEC);
        const back = THREE.MathUtils.smoothstep(t, open, open + RELAX_SEC);
        blendPose(snapPose, RELEASE_POSE, into, outPose);
        pose = blendPose(outPose, base, back, outPose);
        relOpen = into * (1 - back);
        flashK = Math.exp(-t / FLASH_SEC) * (0.5 + 0.7 * rel.strength);
        recoil = Math.exp(-t / 0.09) * (0.04 + 0.08 * rel.strength);
        // 球は手を離れて弾け、しばらくしてからまた小さく生まれる
        const gone = THREE.MathUtils.smoothstep(t, 0, 0.12);
        const reform = THREE.MathUtils.smoothstep(t, open + 0.1, open + 0.1 + REFORM_SEC);
        orbScale = (1 + gone * 1.5) * (1 - gone) + reform * gone;
        orbFade = 1 - gone + reform * gone;
        if (t > open + RELAX_SEC + REFORM_SEC + 0.1) rel = null;
      }
      if (bones.size) applyPose(pose);
      openness = rel ? relOpen : 0;

      // 震え: 0.8 を超えると手全体が、器が少ないと弱く
      const trem = amp * 0.018 + weak * 0.006;
      const k = clock * 31;
      root.position.set(
        trem * (Math.sin(k) * 0.6 + Math.sin(k * 2.3 + 1.7) * 0.4),
        trem * (Math.sin(k * 1.7 + 0.5) * 0.6 + Math.sin(k * 3.1) * 0.4) + Math.sin(clock * 1.3) * 0.012 - recoil,
        trem * 0.6 * Math.sin(k * 1.3 + 2.1) + recoil * 0.6,
      );
      root.rotation.set(trem * 0.5 * Math.sin(k * 0.9 + 0.3), 0, trem * 0.5 * Math.sin(k * 1.1 + 1.3));
      root.updateMatrixWorld(true);

      // 球の位置: 手のひらの面の少し上
      const r = (ORB_R[0] + (ORB_R[1] - ORB_R[0]) * s) * orbScale;
      _palm.copy(palmLocal);
      rig.localToWorld(_palm);
      _v.copy(N).applyQuaternion(root.quaternion);
      const rBase = ORB_R[0] + (ORB_R[1] - ORB_R[0]) * s;
      orb.position.copy(_palm).addScaledVector(_v, rBase + ORB_GAP[0] + (ORB_GAP[1] - ORB_GAP[0]) * s);
      orb.scale.setScalar(Math.max(r, 1e-3));

      // 明るさ: 貯めるほど強く。0.8 を超えるとちらつき、器が少ないと弱く不安定に瞬く
      const pulse = 1 + (active ? 0.06 + 0.08 * lvl : 0.04) * Math.sin(clock * (active ? 9 + 10 * lvl : 2.2));
      const stutter = weak * (0.25 + 0.45 * (hash(Math.floor(clock * 14)) > 0.55 ? 1 : 0));
      const crackle = amp * 0.18 * (hash(Math.floor(clock * 24) + 7.0) - 0.5);
      const power = (0.65 + 0.35 * s) * (1 - 0.5 * weak) * (pulse - stutter + crackle) * orbFade;
      orbU.uTime.value = clock;
      orbU.uLevel.value = lvl;
      orbU.uPower.value = Math.max(0.05, power);
      orbU.uFade.value = orbFade;
      orb.visible = orbFade > 0.01;

      const haloR = r * (2.2 + 1.3 * s) + flashK * 2.5;
      halo.position.copy(orb.position);
      halo.scale.setScalar(haloR);
      haloU.uOrbFrac.value = Math.min(0.9, r / haloR);
      haloU.uPower.value = Math.max(0, power) * (0.5 + 0.5 * s);
      haloU.uFlash.value = flashK;

      orbLight.position.copy(orb.position);
      orbLight.intensity = Math.max(0, power) * (0.35 + 1.1 * s) * orbFade + flashK * 6;
      bgU.uGlow.value.copy(PAL.inner).multiplyScalar(0.05 * Math.max(0, power) * s + 0.06 * flashK);

      flash.visible = flashK > 0.01;
      flashMat.opacity = Math.min(0.8, flashK * 0.45);

      // 肌のシェーダーへ、視点の空間での球の位置と縁の光の向き
      camera.updateMatrixWorld();
      const view = camera.matrixWorldInverse;
      skinU.uOrbPosV.value.copy(orb.position).applyMatrix4(view);
      skinU.uOrbR.value = r;
      skinU.uOrbPower.value = Math.max(0, power) * (0.35 + 0.6 * s) * orbFade + flashK * 0.6;
      skinU.uRimDirV.value.copy(rimLight.position).normalize().transformDirection(view);
    },
    // 放つ瞬間: 指が一気に開き閃光が出る。大きな一発は演出の間、開いた手のまま止まる
    release(shot) {
      Object.assign(snapPose, poseFor(lvl, clock)); // 放った瞬間の構えから開く
      const strength = Math.min(1, (shot?.amount ?? 0) / CONFIG.charge.maxDraw);
      rel = { t: 0, hold: shot?.isBig ? CONFIG.cinematic.freezeSec : LINGER_SEC, strength };
    },
  };
}
