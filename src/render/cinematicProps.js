import * as THREE from 'three';
import { createRng } from '../rng.js';

// 放つ瞬間の演出の小道具: 両手の間の光、広場のまわりの窓から吹き飛んで飛んでくるガラス片、目が映るガラス片・バイザー片・水たまり、
// 一拍の間に画面の周りを沈める幕。
// 動きはすべて「演出の時計」c で決まる（0 で白が晴れ、0.94 で一拍の始まり、1 で一拍の終わり、それより先は通り過ぎる）。
// 一拍の間は c がほとんど進まないので、破片は宙に止まって見える。

const SMALL_SHARDS = 44;
const HERO_SIZE = { glass: [0.95, 0.62], visor: [1.0, 0.44], puddle: [3.4, 2.1] };

const SHARD_VERT = /* glsl */`
attribute float aEdge;
varying vec2 vUv;
varying vec3 vN, vW;
varying float vEdge;
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
uniform float uReflect, uRipple, uFade;
uniform vec3 uTint, uSunDir, uBase;
varying vec2 vUv;
varying vec3 vN, vW;
varying float vEdge;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  if (dot(N, V) < 0.0) N = -N;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 R = reflect(-V, N);
  // 夕方の空と夕日を映す
  vec3 sky = mix(vec3(1.0, 0.55, 0.36), vec3(0.2, 0.25, 0.55), smoothstep(-0.1, 0.6, R.y));
  sky += vec3(1.0, 0.72, 0.45) * pow(max(dot(R, uSunDir), 0.0), 20.0) * 4.0;
  #ifdef PUDDLE
  // 水たまりは夕方の地平の明るい空を映し、暗い道路から浮き上がる
  // 中は暗く、縁へ向かって明るい地平の空を映す帯
  vec3 warm = mix(vec3(1.0, 0.58, 0.42), vec3(0.62, 0.5, 0.85), smoothstep(0.3, 0.95, R.y));
  vec3 col = uBase + warm * mix(1.1, 0.06, smoothstep(0.12, 0.55, vEdge));
  #else
  vec3 col = uBase + sky * (0.12 + 0.75 * fres);
  #endif
  float a = mix(0.35, 0.9, fres);
  #ifdef EYE
  vec2 e = vec2(1.0 - vUv.x, vUv.y);
  #ifdef PUDDLE
  // 水たまり: 弾けた衝撃の輪が広がり（一拍の間はほぼ止まる）、映った像をゆらす
  vec2 q = (vUv - 0.5) * vec2(1.7, 1.0);
  float d = length(q);
  e += q / max(d, 1e-3) * sin(d * 70.0 - uRipple * 40.0) * 0.006 * exp(-d * 2.0);
  e = (e - 0.5) * vec2(1.25, 0.8) + 0.5; // 目の像は水たまりのまん中に（斜めから見て縦に縮むぶん、縦に伸ばす）
  vec2 ec = abs(e - 0.5) * 2.0;
  float inPic = 1.0 - smoothstep(0.5, 0.85, length(ec * vec2(0.8, 1.25)));
  #else
  float inPic = 1.0;
  #endif
  vec3 eye = texture2D(tEye, clamp(e, 0.0, 1.0)).rgb;
  col = mix(col, uBase * 0.5 + eye * uTint, uReflect * inPic * (1.0 - 0.35 * fres));
  a = mix(a, 0.96, uReflect);
  #ifndef PUDDLE
  // ひび（目の像の上を一本走る）
  vec2 c1 = vUv - vec2(0.62, 0.4);
  float crack = (1.0 - smoothstep(0.0, 0.004, abs(dot(c1, normalize(vec2(0.8, -0.6)))))) * step(0.0, c1.x);
  col += vec3(1.0, 0.92, 0.8) * crack * 0.8;
  #endif
  #endif
  // 割れた縁が光る（水たまりは縁を溶かす）
  #ifdef PUDDLE
  a *= smoothstep(0.0, 0.1, vEdge);
  #else
  float edge = 1.0 - smoothstep(0.0, 0.07, vEdge);
  col += vec3(1.0, 0.88, 0.7) * edge * 1.8;
  a = max(a, edge);
  #endif
  gl_FragColor = vec4(col * uFade, a * uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 一拍の間、画面の周りを暗く沈める幕（カメラのすぐ前に置く。目の板と破片はこの後に描く）
const DIM_FRAG = /* glsl */`
uniform float uDim, uAspect;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float v = smoothstep(0.25, 0.85, length(q) / max(1.0, uAspect * 0.6));
  gl_FragColor = vec4(0.01, 0.01, 0.03, uDim * (0.55 + 0.4 * v));
}`;

const POP_FRAG = /* glsl */`
uniform float uI;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float core = exp(-d * d * 10.0), halo = exp(-d * 3.5) * (1.0 - smoothstep(0.85, 1.0, d));
  vec3 col = vec3(1.0, 0.95, 0.85) * core * 4.0 + vec3(1.0, 0.62, 0.3) * halo * 1.2;
  gl_FragColor = vec4(col * uI, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 割れたガラスの形: 中心から外へ伸びる扇（aEdge は縁で 0、中心で 1）。uv は外接する箱で 0〜1
// smooth: 角ばらず、ゆるく波打つ縁（水たまり）
function shardGeometry(rng, w, h, sides = 7, curve = 0, smooth = false) {
  const pos = [0, 0, 0], uv = [0.5, 0.5], edge = [1];
  const pts = [];
  const k = [rng() * 6, rng() * 6, rng() * 6];
  for (let i = 0; i < sides; i++) {
    const a = smooth ? (i / sides) * Math.PI * 2 : (i / sides) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const r = smooth ? 0.82 + 0.1 * Math.sin(2 * a + k[0]) + 0.06 * Math.sin(3 * a + k[1]) + 0.04 * Math.sin(5 * a + k[2]) : 0.62 + 0.38 * rng();
    pts.push([Math.cos(a) * r * w / 2, Math.sin(a) * r * h / 2]);
  }
  for (const [x, y] of pts) {
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

// バイザー片: 横長に曲がった帯（格子。aEdge は縁からの近さ）
function visorGeometry(w, h) {
  const g = new THREE.PlaneGeometry(w, h, 16, 4);
  const p = g.attributes.position, uv = g.attributes.uv;
  const edge = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), u = uv.getX(i), v = uv.getY(i);
    p.setZ(i, -0.22 * (x * x) / (w * w / 4));
    // 片側がぎざぎざに割れている
    if (u > 0.8) p.setY(i, p.getY(i) * (1 - (u - 0.8) * 1.6 * (0.5 + 0.5 * Math.sin(v * 17))));
    edge[i] = Math.min(u, 1 - u, v, 1 - v) * 2;
  }
  g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  g.computeVertexNormals();
  return g;
}

export function createCinematicProps(scene, eyeTexture, { sunDir = new THREE.Vector3(0.8, 0.42, -0.45).normalize() } = {}) {
  const group = new THREE.Group();
  group.name = 'cinematicProps';
  group.visible = false;
  scene.add(group);
  const rng = createRng(0xc1e7a);

  const common = () => ({
    tEye: { value: eyeTexture }, uReflect: { value: 0 }, uRipple: { value: 0 }, uFade: { value: 1 },
    uTint: { value: new THREE.Color(1, 1, 1) }, uSunDir: { value: sunDir.clone() }, uBase: { value: new THREE.Color(0.02, 0.03, 0.04) },
  });
  const shardMat = (defines) => new THREE.ShaderMaterial({
    uniforms: common(), vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, defines,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });

  // 目が映る板（種類ごと）
  const heroes = {
    glass: new THREE.Mesh(shardGeometry(rng, ...HERO_SIZE.glass, 7), shardMat({ EYE: '' })),
    visor: new THREE.Mesh(visorGeometry(...HERO_SIZE.visor), shardMat({ EYE: '' })),
    puddle: new THREE.Mesh(shardGeometry(rng, ...HERO_SIZE.puddle, 40, 0, true).rotateX(-Math.PI / 2), shardMat({ EYE: '', PUDDLE: '' })),
  };
  heroes.visor.material.uniforms.uTint.value.setRGB(1.0, 0.72, 0.42);
  heroes.visor.material.uniforms.uBase.value.setRGB(0.03, 0.02, 0.01);
  heroes.puddle.material.uniforms.uTint.value.setRGB(0.8, 0.85, 0.95);
  heroes.puddle.material.uniforms.uBase.value.setRGB(0.012, 0.014, 0.02);
  for (const m of Object.values(heroes)) { m.frustumCulled = false; m.renderOrder = 21; m.visible = false; group.add(m); }

  // 飛んでくる小さなガラス片
  const smallGeo = shardGeometry(rng, 1, 1, 5);
  const small = new THREE.InstancedMesh(smallGeo, shardMat({}), SMALL_SHARDS);
  small.frustumCulled = false;
  small.renderOrder = 21;
  group.add(small);

  // 小さく弾けた光
  const pop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: POP_FRAG, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  }));
  pop.frustumCulled = false;
  pop.renderOrder = 21;
  group.add(pop);

  const dim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { uDim: { value: 0 }, uAspect: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: DIM_FRAG, transparent: true, depthTest: false, depthWrite: false,
  }));
  dim.frustumCulled = false;
  dim.renderOrder = 20;
  group.add(dim);
  const _fwd = new THREE.Vector3();

  const V = (a) => new THREE.Vector3().fromArray(a);
  let plan = null, hero = null, popPos = new THREE.Vector3(), paths = [], heroPath = null;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

  // 弾けた所から e へ。c=1 で e に着き、その先は同じ向きに通り過ぎる
  function along(path, c, out) {
    if (c <= 1) {
      const k = 1 - (1 - c) * (1 - c);
      return out.copy(path.s).lerp(path.e, k);
    }
    return out.copy(path.e).addScaledVector(path.dir, (c - 1) * path.exit);
  }

  return {
    group,
    get heroMesh() { return hero; },
    // 演出の始まりに: 両手の光（主人公の前）と、破片の出どころ（広場のまわりの窓）と行き先（一拍のカメラの前）を決める。
    // view = 一拍のカメラの { fwd, right, up, tanH, tanV }
    setup(p, view) {
      plan = p;
      group.visible = true;
      for (const m of Object.values(heroes)) m.visible = false;
      hero = heroes[p.reflector.type];
      hero.visible = true;
      const cam = V(p.camPos);
      const f = V(p.path.forward), o = V(p.path.origin);
      popPos.copy(o).addScaledVector(f, 0.55).add(new THREE.Vector3(0, -0.25, 0));
      const back = f.clone().negate();
      const source = () => o.clone().addScaledVector(back, 6 + 14 * rng())
        .add(new THREE.Vector3((rng() - 0.5) * 24, 2 + 16 * rng(), (rng() - 0.5) * 24));
      paths = [];
      for (let i = 0; i < SMALL_SHARDS; i++) {
        const depth = 1.2 + 14 * rng() * rng();
        let x = (rng() - 0.5) * 2.6, y = (rng() - 0.5) * 2.4;
        // 手前の破片は画面のまん中（目の板の所）を空ける
        if (depth < 8 && Math.abs(x) < 0.9 && Math.abs(y) < 0.8) x = Math.sign(x || 1) * (0.9 + 0.4 * rng());
        const e = cam.clone().addScaledVector(view.fwd, depth)
          .addScaledVector(view.right, x * depth * view.tanH)
          .addScaledVector(view.up, y * depth * view.tanV);
        const s = source();
        const size = 0.12 + 0.45 * rng() * rng();
        paths.push({ s, e, dir: e.clone().sub(s).normalize(), exit: 10 + 10 * rng(), size, axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), spin: 6 + 14 * rng(), aspect: 0.5 + rng() });
      }
      const re = V(p.reflector.pos);
      heroPath = { s: o.clone().addScaledVector(back, 8).add(new THREE.Vector3(0, 6, 0)), e: re, exit: 14, axis: new THREE.Vector3(0.3, 1, 0.2).normalize(), spin: 9 };
      heroPath.dir = re.clone().sub(heroPath.s).normalize();
      if (p.reflector.type === 'puddle') {
        hero.position.copy(re);
        const away = re.clone().sub(cam).setY(0).normalize();
        hero.rotation.set(0, Math.atan2(-away.x, -away.z), 0);
      }
    },
    // c: 演出の時計、facing: 一拍の間に目の板が向く姿勢（カメラの向き）、reflect: 目の映り込みの強さ、popI: 弾けた光の強さ、
    // dimK: 画面の周りを沈める強さ
    update(c, { facing, reflect, popI, camera, dimK = 0 }) {
      if (!plan) return;
      dim.visible = dimK > 0.001;
      if (dim.visible) {
        const d = camera.near * 1.5, hh = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.05;
        dim.position.copy(camera.position).addScaledVector(camera.getWorldDirection(_fwd), d);
        dim.quaternion.copy(camera.quaternion);
        dim.scale.set(hh * camera.aspect, hh, 1);
        dim.material.uniforms.uDim.value = dimK;
        dim.material.uniforms.uAspect.value = camera.aspect;
      }
      const flying = c > 0;
      small.visible = flying;
      for (let i = 0; i < paths.length; i++) {
        const P = paths[i];
        along(P, c, _p);
        _q.setFromAxisAngle(P.axis, P.spin * c);
        _s.set(P.size, P.size * P.aspect, 1);
        small.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      small.instanceMatrix.needsUpdate = true;
      const u = hero.material.uniforms;
      u.uReflect.value = reflect;
      u.uRipple.value = Math.max(0, c);
      if (plan.reflector.type !== 'puddle') {
        hero.visible = flying;
        along(heroPath, c, hero.position);
        // 飛ぶ間は回り、一拍に近づくとカメラの方を向いて止まる
        _q.setFromAxisAngle(heroPath.axis, heroPath.spin * (c - 0.94));
        const w = THREE.MathUtils.smoothstep(c, 0.6, 0.93) * (1 - THREE.MathUtils.smoothstep(c, 1.0, 1.25));
        _q2.copy(facing);
        hero.quaternion.copy(_q).slerp(_q2, w);
      }
      pop.visible = popI > 0.001;
      pop.position.copy(popPos);
      pop.quaternion.copy(camera.quaternion);
      const size = 2 + 6 * Math.min(1, Math.max(0, c) * 1.6);
      pop.scale.set(size, size, 1);
      pop.material.uniforms.uI.value = popI;
    },
    hide() { group.visible = false; plan = null; },
  };
}
