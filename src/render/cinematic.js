import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { groundHeight } from './sphereDeform.js';
import { createCinematicProps } from './cinematicProps.js';

// 大きな一発を放つ瞬間の演出（画面全体を使う）。
// 離す → 手の画面で両手が組み合わさる → 画面全体が真っ白 → カメラが主人公の目から後ろ上へ引いていく →
// 時間が止まり、飛んでくるガラスに軍団の一人の目が映る → 時間が動き出し、追ってくる爆発の front を読みながら引き続ける →
// 球の全体が見える遠めの構図で一度止まり、2画面に戻る（上空カメラは少し保ってから近い位置へ戻る）。
// chooseShot: 引いていく道（向き・上がり方）と目の一拍の位置を選ぶ純粋な関数。createChase: front を読んで引く距離。

export const CINE = {
  eyeY: 1.7,            // 主人公の目の高さ（m）
  fovDeg: 55,           // 全画面のカメラの縦の画角
  fitUpDeg: 24,         // 球がビルに届く瞬間、ビルは視線から縦にこの角度の内側
  fitSideDeg: 11,       // 横にこの角度の内側（縦長の全画面の横の半画角 約13.5°）
  ring: [0.4, 0.7],     // 狙うビルは、その一発の半径のこの割合の距離（front が届く途中）
  enemyNear: 120,       // 爆心からこの距離までの生きた軍勢の目が映る
  candidates: 16,       // 道の向きの候補の数
  beatDist: { glass: 16, visor: 16, puddle: 11 }, // 目の一拍のとき、カメラが目から引いた横の距離（m）
  // 道の形: 横に x 引いたときの高さ = 目の高さ + rise·(1 − e^(−x/riseLen)) + slope·x。
  // 最初に急に上がって広場のまわりのビル（〜28m）を越え、そのあとはゆるい角度で街の上を引く。
  rises: [3, 8, 16, 26, 38, 50, 64, 80, 100, 125], // 低い順に試す（低いほど、迫る球の壁が大きく見える）
  riseLen: 10,
  slope: [0.12, 0.42],
  puddleMaxRise: 3,     // 水たまりは、最初にほとんど上がらない道のときだけ
  clearance: 8,         // 道はビルからこの距離（m）より離れる（近くの壁で画面が埋まらないように）
  losFronts: [0.3, 0.5, 0.75, 1.0], // 球が狙うビルのこの割合まで来たとき、カメラから迫る球の壁への見通しがあること
  riseWeight: 1 / 40,   // 低い道を好む強さ（上がる高さ 1m あたりの減点）
  chaseMaxSec: 6,       // 追う一発が見つからなくても、この秒数で上空へ戻る
  wideFrontFrac: 0.8,   // 前線がその一発の半径のこの割合に届いたら、追うのをやめて全体が見える構図へなじむ（球が消える前に着く）
  sideAz: 0.2,          // 道の向きを、狙うビルの向きからずらす最大（rad。ビルの横をかすめる）
  reflectAhead: 2.8,    // ガラス片・バイザー片は一拍のカメラのこの距離の前で止まる（m）
  puddleAhead: 4.2,
};

// 追われて引くカメラは front からこの距離だけ先にいたい（lead）、決してこれより近づかない（minLead）
export const leadFor = (front) => 20 + 0.6 * front;
export const minLeadFor = (front) => 6 + 0.08 * front;

const TYPES = ['glass', 'visor', 'puddle'];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const inBox = (p, b, m) => Math.abs(p[0] - b.x) < b.w / 2 + m && Math.abs(p[2] - b.z) < b.d / 2 + m && p[1] < b.h + m;

// 道の上の、目から横に x だけ引いた点（path = { origin, az, rise, riseLen, slope, forward, look }）
export function pathPoint(path, x) {
  const y = path.origin[1] + path.rise * (1 - Math.exp(-x / path.riseLen)) + path.slope * x;
  return [path.origin[0] + Math.cos(path.az) * x, y, path.origin[2] + Math.sin(path.az) * x];
}

