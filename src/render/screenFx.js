import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// 街の画面の画面効果: 光のにじみ（bloom、high/mid）、熱による空気のゆがみ（high）、放つ瞬間の白い閃光（全段）。
// fx = { flash: 0..1, heat: { center:[x,y,z], radius, strength } | null, time }

const BLOOM = { strength: 0.38, radius: 0.3, threshold: 1.05 };

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFlash: { value: 0 },
    uTime: { value: 0 },
    uHeat: { value: 0 },
    uHeatCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uHeatRadius: { value: 0.3 },
    uAspect: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uFlash, uTime, uHeat, uHeatRadius, uAspect;
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
      // 閃光: 白へ飛ばす（トーンマップ前なので強く足しても白に収まる）
      c.rgb = mix(c.rgb, vec3(4.0), uFlash * 0.85) + vec3(uFlash * 1.5);
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

  function build(tier, scene, camera) {
    composer?.dispose();
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true });
    composer = new EffectComposer(renderer, target);
    composer.renderToScreen = true;
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    composer.addPass(bloomPass);
    finalPass = new ShaderPass({ ...FinalShader, uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms), defines: tier.heatHaze ? { HEAT_HAZE: '' } : {} });
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
      if (!composer) {
        renderer.render(scene, camera);
        if (flash > 0) {
          const auto = renderer.autoClear;
          renderer.autoClear = false;
          flashQuad.material.opacity = flash;
          flashQuad.render(renderer);
          renderer.autoClear = auto;
        }
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
      if (tier.heatHaze && fx.heat && fx.heat.strength > 0) projectHeat(fx.heat, camera, rect, u); else u.uHeat.value = 0;
      composer.render();
    },
  };
}
