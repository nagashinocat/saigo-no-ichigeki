import * as THREE from 'three';
import { createHeroBodyBuilder, skinPose } from './heroBody.js';
import { INTRO, BIKE_CAM, introBikes, bikeAt, introStreaks, streakAt, introHands, whooshAt, introShake, heroPath, LIGHT_SHOT, HIDE_SHOT, LIGHT_BIKES, lightBikeAt } from './introTimeline.js';

// 導入のアニメーション（S6）の 3D の拍: 1 バイク・3 ライト・5 隠れる・6 手。カード・白・題字は画面の上の 2D（introOverlay.js）。
// 画面全体を一つのカメラで描く（views.renderFull。high/mid は光のにじみ・動きのぶれ・粒子、low はそのまま）。
// 街は S7/S8 の夕方の九龍城×ネオン街（cityView。近いカメラなので setCloseView で壁の飾りを出す）、バイクは軍勢と同じ
// 浮遊バイク（enemyView の extra）、主人公は heroBody の体（走る・すくむを骨の回転で動かす）、手は S10 の手（handView）。
// 時刻 t（導入の秒）を渡すと、その瞬間の絵を決める（手の拍だけは手の動きを決まった刻みで積み上げる。巻き戻すと最初から）。

// 撮る場所（街の座標。道路の格子の中心線の上なので建物に埋まらない）。sx, sz: カメラの足元、yaw: 通りの奥（ローカルの -z）の向き
// 1: 外へ伸びる長い通り（奥の高い塔へ向かって見上げる）。3: 別の通り。5: 広場（爆心）のすぐ横の路地から、広場を囲む道の開口部を見る
const SITES = {
  bikes: [{ sx: 39, sz: -52, yaw: 0 }, { sx: -39, sz: -52, yaw: 0 }, { sx: 65, sz: -52, yaw: 0 }],
  light: [{ sx: -44, sz: -65, yaw: Math.PI / 2 }, { sx: -44, sz: 65, yaw: Math.PI / 2 }, { sx: 44, sz: -65, yaw: -Math.PI / 2 }],
  // S6 fix1: 主人公が身を潜める所（HIDE.to）は広場（爆心）の縁: 広場の横の道（x = 13）の、広場を囲む道との角（中心から約 15 m）。
  // カメラは広場の側から外を見る（開口部の向こうは外へ伸びるネオンの通り）。主人公はこの所から浮き上がって広場の上で放つ
  hide: [{ sx: 13 - HIDE_SHOT.to[0], sz: -8 - HIDE_SHOT.to[1], yaw: 0 }],
};
// 3: 主人公とバイク（ローカル）。主人公は奥から歩いてきてすくみ、右へ走り去る。バイクは奥で向きを変え、ライトが主人公をなめる
const LIGHT = LIGHT_SHOT;
// 5: すき間（ローカル）。開口部の奥行き、主人公が走り込む道すじ、カメラ
// 隠れる場所は、ビルとビルの間の幅 GAP.half × 2 m のすき間（路地の中に壁を 2 枚建てる。開口部の向こうは広場を囲む道）
const HIDE = HIDE_SHOT;
const GAP = { half: 1.32, z0: 4, h: 26 };
// 6: 手のアップ（手の場面のカメラを寄せる）
const HANDS_CAM = { pos: [0, 2.45, 3.05], look: [0, 0.05, 0], fov: 46 };
const HEAD_GREEN = new THREE.Color(0.82, 1.0, 0.88);

// 主人公の導入の体: 力を抜いて立った姿で組み、走る・すくむ・壁にもたれるは骨の回転（skinPose）で重ねる
const STAND = Object.freeze({
  lift: null,
  spine: [0.04, 0, 0], neck: [0.04, 0, 0],
  'upperArm.L': [0, 0, 0.14], 'foreArm.L': [-0.25, 0, 0], 'upperArm.R': [0, 0, -0.14], 'foreArm.R': [-0.25, 0, 0],
});

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3;
const mixA = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// 骨の回転: 走る（位相 ph。ph = π/2 で左足が前に着く）
function runRot(ph, k = 1) {
  const s = Math.sin(ph), c = Math.cos(ph);
  const knee = (x) => 0.25 + 1.1 * Math.max(0, x);
  return {
    spine: [0.26 * k, 0.08 * s * k, 0], chest: [0.05 * k, -0.18 * s * k, 0], head: [-0.12 * k, 0.1 * s * k, 0],
    'thigh.L': [-0.85 * s * k, 0, 0], 'shin.L': [knee(-c) * k, 0, 0], 'foot.L': [0.2 * k, 0, 0],
    'thigh.R': [0.85 * s * k, 0, 0], 'shin.R': [knee(c) * k, 0, 0], 'foot.R': [0.2 * k, 0, 0],
    'upperArm.L': [0.75 * s * k, 0, 0.1 * k], 'foreArm.L': [-1.25 * k, 0, 0],
    'upperArm.R': [-0.75 * s * k, 0, -0.1 * k], 'foreArm.R': [-1.25 * k, 0, 0],
  };
}
// すくむ: 右腕で顔をかばい、体をひねって背を丸め、膝を折る（k 0〜1）
function flinchRot(k) {
  return {
    spine: [0.32 * k, -0.25 * k, 0], chest: [0.2 * k, -0.2 * k, 0], neck: [0.25 * k, 0, 0], head: [0.3 * k, -0.6 * k, 0.1 * k],
    'upperArm.R': [-1.9 * k, 0.2 * k, -0.35 * k], 'foreArm.R': [-1.9 * k, 0, 0],
    'upperArm.L': [-0.6 * k, 0, 0.35 * k], 'foreArm.L': [-1.6 * k, 0, 0],
    'thigh.L': [-0.45 * k, 0, 0.05 * k], 'shin.L': [0.8 * k, 0, 0], 'thigh.R': [-0.15 * k, 0, -0.05 * k], 'shin.R': [0.55 * k, 0, 0],
  };
}
// 壁に背を預けて息をつく（breath: 呼吸の位相）。顔は開口部へ向ける
function hideRot(breath, k) {
  const b = Math.sin(breath) * 0.04;
  return {
    spine: [(-0.08 + b) * k, 0, 0], chest: [(0.06 + b) * k, 0, 0], head: [0.05 * k, -0.85 * k, 0],
    'upperArm.L': [0.15 * k, 0, 0.22 * k], 'foreArm.L': [-0.4 * k, 0, 0], 'upperArm.R': [-0.35 * k, 0, -0.25 * k], 'foreArm.R': [-1.1 * k, 0, 0],
    'thigh.L': [-0.35 * k, 0, 0.1 * k], 'shin.L': [0.6 * k, 0, 0], 'thigh.R': [-0.2 * k, 0, -0.08 * k], 'shin.R': [0.4 * k, 0, 0],
  };
}
// 骨の回転の一覧どうしが同じか（同じ骨・同じ値。物を作らずに比べる）
export function sameRot(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  let n = 0;
  for (const k in a) {
    n++;
    const x = a[k], y = b[k];
    if (x === y) continue;
    if (!x || !y || x[0] !== y[0] || x[1] !== y[1] || x[2] !== y[2]) return false;
  }
  for (const k in b) n--;
  return n === 0;
}
function addRot(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = o[k] ? [o[k][0] + v[0], o[k][1] + v[1], o[k][2] + v[2]] : v;
  return o;
}