// 追われて引くときに見る点: 狙うビルの向き（path.look）で、球の壁が街に触れているあたり。front=0 では主人公の胸
export function chaseLook(path, front) {
  const h = path.look;
  return [h[0] * front * 0.9, 1.2 + front * 0.3, h[2] * front * 0.9];
}

// 迫る球の壁の、カメラ側の中ほどの高さの点（見通しを確かめる先）。仰角 50°
export function sphereWall(path, front) {
  const h = path.look, c = Math.cos(0.87), sn = Math.sin(0.87);
  return [h[0] * front * c, front * sn, h[2] * front * c];
}

// 点 p が、cam から look を向いたカメラの横・縦の何度にあるか
function viewAngles(cam, look, p) {
  const f = norm(sub(look, cam)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), v = sub(p, cam);
  const z = dot(v, f);
  if (z <= 0) return null;
  return { side: Math.abs(Math.atan2(dot(v, r), z)) * 180 / Math.PI, up: Math.abs(Math.atan2(dot(v, u), z)) * 180 / Math.PI };
}

// 狙うビル: 輪の中のビル。軍勢の一人の向きに近いものを優先し（その者の近くのビルが潰れる）、何棟か引いて一番高いもの。
function pickTarget(buildings, R, enemy, rng) {
  const lo = CINE.ring[0] * R, hi = CINE.ring[1] * R;
  const ring = buildings.filter((b) => b.dist >= lo && b.dist <= hi);
  let pool = ring;
  if (enemy) {
    const near = ring.filter((b) => angDiff(Math.atan2(b.z, b.x), enemy.angle) < 0.7);
    if (near.length) pool = near;
  }
  if (!pool.length) {
    const a = enemy ? enemy.angle : rng() * Math.PI * 2, d = (lo + hi) / 2;
    return { id: null, x: Math.cos(a) * d, z: Math.sin(a) * d, w: 12, d: 12, h: 24, dist: d };
  }
  let best = null;
  for (let i = 0; i < 3; i++) {
    const b = pool[Math.floor(rng() * pool.length)];
    if (!best || b.h > best.h) best = b;
  }
  return best;
}

// 線分 a→c がビルの箱を通るか（スラブ法）
function segHitsBox(a, c, b) {
  const lo = [b.x - b.w / 2, 0, b.z - b.d / 2], hi = [b.x + b.w / 2, b.h, b.z + b.d / 2];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = c[i] - a[i];
    if (Math.abs(d) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return false; continue; }
    let u = (lo[i] - a[i]) / d, v = (hi[i] - a[i]) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}

// 道の採点: ビルに clearance より近づく（または地面すれすれの）点があれば使わない（Infinity）。
// 追われ始め（球が狙うビルに届くまで）に、迫る球の壁への見通しを、まだ飲み込まれていないビルがふさぐと大きく減点。
// あとは、球がビルに届く瞬間にビルが画面からはみ出す角度（度）。
function scorePath(path, b, near, wide, R, ground) {
  const end = R + leadFor(R);
  for (let s = 1; s <= end; s += 2) {
    const p = pathPoint(path, s);
    if (p[1] <= ground(p) + 1.5) return Infinity;
    for (const o of near) if (inBox(p, o, CINE.clearance)) return Infinity;
  }
  let blocked = 0;
  for (const k of CINE.losFronts) {
    const front = k * b.dist;
    const cam = pathPoint(path, front + leadFor(front)), wall = sphereWall(path, front);
    if (wide.some((o) => o.dist > front * 1.05 && o.id !== b.id && segHitsBox(cam, wall, o))) blocked++;
  }
  const cam = pathPoint(path, b.dist + leadFor(b.dist));
  const a = viewAngles(cam, chaseLook(path, b.dist), [b.x, b.h * 0.5, b.z]);
  if (!a) return 1000;
  return blocked * 30 + Math.max(0, a.up - CINE.fitUpDeg + 2) + Math.max(0, a.side - CINE.fitSideDeg + 1.5) * 2;
}

