import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LENS_CURVE } from './blackholeTimeline.js';

// 重力レンズの画面効果（時間切れの結末、blackholeTimeline.js の写し方をシェーダーで行う）。
// 場面をレンダーターゲットへ描き、画面の rect へ、黒い球のまわりでゆがめて写す。sky を渡すと空だけを別の層に描き
// （カメラの層 SKY_LAYER）、街の層と空の層を別々の進みで飲み込む（街が先、空があと）。
// その上に、黒い球（影）・光の輪（光子の輪）・傾いた光の円盤を描く。トーンマップと色空間は、画面へ描くこの段で行う。
// 画質の段: 光の筋のために重ねる回数（taps）、レンダーターゲットの解像度の割合（scale / skyScale）、円盤の模様の細かさ（oct）。
// 段を変えてもシェーダーは作り直さない（回数と細かさは uniform で、ループの上限は MAX_*）。

export const SKY_LAYER = 3;
export const LENS_QUALITY = {
  high: { taps: 12, scale: 1, skyScale: 0.5, oct: 3 },
  mid: { taps: 8, scale: 0.7, skyScale: 0.35, oct: 2 },
  low: { taps: 4, scale: 0.5, skyScale: 0.25, oct: 1 },
};
const MAX_TAPS = 12, MAX_OCT = 3;
const INCL = 0.42; // 円盤の傾き（縦につぶす割合。斜め上から見下ろし、渦の腕が見える）

const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