// 柱の足元が撮る範囲（ローカルの x ±hw、z が z0〜z1）に入らない最初の場所
function pickSite(cands, pillars, hw, z0, z1) {
  for (const s of cands) {
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const blocked = pillars.some((p) => {
      const dx = p.x - s.sx, dz = p.z - s.sz;
      // ワールド → ローカル（yaw の逆回し）
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      return Math.abs(lx) < hw && lz > z0 && lz < z1;
    });
    if (!blocked) return s;
  }
  return cands[0];
}

// 光の帯・光の円錐・まぶしさの板の材質（加算）
const CONE_VERT = /* glsl */`
varying float vAx; varying vec3 vN, vV;
void main() {
  vAx = uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CONE_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uK, uCore;
varying float vAx; varying vec3 vN, vV;
void main() {
  // uCore が大きいほど、光の帯の芯（円錐の真ん中を見通す所）だけが明るい（硬いスポットライト）
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4 + uCore);
  float ax = clamp(vAx, 0.0, 1.0); // 補間で 0〜1 をわずかに外れると pow が NaN になり、光のにじみが画面全体を黒くする
  float along = pow(1.0 - ax, 1.7) * smoothstep(0.0, 0.04, ax);
  float a = edge * along * uK;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
// 地面の光の溜まりと、主人公の長い影（ライトの拍）
const POOL_VERT = /* glsl */`
varying vec3 vW;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
// ライトは最大 POOL_N 個（バイクの拍は一台ごと、ライトの拍は 1 個で主人公の影つき）
const POOL_N = 6;
const POOL_FRAG = /* glsl */`
#define N ${POOL_N}
uniform vec3 uLamp[N], uDir[N]; uniform float uK[N];
uniform vec3 uColor, uFoot; uniform float uCos, uHeroH, uShadow;
varying vec3 vW;
float segDist(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0); return length(p - a - ab * h); }
void main() {
  float a = 0.0;
  for (int i = 0; i < N; i++) {
    if (uK[i] <= 0.0) continue;
    vec3 L = vW - uLamp[i];
    float d = max(length(L), 1e-3);
    // 縁の幅は開きに比べて決める（細いスポットライトでも、くっきりした丸い光の溜まり）
    float cone = smoothstep(uCos, uCos + (1.0 - uCos) * 0.25, dot(L / d, uDir[i]));
    float fall = 1.0 / (1.0 + d * d / 180.0);
    float shade = 1.0;
    if (uShadow > 0.0) {
      // 影: 足元から、頭をライトから地面へ映した点まで（ライトが頭より高いとき）。ライトごとに一つ（足元から扇に広がる）
      vec3 head = uFoot + vec3(0.0, uHeroH, 0.0);
      float k = uLamp[i].y / max(0.05, uLamp[i].y - head.y);
      vec3 tip = uLamp[i] + (head - uLamp[i]) * min(k, 30.0);
      float sd = segDist(vW.xz, uFoot.xz, tip.xz);
      float along = clamp(length(vW.xz - uFoot.xz) / max(0.1, length(tip.xz - uFoot.xz)), 0.0, 1.0);
      shade = 1.0 - 0.96 * uShadow * (1.0 - smoothstep(0.2 + 0.35 * along, 0.32 + 0.6 * along, sd));
    }
    a += cone * fall * shade * uK[i];
  }
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
// 加算の帯（光の筋・推進の光の長い尾・壁の照り返し）: uv.x が長さの向き、uv.y が幅の向き
const BAND_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BAND_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uK, uHead, uSoft;
varying vec2 vUv;
void main() {
  vec2 q = clamp(vUv, 0.0, 1.0);
  float w = clamp(1.0 - smoothstep(0.0, 1.0, abs(q.y - 0.5) * 2.0), 0.0, 1.0);
  w = pow(w, uSoft);
  // uHead: 明るい頭の位置（0 なら一様、1 なら uv.x = 1 が頭で後ろへ消える）
  float along = mix(1.0, pow(q.x, 2.2), uHead);
  float a = w * along * uK;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

function glareTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.08, 'rgba(235,255,240,0.85)');
  r.addColorStop(0.3, 'rgba(160,255,200,0.22)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  // 横に伸びるレンズの光（アナモルフィック）
  const h = g.createLinearGradient(0, 0, 256, 0);
  h.addColorStop(0, 'rgba(120,200,255,0)');
  h.addColorStop(0.5, 'rgba(220,250,255,0.9)');
  h.addColorStop(1, 'rgba(120,200,255,0)');
  g.fillStyle = h;
  g.fillRect(0, 124, 256, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 6: 手の拍を拍の中の秒 local まで進める（handView を決まった刻みで。local が戻ったら構えから積み直す）。
// 放つ瞬間（INTRO.hands.releaseAt）に最後の一発と同じ握り込み（S10 の鷲掴み）を起こし、カメラを画面全体の縦横比 aspect で寄せる。
// state: { t, released }（{ t: -1 } で始める）。テスト（ハートに見えないか）も同じ関数で動かす
const HAND_DT = 1 / 60;
const _hd = new THREE.Vector3();
export function introHandsTo(hand, state, local, aspect) {
  hand.resize(aspect); // 両手の指先が横で切れない画角と、目の位置へ
  hand.setFlashScale(INTRO.hands.flash); // 握り込んだ鉤爪と、指の間から漏れる芯の光を見せる（閃光で白く飛ばさない）
  hand.setShakeScale?.(0); // R1b: 握り込みの震えで画面が揺れて見えないように
  if (state.t < 0 || local < state.t - 1e-6) { hand.reset(); state.t = 0; state.released = false; }
  while (state.t < local - 1e-9) {
    const d = Math.min(HAND_DT, local - state.t);
    if (!state.released && state.t + d >= INTRO.hands.releaseAt) {
      // 放つ瞬間まで進めてから握り込む
      const pre = INTRO.hands.releaseAt - state.t;
      if (pre > 0) { const h = introHands(state.t + pre * 0.5); hand.update(pre, h.level, h.active, 1); }
      hand.release({ amount: 100, isBig: true });
      state.released = true;
      const post = d - pre;
      if (post > 0) hand.update(post, 0, false, 1);
    } else {
      const h = introHands(state.t + d);
      hand.update(d, h.level, h.active, 1);
    }
    state.t += d;
  }
  const c = hand.camera;
  // 貯め始めはゆっくり寄り、握り込む瞬間に強く寄る（目の位置から、見る向きへ進む）
  const k = smooth(local / 2.2), g = smooth((local - INTRO.hands.releaseAt) / 0.3);
  c.getWorldDirection(_hd);
  c.position.addScaledVector(_hd, 0.35 * k + 0.2 * g);
  c.fov *= 1 - 0.04 * k;
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
}

export function createIntro({ views, scene, cityView, enemyView, heroAura, patrolGlow, hand, city, tier = 'high', getTier = () => tier, seed = 1 }) {
  const pillars = city.transit?.pillars ?? [];
  const site = {
    bikes: pickSite(SITES.bikes, pillars, 8, -260, 12),
    light: pickSite(SITES.light, pillars, 8, -60, 6),
    hide: pickSite(SITES.hide, pillars, 6, -26, 4),
  };
  const toWorld = (s, x, y, z, out = new THREE.Vector3()) => {
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    return out.set(s.sx + x * c + z * sn, y, s.sz - x * sn + z * c);
  };
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
  const group = new THREE.Group();
  group.name = 'intro';
  group.visible = false;
  scene.add(group);

  // 光の円錐（バイクのライト。先から開く。長さ 1 の単位円錐を、向きと長さで置く）
  const coneGeo = new THREE.CylinderGeometry(0.06, 1, 1, 28, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
  // uv.y: 円錐の付け根 0 → 先 1（CylinderGeometry の uv.y は上 1 → 下 0。回したので先が -z → +z へ）
  const coneMat = () => new THREE.ShaderMaterial({ uniforms: { uColor: { value: HEAD_GREEN.clone() }, uK: { value: 0 }, uCore: { value: 0 } }, vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  {
    const uv = coneGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  }
  const glareTex = glareTexture();
  const lamps = Array.from({ length: 7 }, () => {
    const cone = new THREE.Mesh(coneGeo, coneMat());
    cone.frustumCulled = false;
    cone.renderOrder = 5;
    const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false }));
    glare.renderOrder = 6;
    // 推進の光の長い尾（水平と縦の 2 枚）
    const bandMat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(0.5, 1.0, 0.75) }, uK: { value: 0 }, uHead: { value: 1 }, uSoft: { value: 1.6 } }, vertexShader: BAND_VERT, fragmentShader: BAND_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const tail = new THREE.Group();
    const h = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), bandMat);
    const v = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2), bandMat);
    tail.add(h, v);
    for (const m of [h, v]) { m.frustumCulled = false; m.renderOrder = 4; }
    group.add(cone, glare, tail);
    return { cone, glare, tail, bandMat };
  });
  const hideLamps = () => { for (const l of lamps) { l.cone.visible = l.glare.visible = l.tail.visible = false; } };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _l = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1);
  // ライト: 位置 p（ワールド）、向き dir（ワールド、単位）、長さ len、開き half（rad）、強さ k
  function setLamp(l, p, dir, len, half, k, glareK, core = 0) {
    l.cone.material.uniforms.uCore.value = core;
    // カメラが光の円錐の中・すぐ近くにいるときは円錐を薄く（内側の面が画面を覆って白い板に見えない）。まぶしさの板が受け持つ
    _l.copy(cam.position).sub(p);
    const camDist = _l.length(), camAng = Math.acos(Math.min(1, Math.max(-1, _l.dot(dir) / Math.max(1e-6, camDist))));
    k *= smooth((camDist - 5) / 14) * (0.15 + 0.85 * smooth((camAng - half * 0.9) / (half * 1.2)));
    l.cone.visible = k > 0.002;
    l.cone.position.copy(p);
    l.cone.quaternion.setFromUnitVectors(_z, dir);
    const r = Math.tan(half) * len;
    l.cone.scale.set(r, r, len);
    l.cone.material.uniforms.uK.value = k;
    // まぶしさ: ライトがカメラを向くほど大きく明るい
    _l.copy(cam.position).sub(p);
    const dist = _l.length();
    const facing = smooth((_l.normalize().dot(dir) - Math.cos(half * 1.6)) / (1 - Math.cos(half * 1.6)));
    const g = glareK * (0.3 + 0.7 * facing);
    l.glare.visible = g > 0.01;
    l.glare.position.copy(p).addScaledVector(dir, 0.15);
    // 画面の高さに対する大きさ（遠くても小さくなりすぎず、向いた瞬間だけ大きく）
    const s = (0.035 + 0.2 * facing ** 3) * 2 * Math.max(dist, 0.5) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * Math.min(1, glareK);
    l.glare.scale.set(s * 2.4, s, 1);
    l.glare.material.opacity = Math.min(1, g);
    return facing;
  }
  // 尾: 付け根 p から、向き back（ワールド、単位）へ長さ len
  function setTail(l, p, back, len, k) {
    // カメラのすぐ近く（頭上を抜ける瞬間）では消す（帯の面が画面を覆って白く飛ばない）
    const along = Math.min(len, Math.max(0, _l.copy(cam.position).sub(p).dot(back)));
    _l.copy(p).addScaledVector(back, along);
    k *= smooth((_l.distanceTo(cam.position) - 1.5) / 5);
    l.tail.visible = k > 0.002;
    l.tail.position.copy(p).addScaledVector(back, len / 2);
    l.tail.quaternion.setFromUnitVectors(_z, _b.copy(back).negate());
    l.tail.scale.set(0.55, 0.55, len);
    l.bandMat.uniforms.uK.value = k;
  }

  // 地面の光の溜まり（ライトの拍）
  const poolU = {
    uLamp: { value: Array.from({ length: POOL_N }, () => new THREE.Vector3()) }, uDir: { value: Array.from({ length: POOL_N }, () => new THREE.Vector3(0, 0, 1)) },
    uK: { value: new Array(POOL_N).fill(0) }, uColor: { value: HEAD_GREEN.clone().multiplyScalar(1.4) },
    uFoot: { value: new THREE.Vector3() }, uCos: { value: Math.cos(0.2) }, uHeroH: { value: 1.72 }, uShadow: { value: 0 },
  };
  const clearPool = () => poolU.uK.value.fill(0);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: poolU, vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  // 3（持ち主 19:04）: 追い詰められた主人公の後ろの壁と、壁に映る丸いライトの溜まり（地面と同じ式を縦の板で）と、
  // ライトごとに壁へ映る主人公の黒い影（主人公の網をライトの位置から壁の面へ押しつぶして描く。安い投影の影）
  const lightSet = new THREE.Group();
  lightSet.visible = false;
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(34, 16, 0.6), new THREE.MeshLambertMaterial({ color: 0x2c2832 }));
  const wallPool = new THREE.Mesh(new THREE.PlaneGeometry(34, 16), new THREE.ShaderMaterial({ uniforms: poolU, vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  wallPool.renderOrder = 5;
  wallPool.frustumCulled = false;
  lightSet.add(wallMesh, wallPool);
  group.add(lightSet);
  const SHADOW_VERT = /* glsl */`