// 向き az の道の近く（横に width m 以内、前側）のビルだけを選ぶ（当たり判定を軽くする）
function nearPath(buildings, az, width = 25) {
  const c = Math.cos(az), s = Math.sin(az);
  return buildings.filter((o) => {
    const along = o.x * c + o.z * s, across = Math.abs(-o.x * s + o.z * c);
    return along > -15 && across < width + Math.max(o.w, o.d);
  });
}

export function chooseShot({ shot, buildings, enemies = [], rng, crater = 0 }) {
  const R = shot.radius;
  const alive = enemies.filter((e) => e.state !== 'dead' && e.dist <= CINE.enemyNear);
  const enemy = alive.length ? alive[Math.floor(rng() * alive.length)] : null;
  let type = enemy ? TYPES[Math.floor(rng() * TYPES.length)] : 'glass';
  const b = pickTarget(buildings, R, enemy, rng);
  const ground = (p) => groundHeight(Math.hypot(p[0], p[2]), crater > 0 ? [crater] : []);
  const origin = [0, CINE.eyeY, 0]; // 主人公は浮いている（足元の地面が下がっても目の高さは変わらない）
  const baseAz = Math.atan2(b.z, b.x);
  const look = [Math.cos(baseAz), 0, Math.sin(baseAz)];
  const makePath = (az, rise, slope) => ({ origin, az, rise, riseLen: CINE.riseLen, slope, forward: [-Math.cos(az), 0, -Math.sin(az)], look });

  // 向き（狙うビルの向きから少しずらす）ごとに、低い道から順に試し、その向きで一番低い、ビルを通らない道を候補にする。
  // 候補のうち、球がビルに届く瞬間のビルの入り方がよく、低いもの。
  const search = (rises) => {
    let best = null;
    for (let k = 0; k < CINE.candidates; k++) {
      const az = baseAz + (k === 0 ? 0 : (rng() * 2 - 1) * CINE.sideAz);
      const near = nearPath(buildings, az), wide = nearPath(buildings, az, 90);
      const slope = CINE.slope[0] + (CINE.slope[1] - CINE.slope[0]) * rng();
      for (const rise of rises) {
        const path = makePath(az, rise, slope);
        const score = scorePath(path, b, near, wide, R, ground);
        if (score === Infinity) continue;
        const total = score + rise * CINE.riseWeight;
        if (!best || total < best.score) best = { path, score: total };
        break;
      }
    }
    return best;
  };
  // 水たまりは、最初にほとんど上がらない道があるときだけ。なければガラス
  let best = type === 'puddle' ? search(CINE.rises.filter((r) => r <= CINE.puddleMaxRise)) : null;
  if (type === 'puddle' && !best) type = 'glass';
  best ??= search(CINE.rises);
  // どの道もビルにぶつかる（まずない）なら、高く上がる道にする
  best ??= { path: makePath(baseAz, 160, 0.3) };
  const { path } = best;
  const lookAt = chaseLook(path, 0);
  const side = rng() < 0.5 ? -1 : 1;
  const frame = (dist) => {
    const camPos = pathPoint(path, dist);
    const f = norm(sub(lookAt, camPos)), right = norm(cross(f, [0, 1, 0]));
    return { camPos, f, right, up: cross(right, f) };
  };
  // 水たまり: カメラが低い道のときだけ、カメラの前の地面に（ビルの中なら、高い道ならガラスにする）
  if (type === 'puddle') {
    const { camPos, f, right } = frame(CINE.beatDist.puddle);
    const fh = norm([f[0], 0, f[2]]);
    const refl = add(add(camPos, fh, CINE.puddleAhead), right, side * 0.5);
    refl[1] = ground(refl) + 0.02;
    if (camPos[1] - ground(camPos) <= 5 && !buildings.some((o) => inBox(refl, o, 1.5))) {
      return result(path, camPos, lookAt, b, type, enemy, refl);
    }
    type = 'glass';
  }
  const { camPos, f, right, up } = frame(CINE.beatDist[type]);
  return result(path, camPos, lookAt, b, type, enemy, add(add(add(camPos, f, CINE.reflectAhead), right, side * 0.55), up, 0.12));
}

