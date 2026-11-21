import * as THREE from 'three';
import { DUSK } from './style.js';

// fix1（持ち主 15:33「軍勢は街の全体にいた方が良い」、見えること）: 街を見回る軍勢（e.patrol）の推進の光の点。
//  - 遠いほど大きく明るくなる光の点（画面の画素で大きさを決める）。近く（near m の内）はバイクそのものが見えるので出さない。
//    霞の中でも半分は残す（遠くの地区にも軍勢がいるのが読める）
//  - 爆発の光の壁に飲まれた瞬間、白緑の火花がぱっと広がって消える（flash 秒）。光の壁を透かして見える（深さを見ない）
// 一つの Points（1 回の描画、最大 count 点）。毎フレーム位置と状態を書く（数十点なので軽い）

export const PATROL_GLOW = { near: 70, far: 420, minPx: 2.2, maxPx: 7.5, flash: 0.7, flashPx: 46 };

const VERT = /* glsl */`
attribute float aDead; // 倒れてからの秒（生きていれば -1）
uniform float uPx, uMinPx, uMaxPx, uNear, uFar, uFlash, uFlashPx, uPR;
varying float vA; varying float vF;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = -mv.z;
  gl_Position = projectionMatrix * mv;
  float far = smoothstep(uNear, uFar, d);
  if (aDead < 0.0) {
    vA = smoothstep(uNear, uNear * 1.8, d) * (0.55 + 0.45 * far);
    vF = 0.0;
    gl_PointSize = mix(uMinPx, uMaxPx, far) * uPR;
  } else {
    float u = clamp(aDead / uFlash, 0.0, 1.0);
    vA = (1.0 - u) * (1.0 - u);
    vF = 1.0;
    gl_PointSize = uFlashPx * uPR * (0.35 + 0.65 * sqrt(u)) * (0.5 + 0.5 * far);
  }
  if (vA <= 0.001) gl_PointSize = 0.0;
}`;
const FRAG = /* glsl */`
uniform vec3 uColor;
varying float vA; varying float vF;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  float core = exp(-r * 9.0), halo = exp(-r * 2.6);
  vec3 c = mix(uColor * (core * 0.8 + halo * 0.45), vec3(0.9, 1.0, 0.95) * (core * 2.2 + halo * 0.6) + uColor * halo * 0.6, vF);
  gl_FragColor = vec4(c * vA, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createPatrolGlow(count, tier = 'high') {
  const pos = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const dead = new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1);
  pos.setUsage(THREE.DynamicDrawUsage); dead.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', pos);
  geo.setAttribute('aDead', dead);
  const G = PATROL_GLOW;
  // 遠くの点は小さいので、バイクの推進の光より飽和した緑（白く飛ばさない）
  const color = DUSK.thrustLow.clone().multiplyScalar(tier === 'low' ? 0.9 : 1.3);
  const uniforms = {
    uPx: { value: 1 }, uMinPx: { value: G.minPx }, uMaxPx: { value: G.maxPx }, uNear: { value: G.near }, uFar: { value: G.far },
    uFlash: { value: G.flash }, uFlashPx: { value: G.flashPx }, uPR: { value: 1 }, uColor: { value: color },
  };
  // 深さは見ない: 遠くの通りの軍勢はビルの陰でも光の点として透けて見える（上空の画面の探す者の目印と同じ考え。軍勢が街じゅうにいるのが読める）
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.name = 'patrol-glow';
  points.frustumCulled = false;
  points.renderOrder = 7;
  geo.setDrawRange(0, 0);
  let clock = 0;
  const died = new Map();
  return {
    points,
    // リプレイで放つ直前へ戻すとき
    reset() { died.clear(); },
    count: () => geo.drawRange.count,
    // enemies: 軍勢の一覧（見回る者だけ使う）。pixelRatio: 画素比
    // 倒れた時刻はこの層の時計で覚える（最後の一発の間はゲームの軍勢の時間が止まっているので deadTime は進まない）。dt: 世界の秒
    update(enemies, { pixelRatio = 1, visible = true, dt = 0 } = {}) {
      clock += dt;
      points.visible = visible;
      uniforms.uPR.value = pixelRatio;
      let n = 0;
      const p = pos.array, a = dead.array;
      for (const e of enemies) {
        if (!e.patrol || n >= count) continue;
        let since = -1;
        if (e.state === 'dead') {
          if (!died.has(e.id)) died.set(e.id, clock);
          since = clock - died.get(e.id);
          if (since > G.flash) continue;
        }
        p[n * 3] = e.x; p[n * 3 + 1] = 3.2; p[n * 3 + 2] = e.z;
        a[n] = since;
        n++;
      }
      geo.setDrawRange(0, n);
      pos.needsUpdate = dead.needsUpdate = true;
    },
  };
}
