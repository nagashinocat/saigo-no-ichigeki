import * as THREE from 'three';
import { createRng } from '../rng.js';

// 最後の一発の演出の小道具（街の場面に置く）: 前線が届いたビルの窓から漏れる光と光の筋、砕けて宙に浮くガラス片、
// 目が映る大きなガラス片、宙に止まった塵。
// 動きはすべて「体感時間」P（finaleTimeline.perceivedTime: 白が晴れた瞬間が 0、一拍の間はほとんど進まない）で決まる。
// 目が映るガラス片だけは演出の秒 t で動く（カメラの前のちょうどよい所で止まるように）。

const HERO_SIZE = [0.9, 0.58];
const TIER_COUNTS = {
  high: { shards: 110, motes: 420 },
  mid: { shards: 70, motes: 240 },
  low: { shards: 36, motes: 90 },
};

const SHARD_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN, vW;
varying float vEdge;
attribute float aEdge;
void main() {
  vUv = uv;
  vEdge = aEdge;
  vec4 lp = vec4(position, 1.0);
  vec3 ln = normal;
  #ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  ln = mat3(instanceMatrix) * ln;
  #endif
  vec4 wp = modelMatrix * lp;
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * ln);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SHARD_FRAG = /* glsl */`
uniform sampler2D tEye;
uniform float uReflect, uLight, uFade;
uniform vec3 uBlast, uSunDir;
varying vec2 vUv;
varying vec3 vN, vW;
varying float vEdge;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  if (dot(N, V) < 0.0) N = -N;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 R = reflect(-V, N);
  // 夕方の暗い空と、背後から迫る光の映り込み
  vec3 toB = normalize(uBlast - vW);
  vec3 sky = mix(vec3(0.35, 0.16, 0.12), vec3(0.04, 0.05, 0.12), smoothstep(-0.1, 0.6, R.y));
  float glint = pow(max(dot(R, toB), 0.0), 18.0) * 6.0 + pow(max(dot(R, toB), 0.0), 3.0) * 0.6;
  vec3 col = vec3(0.015, 0.018, 0.024) + sky * (0.1 + 0.6 * fres) + vec3(1.0, 0.7, 0.42) * glint * uLight;
  // 光に透かされたガラスの縁: 光の方を向くほど熱い色
  float back = max(dot(-V, toB), 0.0);
  col += vec3(1.0, 0.62, 0.3) * pow(back, 6.0) * uLight * 0.6;
  float a = mix(0.25, 0.85, fres) + glint * 0.2;
  #ifdef EYE
  // 映った目（鏡なので左右が逆）。ガラスのわずかなゆがみで像がゆれ、縁ほど色がずれる
  vec2 e = vec2(1.0 - vUv.x, vUv.y);
  vec2 wob = vec2(sin(vUv.y * 17.0 + vUv.x * 5.0) * 0.006, sin(vUv.x * 13.0 - vUv.y * 4.0) * 0.005);
  float ca = 0.004 + 0.012 * (1.0 - smoothstep(0.0, 0.35, vEdge));
  vec2 dir = normalize(e - 0.5 + 1e-4);
  vec3 eye = vec3(texture2D(tEye, clamp(e + wob + dir * ca, 0.0, 1.0)).r,
                  texture2D(tEye, clamp(e + wob, 0.0, 1.0)).g,
                  texture2D(tEye, clamp(e + wob - dir * ca, 0.0, 1.0)).b);
  float k = uReflect;
  col = col * (1.0 - 0.85 * k) + eye * k * 1.9;
  a = mix(a, 0.94, k);
  // ひび（像の上を走る細い線）
  vec2 c1 = vUv - vec2(0.66, 0.36);
  float crack = (1.0 - smoothstep(0.0, 0.003, abs(dot(c1, normalize(vec2(0.8, -0.6)))))) * step(0.0, c1.x);
  vec2 c2 = vUv - vec2(0.2, 0.7);
  crack += (1.0 - smoothstep(0.0, 0.0025, abs(dot(c2, normalize(vec2(0.3, 0.95)))))) * step(c2.y, 0.0) * step(-0.25, c2.y);
  col += vec3(1.0, 0.9, 0.78) * crack * (0.5 + uLight);
  #endif
  // 割れた縁が光る
  float edge = 1.0 - smoothstep(0.0, 0.06, vEdge);
  col += vec3(1.0, 0.85, 0.62) * edge * (0.6 + 2.2 * uLight);
  a = max(a, edge);
  gl_FragColor = vec4(col * uFade, a * uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 窓から漏れる光（窓の大きさの板。にじみの分だけ大きく描く）
const GLOW_VERT = /* glsl */`
attribute vec3 aInfo; // x: 乱数, y: 割れる体感時刻, z: 窓の幅/高さ
varying vec2 vUv;
varying vec3 vInfo;
void main() {
  vUv = uv;
  vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const GLOW_FRAG = /* glsl */`
uniform float uLight, uP;
varying vec2 vUv;
varying vec3 vInfo;
void main() {
  // 板は窓の 1.8 倍。中の四角が窓、外はにじみ
  vec2 q = abs(vUv - 0.5) * 1.8;
  float inWin = (1.0 - smoothstep(0.46, 0.5, q.x)) * (1.0 - smoothstep(0.46, 0.5, q.y));
  float bleed = exp(-max(max(q.x, q.y) - 0.5, 0.0) * 16.0);
  float broken = smoothstep(vInfo.y, vInfo.y + 0.03, uP);
  // 窓ごとに明るさがちがう（奥の部屋の壁や家具の影）。割れた窓ほど光が素通しになる
  float k = uLight * (0.2 + 0.8 * vInfo.x * vInfo.x) * (0.25 + 0.75 * broken);
  // 窓の中: 下ほど暗い（床と家具の影）、上の縁が一番明るい。奥の部屋の影がまだらに落ちる
  vec2 wq = (vUv - 0.5) * 1.8 + 0.5;
  float room = 0.65 + 0.35 * sin(wq.x * 7.0 + vInfo.x * 20.0) * sin(wq.y * 5.0 + vInfo.x * 11.0);
  float inner = mix(0.35, 1.25, smoothstep(0.0, 1.0, wq.y)) * room;
  vec3 hot = mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.9, 0.75), smoothstep(0.3, 1.0, k));
  vec3 col = hot * (inWin * 1.7 * inner + bleed * 0.3) * k;
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 割れた窓から通りへ差す光の筋（十字に組んだ2枚の板。根元が明るく先へ消える）
const BEAM_FRAG = /* glsl */`
uniform float uLight, uP;
varying vec2 vUv;
varying vec3 vInfo;
void main() {
  float along = vUv.y;              // 0: 窓、1: 先
  float across = abs(vUv.x - 0.5) * 2.0;
  float broken = smoothstep(vInfo.y, vInfo.y + 0.05, uP);
  float a = (1.0 - smoothstep(0.0, 1.0, along)) * (1.0 - smoothstep(0.35, 1.0, across)) * smoothstep(0.0, 0.04, along);
  // 光の筋に浮く塵のちらつき（止まった時間の中で、ほとんど動かない）
  float grain = 0.75 + 0.25 * sin(vUv.y * 60.0 + vInfo.x * 40.0) * sin(vUv.x * 23.0 + vInfo.x * 13.0);
  vec3 col = vec3(1.0, 0.72, 0.42) * a * grain * uLight * broken * 0.09 * step(0.55, vInfo.x) * vInfo.x;
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 宙に止まった塵（近いものほど大きくぼける）
const MOTE_VERT = /* glsl */`
attribute vec4 aMote; // x: 大きさ, y: 明るさ, z,w: 揺れの位相
uniform float uP, uScale;
varying float vB, vSoft;
void main() {
  vec3 p = position + vec3(sin(aMote.z + uP * 2.0), sin(aMote.w + uP * 1.7) * 0.6, cos(aMote.z * 1.3 + uP * 1.5)) * 0.08;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  float d = max(0.2, -mv.z);
  gl_PointSize = clamp(aMote.x * uScale / d, 1.0, 64.0);
  // 近いもの（ピントの外）ほど大きく淡い
  vSoft = smoothstep(4.0, 0.6, d);
  vB = aMote.y / (1.0 + vSoft * 5.0);
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */`
uniform float uLight;
varying float vB, vSoft;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float disc = mix(1.0 - smoothstep(0.15, 1.0, r), (1.0 - smoothstep(0.82, 1.0, r)) * (0.7 + 0.3 * smoothstep(0.5, 0.97, r)), vSoft);
  vec3 col = vec3(1.0, 0.8, 0.56) * disc * vB * (0.6 + 3.0 * uLight);
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ビルの向こうの光の壁が、屋根と壁の縁からこぼれる光（爆心に立てた、カメラを向く大きな板。ビルが手前をふさぐ）
const HALO_FRAG = /* glsl */`
uniform float uI, uP;
varying vec2 vUv;
float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  float ang = atan(q.y, q.x);
  // 放射状の光の筋（止まった時間の中で、ほとんど動かない）
  float a = ang * 18.0 / 6.2832 + 0.5;
  float ray = mix(h11(floor(a)), h11(floor(a) + 1.0), smoothstep(0.0, 1.0, fract(a)));
  float b = ang * 47.0 / 6.2832;
  ray = ray * 0.7 + 0.3 * mix(h11(floor(b) + 9.0), h11(floor(b) + 10.0), smoothstep(0.0, 1.0, fract(b)));
  float rays = pow(ray, 4.0) * exp(-d * 1.8) * (0.7 + 0.3 * sin(uP * 30.0 + ang * 3.0));
  float glow = exp(-d * 3.0) * 1.5 + exp(-d * 12.0) * 4.0;
  vec3 col = vec3(1.0, 0.6, 0.28) * glow + vec3(1.0, 0.8, 0.58) * rays * 1.8;
  col *= 1.0 - smoothstep(0.85, 1.0, d);
  gl_FragColor = vec4(col * uI, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 割れたガラスの形: 中心から外へ伸びる扇（aEdge は縁で 0、中心で 1）。uv は外接する箱で 0〜1
function shardGeometry(rng, w, h, sides = 7, curve = 0) {
  const pos = [0, 0, 0], uv = [0.5, 0.5], edge = [1];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const r = 0.66 + 0.34 * rng();
    const x = Math.cos(a) * r * w / 2, y = Math.sin(a) * r * h / 2;
    pos.push(x, y, -curve * (x * x) / (w * w / 4));
    uv.push(x / w + 0.5, y / h + 0.5);
    edge.push(0);
  }
  const index = [];
  for (let i = 0; i < sides; i++) index.push(0, 1 + i, 1 + ((i + 1) % sides));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// 光の筋: 根元（y=0）から先（y=1）へ、十字の2枚
function beamGeometry() {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const pos = [...a.attributes.position.array, ...b.attributes.position.array];
  const uv = [...a.attributes.uv.array, ...b.attributes.uv.array];
  const idx = [...a.index.array, ...b.index.array.map((i) => i + 4)];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const additive = (opts) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, ...opts,
});

export function createCinematicProps(scene, eyeTexture, { sunDir = new THREE.Vector3(0.8, 0.42, -0.45).normalize(), tier = 'high' } = {}) {
  const counts = TIER_COUNTS[tier] ?? TIER_COUNTS.mid;
  const group = new THREE.Group();
  group.name = 'cinematicProps';
  group.visible = false;
  scene.add(group);
  const rng = createRng(0xc1e7a);
  const blastPos = new THREE.Vector3(0, 8, 0);

  const shardUniforms = () => ({
    tEye: { value: eyeTexture }, uReflect: { value: 0 }, uLight: { value: 0 }, uFade: { value: 1 },
    uBlast: { value: blastPos }, uSunDir: { value: sunDir.clone() },
  });
  const shardMat = (defines) => new THREE.ShaderMaterial({
    uniforms: shardUniforms(), vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, defines,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });

  // 目が映る大きなガラス片
  const hero = new THREE.Mesh(shardGeometry(rng, ...HERO_SIZE, 7, 0.04), shardMat({ EYE: '' }));
  hero.frustumCulled = false;
  hero.renderOrder = 22;
  group.add(hero);

  // 砕けて宙に浮くガラス片
  const small = new THREE.InstancedMesh(shardGeometry(rng, 1, 1, 5), shardMat({}), counts.shards);
  small.frustumCulled = false;
  small.renderOrder = 21;
  group.add(small);

  // 窓の光と光の筋（窓は 1 枚の壁の分だけ。多くても 64）
  const MAX_WIN = 64;
  const glowUniforms = { uLight: { value: 0 }, uP: { value: 0 } };
  const winInfo = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WIN * 3), 3);
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  glowGeo.setAttribute('aInfo', winInfo);
  const glow = new THREE.InstancedMesh(glowGeo, additive({ uniforms: glowUniforms, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, side: THREE.DoubleSide }), MAX_WIN);
  glow.frustumCulled = false;
  glow.renderOrder = 19;
  group.add(glow);
  const beamGeo = beamGeometry();
  beamGeo.setAttribute('aInfo', winInfo);
  const beams = new THREE.InstancedMesh(beamGeo, additive({ uniforms: glowUniforms, vertexShader: GLOW_VERT, fragmentShader: BEAM_FRAG, side: THREE.DoubleSide }), MAX_WIN);
  beams.frustumCulled = false;
  beams.renderOrder = 20;
  group.add(beams);

  // ビルの向こうからこぼれる光
  const haloUniforms = { uI: { value: 0 }, uP: { value: 0 } };
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive({ uniforms: haloUniforms, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: HALO_FRAG }));
  halo.frustumCulled = false;
  halo.renderOrder = 18;
  group.add(halo);

  // 塵
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(counts.motes * 3), 3));
  const moteAttr = new Float32Array(counts.motes * 4);
  moteGeo.setAttribute('aMote', new THREE.BufferAttribute(moteAttr, 4));
  const moteUniforms = { uP: { value: 0 }, uScale: { value: 300 }, uLight: { value: 0 } };
  const motes = new THREE.Points(moteGeo, additive({ uniforms: moteUniforms, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG }));
  motes.frustumCulled = false;
  motes.renderOrder = 23;
  group.add(motes);

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  const V = (a) => new THREE.Vector3().fromArray(a);
  let shards = [], heroPath = null, nWin = 0;

  return {
    group,
    heroMesh: hero,
    // 演出の始まりに: plan（finalePlan.js）から窓・ガラス片・塵を並べる。
    // view: 一拍のカメラ { pos, fwd, right, up, tanV, tanH }、P: { contact, breakAt: [早い, 遅い] }（体感時間）、
    // heroTimes: 目が映るガラス片が窓を離れる・カメラの前に着く演出の秒
    setup(plan, view, P, heroTimes) {
      group.visible = true;
      const n = V(plan.normal);
      const wins = plan.windows.slice(0, MAX_WIN);
      nWin = wins.length;
      glow.count = beams.count = nWin;
      // 爆心に近い窓から先に割れる（割れる波が、壁に沿ってカメラの方へ走る）
      const dOf = (w) => Math.hypot(w.center[0], w.center[2]);
      const dMin = Math.min(...wins.map(dOf)), dMax = Math.max(...wins.map(dOf));
      const order = (w) => (dOf(w) - dMin) / Math.max(1, dMax - dMin);
      for (let i = 0; i < nWin; i++) {
        const w = wins[i];
        const c = V(w.center).addScaledVector(n, 0.06);
        const tb = P.breakAt[0] + (P.breakAt[1] - P.breakAt[0]) * (0.75 * order(w) + 0.25 * rng());
        winInfo.setXYZ(i, rng(), tb, w.w / w.h);
        _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        glow.setMatrixAt(i, _m.compose(c, _q, _s.set(w.w * 1.8, w.h * 1.8, 1)));
        // 光の筋: 窓から外へ、少し下向きに広がる
        const len = 5 + 7 * rng();
        _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().add(new THREE.Vector3(0, -0.12 - 0.1 * rng(), 0)).normalize());
        beams.setMatrixAt(i, _m.compose(c, _q, _s.set(w.w * 0.9, len, w.w * 0.9)));
      }
      winInfo.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      beams.instanceMatrix.needsUpdate = true;
      const cam = V(view.pos);
      // ガラス片: 窓から外へ吹き出す。三分の一はカメラの前（画面の中）へ、残りは壁の近くに浮く
      shards = [];
      for (let i = 0; i < counts.shards; i++) {
        const w = wins.length ? wins[Math.floor(rng() * wins.length)] : { center: [n.x * 20, 8, n.z * 20], w: 2, h: 2 };
        const s = V(w.center).add(new THREE.Vector3((rng() - 0.5) * w.w, (rng() - 0.5) * w.h, (rng() - 0.5) * w.w).multiply(new THREE.Vector3(Math.abs(n.z), 1, Math.abs(n.x))));
        const tb = P.breakAt[0] + (P.breakAt[1] - P.breakAt[0]) * (wins.length ? 0.75 * order(w) + 0.25 * rng() : rng());
        const flight = Math.max(0.05, P.contact - tb);
        let v;
        if (i % 3 === 0) {
          // 画面の中の、カメラから 1.2〜9 m の所で一拍を迎える
          const depth = 1.2 + 8 * rng() * rng();
          let x = (rng() - 0.5) * 2.2, y = (rng() - 0.5) * 2.0;
          if (depth < 4 && Math.abs(x) < 0.7 && Math.abs(y) < 0.6) x = Math.sign(x || 1) * (0.7 + 0.4 * rng()); // まん中（目のガラス片）を空ける
          const e = cam.clone().addScaledVector(V(view.fwd), depth).addScaledVector(V(view.right), x * depth * view.tanH).addScaledVector(V(view.up), y * depth * view.tanV);
          v = e.sub(s).divideScalar(flight);
        } else {
          v = n.clone().multiplyScalar(5 + 12 * rng()).add(new THREE.Vector3((rng() - 0.5) * 6, (rng() - 0.2) * 4, (rng() - 0.5) * 6));
        }
        const size = 0.08 + 0.4 * rng() * rng();
        shards.push({ s, v, tb, size, aspect: 0.45 + rng(), axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), spin: 4 + 14 * rng() });
      }
      // 目が映るガラス片: 上の階の窓から、カメラの前の止まる所へ
      const hw = wins.length ? wins.reduce((m, w) => (w.center[1] > m.center[1] - 0.1 && Math.abs(w.col - 1.5) < Math.abs(m.col - 1.5) + 0.5 ? w : m), wins[0]) : null;
      const hs = hw ? V(hw.center) : V(plan.look);
      heroPath = { s: hs, e: V(plan.shardPos), t0: heroTimes[0], t1: heroTimes[1], axis: new THREE.Vector3(0.4, 1, 0.25).normalize() };
      // 塵: カメラの前の空間（1〜16 m）に散らす
      const pos = moteGeo.attributes.position;
      for (let i = 0; i < counts.motes; i++) {
        const depth = 0.5 + 14 * rng() ** 2.2;
        const x = (rng() - 0.5) * 2.4, y = (rng() - 0.5) * 2.4;
        const p = cam.clone().addScaledVector(V(view.fwd), depth).addScaledVector(V(view.right), x * depth * view.tanH).addScaledVector(V(view.up), y * depth * view.tanV);
        pos.setXYZ(i, p.x, p.y, p.z);
        moteAttr.set([0.022 + 0.07 * rng() ** 3, 0.3 + 0.7 * rng() ** 2, rng() * 6.28, rng() * 6.28], i * 4);
      }
      pos.needsUpdate = true;
      moteGeo.attributes.aMote.needsUpdate = true;
    },
    // t: 演出の秒、P: 体感時間、light: 窓の光と光の筋の強さ 0〜1、reflect: 目の映り込みの強さ 0〜1、
    // facing: 目のガラス片が向く姿勢、pointScale: 1 m を画素へ直す係数、fade: 全体の消え方
    // front: 今の前線の半径（m）、camera: 今のカメラ
    update({ t, P, light, reflect, facing, pointScale, fade = 1, front = 10, camera }) {
      if (!heroPath) return;
      halo.position.set(0, front * 0.75, 0);
      if (camera) halo.quaternion.copy(camera.quaternion);
      halo.scale.setScalar(front * 3 + 30);
      haloUniforms.uI.value = 0.55 * (0.3 + 0.9 * light) * fade;
      haloUniforms.uP.value = P;
      glowUniforms.uLight.value = light * fade;
      glowUniforms.uP.value = P;
      moteUniforms.uP.value = P;
      moteUniforms.uLight.value = light * fade;
      moteUniforms.uScale.value = pointScale;
      for (const m of [small.material, hero.material]) {
        m.uniforms.uLight.value = light;
        m.uniforms.uFade.value = fade;
      }
      let vis = 0;
      for (let i = 0; i < shards.length; i++) {
        const S = shards[i];
        const dt = P - S.tb;
        if (dt <= 0) { small.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
        vis++;
        _p.copy(S.s).addScaledVector(S.v, dt);
        _p.y -= 4.9 * dt * dt;
        _q.setFromAxisAngle(S.axis, S.spin * dt);
        _s.set(S.size, S.size * S.aspect, 1);
        small.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      small.visible = vis > 0;
      small.instanceMatrix.needsUpdate = true;
      // 目のガラス片: 窓を離れ、回りながら飛び、カメラの前で向きをそろえて止まる（その後はほんの少し漂う）
      const u = (t - heroPath.t0) / (heroPath.t1 - heroPath.t0);
      hero.visible = u > 0;
      if (u > 0) {
        const k = 1 - (1 - Math.min(1, u)) ** 4;
        hero.position.copy(heroPath.s).lerp(heroPath.e, k);
        hero.position.y += Math.max(0, u - 1) * 0.02;
        const spin = (1 - k) * 9 + Math.max(0, u - 1) * 0.05;
        _q.setFromAxisAngle(heroPath.axis, spin);
        hero.quaternion.copy(_q).slerp(facing, THREE.MathUtils.smoothstep(u, 0.55, 1.0));
        _e.set(0.05 * Math.max(0, u - 1), -0.04 * Math.max(0, u - 1), 0.03 * Math.max(0, u - 1));
        hero.quaternion.multiply(_q.setFromEuler(_e));
      }
      hero.material.uniforms.uReflect.value = reflect;
    },
    hide() { group.visible = false; heroPath = null; },
  };
}