function result(path, camPos, lookAt, b, type, enemy, refl) {
  return {
    path, camPos, lookAt,
    targetId: b.id,
    target: { x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, dist: b.dist },
    reflector: { type, enemyId: enemy ? enemy.id : null, pos: refl },
  };
}

// 追われて引く距離 s。生きた front を毎フレーム読み、front + lead へ臨界減衰のばねで向かう。
// 戻らず、front + minLead より近づかない（front が急に速くなればカメラも同じだけ速くなる）。
export function createChase(s0, { rate = 6 } = {}) {
  let s = s0, v = 0;
  return {
    get s() { return s; },
    update(dt, front) {
      const want = Math.max(s, front + leadFor(front));
      if (dt > 0) {
        v = (v + rate * rate * (want - s) * dt) / (1 + 2 * rate * dt + rate * rate * dt * dt);
        v = Math.max(0, v);
        s += v * dt;
      }
      const floor = front + minLeadFor(front);
      if (s < floor) { if (dt > 0) v = Math.max(v, (floor - s) / dt); s = floor; }
      return s;
    },
  };
}

// ---- 演出の進行 ----
// 時刻（演出の始まりからの秒）。ゲームの時間は freezeSec まで止まる。
//   0〜HAND: 2画面のまま、手の画面で両手が組み合わさる
//   HAND〜WHITE: 画面全体が真っ白
//   WHITE〜BEAT: 全画面。カメラが主人公の目から後ろ上へ beatDist まで引く（白が晴れていく）
//   BEAT〜BEAT+eyeBeatSec: 時間が止まり、ガラスに目が映る一拍
//   その後: 時間が動き出し（cinematicEnd でゲームも動く）、front を読んで引き続け、球の全体が見える上空の構図へ
//   SETTLE 秒でなじみ、WIDE_HOLD 秒止まってから 2画面に戻る
const HAND = 0.25, WHITE = 0.4, PULL = 0.35;
const BEAT = WHITE + PULL;
const BEAT_FOV = 34;
const SETTLE = 1.1;
const WIDE_HOLD = 0.5; // 全体が見える構図で止まる秒
const EYE_RT = [512, 256];
const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const easeOut = (x) => { const t = Math.min(1, Math.max(0, x)); return 1 - (1 - t) ** 3; };
const lerp3 = (a, b, k, out) => out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);

// 小道具の時計 c（cinematicProps.js）: 白が晴れた瞬間 0、一拍の始まり 0.94、一拍の終わり 1、その先は速く進む
export function propClock(t, beatEnd) {
  if (t < WHITE) return -1;
  if (t < BEAT) return 0.94 * (t - WHITE) / (BEAT - WHITE);
  if (t < beatEnd) return 0.94 + 0.06 * (t - BEAT) / (beatEnd - BEAT);
  return 1 + (t - beatEnd) / 0.2;
}