const FRAG = /* glsl */`
#define MAX_TAPS ${MAX_TAPS}
#define MAX_OCT ${MAX_OCT}
uniform sampler2D tMain, tSky;
uniform float uSkyOn, uTaps, uOct, uPx;
uniform vec2 uCenter, uScale;
uniform float uE, uShadow, uRing, uDisk, uTime, uFade, uTilt, uBars;
uniform vec4 uLm, uLs; // 層ごと: 渦, 流れ込み（log）, 残り, 光の強まり
uniform vec2 uBm, uBs; // 光の筋の幅: 渦, 流れ込み
uniform mat3 uCamBasis;
uniform vec2 uTan;
uniform vec3 uGold, uAmber, uViolet, uWhite;
varying vec2 vUv;

vec2 lensUv(vec2 q, float r, float swirl, float logZoom) {
  vec2 s = q * (1.0 - uE * uE / max(r * r, 1e-8));
  float a = swirl * pow(${LENS_CURVE.reach.toFixed(3)} / (r + ${LENS_CURVE.reach.toFixed(3)}), 1.5);
  float c = cos(a), sn = sin(a);
  s = vec2(c * s.x - sn * s.y, sn * s.x + c * s.y) * exp(logZoom);
  return uCenter + s / uScale;
}
// 元の画の中か（縁はなめらかに消す: 光の筋を重ねたとき、画の縁が段の模様にならない）
float inside(vec2 uv) { vec2 e = min(uv, 1.0 - uv); return smoothstep(0.0, 0.025, min(e.x, e.y)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < MAX_OCT; i++) { if (float(i) >= uOct) break; s += a * vnoise(p); n += a; p = p * 2.07 + 13.1; a *= 0.5; }
  return s / max(n, 1e-3);
}

void main() {
  vec2 q = (vUv - uCenter) * uScale;
  float r = max(length(q), 1e-5);

  // 街（と手）の層・空の層を、少し前の進みまで遡って重ねる（渦を巻いて流れ込む光の筋）
  vec4 m = vec4(0.0); vec3 s = vec3(0.0); float wsum = 0.0;
  // 重ねる位置を画素ごとに少しずらす（段の模様を細かいざらつきに変える）
  float jit = hash(gl_FragCoord.xy * 0.913 + 17.0);
  for (int j = 0; j < MAX_TAPS; j++) {
    if (float(j) >= uTaps) break;
    float w = uTaps > 1.0 ? min(1.0, (float(j) + jit) / uTaps) : 0.0;
    float k = 1.0 - 0.55 * w; // 尾ほど淡い
    vec2 a = lensUv(q, r, uLm.x - uBm.x * w, uLm.y - uBm.y * w);
    m += texture2D(tMain, a) * inside(a) * k;
    if (uSkyOn > 0.5) {
      vec2 b = lensUv(q, r, uLs.x - uBs.x * w, uLs.y - uBs.y * w);
      s += texture2D(tSky, b).rgb * inside(b) * k;
    }
    wsum += k;
  }
  m /= max(wsum, 1e-3); s /= max(wsum, 1e-3);
  vec3 col = vec3(0.0);
  if (uSkyOn > 0.5) {
    // 街が飲まれたあとに見える地平の下の空は、底のない暗さへ沈める
    vec2 b0 = lensUv(q, r, uLs.x, uLs.y);
    vec3 d = normalize(uCamBasis * vec3((b0 * 2.0 - 1.0) * uTan, -1.0));
    s *= smoothstep(-0.06, 0.0, d.y) * 0.998 + 0.002;
    col = s * uLs.z * uLs.w;
  }
  col = col * (1.0 - m.a * uLm.z) + m.rgb * uLm.z * uLm.w;

  // 黒い球（影）
  float aa = 1.5 * uPx;
  float outside = smoothstep(uShadow - aa, uShadow + aa, r);
  col *= outside;

  // 傾いた光の円盤（内ほど熱く白く、外は青紫。近づいてくる左側が明るい）
  float ct = cos(uTilt), st = sin(uTilt);
  vec2 dq = vec2(ct * q.x + st * q.y, -st * q.x + ct * q.y);
  vec2 dp = vec2(dq.x, dq.y / ${INCL.toFixed(2)});
  float dr = max(length(dp), 1e-5);
  float rin = uShadow * 1.32, rout = uShadow * 3.0;
  float x = (dr - rin) / (rout - rin);
  vec3 disk = vec3(0.0);
  if (uDisk > 0.0 && x > -0.1 && x < 1.1) {
    float band = smoothstep(0.0, 0.05, x) * pow(1.0 - smoothstep(0.0, 1.0, x), 1.5);
    float ang = atan(dp.y, dp.x);
    float spin = uTime * 2.4 * pow(rin / max(dr, rin), 1.5);
    // 渦の腕: 外ほど遅れてねじれた筋（同心の縞にならないよう、角度を半径でずらす）
    float tw = ang + spin + x * 7.5;
    vec2 cs = vec2(cos(tw), sin(tw));
    float turb = fbm(cs * 2.3 + vec2(x * 1.6, -x * 1.1));
    float arms = 0.5 + 0.5 * sin(tw * 2.0 + turb * 3.0);
    float lanes = mix(0.2, 1.35, smoothstep(0.15, 0.95, arms));
    float heat = pow(clamp(1.0 - x, 0.0, 1.0), 2.0);
    vec3 c = mix(uViolet, uAmber, smoothstep(0.0, 0.6, heat));
    c = mix(c, uGold, smoothstep(0.45, 0.9, heat));
    c = mix(c, uWhite, smoothstep(0.8, 1.0, heat) * 0.7);
    float dop = mix(0.2, 2.0, pow(0.5 - 0.5 * dp.x / dr, 1.3));
    disk = c * band * lanes * mix(0.5, 1.2, turb) * dop * uDisk * 2.4;
  }
  float front = step(dq.y, 0.0); // 手前の半分は黒い球の前、奥の半分は黒い球に隠れる
  col += disk * (1.0 - front) * outside;

  // 光子の輪（黒い球の縁の細い光）と、外へにじむ淡い光
  float pr = uShadow * 1.04;
  float ringW = uShadow * 0.022 + aa;
  float ring = exp(-pow((r - pr) / ringW, 2.0)) * 1.4 + exp(-max(r - pr, 0.0) / (uShadow * 0.4)) * 0.22 * step(pr, r);
  float ringDop = mix(0.6, 1.4, 0.5 - 0.5 * dq.x / r);
  col += mix(uGold, uWhite, 0.55) * ring * ringDop * uRing;

  col += disk * front;
  col *= 1.0 - uFade;
  col *= step(uBars, vUv.y) * step(vUv.y, 1.0 - uBars);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ZERO_LAYER = { swirl: 0, logZoom: 0, alpha: 1, boost: 1, blurSwirl: 0, blurZoom: 0 };

// renderer: WebGLRenderer。sky: 空の網（あれば空を別の層に描く。SKY_LAYER を足す）
export function createLensFx(renderer, { sky = null, tier = 'high' } = {}) {
  const opts = { type: THREE.HalfFloatType, depthBuffer: true };
  const rtMain = new THREE.WebGLRenderTarget(1, 1, opts);
  const rtSky = sky ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }) : null;
  if (sky) sky.layers.enable(SKY_LAYER);
  const u = {
    tMain: { value: rtMain.texture }, tSky: { value: rtSky?.texture ?? null },
    uSkyOn: { value: 0 }, uTaps: { value: 1 }, uOct: { value: 1 }, uPx: { value: 0.002 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uScale: { value: new THREE.Vector2(1, 1) },
    uE: { value: 0 }, uShadow: { value: 0 }, uRing: { value: 0 }, uDisk: { value: 0 }, uTime: { value: 0 },
    uFade: { value: 0 }, uTilt: { value: 0 }, uBars: { value: 0 },
    uLm: { value: new THREE.Vector4() }, uLs: { value: new THREE.Vector4() },
    uBm: { value: new THREE.Vector2() }, uBs: { value: new THREE.Vector2() },
    uCamBasis: { value: new THREE.Matrix3() }, uTan: { value: new THREE.Vector2(1, 1) },
    uGold: { value: srgb(1.0, 0.86, 0.55) }, uAmber: { value: srgb(0.98, 0.45, 0.12) },
    uViolet: { value: srgb(0.42, 0.36, 0.95) }, uWhite: { value: srgb(1.0, 0.98, 0.94) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
  });
  const quad = new FullScreenQuad(material);
  let quality = LENS_QUALITY[tier] ?? LENS_QUALITY.high;
  let warmed = false;
  const _clear = new THREE.Color();

  const setLayer = (vec, blur, l = ZERO_LAYER) => { vec.set(l.swirl, l.logZoom, l.alpha, l.boost); blur.set(l.blurSwirl, l.blurZoom); };
  const fit = (rt, w, h) => { if (rt.width !== w || rt.height !== h) rt.setSize(w, h); };
  // レンダーターゲットの大きさ（CSS 画素の size に、画素比と段の割合を掛ける）。2画面から画面全体へ移っても
  // 作り直さないよう、呼ぶ側は同じ size を渡す（画は rect の縦横比に引き伸ばして入り、写すときに戻る）
  function fitAll(size, useSky) {
    const pr = renderer.getPixelRatio();
    fit(rtMain, Math.max(1, Math.round(size.w * pr * quality.scale)), Math.max(1, Math.round(size.h * pr * quality.scale)));
    if (useSky) fit(rtSky, Math.max(1, Math.round(size.w * pr * quality.skyScale)), Math.max(1, Math.round(size.h * pr * quality.skyScale)));
  }

  // 場面をレンダーターゲットへ（空を別の層に描くときは、街の層から空を抜く）。透明の背景で描く
  function drawLayers(scene, camera, useSky) {
    renderer.getClearColor(_clear);
    const alpha = renderer.getClearAlpha();
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    if (useSky) sky.visible = false;
    renderer.setRenderTarget(rtMain);
    renderer.render(scene, camera);
    if (useSky) {
      sky.visible = true;
      const mask = camera.layers.mask;
      camera.layers.set(SKY_LAYER);
      renderer.setRenderTarget(rtSky);
      renderer.render(scene, camera);
      camera.layers.mask = mask;
    }
    renderer.setClearColor(_clear, alpha);
  }

  return {
    material, rtMain, rtSky,
    get quality() { return quality; },
    setTier(name) { quality = LENS_QUALITY[name] ?? quality; },
    // rect（CSS 画素、左下原点）へ、scene を camera で描いてゆがめて写す。size: レンダーターゲットの大きさ（CSS 画素。既定は rect）。
    // center: 黒い球の中心（rect の中の 0..1）。lens: { E, shadow, ring, disk, fade, bars, layer, sky?, time, tilt }
    // （長さは rect の短い辺が 1。layer は街・手の層、sky は空の層。sky を描かない効果では無視）
    render(scene, camera, rect, center, lens, size = rect) {
      const short = Math.max(1, Math.min(rect.w, rect.h));
      const useSky = !!(rtSky && lens.sky);
      fitAll(size, useSky);
      drawLayers(scene, camera, useSky);
      renderer.setRenderTarget(null);

      u.uSkyOn.value = useSky ? 1 : 0;
      u.uTaps.value = quality.taps; u.uOct.value = quality.oct;
      u.uPx.value = 1 / short;
      u.uCenter.value.set(center[0], center[1]);
      u.uScale.value.set(rect.w / short, rect.h / short);
      u.uE.value = lens.E; u.uShadow.value = lens.shadow; u.uRing.value = lens.ring ?? 0; u.uDisk.value = lens.disk ?? 0;
      u.uTime.value = lens.time ?? 0; u.uFade.value = lens.fade ?? 0; u.uTilt.value = lens.tilt ?? 0; u.uBars.value = lens.bars ?? 0;
      setLayer(u.uLm.value, u.uBm.value, lens.layer);
      setLayer(u.uLs.value, u.uBs.value, lens.sky ?? ZERO_LAYER);
      u.uCamBasis.value.setFromMatrix4(camera.matrixWorld);
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov ?? 50) / 2);
      u.uTan.value.set(tanV * (camera.aspect ?? 1), tanV);

      renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissorTest(true);
      quad.render(renderer);
      renderer.setScissorTest(false);
    },
    // 画面へ描く段のシェーダーと、レンダーターゲットへ描く場面の材質を前もって作る（呼ぶ側が両方の描き先で呼ぶ）
    // size を渡すと、レンダーターゲットもその大きさで先に作り、一度実際に描いておく（ドライバーによっては、描き先の形式ごとの
    // 準備が初めて描いたときに走り、最初の一コマが止まる。シェーダーを作るだけでは足りない）
    warmup(scene, camera, size = null) {
      if (scene) renderer.compile(scene, camera);
      quad.render(renderer);
      if (size && scene && !warmed) {
        warmed = true;
        const target = renderer.getRenderTarget();
        fitAll(size, !!rtSky);
        drawLayers(scene, camera, !!rtSky);
        renderer.setRenderTarget(target);
      }
    },
    dispose() { rtMain.dispose(); rtSky?.dispose(); material.dispose(); quad.dispose(); },
  };
}

// 点 p（世界）を camera で写した、rect の中の位置（0..1）。後ろにあれば null
export function projectToRect(p, camera, out = [0.5, 0.5]) {
  const v = p.isVector3 ? p.clone() : new THREE.Vector3(...p);
  v.project(camera);
  if (v.z > 1) return null;
  out[0] = v.x * 0.5 + 0.5; out[1] = v.y * 0.5 + 0.5;
  return out;
}