uniform mat4 uHero; uniform vec3 uLamp, uP0, uN;
void main() {
  vec3 w = (uHero * vec4(position, 1.0)).xyz;
  vec3 d = w - uLamp;
  float t = dot(uP0 - uLamp, uN) / dot(d, uN);
  vec3 p = uLamp + d * max(t, 0.0) + uN * 0.03;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
  const shadows = [];
  const _wallN = new THREE.Vector3(), _wallP = new THREE.Vector3();
  pool.renderOrder = 3;
  pool.frustumCulled = false;
  group.add(pool);

  // すき間の開口部を横切る光の筋と、壁の照り返し（隠れる拍）
  const streakMeshes = introStreaks().map(() => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(0.75, 1.0, 0.85) }, uK: { value: 0 }, uHead: { value: 1 }, uSoft: { value: 2.2 } }, vertexShader: BAND_VERT, fragmentShader: BAND_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    m.renderOrder = 5;
    group.add(m);
    return m;
  });
  const washU = () => ({ uColor: { value: new THREE.Color(0.55, 0.95, 0.75) }, uK: { value: 0 }, uHead: { value: 1 }, uSoft: { value: 0.5 } });
  const walls = [-1, 1].map(() => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: washU(), vertexShader: BAND_VERT, fragmentShader: BAND_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    m.renderOrder = 4;
    group.add(m);
    return m;
  });

  // 5: すき間の壁と、壁の配管・室外機・開口部の近くの縦の看板
  const gapSet = new THREE.Group();
  gapSet.name = 'intro-gap';
  gapSet.visible = false;
  {
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x1c1a21 }); // 持ち主 19:04: 真っ暗なすき間
    const dark = new THREE.MeshLambertMaterial({ color: 0x141217 });
    const len = GAP.z0 - HIDE.open;
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, GAP.h, len), wallMat);
      w.position.set(side * (GAP.half + 0.4), GAP.h / 2, (GAP.z0 + HIDE.open) / 2);
      gapSet.add(w);
    }
    // 配管（右の壁を奥へ）と室外機（左の壁）
    for (const [y, r] of [[2.7, 0.07], [3.15, 0.05], [5.4, 0.09]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8).rotateX(Math.PI / 2), dark);
      p.position.set(GAP.half - r - 0.02, y, (GAP.z0 + HIDE.open) / 2);
      gapSet.add(p);
    }
    for (const [z, y] of [[-3.5, 3.4], [-8.5, 2.9], [-12.5, 4.1], [-6, 6.6]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.85), dark);
      b.position.set(-GAP.half + 0.22, y, z);
      gapSet.add(b);
    }
    // 開口部の近くの縦の看板（にじむ桃色）
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 2.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.35, 0.9), side: THREE.DoubleSide }));
    sign.position.set(GAP.half - 0.05, 5.2, HIDE.open + 1.6);
    sign.rotation.y = -Math.PI / 2;
    gapSet.add(sign);
  }
  group.add(gapSet);

  // 主人公（導入の体）。材質は enemyView の主人公と同じシェーダーで、影絵の強さと縁の光だけ自分のもの
  const heroDetail = tier === 'low' ? 'low' : 'mid';
  const heroBuilder = createHeroBodyBuilder({ detail: heroDetail, pose: STAND });
  let heroMesh = null, heroBody = null, heroPos = null;
  const heroU = { uSil: { value: 0 }, uWindK: { value: 0.5 }, uRim: { value: HEAD_GREEN.clone().multiplyScalar(2.2) }, uGlow: { value: 0 } };
  function ensureHero() {
    if (heroMesh) return heroMesh;
    heroBody = heroBuilder.finish();
    const src = enemyView.hero.material;
    const geo = heroBody.geometry.clone();
    heroPos = geo.attributes.position;
    heroPos.setUsage(THREE.DynamicDrawUsage);
    const mat = new THREE.ShaderMaterial({ uniforms: { ...src.uniforms, ...heroU }, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader });
    heroMesh = new THREE.InstancedMesh(geo, mat, 1);
    heroMesh.frustumCulled = false;
    heroMesh.name = 'intro-hero';
    group.add(heroMesh);
    return heroMesh;
  }
  const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1);
  let lastRot = null;
  function placeHero(s, x, z, yaw, rot, y = 0) {
    ensureHero();
    heroMesh.visible = true;
    toWorld(s, x, y, z, _a);
    heroMesh.setMatrixAt(0, _m.compose(_a, _q.setFromEuler(_e.set(0, s.yaw + yaw, 0)), _one));
    heroMesh.instanceMatrix.needsUpdate = true;
    // 骨の回転が前のフレームと同じなら頂点を組み直さない（毎フレーム文字列にして比べない）
    if (!sameRot(rot, lastRot)) {
      skinPose(heroBody, rot, heroPos.array);
      heroPos.needsUpdate = true;
      lastRot = rot;
    }
    return _a;
  }

  const bikes = introBikes();
  const extra = [];
  const syncBikes = (dt) => enemyView.sync([], { extra, dt, pointScale: views.size.h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)), aids: false });
  // バイクの姿勢（enemyView の extra の形）
  const bikePoseW = (s, p, id, thrust = 1.5) => {
    toWorld(s, p.x, p.y, p.z, _a);
    return { id: 900 + id, x: _a.x, y: _a.y, z: _a.z, yaw: s.yaw + p.yaw, pitch: p.pitch, roll: p.roll, thrust, trail: 1.2, curve: 0, head: 0 };
  };

  // R1b（持ち主 08:24「導入のムービーなんだけど画面揺れなくていいかも、逆に見にくくなってる」）: カメラは揺らさない
  // （ゆっくり寄る・傾き・カットはそのまま）。R1c（持ち主 11:03）: バイクが頭上を抜ける瞬間だけ、introShake の短い小さな揺れ
  // （introShake はバイクの拍の外では 0。どの拍もここを通る）
  let shakeT = -1;
  // R1f: 動きを減らす設定（prefers-reduced-motion）なら揺らさない
  const reduceMotion = (() => { try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
  function setCam(s, pos, look, fov, roll = 0) {
    toWorld(s, pos[0], pos[1], pos[2], cam.position);
    toWorld(s, look[0], look[1], look[2], _b);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
    cam.lookAt(_b);
    const j = introShake(shakeT, { reduced: reduceMotion });
    if (j.x || j.y || j.roll || j.pitch) { cam.translateX(j.x); cam.translateY(j.y); cam.rotateX(j.pitch ?? 0); cam.rotateZ(j.roll); }
    cam.fov = fov;
    cam.aspect = views.size.w / Math.max(1, views.size.h);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  // 画づくり（screenFx の grade）
  const grade = { bars: 0, ca: 0.6, vig: 0.55, sat: 1.08, warm: 0.35, grain: 0.05, streak: 0, exposure: 1, fade: 0, contrast: 1.12, bloom: 1.3, zoom: 0, zoomC: [0.5, 0.5], blur: [0, 0] };
  const fx = { grade, flash: 0, time: 0 };
  const _vp = new THREE.Vector3();

  // ---- 拍ごと ----
  let speed = 0, vpX = 0.5, vpY = 0.5;
  function bikesBeat(t, local, dt) {
    const s = site.bikes;
    // 一番近いバイクの近さで色ずれ・速さの線（揺れは通過の瞬間だけ setCam の introShake）
    let near = 0;
    for (const b of bikes) near = Math.max(near, whooshAt(b, t).gain);
    const push = 0.6 * local; // ゆっくり前へ
    setCam(s, [BIKE_CAM.pos[0], BIKE_CAM.pos[1], BIKE_CAM.pos[2] - push], BIKE_CAM.look, BIKE_CAM.fov - 4 * local, -0.05);
    extra.length = 0;
    clearPool();
    poolU.uShadow.value = 0;
    poolU.uCos.value = Math.cos(0.21);
    toWorld(s, 0, 0, -60, pool.position);
    pool.visible = true;
    bikes.forEach((b, i) => {
      const p = bikeAt(b, t);
      const live = p.z < 30 && p.z > -420;
      const l = lamps[i];
      if (!live) { if (b.hero) enemyView.setFocus(null); l.cone.visible = l.glare.visible = l.tail.visible = false; return; }
      // 見せ場の一台は、演出で大きく映る乗り手の細かい体（enemyView の focus。riderBody）で描く
      if (b.hero) enemyView.setFocus({ id: 900 + b.id, pose: { reach: 0, keep: 1, ...bikePoseW(s, p, b.id, 1.8) } });
      else extra.push(bikePoseW(s, p, b.id));
      // ライトは前（+z）へ下向き（道を照らす光の溜まりが手前へ滑ってくる）。尾は後ろ（-z）へ
      toWorld(s, p.x, p.y + 0.35, p.z + 1.1, _a);
      const dir = _b.set(Math.sin(s.yaw + p.yaw), -0.2, Math.cos(s.yaw + p.yaw)).normalize();
      if (i < POOL_N) { poolU.uLamp.value[i].copy(_a); poolU.uDir.value[i].copy(dir); poolU.uK.value[i] = 0.32 * smooth((-p.z - 2) / 10) * smooth((300 + p.z) / 80); }
      setLamp(l, _a, dir.clone(), 34, 0.19, 0.1, 0.9);
      toWorld(s, p.x, p.y + 0.3, p.z - 1.3, _a);
      setTail(l, _a, dir.clone().negate().setY(0).normalize(), 24, 0.55);
    });
    for (let i = bikes.length; i < lamps.length; i++) lamps[i].cone.visible = lamps[i].glare.visible = lamps[i].tail.visible = false;
    syncBikes(dt);
    _vp.copy(toWorld(s, 0, BIKE_CAM.look[1], -200, _vp)).project(cam);
    vpX = _vp.x * 0.5 + 0.5; vpY = _vp.y * 0.5 + 0.5;
    speed = 0.35 + 0.65 * near;
    Object.assign(grade, { exposure: 1.0, contrast: 1.15, streak: 0, ca: 0.2 + 0.6 * near, zoom: 0.006 * near, zoomC: [vpX, vpY], blur: [0, 0], grain: 0.04, vig: 0.6, warm: 0.3, sat: 1.1, bloom: 0.75 });
    fx.flash = 0;
  }

  // 3: ライトに捉えられる（持ち主 18:04 / 19:04）: 壁際に追い詰められた主人公を、正面に浮かぶバイクのライトが一つ、また一つと
  // とらえる。後ろの壁にライトの丸い溜まりが重なり、その中に主人公の黒い影がライトの数だけ扇に映る。すくんで、横へ光を避けて逃げる
  // （壁の丸い光は遅れて主人公を追う）
  function ensureShadows() {
    if (shadows.length) return;
    for (let i = 0; i < LIGHT_BIKES.length; i++) {
      const m = new THREE.Mesh(heroMesh.geometry, new THREE.ShaderMaterial({
        uniforms: { uHero: { value: new THREE.Matrix4() }, uLamp: { value: new THREE.Vector3() }, uP0: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3() }, uK: { value: 0 } },
        vertexShader: SHADOW_VERT, fragmentShader: 'uniform float uK; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uK); }',
        transparent: true, depthWrite: false,
      }));
      m.frustumCulled = false;
      m.renderOrder = 6;
      lightSet.add(m);
      shadows.push(m);
    }
  }
  let aimX = null;
  function lightBeat(t, local, dt) {
    const s = site.light, L = INTRO.light;
    const fl = L.flinchAt, runFrom = fl + INTRO.run.afterFlinch - 0.13;
    const locks = LIGHT_BIKES.reduce((n, b) => n + lightBikeAt(b, local).lock, 0);
    const hit = local >= fl ? Math.exp(-(local - fl) / 0.12) : 0;
    const snap = LIGHT_BIKES.reduce((m, b) => Math.max(m, local >= b.lockAt ? Math.exp(-(local - b.lockAt) / 0.06) : 0), 0);
    const c = LIGHT.cam;
    // カメラ: バイクの後ろ・間から主人公を見る。光が増えるほどじわじわ寄り、すくむ瞬間に小さく寄る
    const push = 1.2 * smooth(local / fl);
    setCam(s, [c.pos[0], c.pos[1], c.pos[2] - push], c.look, c.fov - 6 * smooth((local - fl) / 0.3), 0.02);
    const hp = heroPath('light', local);
    const hx = hp.x, hz = hp.z;
    let yaw = 0, rot;
    if (local < fl) {
      rot = addRot(runRot(0, 0), flinchRot(0.15 + 0.12 * locks / 5)); // 壁を背に身を固くする
    } else if (local < runFrom) {
      rot = flinchRot(0.27 + 0.73 * easeOut((local - fl) / 0.12));
    } else {
      const u = local - runFrom;
      const k = smooth(u / 0.25);
      const ph = Math.PI / 2 + Math.PI * (u - 0.13) / INTRO.run.stride;
      rot = addRot(flinchRot(1 - k), runRot(ph, k));
      yaw = 1.45 * k; // 横（ローカル +x）へ向きを変えて、壁に沿って逃げる
    }
    placeHero(s, hx, hz, yaw, rot);
    ensureShadows();
    // 壁（主人公のすぐ後ろ）
    lightSet.visible = true;
    toWorld(s, 0, 8, LIGHT.wall - 0.3, wallMesh.position);
    wallMesh.rotation.set(0, s.yaw, 0);
    toWorld(s, 0, 8, LIGHT.wall + 0.02, wallPool.position);
    wallPool.rotation.set(0, s.yaw, 0);
    _wallN.set(Math.sin(s.yaw), 0, Math.cos(s.yaw)); // 壁の面の向き（ローカル +z）
    toWorld(s, 0, 0, LIGHT.wall, _wallP);
    heroMesh.getMatrixAt(0, _m);
    // ライトの狙い: 主人公の胸。逃げ出すと、遅れて追う（壁の丸い光が主人公を探す）
    aimX = aimX === null || local < 0.05 ? hx : aimX + (hx - aimX) * Math.min(1, dt * 4);
    toWorld(s, aimX, 1.25, hz, _b);
    const chest = _b.clone();
    extra.length = 0;
    clearPool();
    hideLamps();
    LIGHT_BIKES.forEach((b, i) => {
      const p = lightBikeAt(b, local);
      const sh = shadows[i];
      if (!p.on) { sh.visible = false; return; }
      // バイクは主人公を向いて浮かぶ（カメラには後ろ姿）
      const yawB = Math.atan2(aimX - p.x, hz - p.z);
      extra.push(bikePoseW(s, { x: p.x, y: p.y, z: p.z, yaw: yawB, pitch: 0.06, roll: 0.12 * Math.sin(local * 1.7 + i) }, 30 + b.id, 1.6));
      toWorld(s, p.x + Math.sin(yawB) * 1.1, p.y + 0.35, p.z + Math.cos(yawB) * 1.1, _a);
      const lampPos = _a.clone();
      const fwd = new THREE.Vector3(Math.sin(s.yaw + yawB + 0.7), -0.25, Math.cos(s.yaw + yawB + 0.7)).normalize();
      const dir = fwd.lerp(chest.clone().sub(lampPos).normalize(), p.lock).normalize();
      const on = smooth((local - (b.lockAt - 0.4)) / 0.15);
      setLamp(lamps[i], lampPos, dir, lampPos.distanceTo(chest) + 1.5, 0.13, (0.05 + 0.07 * p.lock) * on, 0.55 * on, 4);
      poolU.uLamp.value[i].copy(lampPos);
      poolU.uDir.value[i].copy(dir);
      poolU.uK.value[i] = (0.2 + 0.8 * p.lock) * on * 0.32;
      // 壁に映る主人公の影（ライトがとらえている間）
      sh.visible = p.lock > 0.02;
      const u = sh.material.uniforms;
      u.uHero.value.copy(_m); u.uLamp.value.copy(lampPos); u.uP0.value.copy(_wallP); u.uN.value.copy(_wallN); u.uK.value = 0.96 * p.lock;
    });
    poolU.uCos.value = Math.cos(0.13);
    poolU.uShadow.value = 0;
    pool.visible = false;
    syncBikes(dt);
    // 正面から照らされる: 影絵ではなく、光で白く飛びかける
    const blind = locks / LIGHT_BIKES.length;
    heroU.uSil.value = 0;
    heroU.uGlow.value = 0.15 + 0.45 * blind;
    Object.assign(grade, { exposure: 0.85 + 0.12 * blind + 0.06 * snap, contrast: 1.3, streak: 0, ca: 0.3 + 0.6 * snap + 1.0 * hit, zoom: 0.008 * snap + 0.02 * hit, zoomC: [0.5, 0.55], blur: [0, 0], grain: 0.06, vig: 0.8 - 0.1 * blind, warm: 0.12, sat: 1.0 - 0.1 * blind, bloom: 0.45 + 0.25 * blind });
    fx.flash = 0;
  }

  // 5: すき間へ隠れる（そこが爆心）
  const streaks = introStreaks();
  function hideBeat(t, local, dt) {
    const s = site.hide;
    gapSet.visible = true;
    gapSet.position.set(s.sx, 0, s.sz);
    gapSet.rotation.set(0, s.yaw, 0);
    hideLamps();
    extra.length = 0;
    syncBikes(dt);
    // 主人公: 開口部から走り込み、左の壁に背を預ける
    const stop = INTRO.run.hideStop;
    const { x: hx, z: hz } = heroPath('hide', local);
    const settle = smooth((local - stop + 0.15) / 0.35);
    const ph = Math.PI / 2 + Math.PI * (local - 0.04) / INTRO.run.stride;
    const rot = addRot(runRot(ph, 1 - settle), hideRot(local * 5.5, settle));
    // 走る向き（手前・左へ）→ 壁を背に、右（ローカル +x）を向く
    const runYaw = Math.atan2(HIDE.to[0] - HIDE.from[0], HIDE.to[1] - HIDE.from[1]);
    const yaw = runYaw + (Math.PI / 2 - runYaw) * settle;
    placeHero(s, hx, hz, yaw, rot);
    heroU.uSil.value = 0.97; // 真っ暗の中の影（縁だけかすかに光る）
    // 光の筋: 開口部（ローカル z = open）を横に走る
    let wash = 0, washSide = 0;
    streaks.forEach((st, i) => {
      const a = streakAt(st, local), m = streakMeshes[i];
      const k = a.on ? Math.exp(-(a.u * a.u) * 0.7) : 0;
      m.visible = k > 0.01;
      if (!m.visible) return;
      const z = HIDE.open - 1.5 - st.depth * 6;
      // 明るい頭（帯の uv.x = 1 の端）が u の位置。尾はその後ろへ 18 m
      toWorld(s, a.u * 9 - st.dir * 9, 0.9 + st.y * 3.2, z, m.position);
      m.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw + (st.dir > 0 ? 0 : Math.PI));
      m.scale.set(18, 0.6, 1);
      m.material.uniforms.uK.value = 2.8 * k;
      wash = Math.max(wash, k * (1 - st.depth * 0.5));
      washSide = a.u;
    });
    // 壁の照り返し（開口部に近いほど明るい）
    walls.forEach((w, i) => {
      const side = i ? 1 : -1;
      toWorld(s, side * (GAP.half - 0.03), 3.2, HIDE.open + 6, w.position);
      w.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw + Math.PI / 2);
      w.scale.set(13, 6.5, 1);
      w.rotateY(side > 0 ? Math.PI : 0);
      w.material.uniforms.uK.value = wash * (0.12 + 0.12 * Math.max(0, side * washSide));
      w.visible = wash > 0.01;
    });
    pool.visible = false;
    const c = HIDE.cam;
    const push = 0.9 * smooth(local / 2.2);
    setCam(s, [c.pos[0] - 0.2 * push, c.pos[1] - 0.05 * push, c.pos[2] - push], c.look, c.fov - 3 * push, 0.03);
    Object.assign(grade, { exposure: 0.36 + 0.2 * wash, contrast: 1.35, streak: 0, ca: 0.3 + 0.8 * wash, zoom: 0, zoomC: [0.5, 0.5], blur: [0.006 * wash * Math.sign(washSide || 1), 0], grain: 0.07, vig: 0.85, warm: 0.15, sat: 0.95, bloom: 1.0 });
    fx.flash = 0;
  }

  // 6: 手のアップ。手は決まった刻みで積み上げる（巻き戻したら最初から）
  const handsState = { t: -1, released: false };
  function handsBeat(t, local) {
    introHandsTo(hand, handsState, local, views.size.w / Math.max(1, views.size.h));
    const charge = introHands(Math.min(local, INTRO.hands.releaseAt - 0.01)).level;
    const clamp = local >= INTRO.hands.releaseAt ? Math.exp(-(local - INTRO.hands.releaseAt) / 0.18) : 0;
    // 握り込んだあとは光のにじみを絞り、暗めにして、締めつけた鉤爪と指の間から漏れる芯の光を見せる（白く飛ばさない）
    const held = local >= INTRO.hands.releaseAt ? 1 : 0;
    Object.assign(grade, { exposure: 0.92 - 0.12 * held, contrast: 1.12 + 0.1 * held, streak: 0, ca: 0.3 + 0.8 * charge * (1 - held) + 1.2 * clamp, zoom: 0.02 * clamp, zoomC: [0.5, 0.5], blur: [0, 0], grain: 0.05, vig: 0.7 + 0.1 * held, warm: 0.3, sat: 1.05, bloom: held ? 0.06 : 0.2 + 0.25 * charge });
    fx.flash = 0;
  }

  let beatName = null, lastT = 0;
  function show(on) {
    group.visible = on;
    enemyView.hero.visible = !on;
    if (heroAura) heroAura.group.visible = !on;
    if (patrolGlow) patrolGlow.points.visible = !on;
    if (!on) { hideLamps(); extra.length = 0; }
  }

  return {
    camera: cam, site, fx,
    get beat() { return beatName; },
    get speed() { return speed; },
    get vanish() { return [vpX, vpY]; },
    // 手の空いた時間に、主人公の導入の体を区切りごとに組み立てる（できたら true）
    prepareStep() { return heroBuilder.step(); },
    get prepared() { return heroBuilder.done; },
    // TAP の直後（導入の 0 秒を決める前）に残りを一度に組み立てる（ライトの拍の最初のフレームで止まらない）
    finishPrepare() { heroBuilder.finish(); },
    // 導入の材質と形を前もって GPU へ（TAP を待つ画面か TAP の直後。導入の最初のフレームで止まらない）:
    // 導入の物をいったん全部見せ、主人公の導入の体と壁の影も作ってから fn(scene, camera, fx) を呼ぶ（main が描き先ごとに
    // compile し、画面全体で一度描く）。終わったら見え方を元に戻す。主人公の導入の体を組み立て終えてから呼ぶ
    warmup(fn) {
      ensureHero();
      ensureShadows();
      const saved = [];
      group.traverse((o) => { saved.push(o.visible); o.visible = true; });
      shakeT = -1;
      setCam(site.bikes, BIKE_CAM.pos, BIKE_CAM.look, BIKE_CAM.fov);
      try { fn(scene, cam, fx); } finally {
        let i = 0;
        group.traverse((o) => { o.visible = saved[i++]; });
      }
    },
    // 時刻 t（導入の秒）の絵を決める。beat: introTimeline の beatAt の戻り値
    update(t, b) {
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      shakeT = t;
      beatName = b.name;
      fx.time = t;
      const is3d = b.name === 'bikes' || b.name === 'light' || b.name === 'hide';
      show(is3d);
      if (is3d) cityView.setCloseView(true);
      if (heroMesh) heroMesh.visible = b.name === 'light' || b.name === 'hide';
      if (b.name !== 'light') { pool.visible = false; lightSet.visible = false; heroU.uGlow.value = 0; }
      if (b.name !== 'hide') { gapSet.visible = false; for (const m of streakMeshes) m.visible = false; for (const w of walls) w.visible = false; }
      if (b.name !== 'bikes' && enemyView.focus?.id >= 900) enemyView.setFocus(null);
      if (b.name === 'bikes') bikesBeat(t, b.local, dt);
      else if (b.name === 'light') lightBeat(t, b.local, dt);
      else if (b.name === 'hide') hideBeat(t, b.local, dt);
      else if (b.name === 'hands') handsBeat(t, b.local);
    },
    // 画面全体に描く（3D の拍と手の拍だけ。カード・白・題字は 2D が覆う）
    draw() {
      if (beatName === 'hands') views.renderFull(hand.scene, hand.camera, fx);
      else if (group.visible) views.renderFull(scene, cam, fx);
      else return false;
      return true;
    },
    // 導入を終える（ゲームへ）: 導入の物を隠し、手を構えへ戻す
    end() {
      show(false);
      if (enemyView.focus?.id >= 900) enemyView.setFocus(null);
      if (heroMesh) heroMesh.visible = false;
      pool.visible = false;
      for (const m of streakMeshes) m.visible = false;
      for (const w of walls) w.visible = false;
      gapSet.visible = false;
      lightSet.visible = false;
      enemyView.sync([], { aids: true });
      hand.reset();
      hand.setFlashScale(1);
      hand.setShakeScale?.(1);
      handsState.t = -1;
      beatName = null;
    },
    get tierName() { return getTier(); },
    // 調べる用: 主人公の画面の位置（NDC）
    _hero() { if (!heroMesh) return null; heroMesh.getMatrixAt(0, _m); _a.setFromMatrixPosition(_m); const w = _a.toArray().map((v) => +v.toFixed(2)); _a.project(cam); return { world: w, ndc: [+_a.x.toFixed(2), +_a.y.toFixed(2)] }; },
    seed,
  };
}