// views: createViews の戻り値（全画面の大きさ、上空カメラ）、enemyView: 目のアップと主人公の向き、
// explosionView: 本爆発の閃光（screen）。opts.renderer: 目のアップのレンダーターゲット用、opts.scene: 小道具を置く街の場面
export function createCinematic(views, enemyView, explosionView, { renderer, scene, sunDir, cfg = CONFIG } = {}) {
  const beatEnd = Math.min(cfg.cinematic.freezeSec, BEAT + cfg.cinematic.eyeBeatSec);
  const cam = new THREE.PerspectiveCamera(CINE.fovDeg, 1, 0.2, 6000);
  const rt = new THREE.WebGLRenderTarget(EYE_RT[0], EYE_RT[1], { type: THREE.HalfFloatType, depthBuffer: false });
  const eyeScene = new THREE.Scene();
  const eyeCam = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.1, 10);
  eyeCam.position.z = 1;
  const props = createCinematicProps(scene, rt.texture, { sunDir });

  // phase: 'off' | 'freeze'（ゲームが止まっている間） | 'chase' | 'settle'（全体が見える構図へ） | 'hold'（そこで止まる）
  let phase = 'off', t = 0, plan = null, shot = null, eye = null;
  let chase = null, trackedId = null, front = 0, settleT = 0, chaseS = 0, chaseT = 0;
  const V = (a) => new THREE.Vector3().fromArray(a);
  const P = { eye: new THREE.Vector3(), fwdLook: new THREE.Vector3(), hero: new THREE.Vector3(), cam: new THREE.Vector3(), refl: new THREE.Vector3(), beatPos: new THREE.Vector3(), beatEndPos: new THREE.Vector3(), wide: new THREE.Vector3() };
  const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _q = new THREE.Quaternion();
  const facing = new THREE.Quaternion();
  const screen = { flash: 0, time: 0, heat: null };

  function aim(pos, look, fov) {
    const { w, h } = views.size;
    cam.aspect = w / Math.max(1, h);
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  // 一拍の間のカメラ: 目の板が画面のいちばん短い辺の 85% に収まる距離まで寄る
  function beatDistance() {
    const size = { glass: 0.95, visor: 1.0, puddle: 3.6 }[plan.reflector.type];
    const { w, h } = views.size;
    const tanV = Math.tan(THREE.MathUtils.degToRad(BEAT_FOV) / 2), tanH = tanV * w / Math.max(1, h);
    return size / (2 * 0.85 * Math.min(tanV, tanH));
  }

  // 追われて引くカメラの姿勢（chase と settle で使う）
  function chasePose(dt, blasts) {
    if (trackedId == null && blasts.length) trackedId = blasts.reduce((m, b) => Math.max(m, b.id), -Infinity);
    const b = blasts.find((x) => x.id === trackedId);
    const done = trackedId != null && !b;
    front = b ? b.front : (done ? shot.radius : 0);
    chaseS = chase.update(dt, front);
    _pos.fromArray(pathPoint(plan.path, chaseS));
    _look.fromArray(chaseLook(plan.path, front));
    return done || (b && b.front >= shot.radius * CINE.wideFrontFrac);
  }

  const self = {
    get active() { return phase !== 'off'; },
    // ゲームが止まっている間（描画側の世界も止める）
    get frozen() { return phase === 'freeze'; },
    // 画面全体を演出のカメラで描くか（手の画面と HUD は描かない）
    get fullscreen() { return phase !== 'off' && !(phase === 'freeze' && t < HAND); },
    // 画面全体を真っ白にするか
    get white() { return phase === 'freeze' && t >= HAND && t < WHITE; },
    get camera() { return cam; },
    get plan() { return plan; },
    get time() { return t; },
    get phase() { return phase; },
    // 世界（破片・粉・軍勢・ビルのつぶれ）の時間の進み方 0〜1。一拍の終わりから動き出す
    get worldScale() { return phase === 'freeze' ? ease((t - beatEnd) / 0.05) : 1; },
    // 演出の間の画面効果: 白から晴れていく閃光。追う間は本爆発の閃光（熱のゆがみは近い構図で画面じゅうに掛かるので使わない）
    get screen() {
      if (phase === 'off') return null;
      if (phase === 'freeze') {
        screen.flash = t >= WHITE ? 0.9 * Math.exp(-(t - WHITE) / 0.045) : 0;
        screen.time = t;
        screen.heat = null;
        return screen;
      }
      screen.flash = explosionView.screen.flash;
      screen.time = explosionView.screen.time;
      screen.heat = null;
      return screen;
    },
    // 最初の演出で止まらないよう、小道具と目のアップのシェーダーを先に作っておく
    warmup(r, camera) {
      props.group.visible = true;
      const shown = [];
      props.group.traverse((o) => { if (!o.visible) { shown.push(o); o.visible = true; } });
      r.compile(scene, camera);
      for (const o of shown) o.visible = false;
      props.group.visible = false;
      eyeScene.add(enemyView.eyeCloseup(null));
      r.compile(eyeScene, eyeCam);
      eyeScene.clear();
    },
    // 'cinematicStart'
    play(p, s) {
      plan = p; shot = s; phase = 'freeze'; t = 0;
      chase = null; trackedId = null; front = 0;
      const f = V(p.path.forward);
      enemyView.setHeroYaw(Math.atan2(f.x, f.z)); // 主人公は道と反対を向き、カメラはその背中から引いていく
      P.eye.fromArray(p.path.origin);
      P.fwdLook.copy(P.eye).addScaledVector(f, 8).add(new THREE.Vector3(0, -2.6, 0)); // 両手のあたり
      P.hero.fromArray(p.lookAt);
      P.cam.fromArray(p.camPos);
      P.refl.fromArray(p.reflector.pos);
      const d = beatDistance();
      if (p.reflector.type === 'puddle') {
        const away = P.refl.clone().sub(P.cam).setY(0).normalize();
        P.beatPos.copy(P.refl).addScaledVector(away, -d * 0.78).add(new THREE.Vector3(0, d * 0.62, 0));
      } else {
        P.beatPos.copy(P.refl).addScaledVector(P.refl.clone().sub(P.cam).normalize(), -d);
      }
      // 小道具: 一拍のカメラ（camPos から主人公）を基準に置く
      aim(P.cam, P.hero, CINE.fovDeg);
      const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
      cam.matrixWorld.extractBasis(right, up, fwd);
      fwd.negate();
      const tanV = Math.tan(THREE.MathUtils.degToRad(CINE.fovDeg) / 2);
      props.setup(p, { fwd, right, up, tanV, tanH: tanV * cam.aspect });
      // 目の板の向き: 一拍の位置のカメラの方へ、少しだけ傾ける
      aim(P.beatPos, P.refl, BEAT_FOV);
      facing.copy(cam.quaternion).multiply(_q.setFromEuler(new THREE.Euler(0.12, -0.18, 0.06)));
      eyeScene.clear();
      eye = enemyView.eyeCloseup(p.reflector.enemyId);
      eyeScene.add(eye);
      self.update(0);
    },
    // 'cinematicEnd': ゲームが動き出す。ここからは追ってくる爆発を見せながら引く
    end() {
      if (phase !== 'freeze') return;
      phase = 'chase';
      chaseT = 0;
      chase = createChase(Math.max(CINE.beatDist[plan.reflector.type], P.cam.distanceTo(P.eye)));
    },
    // blasts: game.blasts（追う一発の front を読む）
    update(dt, blasts = []) {
      if (phase === 'off') return;
      t += dt;
      if (phase === 'chase' || phase === 'settle' || phase === 'hold') {
        chaseT += dt;
        // 追う一発が見つからない・終わらないときも、決まった時間で上空へ戻る
        const finished = chasePose(dt, blasts) || chaseT >= CINE.chaseMaxSec;
        let fov = CINE.fovDeg;
        if (phase === 'chase' && finished) { phase = 'settle'; settleT = 0; }
        if (phase === 'settle' || phase === 'hold') {
          // 球の全体が見える遠めの構図（上空カメラと同じ向きで、全画面に全体が収まるまで下がった位置）へなじみ、一度止まる
          settleT += dt;
          const k = ease(settleT / SETTLE);
          const city = views.cityCamera;
          views.widePosition(shot.radius, cam.aspect, P.wide);
          _pos.lerp(P.wide, k);
          aim(_pos, _look, fov + (city.fov - fov) * k);
          _q.copy(cam.quaternion).slerp(city.userData.baseQuat ?? city.quaternion, k);
          cam.quaternion.copy(_q);
          cam.updateMatrixWorld();
          if (phase === 'settle' && settleT >= SETTLE) phase = 'hold';
          // 止まったあと 2画面に戻り、上空カメラは保ってから近い位置へ戻る（views / blastCamera.js）
          if (settleT >= SETTLE + WIDE_HOLD) self.stop();
        } else {
          aim(_pos, _look, fov);
        }
        props.update(propClock(t, beatEnd), { facing, reflect: 0, popI: 0, camera: cam, dimK: 0 });
        return;
      }
      const c = propClock(t, beatEnd);
      let fov = CINE.fovDeg;
      if (t < WHITE) {
        _pos.copy(P.eye);
        _look.copy(P.fwdLook);
        fov = 62;
      } else if (t < BEAT) {
        // 目から後ろ上へ、一気に引いてから緩む。見る先は両手から主人公の背中へ
        const u = (t - WHITE) / PULL;
        lerp3(P.eye, P.cam, easeOut(u), _pos);
        lerp3(P.fwdLook, P.hero, ease(u / 0.5), _look);
        fov = 62 + (CINE.fovDeg - 62) * ease(u);
      } else if (t < beatEnd) {
        const turn = ease((t - BEAT) / 0.14), push = (t - BEAT) / (beatEnd - BEAT);
        lerp3(P.cam, P.beatPos, 0.75 * turn + 0.25 * push, _pos);
        lerp3(P.hero, P.refl, turn, _look);
        fov = CINE.fovDeg + (BEAT_FOV - CINE.fovDeg) * turn;
        P.beatEndPos.copy(_pos);
      } else {
        // 時間が動き出す: 一気にもとの道と構図へ戻る
        const k = ease((t - beatEnd) / 0.08);
        lerp3(P.beatEndPos, P.cam, k, _pos);
        lerp3(P.refl, P.hero, k, _look);
        fov = BEAT_FOV + (CINE.fovDeg - BEAT_FOV) * k;
      }
      aim(_pos, _look, fov);
      // 小道具と目
      const reflect = ease((t - BEAT + 0.04) / 0.1) * (1 - ease((t - beatEnd + 0.02) / 0.1));
      const popI = c < 0 ? 0 : Math.min(1, 1.4 - c) * 1.2;
      const dimK = ease((t - BEAT) / 0.12) * (1 - ease((t - beatEnd + 0.03) / 0.06));
      props.update(c, { facing, reflect, popI, camera: cam, dimK });
      if (reflect > 0 && eye) {
        const u = eye.material.uniforms;
        const b = Math.min(1, Math.max(0, (t - BEAT) / (beatEnd - BEAT)));
        u.uTime.value = t;
        u.uGlow.value = 0.12 + 0.88 * b * b;
        // 細く硬くにらんでいた目が、光が迫った瞬間に凍りついたように見開かれる
        u.uOpen.value = 0.08 + 0.87 * ease((b - 0.55) / 0.08);
        u.uLook.value = ease((b - 0.3) / 0.06) * 0.7;
        // 一拍のうちに、片方の目へ寄っていく
        const z = ease(b / 0.9), hw = 1 - 0.3 * z, cx = -0.3 * z;
        eyeCam.left = cx - hw; eyeCam.right = cx + hw; eyeCam.top = hw / 2; eyeCam.bottom = -hw / 2;
        eyeCam.updateProjectionMatrix();
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(rt);
        renderer.render(eyeScene, eyeCam);
        renderer.setRenderTarget(prev);
      }
    },
    // 上空カメラの2画面へ戻る
    stop() {
      phase = 'off';
      props.hide();
    },
  };
  return self;
}
