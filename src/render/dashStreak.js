import * as THREE from 'three';

// M2（持ち主 15:20「物陰にシュッと入る」）: 隠れるの滑り込みの見た目。滑り込んだ道すじに残る光の筋（加算の帯 2 枚: 上空から見える水平の帯と、
// 横から見える縦の帯）が、滑り込みのあと fadeSec 秒で細く消える。物陰に入った主人公の足元には、暗い影の溜まり（隠れている間だけ）。
// どちらも網 1 つずつ、毎フレーム行列と uniform を書き換えるだけ
export const STREAK = { width: 1.6, height: 1.1, fadeSec: 0.35, shadowR: 2.6 };
const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
uniform vec3 uCol;
uniform float uA;
varying vec2 vUv;
void main() {
  // 進む先（uv.x = 1）ほど明るく、帯の真ん中が明るい
  float a = uA * pow(vUv.x, 1.6) * (1.0 - smoothstep(0.15, 0.5, abs(vUv.y - 0.5)));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;
const SHADOW_FRAG = /* glsl */`
uniform float uA;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = uA * (1.0 - smoothstep(0.3, 1.0, r));
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.02, 0.01, 0.05, a);
}`;

export function createDashStreak(scene) {
  const uniforms = { uCol: { value: new THREE.Color(1.0, 0.82, 0.55).multiplyScalar(1.6) }, uA: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0); // x: 0 → 1 が道すじ
  const tall = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
  const group = new THREE.Group();
  group.name = 'dash-streak';
  const a = new THREE.Mesh(flat, mat), b = new THREE.Mesh(tall, mat);
  a.frustumCulled = b.frustumCulled = false;
  group.add(a, b);
  group.visible = false;
  const sUni = { uA: { value: 0 } };
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(STREAK.shadowR, 24).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: sUni, vertexShader: VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false }));
  shadow.name = 'hide-shadow';
  shadow.frustumCulled = false;
  shadow.renderOrder = 1;
  scene.add(group, shadow);
  let last = null, fade = 0, crouch = 0;
  return {
    group, shadow,
    get crouch() { return crouch; },
    // hero: game.hero（dashing・dashFrom・hidden を読む）。戻り値はしゃがむ強さ 0〜1（主人公の体を縮める）
    update(hero, dt) {
      if (hero.dashing != null && hero.dashFrom) { last = { x0: hero.dashFrom.x, z0: hero.dashFrom.z }; fade = 1; }
      else fade = Math.max(0, fade - dt / STREAK.fadeSec);
      const on = !!last && fade > 0;
      group.visible = on;
      if (on) {
        const dx = hero.x - last.x0, dz = hero.z - last.z0, len = Math.max(0.1, Math.hypot(dx, dz));
        group.position.set(last.x0, 0.6, last.z0);
        group.rotation.set(0, Math.atan2(-dz, dx), 0);
        const w = STREAK.width * (0.35 + 0.65 * fade);
        a.scale.set(len, 1, w); b.scale.set(len, STREAK.height * (0.4 + 0.6 * fade), 1);
        uniforms.uA.value = 0.9 * fade;
      }
      const want = hero.hidden ? 1 : 0;
      crouch += (want - crouch) * (1 - Math.exp(-dt / 0.08));
      shadow.position.set(hero.x, 0.05, hero.z);
      sUni.uA.value = 0.55 * crouch;
      shadow.visible = crouch > 0.01;
      return crouch;
    },
  };
}
