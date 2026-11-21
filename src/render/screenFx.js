import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// 街の画面の画面効果: 光のにじみ（bloom、high/mid）、熱による空気のゆがみ（high）、放つ瞬間の白い閃光（全段）。
// fx = { flash: 0..1, heat: { center:[x,y,z], radius, strength } | null, time }

// 閾値は窓の明かり（style.js の WINDOW_LAMP_MAX）より上: 暗めの夕方の街では、にじむのはバイクの推進の光・街灯の頭・爆発だけ
export const BLOOM = { strength: 0.46, radius: 0.32, threshold: 1.05 };

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFlash: { value: 0 },
    uTime: { value: 0 },
    uHeat: { value: 0 },
    uHeatCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uHeatRadius: { value: 0.3 },
    uAspect: { value: 1 },
    // 演出の画づくり: 黒い帯（画面の高さに対する片側の割合）、色ずれ、周辺減光、彩度、暖色寄せ、粒子、横に伸びる光の筋、明るさ、暗転
    uBars: { value: 0 }, uCA: { value: 0 }, uVig: { value: 0 }, uSat: { value: 1 }, uWarm: { value: 0 },
    uGrain: { value: 0 }, uStreak: { value: 0 }, uExposure: { value: 1 }, uFade: { value: 0 }, uContrast: { value: 1 },
    // 動きのぶれ（S6 の導入。high/mid だけ）: 中心 uZoomC へ向かう放射状のぶれ uZoom と、画面の向きのぶれ uBlur（UV）
    uZoom: { value: 0 }, uZoomC: { value: new THREE.Vector2(0.5, 0.5) }, uBlur: { value: new THREE.Vector2(0, 0) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uFlash, uTime, uHeat, uHeatRadius, uAspect;
    uniform float uBars, uCA, uVig, uSat, uWarm, uGrain, uStreak, uExposure, uFade, uContrast, uZoom;
    uniform vec2 uZoomC, uBlur;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    uniform vec2 uHeatCenter;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      #ifdef HEAT_HAZE
      if (uHeat > 0.0) {
        // 球の縁のすぐ外側の帯と、その上の立ちのぼる熱気をゆがめる
        vec2 q = (uv - uHeatCenter) * vec2(uAspect, 1.0);
        float d = length(q) / max(uHeatRadius, 1e-3);
        float band = exp(-pow((d - 1.06) * 5.0, 2.0)) + 0.35 * smoothstep(1.0, 0.2, d) * step(0.0, q.y);
        float m = band * uHeat;
        vec2 w = vec2(sin(uv.y * 90.0 - uTime * 9.0 + sin(uv.x * 37.0) * 2.0),
                      cos(uv.x * 80.0 + uTime * 7.0 + sin(uv.y * 41.0) * 2.0));
        uv += w * 0.0035 * m;
      }
      #endif
      vec4 c = texture2D(tDiffuse, uv);
      #ifdef GRADE
      // 動きのぶれ: 今の点から、ぶれの向きへ 8 点を平均する
      if (uZoom > 0.0 || dot(uBlur, uBlur) > 0.0) {
        vec2 bd = (uv - uZoomC) * uZoom + uBlur;
        vec4 acc = c;
        for (int i = 1; i < 8; i++) acc += texture2D(tDiffuse, uv - bd * (float(i) / 7.0));
        c = acc / 8.0;
      }
      // 色ずれ: 画面の端ほど赤と青が外と内へずれる
      if (uCA > 0.0) {
        vec2 dc = (uv - 0.5);
        vec2 o = dc * dot(dc, dc) * 0.025 * uCA;
        c.r = texture2D(tDiffuse, uv + o).r;
        c.b = texture2D(tDiffuse, uv - o).b;
      }
      // 横に伸びる光の筋（明るいところだけを横に引き伸ばす）
      if (uStreak > 0.0) {
        vec3 s = vec3(0.0);
        for (int i = 1; i <= 8; i++) {
          float k = float(i) * 0.028;
          vec3 a = texture2D(tDiffuse, uv + vec2(k, 0.0)).rgb, b = texture2D(tDiffuse, uv - vec2(k, 0.0)).rgb;
          s += (max(a - 1.0, 0.0) + max(b - 1.0, 0.0)) * (1.0 - float(i) / 9.0);
        }
        c.rgb += s * vec3(0.9, 0.75, 0.6) * 0.35 * uStreak;
      }
      c.rgb *= uExposure;
      // コントラスト（中間の灰色を軸に、暗いところはより暗く）
      c.rgb = max(vec3(0.0), 0.18 * pow(max(c.rgb, vec3(0.0)) / 0.18, vec3(uContrast)));
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(lum), c.rgb, uSat);
      // 暗部は冷たく、明部は暖かく
      c.rgb *= mix(vec3(1.0), mix(vec3(0.82, 0.9, 1.12), vec3(1.12, 0.98, 0.84), smoothstep(0.05, 0.7, lum)), uWarm);
      vec2 q = (uv - 0.5) * vec2(uAspect, 1.0);
      c.rgb *= 1.0 - uVig * smoothstep(0.35, 1.1, length(q) / max(0.75, uAspect * 0.75));
      c.rgb += (hash(uv * 977.0 + fract(uTime * 7.13)) - 0.5) * uGrain * (0.4 + lum);
      #endif
      // 閃光: 白へ飛ばす（トーンマップ前なので強く足しても白に収まる）
      c.rgb = mix(c.rgb, vec3(4.0), uFlash * 0.85) + vec3(uFlash * 1.5);
      #ifdef GRADE
      c.rgb *= 1.0 - uFade;
      // 黒い帯
      c.rgb *= step(uBars, uv.y) * step(uv.y, 1.0 - uBars);
      #endif
      gl_FragColor = c;
    }`,
};

export function createScreenFx(renderer) {
  let composer = null, finalPass = null, bloomPass = null, renderPass = null, mode = '';
  let size = { w: 0, h: 0, pr: 0 };
  const flashQuad = new FullScreenQuad(new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const _v = new THREE.Vector3(), _r = new THREE.Vector3();
  // 光のにじみを使わない段（low）の、黒い帯・周辺減光・暗さ・暗転だけの重ね描き
  const gradeQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { uBars: { value: 0 }, uVig: { value: 0 }, uFade: { value: 0 }, uAspect: { value: 1 }, uDark: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform float uBars, uVig, uFade, uAspect, uDark; varying vec2 vUv;
      void main() {
        vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
        float v = uVig * smoothstep(0.35, 1.1, length(q) / max(0.75, uAspect * 0.75));
        float bar = 1.0 - step(uBars, vUv.y) * step(vUv.y, 1.0 - uBars);
        gl_FragColor = vec4(0.0, 0.0, 0.0, max(max(1.0 - (1.0 - v) * (1.0 - uDark), bar), uFade));
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  }));
  const NO_GRADE = { bars: 0, ca: 0, vig: 0, sat: 1, grain: 0, streak: 0, exposure: 1, fade: 0, warm: 0, contrast: 1 };

  function build(tier, scene, camera) {
    composer?.dispose();
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true });
    composer = new EffectComposer(renderer, target);
    composer.renderToScreen = true;
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    composer.addPass(bloomPass);
    finalPass = new ShaderPass({ ...FinalShader, uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms), defines: { GRADE: '', ...(tier.heatHaze ? { HEAT_HAZE: '' } : {}) } });
    composer.addPass(finalPass);
    composer.addPass(new OutputPass());
    size = { w: 0, h: 0, pr: 0 };
  }

  // 球の中心と半径を、画面（0..1 の UV と、画面の高さに対する比）へ写す
  function projectHeat(heat, camera, rect, u) {
    _v.fromArray(heat.center).project(camera);
    const dist = camera.position.distanceTo(_r.fromArray(heat.center));
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    u.uHeatCenter.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    u.uHeatRadius.value = heat.radius / Math.max(1, dist) / tanHalf / 2;
    u.uAspect.value = rect.w / Math.max(1, rect.h);
    u.uHeat.value = _v.z < 1 ? heat.strength : 0;
  }

  return {
    // rect に scene を描く（viewport/scissor は呼ぶ側で rect に合わせておく）
    render(scene, camera, rect, tier, fx = {}) {
      const want = tier.bloom ? (tier.heatHaze ? 'bloom+haze' : 'bloom') : 'plain';
      if (want !== mode) {
        mode = want;
        if (want === 'plain') { composer?.dispose(); composer = null; } else build(tier, scene, camera);
      }
      const flash = Math.min(1, Math.max(0, fx.flash ?? 0));
      const grade = fx.grade ?? NO_GRADE;
      if (!composer) {
        renderer.render(scene, camera);
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        if (flash > 0) {
          flashQuad.material.opacity = flash;
          flashQuad.render(renderer);
        }
        if (fx.grade) {
          const g = gradeQuad.material.uniforms;
          g.uBars.value = grade.bars; g.uVig.value = grade.vig * 0.8; g.uFade.value = grade.fade; g.uAspect.value = rect.w / Math.max(1, rect.h);
          g.uDark.value = Math.min(0.5, Math.max(0, 1 - grade.exposure) * 0.8);
          gradeQuad.render(renderer);
        }
        renderer.autoClear = auto;
        return;
      }
      const pr = renderer.getPixelRatio();
      if (size.w !== rect.w || size.h !== rect.h || size.pr !== pr) {
        size = { w: rect.w, h: rect.h, pr };
        composer.setPixelRatio(pr);
        composer.setSize(rect.w, rect.h);
      }
      renderPass.scene = scene;
      renderPass.camera = camera;
      const u = finalPass.uniforms;
      u.uFlash.value = flash;
      u.uTime.value = fx.time ?? 0;
      u.uBars.value = grade.bars; u.uCA.value = grade.ca; u.uVig.value = grade.vig; u.uSat.value = grade.sat; u.uWarm.value = grade.warm;
      u.uGrain.value = grade.grain; u.uStreak.value = grade.streak; u.uExposure.value = grade.exposure; u.uFade.value = grade.fade; u.uContrast.value = grade.contrast ?? 1;
      u.uZoom.value = grade.zoom ?? 0;
      if (grade.zoomC) u.uZoomC.value.set(grade.zoomC[0], grade.zoomC[1]); else u.uZoomC.value.set(0.5, 0.5);
      if (grade.blur) u.uBlur.value.set(grade.blur[0], grade.blur[1]); else u.uBlur.value.set(0, 0);
      u.uAspect.value = rect.w / Math.max(1, rect.h);
      bloomPass.strength = BLOOM.strength * (grade.bloom ?? 1);
      if (tier.heatHaze && fx.heat && fx.heat.strength > 0) projectHeat(fx.heat, camera, rect, u); else u.uHeat.value = 0;
      composer.render();
    },
  };
}
