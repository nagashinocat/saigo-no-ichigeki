import * as THREE from 'three';

// R1（spec §15「終盤に 1 体だけ来る大物」）: 大物のバイクの鼻先の探照灯。光の円錐（加算）と、地面に落ちる光の楕円。
// 来た直後（SEARCHLIGHT.arriveSec 秒）は大きく左右へ振って街を掃き（来たことを見せる）、そのあとは前の道を小さく振りながら照らし、
// 主人公に近づくと主人公へ向ける（掴んで回る間も主人公を照らし続ける）。見た目だけ（判定には使わない）

export const SEARCHLIGHT = {
  lamp: [0, 0.66, 1.2], // バイクの空間のレンズの位置（大物の大きさの倍率をかける前）
  reach: 30,            // m。前の道を照らす点までの水平の距離
  spread: 0.17,         // 円錐の先の半径 / 長さ
  // 来た直後: 主人公の方を中心に、主人公の先 arriveOver m まで届く光で左右に大きく掃く（上空の画面の広場を光が横切る。rad、rad/s）
  arriveSec: 3.2, arriveSwing: 0.55, arriveRate: 2.2, arriveOver: 12, arriveReach: [30, 80],
  swing: 0.32, rate: 1.1,
  heroDist: [34, 18],   // m。この距離で前の道 → 主人公へ向け変える
  color: [1.0, 0.92, 0.76],
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 光の向き（純粋な計算。テストで確かめる）。pose: bikePose の戻り値（x, y, z, yaw, pitch, roll, keep）、scale: 大物の大きさの倍率、
// age: 大物が来てからの秒、time: 見た目の時計（s）、dist: 大物の主人公からの水平の距離
// 返す値: origin（レンズの位置）、target（照らす点）、intensity（0〜）、arriving（来た直後か）
// heroPos: 主人公の位置 { x, z }（既定は原点。動く主人公の仕事が渡せる）
export function searchlightAim(pose, { scale = 1.6, age = 10, time = 0, dist = Infinity, heroPos = { x: 0, z: 0 } } = {}) {
  const S = SEARCHLIGHT;
  const e = new THREE.Euler(pose.pitch ?? 0, pose.yaw ?? 0, pose.roll ?? 0, 'YXZ');
  const o = new THREE.Vector3(...S.lamp).multiplyScalar(scale).applyEuler(e).add(new THREE.Vector3(pose.x, pose.y, pose.z));
  const arriving = age < S.arriveSec;
  let yaw, reach;
  if (arriving) {
    // 主人公の方（yaw 0 で +z）を中心に振り、主人公の少し先まで届く
    yaw = Math.atan2(heroPos.x - o.x, heroPos.z - o.z) + S.arriveSwing * Math.sin(age * S.arriveRate);
    reach = Math.min(S.arriveReach[1], Math.max(S.arriveReach[0], Math.hypot(heroPos.x - o.x, heroPos.z - o.z) + S.arriveOver));
  } else {
    yaw = (pose.yaw ?? 0) + S.swing * Math.sin(time * S.rate);
    reach = S.reach;
  }
  // 照らす地面の点: レンズから yaw の向きへ reach m
  const road = new THREE.Vector3(o.x + Math.sin(yaw) * reach, 0, o.z + Math.cos(yaw) * reach);
  const toHero = arriving ? 0 : smooth(S.heroDist[0], S.heroDist[1], dist);
  const hero = new THREE.Vector3(heroPos.x, 1.1, heroPos.z);
  const target = road.lerp(hero, toHero);
  const intensity = (arriving ? 1 + 0.6 * (1 - smooth(0, S.arriveSec, age)) : 1) * smooth(0, 0.35, age) * (pose.keep ?? 1);
  return { origin: o, target, intensity, arriving, toHero };
}

const BEAM_VERT = /* glsl */`
varying float vAlong;
varying vec3 vN, vW;
void main() {
  vAlong = 1.0 - uv.y; // 0: レンズ, 1: 先
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BEAM_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uI;
varying float vAlong;
varying vec3 vN, vW;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float side = abs(dot(normalize(vN), V)); // 円錐の芯（正面を向いた面）ほど濃く、縁はやわらかく消える
  float a = pow(1.0 - vAlong, 1.3) * smoothstep(0.0, 0.5, side) * smoothstep(0.0, 0.04, vAlong) * uI * 0.32;
  if (!(a >= 0.002)) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const SPOT_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uI;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.25, 1.0, r)) * uI * 0.5;
  if (!(a >= 0.002)) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// group: 足す先。update(boss, time, dt): boss は { e, b }（enemies の一人と bikePose）か null
export function createSearchlight(group) {
  const color = new THREE.Color(...SEARCHLIGHT.color);
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const cone = new THREE.CylinderGeometry(0.02, 1, 1, 28, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
  const beam = new THREE.Mesh(cone, new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uI: { value: 0 } }, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, side: THREE.DoubleSide, ...add,
  }));
  beam.name = 'boss-searchlight';
  beam.frustumCulled = false;
  beam.renderOrder = 3;
  beam.visible = false;
  const spot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uI: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SPOT_FRAG, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...add,
  }));
  spot.name = 'boss-searchlight-spot';
  spot.frustumCulled = false;
  spot.renderOrder = 2;
  spot.visible = false;
  group.add(beam, spot);
  let bornId = null, bornAt = 0;
  return {
    beam, spot,
    // その場のリトライ（restartRound）: 大物の「現れた瞬間」を忘れる（新しい一回の大物も来た直後の掃きから。読み直したページと同じ）
    reset() { bornId = null; bornAt = 0; beam.visible = spot.visible = false; },
    // heroPos: 主人公の位置 { x, z }（既定は原点）
    update(boss, time, heroPos = { x: 0, z: 0 }) {
      const on = !!boss && boss.e.state !== 'dead';
      beam.visible = spot.visible = on;
      if (!on) return null;
      if (bornId !== boss.e.id) { bornId = boss.e.id; bornAt = time; }
      const dist = boss.e.x != null ? Math.hypot(boss.e.x - heroPos.x, boss.e.z - heroPos.z) : boss.e.dist ?? Infinity;
      const aim = searchlightAim(boss.b, { scale: boss.scale ?? 1.6, age: time - bornAt, time, dist, heroPos });
      const len = aim.origin.distanceTo(aim.target);
      beam.position.copy(aim.origin);
      beam.lookAt(aim.target);
      beam.scale.set(len * SEARCHLIGHT.spread, len * SEARCHLIGHT.spread, len);
      beam.material.uniforms.uI.value = aim.intensity;
      // 地面の光の楕円（主人公へ向けた間は消える）
      const r = len * SEARCHLIGHT.spread * 1.4;
      spot.position.set(aim.target.x, 0.08, aim.target.z);
      spot.rotation.y = Math.atan2(aim.target.x - aim.origin.x, aim.target.z - aim.origin.z);
      spot.scale.set(r * 1.6, 1, r * 2.6);
      spot.material.uniforms.uI.value = aim.intensity * (1 - aim.toHero);
      return aim;
    },
  };
}
