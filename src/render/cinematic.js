import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createTimeline, perceivedTime, FINALE } from './finaleTimeline.js';
import { retreatPoint } from './finalePlan.js';
import { createCinematicProps } from './cinematicProps.js';
import { createCineEye } from './cineEye.js';
import { createSpaceView } from './spaceView.js';

// 最後の一発の演出（画面全体を使う。仕様 12 章の絵コンテ 1〜5）。時間割は finaleTimeline.js、撮る場所は finalePlan.js。
//   1. 離す → 両手が組み合わさる（2画面のまま）→ 画面全体が真っ白
//   2. ガラスの一拍（持ち主の絵コンテ 2026-11-21 09:40）: 軍勢の一人（浮遊バイクの乗り手）の背後・肩越し。その向こうから
//      光の壁が迫り、時間がほぼ止まる。音は心臓の鼓動だけ。瓦礫にまじって割れた窓ガラスがゆっくり回りながら飛んでくる。
//      手前を横切るひとつのガラス片に、一瞬その乗り手の目が映り、画面のこちら（遊んでいる人）をまっすぐ見る
//   3. 時間が一気に戻る（爆発の音が開く）。肩越しのまま、その乗り手が光の壁に飲まれてバイクごと吹き飛び、カメラも飲まれて白 →
//      追ってくる爆発から、カメラが通りを上へ・外へ逃げ、
//      ゆっくり進む光の壁（見せる期）を止まって待ち受ける: 手前のビルが飲まれ、球の全体がだんだん大きく迫る
//   4. 宇宙（光の壁がまだ進んでいるうちに切り替わる）: 夕暮れの地球の丸みの上で、光の半球が街の前線の残りと同じく
//      ゆっくりゆるみながら 2 秒あまりかけてふくらみ、止まる（domeAt）。衝撃波の輪が雲の上を走る
//   5. 半球が地平に沿って押しつぶされ、横一線の光になり、細くなって消える。無音のあと、低い地鳴り
// 終わると 'end' を知らせ（結果へ。G4 のリプレイはここに入る）、最後の宇宙の絵を出したまま待つ（held）。
// ゲームの時計はこの演出が決める（gameDt）。前線の進みは演出の時刻表どおりになる。

// 追われて引くカメラは front からこの距離だけ先にいたい（lead）、決してこれより近づかない（minLead）
export const leadFor = (front) => 20 + 0.6 * front;
export const minLeadFor = (front) => 6 + 0.08 * front;

// 肩越しの乗り手が吹き飛ぶ: 光の壁の面が届く FLING_LEAD 秒前から、外（カメラの方）へ速さ v・加速 a（光の壁のすぐ前を
// 押されて飛ぶ）、上へ up、カメラの肩と反対の横へ side（レンズを突き抜けず、すぐ横をかすめる）。m/s
export const FLING_LEAD = 0.04;
export const FLING = { v: 25, a: 40, up: 4, side: 6 };

// 追われて引く距離 s。生きた front を毎フレーム読み、front + lead へ臨界減衰のばねで向かう。
// 戻らず、front + minLead より近づかない（front が急に速くなればカメラも同じだけ速くなる）。
// hold: 引くのはここまで（ゆっくり進む光の壁を、止まったカメラが待ち受ける。それでも minLead より近づかない）
export function createChase(s0, { rate = 6, lead = leadFor, minLead = minLeadFor, hold = Infinity } = {}) {
  let s = s0, v = 0;
  return {
    get s() { return s; },
    update(dt, front) {
      const want = Math.max(s, Math.min(hold, front + lead(front)));
      if (dt > 0) {
        v = (v + rate * rate * (want - s) * dt) / (1 + 2 * rate * dt + rate * rate * dt * dt);
        v = Math.max(0, v);
        s += v * dt;
      }
      const floor = front + minLead(front);
      if (s < floor) { if (dt > 0) v = Math.max(v, (floor - s) / dt); s = floor; }
      return s;
    },
  };
}

// 追われて引くカメラが止まる距離: 宇宙へ切り替わるときの前線 fCut の (1 + gap) 倍 + add（m）
export const CHASE_HOLD = { gap: 0.55, add: 20 };

// 画面の縦横比ごとのレンズ（縦の画角、度）。縦長の画面は横が狭いので広め
export const LENS = {
  shoulder: { portrait: 42, landscape: 32 },   // 2: 乗り手の肩越し（少し長いレンズで、迫る光の壁を大きく）
  chase: { portrait: 78, landscape: 56 },      // 3: 追われて引く
};
// 黒い帯: 画面をこの縦横比に切る（縦長は 9:16、横長はシネマスコープ）
export const BARS = { portrait: 9 / 16, landscape: 2.39 };

export function barsFor(aspect) {
  const target = aspect < 1 ? BARS.portrait : BARS.landscape;
  return Math.max(0, (1 - aspect / target) / 2);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3;
const easeInOut = (x) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
// 心臓の鼓動の波形（ドクン: 強い一打と、少し後の弱い一打）
const pulse = (t, beats) => {
  let p = 0;
  for (const b of beats) {
    const d = t - b;
    if (d >= 0 && d < 0.6) p = Math.max(p, Math.exp(-d * 14) + 0.55 * (d > 0.22 ? Math.exp(-(d - 0.22) * 14) : 0));
  }
  return p;
};

const EYE_RT = { high: [768, 480], mid: [512, 320], low: [384, 240] };
// 宇宙へ切り替わった瞬間の光の半球の大きさ（最大に対する割合）。街の画で大きく迫っていた球が、
// 宇宙で急に小さく見えないよう大きめから始める
const DOME0 = 0.4;
// 宇宙の衝撃波の殻の半径（rMax に対する割合）。p は半球のふくらみ（finaleTimeline の domeAt、0〜1）。
// 半球（DOME0 + (1 − DOME0)·p）の少し先（1.05 倍から 1.45 倍へ）を、半球と同じ進みでふくらむ
export const shellRadius = (p) => (DOME0 + (1 - DOME0) * p) * (1.05 + 0.4 * p);
// 宇宙のカメラの画角（縦長は横の、横長は縦の、度）
const SPACE_FOV = { h: 54, v: 36 };

// views: createViews の戻り値（全画面の大きさ）、enemyView: 目の色と主人公の向き、explosionView: 揺れと閃光。
// opts.renderer: 目のレンダーターゲット、opts.scene: 小道具を置く街の場面、opts.tier: 画質の段
// opts.lights: { sun, fill }（街の光。一拍の間は、光を背にしたビルの壁が影に沈むよう弱める）
// opts.getTier: 今の画質の段（演出を始めるたびに読み、目の画像の大きさ・雲の細かさ・星やガラス片の数を合わせる。
// 部品は始めの段の大きさで作る。段は下がるだけなので、それより重くはならない）
// opts.veilBuilding(id, on): 肩越しのカットの間だけ、光の壁が触れた（近い縁に届いた）ビルを一時的に隠す（球の面へ半分だけ
// 押されたビルの壁が引き伸ばされてレンズの前を横切らないように。光の壁の面がその場所をおおう）。追うカットへ切り替わると戻す
// （そこから先は今までどおり、光の壁に飲まれてつぶれていく）。触れたかは水平の距離で見る（ビルは地面 y=0 に立つ箱で、
// 爆心の球に最も近い点は足元の、水平に最も近い点）
export function createCinematic(views, enemyView, explosionView, { renderer, scene, sunDir, tier = 'high', getTier = () => tier, cfg = CONFIG, lights = null, veilBuilding = null } = {}) {
  const listeners = {};
  const emit = (name, arg) => { for (const fn of listeners[name] ?? []) fn(arg); };
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
  const [rw, rh] = EYE_RT[tier] ?? EYE_RT.mid;
  const rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, depthBuffer: false });
  let playTier = tier;
  const eye = createCineEye();
  const props = createCinematicProps(scene, rt.texture, { sunDir, tier });
  const space = createSpaceView(tier);

  // phase: 'off' | 'play'（時刻表を進める） | 'held'（終わって最後の絵のまま待つ）
  let phase = 'off', t = 0, plan = null, tl = null, stage = 'off';
  let gameDt = 0, worldDt = 0, chase = null, chaseC = 1, chaseR0 = 0, cuesDone = new Set(), focusOn = false;
  // 逃げる道（planFinale の retreat: false で後回しにしたもの）を求める関数。一拍の間に一度だけ呼ぶ
  let resolveRetreat = null;
  // 光の壁が近い縁に届いたら隠すビル（近い順）と、次に見る番号
  let touch = [], touchAt = 0;
  // 一時的に隠したビルを戻す（隠したのは touch の先頭から touchAt まで）
  function unveilAll() {
    for (let i = 0; i < touchAt; i++) veilBuilding(touch[i][1], false);
    touch = []; touchAt = 0;
  }
  function ensureRetreat() {
    if (!plan.retreat && resolveRetreat) plan.retreat = resolveRetreat();
    resolveRetreat = null;
    return plan.retreat;
  }
  // cam / look: 始めの肩越し（少し後ろ）。near / lookNear: ガラス片が来ると寄る肩越し（頭の後ろ・肩の上、ガラス片を見る）。glass: 目が映るガラス片の止まる所
  const P = { cam: new THREE.Vector3(), look: new THREE.Vector3(), radial: new THREE.Vector3(), near: new THREE.Vector3(), lookNear: new THREE.Vector3(), glass: new THREE.Vector3(), end: new THREE.Vector3() };
  const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const screen = { flash: 0, time: 0, heat: null, grade: { bars: 0, ca: 0, vig: 0, sat: 1, grain: 0, streak: 0, exposure: 1, fade: 0, warm: 0, contrast: 1, bloom: 1 } };
  let rMax = 20, spaceDist = 260, wideK = 0;

  const baseLight = lights ? { sun: lights.sun?.intensity ?? 0, fill: lights.fill?.intensity ?? 0 } : null;
  function dimLights(k) {
    if (!lights) return;
    if (lights.sun) lights.sun.intensity = baseLight.sun * (1 - 0.6 * k);
    if (lights.fill) lights.fill.intensity = baseLight.fill * (1 - 0.7 * k);
  }

  // 肩越しのカットの間に隠す、街の側の物: 爆発の粉の板と、壊れたビルから飛ぶ物理の破片（レンズの前に来て乗り手をおおう）
  let worldFx = null;
  function setExplosionDust(on) {
    worldFx ??= [explosionView.group?.getObjectByName?.('dust'), scene?.getObjectByName?.('debris')].filter(Boolean);
    for (const o of worldFx) o.visible = on;
  }

  const aspect = () => views.size.w / Math.max(1, views.size.h);
  const lens = (l) => (aspect() < 1 ? l.portrait : l.landscape);

  function aim(pos, look, fovDeg, roll = 0) {
    cam.aspect = aspect();
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    if (roll) cam.rotateZ(roll);
    cam.fov = fovDeg;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  function cue(name, arg) {
    const key = name + (arg ?? '');
    if (cuesDone.has(key)) return;
    cuesDone.add(key);
    emit('cue', { name, arg });
  }

  // ---- 2: ガラスの一拍（乗り手の肩越し）と、時間が戻って乗り手とカメラが飲まれるまで ----
  // 肩越しのカメラの基準（play で決める）: 位置 P.cam、見る先 P.look、その向きの右・上・前 B.R / B.U / B.F
  const B = { R: new THREE.Vector3(), U: new THREE.Vector3(), F: new THREE.Vector3() };
  // 乗り手（演出の一人）: 置き場所・頭・目・外向き（爆心から離れる、吹き飛ぶ向き）・前・右手側。姿勢は毎フレーム riderPose に書き、enemyView が読む
  const RD = { pos: new THREE.Vector3(), head: new THREE.Vector3(), eye: new THREE.Vector3(), out: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), yaw: 0, side: 1, turn: 0 };
  const riderPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, reach: 0, thrust: 1, keep: 0, head: 0, anchor: 0 };
  // 目が映るガラス片の道（演出の秒で: 光の壁から現れ → 目が合う所 → 乗り手の頭の横をこちらへ）と、目が合う向き
  const HS = { p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), m0: new THREE.Vector3(), m1a: new THREE.Vector3(), m1b: new THREE.Vector3(), m2: new THREE.Vector3(), t0: 0, tM: 0, t2: 0, width: 0.6, axis: new THREE.Vector3(0.35, 1, 0.15).normalize(), q0: new THREE.Quaternion() };
  const heroState = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), width: 0.6, reflect: 0, slide: [0, 0] };
  // 確かめ用（テストと撮影）: 乗り手の姿勢、目が映るガラス片（出ていなければ null）、乗り手の目の位置、映った目の uniforms
  const beatInfo = { rider: riderPose, glass: null, eyePos: RD.eye, eye: null };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _q2 = new THREE.Quaternion();
  const hermite = (out, p0, m0, p1, m1, u) => {
    const u2 = u * u, u3 = u2 * u;
    return out.copy(p0).multiplyScalar(2 * u3 - 3 * u2 + 1).addScaledVector(m0, u3 - 2 * u2 + u).addScaledVector(p1, -2 * u3 + 3 * u2).addScaledVector(m1, u3 - u2);
  };
  // ガラス片の向き: ガラス片は乗り手の顔の前（光の壁の側）にあり、鏡の面は後ろ（乗り手とカメラの方）を向く。法線はガラス片から
  // カメラへの向きと乗り手の目への向きのちょうど間: カメラの視線がそこで返ると乗り手の目に届く＝カメラには乗り手の顔が正面から映る。
  // 映った目は（演出として）まっすぐこちらを見る。上はカメラの上
  function mirrorQuat(out, at, camPos, eyePos = camPos) {
    _n.copy(camPos).sub(at).normalize();
    _c.copy(eyePos).sub(at).normalize();
    _n.add(_c).normalize();
    _c.crossVectors(B.U, _n).normalize();
    _b.crossVectors(_n, _c);
    return out.setFromRotationMatrix(_m.makeBasis(_c, _b, _n));
  }
  // ガラス片の位置（演出の秒 t）。一拍が終わると体感時間で一気に飛び去る
  function heroPos(out, t) {
    if (t <= HS.tM) return hermite(out, HS.p0, HS.m0, HS.p1, HS.m1a, clamp01((t - HS.t0) / (HS.tM - HS.t0)));
    if (t <= HS.t2) return hermite(out, HS.p1, HS.m1b, HS.p2, HS.m2, (t - HS.tM) / (HS.t2 - HS.tM));
    return out.copy(HS.p2).addScaledVector(HS.m2, (t - HS.t2) / (HS.t2 - HS.tM) / FINALE.slowRate);
  }

  // 寄る肩越しへの動き（0 → 1）: ガラス片が飛んでくる間（contact の少しあと〜目が合う直前）に、演出の秒でゆっくり
  const nearAt = (t) => easeInOut((t - (tl.contact + 0.3)) / (tl.eye[0] + 0.05 - (tl.contact + 0.3)));
  // 目が合ったあと、最後の鼓動の間に少し戻る（0 → 1。飲まれる所 P.end へ）
  const backAt = (t) => easeInOut((t - (tl.eye[1] + 0.1)) / (tl.beatEnd - (tl.eye[1] + 0.1)));

  function updateShoulder() {
    const c = tl.contact, be = tl.beatEnd;
    const Pt = perceivedTime(t);
    const b = clamp01((t - c) / (be - c));
    const hb = pulse(t, tl.beats);
    const front = tl.front(t);
    // カメラ: 少し後ろの肩越しから始まり、ごくわずかに押し込む。ガラス片が飛んでくると（演出の秒で、体感時間ではなく）ゆっくり
    // 乗り手の肩の上へ寄り、顔の前のガラス片を見る（ガラス片と映った目が画面の大きな部分を占め、ヘルメットと肩が縁に入る）。
    // 寄ったところで止まり、時間が戻って乗り手が飲まれると、押し寄せる光に後ろへ弾かれ、揺れる
    const push = 0.08 * smooth((t - tl.white) / (c - tl.white)) + 0.1 * smooth((t - c) / (be - c));
    const m = nearAt(t), mb = backAt(t);
    const r = Math.max(0, t - tl.engulf + 0.03);
    const recoil = 9 * r + 20 * r * r;
    _pos.copy(P.cam).addScaledVector(B.F, push).lerp(P.near, m).addScaledVector(B.U, 0.12 * Math.sin(Math.PI * m)).lerp(P.end, mb);
    _a.copy(P.look).addScaledVector(B.F, push).sub(_pos).normalize();
    _b.copy(P.lookNear).sub(_pos).normalize();
    _look.copy(_pos).addScaledVector(_a.lerp(_b, m * (1 - 0.75 * mb)).normalize(), 10);
    _pos.addScaledVector(RD.out, recoil);
    _look.addScaledVector(RD.out, recoil);
    // 手持ちのごくわずかな揺れ（止まった時間の中なので、ほとんど動かない）
    _pos.addScaledVector(B.R, 0.006 * Math.sin(t * 0.9)).addScaledVector(B.U, 0.005 * Math.sin(t * 0.7 + 1));
    let fov = lens(LENS.shoulder) * (1 - 0.012 * hb) + 9 * smooth(r / 0.22);
    aim(_pos, _look, fov, -0.02 * easeInOut(b));
    const shake = r > 0 ? 0.03 * smooth(r / 0.05) : 0;
    if (shake) {
      _e.set(shake * Math.sin(t * 41), shake * Math.sin(t * 33 + 1.3), shake * 0.7 * Math.sin(t * 27 + 2.1));
      cam.quaternion.multiply(_q.setFromEuler(_e));
      cam.updateMatrixWorld();
    }
    // 乗り手: 爆心を向いて浮き、推進の光を灯したまま固まる。ガラス片が来ると頭をわずかにそちらへ向ける。
    // 光の壁に届かれると（engulf）バイクごとこちらへ吹き飛ぶ
    const look = smooth((t - (tl.eye[0] - 0.45)) / 0.4);
    // 吹き飛ぶのは、光の壁の面がわずかに届く手前（押し寄せる圧の波）から。壁のすぐ前を、回りながらカメラの横へ
    const k = Math.max(0, t - (tl.engulf - FLING_LEAD));
    riderPose.x = RD.pos.x; riderPose.y = RD.pos.y + 0.03 * Math.sin(t * 0.9); riderPose.z = RD.pos.z;
    riderPose.yaw = RD.yaw + 0.01 * Math.sin(t * 0.6); riderPose.pitch = 0.015; riderPose.roll = 0.02 * Math.sin(t * 0.7);
    riderPose.head = RD.turn * look; // 顔の前へ来るガラス片の方へ
    riderPose.thrust = 1.25; riderPose.keep = 1; riderPose.reach = 0;
    if (k > 0) {
      const fly = FLING.v * k + 0.5 * FLING.a * k * k;
      // 押される向きは外（爆心から離れる）とカメラの方（乗り手の後ろ）の間: カメラへ向かって飛び、レンズのすぐ横をかすめる
      const dx = RD.out.x * 0.4 - RD.fwd.x * 0.6, dz = RD.out.z * 0.4 - RD.fwd.z * 0.6, dl = Math.hypot(dx, dz);
      riderPose.x += dx / dl * fly - RD.right.x * RD.side * FLING.side * k;
      riderPose.z += dz / dl * fly - RD.right.z * RD.side * FLING.side * k;
      riderPose.y += FLING.up * k - 2 * k * k;
      riderPose.pitch -= 5 * k + 9 * k * k;
      riderPose.roll += RD.side * 5 * k;
      riderPose.yaw += 2 * k;
      riderPose.head *= Math.max(0, 1 - 6 * k);
      riderPose.thrust = Math.max(0, 1.25 - 5 * k);
    }
    if (t >= tl.snap) riderPose.keep = 0;
    // 目が映るガラス片: 光の壁から現れ、ゆっくり回りながら飛んできて、手前を横切る。目が合う間（tl.eye）は
    // 鏡の向きがカメラと乗り手の目の真ん中へそろい、ほとんど回らない。回るにつれて像が縁から抜ける
    let hero = null;
    beatInfo.glass = null;
    if (t >= HS.t0 && t < be + 0.08) {
      heroPos(heroState.pos, t);
      const dt = t - HS.tM;
      const w = smooth((t - (tl.eye[0] - 0.5)) / 0.35) * (1 - smooth((t - (tl.eye[1] + 0.05)) / 0.4));
      // 向きがそろった姿勢から、目が合う間はごくわずか（0.07 rad/s）、その外は大きく（3 乗で）回る
      const theta = 0.07 * dt + 0.5 * dt * dt * dt;
      mirrorQuat(_q2, heroState.pos, cam.position, RD.eye);
      heroState.quat.copy(HS.q0).multiply(_q.setFromAxisAngle(HS.axis, theta)).slerp(_q2.multiply(_q.setFromAxisAngle(HS.axis, 0.07 * dt)), w);
      // 映った目の像のずれ: 鏡の中心で反射した視線が、乗り手の目へまっすぐ届く向きからどれだけそれたか（ガラスの面の向きで）
      _n.set(0, 0, 1).applyQuaternion(heroState.quat);
      _a.copy(heroState.pos).sub(cam.position).normalize(); // 見る向き
      _a.reflect(_n);                                       // 反射した視線
      _b.copy(RD.eye).sub(heroState.pos).normalize();
      _a.sub(_b);
      _c.set(1, 0, 0).applyQuaternion(heroState.quat);
      _b.set(0, 1, 0).applyQuaternion(heroState.quat);
      heroState.slide[0] = 2.2 * _a.dot(_c); heroState.slide[1] = 2.2 * _a.dot(_b);
      heroState.width = HS.width * smooth((t - HS.t0) / 0.25);
      heroState.reflect = smooth((t - tl.eye[0]) / 0.08) * (1 - smooth((t - (tl.eye[1] - 0.1)) / 0.1));
      hero = heroState;
      beatInfo.glass = heroState;
    }
    const light = 0.3 + 0.45 * smooth((t - tl.white) / (c - tl.white)) + 0.25 * b + 0.6 * smooth(r / 0.15);
    const ps = views.size.h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    props.update({ t, P: Pt, light, pointScale: ps, fade: 1, front, camera: cam, hero, wall: 0.5 + 0.1 * light });
    // 目: 映った一瞬、はじめはわずかに横（光の壁）を見ていて、心臓の鼓動とともにこちらへ目が合う。
    // にらみ → 鼓動ごとに開き → 凍りついた見開き。瞳には迫る光が映り、育つ
    if (hero && heroState.reflect > 0) {
      const u = eye.uniforms;
      const lock = tl.beats.find((x) => x >= tl.eye[0]) ?? tl.eye[0];
      const met = smooth((t - lock) / 0.05);
      const e = clamp01((t - tl.eye[0]) / (tl.eye[1] - tl.eye[0]));
      u.uOpen.value = Math.min(1, 0.16 + 0.34 * smooth((t - lock) / 0.08) + 0.45 * smooth((t - lock - 0.08) / 0.4) + 0.05 * hb);
      u.uLight.value = 0.18 + 0.4 * e ** 1.3; // 瞳の上の迫る光は黒目の半分ほどまで（目が光の玉にならない）
      u.uFlood.value = 0;
      u.uLook.value = 1.3 * (1 - met) - 0.55 * met;
      u.uTime.value = t;
      eye.render(renderer, rt);
    }
    const g = screen.grade;
    g.sat = 0.85; g.warm = 0.55; g.contrast = 1.3;
    g.vig = 0.45 + 0.3 * smooth((t - c) / 0.5) + 0.15 * hb + 0.15 * Math.sin(Math.PI * clamp01((t - tl.eye[0]) / (tl.eye[1] - tl.eye[0])));
    g.ca = 0.35 + 0.2 * b + 0.5 * hb + 2.0 * smooth(r / 0.1);
    g.exposure = 0.8 - 0.08 * hb + 0.6 * smooth(r / 0.25);
    // 画面いっぱいの光の壁に bloom を強くかけると全体が白い膜になる: 一拍の間は弱く、時間が戻って光が押し寄せると強く
    g.bloom = 0.22 + 0.8 * smooth(r / 0.2);
    g.grain = 0.05;
    // 白が晴れる閃光。光の壁がカメラに届く手前から白へ（追うカットへは白のまま切り替わる）
    const camD = _pos.length();
    screen.flash = Math.max(0, 0.95 * Math.exp(-(t - tl.white) / 0.03))
      + (t >= tl.resume ? Math.max(smooth((front - (camD - 1.2)) / 1.2), smooth((t - (tl.snap - 0.07)) / 0.07)) : 0);
    for (let i = 0; i < tl.beats.length; i++) if (t >= tl.beats[i] && t < tl.beatEnd) cue('heart', i);
  }

  // ---- 3: 時間が戻り、追ってくる爆発から逃げる ----
  function updateChase(dt) {
    const front = tl.front(t);
    // はじめは通りの高さで、すぐ後ろに迫る光の壁から逃げる（近い）。追いつかれる寸前に振り切り、
    // 光の壁の輪郭（球の上の縁）が画面に入る遠さへ引いて、街が飲まれていく全体を見せる
    const k = (t - tl.snap);
    const wide = smooth((k - 0.6) / 0.8);
    if (!chase) {
      const d = ensureRetreat().dir;
      chaseC = Math.max(0.35, (d[0] * P.radial.x + d[1] * P.radial.z));
      // 見せる期: カメラは宇宙へ切り替わるときの前線（fCut）の外の hold で止まり、ゆっくり進む光の壁が
      // 手前のビルを飲みながら迫ってくるのを待ち受ける（球の全体が入り、だんだん大きくなる）
      const fCut = tl.fCut;
      chase = createChase(chaseR0, {
        lead: (f) => (16 + 0.55 * f) * (1 - wideK) + (24 + 1.25 * f) * wideK,
        minLead: (f) => (8 + 0.2 * f) * (1 - wideK) + (8 + 0.35 * f) * wideK,
        hold: Math.max(chaseR0, fCut * (1 + CHASE_HOLD.gap) + CHASE_HOLD.add),
      });
    }
    wideK = wide;
    const s = chase.update(dt, front);
    const x = Math.max(0, (s - chaseR0) / chaseC);
    _pos.fromArray(retreatPoint(plan.retreat, x));
    // 爆心の方、迫る光の壁が街に触れているあたりを見る（近いうちは壁の根元、引くと球の全体）
    const lookD = front * 0.3, lookY = Math.max(4, front * (0.2 + 0.18 * wide));
    _look.copy(P.radial).multiplyScalar(Math.max(4, lookD)).setY(lookY);
    const fov = lens(LENS.chase) + 10 * Math.exp(-k / 0.35);
    const shake = Math.min(0.06, (explosionView.cameraInfo?.shake ?? 0) * 2.2 + 0.02 * Math.exp(-k / 0.25));
    aim(_pos, _look, fov, 0);
    _e.set(shake * Math.sin(t * 37), shake * Math.sin(t * 29 + 1.3), shake * 0.6 * Math.sin(t * 23 + 2.1));
    cam.quaternion.multiply(_q.setFromEuler(_e));
    cam.updateMatrixWorld();
    const g = screen.grade;
    g.sat = 1.05; g.warm = 0.25; g.vig = 0.35; g.grain = 0.04; g.exposure = 0.85; g.contrast = 1.1; g.bloom = 1;
    g.ca = 0.5 + 2.4 * Math.exp(-k / 0.3);
    // 白から、弾けた閃光へ
    screen.flash = 1 - smooth(k / 0.12);
  }

  // ---- 4〜5: 宇宙 ----
  function updateSpace() {
    const u = clamp01((t - tl.chaseEnd) / (tl.flatten - tl.chaseEnd));
    const portrait = aspect() < 1;
    const push = easeOut(u) * 0.12 + Math.max(0, t - tl.flatten) * 0.012;
    space.aim({
      aspect: aspect(),
      dist: spaceDist * (1 - push), alt: (portrait ? 46 : 64) * (1 - push * 0.6),
      lookAhead: 420, lookUp: portrait ? -250 : -40,
      fovH: SPACE_FOV.h, fovV: SPACE_FOV.v, roll: 0.07 - 0.03 * easeOut(u),
    });
    // 光の半球: ふくらむ → 押しつぶされて横一線 → 細くなって消える
    const f = clamp01((t - tl.flatten) / FINALE.flattenSec);
    const th = clamp01((t - tl.flatten - FINALE.flattenSec) / FINALE.thinSec);
    // 半球は街の前線の残りと同じく、ゆっくりゆるみながらふくらみ、domeEnd に止まる（finaleTimeline の domeAt）
    const r = rMax * (DOME0 + (1 - DOME0) * tl.domeAt(t));
    const flat = easeInOut(f);
    const domeI = (0.75 + 0.35 * Math.sin(Math.PI * f)) * (1 - smooth((f - 0.3) / 0.4));
    space.setDome(r, flat, domeI, t);
    // 衝撃波の輪: 半球の根元から雲の上を走り、カメラの下をくぐって消える
    const ru = clamp01((u - 0.03) / 0.97);
    const ringR = r * 0.9 + (spaceDist * 0.78) * (1 - (1 - ru) ** 1.5);
    // カメラの下へ近づくほど太く見えるので、近づく前に薄れる
    space.setRing(ringR, ru > 0 ? (1 - smooth((ru - 0.45) / 0.45)) * (1 - f) * smooth(ru / 0.05) : 0);
    // 衝撃波の殻: 半球の少し先を、半球と同じゆっくりした進み（domeAt）でふくらみ、ふくらみきる前に薄れて消える
    const pd = tl.domeAt(t);
    space.setShell(rMax * shellRadius(pd), (1 - smooth((pd - 0.55) / 0.45)) * smooth(u / 0.06) * (1 - f));
    // 横一線の光: 画面の横幅の大半にわたる
    const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(space.camera.fov) / 2) * space.camera.aspect);
    const d = space.camera.position.length();
    const len = 2 * d * Math.tan(hf / 2) * (0.6 + 0.5 * smooth(f / 0.7)) * (1 + 0.15 * th);
    const lineI = smooth((f - 0.15) / 0.35) * (1 - smooth((th - 0.35) / 0.65)) * (1.2 + 0.8 * Math.sin(Math.PI * clamp01(f * 1.3)));
    space.setLine(len, r * 1.1 * (1 - 0.8 * flat), th, lineI);
    // 消えたあとに残る、焼けた街の小さな灯
    space.setScar(2.0 * smooth((t - tl.lineEnd + 0.3) / 0.6) * (1 - 0.4 * smooth((t - tl.rumble) / 1.5)));
    space.setStars(smooth(u / 0.4));
    const g = screen.grade;
    g.sat = 1.0; g.warm = 0.1; g.grain = 0.035; g.contrast = 1.05; g.bloom = 0.55;
    g.vig = 0.5;
    g.ca = 0.25 + 0.6 * lineI;
    g.streak = lineI;
    // 地鳴りの間、ごくわずかに揺れる
    if (t > tl.rumble) {
      const k = Math.min(1, (t - tl.rumble) / 0.4) * 0.0025;
      space.camera.rotateX(k * Math.sin(t * 31));
      space.camera.rotateY(k * Math.sin(t * 23 + 1));
      space.camera.updateMatrixWorld();
    }
    g.exposure = 1 - 0.18 * smooth((t - tl.lineEnd) / 1.2);
    screen.flash = 0;
  }

  const self = {
    get active() { return phase !== 'off'; },
    // 演出の時刻表が終わったか（終わったあとは最後の絵のまま待つ）
    get finished() { return phase === 'held'; },
    // ゲームが止まって見える間（両手と白の間）
    get frozen() { return phase === 'play' && t < (tl?.white ?? 0); },
    // 画面全体を演出のカメラで描くか（手の画面と HUD は描かない）
    get fullscreen() { return phase === 'held' || (phase === 'play' && t >= tl.hands); },
    get white() { return phase === 'play' && stage === 'white'; },
    get camera() { return stage === 'space' || stage === 'flatten' || stage === 'silence' || stage === 'rumble' || stage === 'done' ? space.camera : cam; },
    // 描く場面（null なら街の場面）
    get renderScene() { return self.camera === space.camera ? space.scene : null; },
    get plan() { return plan; },
    // 小道具の場面（確かめ用）
    get propsGroup() { return props.group; },
    // ガラスの一拍の確かめ用: { rider（姿勢）, glass（目が映るガラス片 { pos, quat, width, reflect, slide } か null）, eyePos, eye（目の uniforms） }
    get beat() { beatInfo.eye = eye.uniforms; return beatInfo; },
    get timeline() { return tl; },
    get time() { return t; },
    get stage() { return stage; },
    get phase() { return phase; },
    // このフレームでゲームを進める秒（ゲームの時計は演出の時刻表が決める）
    get gameDt() { return phase === 'off' ? null : gameDt; },
    // 世界（破片・粉・球の模様・軍勢）を進める秒
    get worldDt() { return worldDt; },
    get screen() { return phase === 'off' ? null : screen; },
    on(name, fn) { (listeners[name] ??= []).push(fn); },
    warmup(r, camera) {
      props.group.visible = true;
      r.compile(scene, camera);
      props.group.visible = false;
      r.compile(eye.scene, eye.camera);
      space.warmup(r);
      // 宇宙の場面と目は一度小さく描いて、形と画像を先に GPU へ送っておく（切り替わった瞬間に止まらないように）
      space.aim({ aspect: 0.5, dist: 190, alt: 46, lookAhead: 420, lookUp: -250, fovH: SPACE_FOV.h, fovV: SPACE_FOV.v });
      const tmp = new THREE.WebGLRenderTarget(16, 16);
      const prev = r.getRenderTarget();
      r.setRenderTarget(tmp);
      r.render(space.scene, space.camera);
      r.setRenderTarget(rt);
      r.render(eye.scene, eye.camera);
      r.setRenderTarget(prev);
      tmp.dispose();
    },
    // 今の演出の画質: 段・目の画像の大きさ・雲の段数と星の数・ガラス片と塵の数
    get quality() { return { tier: playTier, eye: [rt.width, rt.height], space: space.tierInfo, props: props.counts }; },
    // 'cinematicStart': plan は finalePlan.planFinale の戻り値。
    // opts.retreat: plan.retreat が null のとき逃げる道を返す関数（重いので、放つ瞬間ではなく止まった一拍の間に呼ぶ）
    // opts.buildings: 残っているビル（肩越しのカットの間、光の壁が触れたものを veilBuilding で一時的に隠す）
    play(p, s, { retreat = null, buildings = null } = {}) {
      plan = { ...p }; phase = 'play'; t = 0; stage = 'hands';
      resolveRetreat = retreat;
      if (!plan.retreat && !resolveRetreat) throw new Error('cinematic.play: plan.retreat がなく、求める関数もない');
      playTier = getTier();
      const [ew, eh] = EYE_RT[playTier] ?? EYE_RT.mid;
      if (ew !== rt.width || eh !== rt.height) rt.setSize(ew, eh);
      space.setTier(playTier);
      tl = createTimeline({ radius: s.radius, hitDist: p.hitDist, riderDist: p.riderDist, camDist: p.camDist }, undefined, cfg);
      chase = null; cuesDone = new Set(); focusOn = false;
      const nearOf = (b) => Math.hypot(Math.max(0, Math.abs(b.x) - b.w / 2), Math.max(0, Math.abs(b.z) - b.d / 2));
      unveilAll();
      touch = veilBuilding && buildings ? buildings.map((b) => [nearOf(b), b.id]).filter(([d]) => d < s.radius).sort((a, b) => a[0] - b[0]) : [];
      touchAt = 0;
      P.cam.fromArray(p.camPos); P.look.fromArray(p.look);
      P.radial.set(p.camPos[0], 0, p.camPos[2]).normalize();
      chaseR0 = Math.hypot(p.camPos[0], p.camPos[2]);
      // 主人公は撮る向きを向く
      enemyView.setHeroYaw(Math.atan2(P.radial.x, P.radial.z));
      // 同じ人は同じ目
      const src = enemyView.eyeCloseup?.(p.riderId)?.material?.uniforms;
      if (src) eye.setIdentity({ iris: src.uIris?.value, skin: src.uSkin?.value, seed: src.uSeed?.value });
      // 乗り手（演出の一人）: 置き場所・頭（前かがみで少し前）・目・外向き（カメラの方）・右手側
      RD.pos.fromArray(p.rider.pos); RD.out.fromArray(p.rider.out); RD.fwd.fromArray(p.rider.fwd); RD.yaw = p.rider.yaw; RD.side = p.rider.side;
      RD.right.set(-RD.fwd.z, 0, RD.fwd.x);
      if (p.rider.head) RD.head.fromArray(p.rider.head);
      else RD.head.copy(RD.pos).add(_a.set(0, 1.43, 0)).addScaledVector(RD.fwd, 0.02);
      RD.eye.copy(RD.head).addScaledVector(RD.fwd, 0.11);
      riderPose.keep = 0;
      // 寄った肩越しのカメラとガラス片の止まる所（古い plan にはないので、そのときは乗り手から決める）
      const side = (x) => _a.copy(RD.right).multiplyScalar(x * RD.side);
      if (p.glass) P.glass.fromArray(p.glass); else P.glass.copy(RD.head).addScaledVector(RD.fwd, 1.25).add(side(0.3)).add(_b.set(0, 0.28, 0));
      if (p.camNear) P.near.fromArray(p.camNear); else P.near.copy(RD.head).addScaledVector(RD.fwd, -1.35).add(side(0.24)).add(_b.set(0, 0.1, 0));
      if (p.lookNear) P.lookNear.fromArray(p.lookNear); else P.lookNear.copy(P.glass).lerp(RD.head, 0.22);
      if (p.camEnd) P.end.fromArray(p.camEnd); else P.end.copy(P.near).lerp(P.cam, 0.55);
      // 頭を向ける角度（材質の頭の向きは + で乗り手の右手側の反対へ）
      _a.copy(P.glass).sub(RD.head);
      RD.turn = -0.8 * Math.atan2(_a.dot(RD.right), _a.dot(RD.fwd));
      // 寄ったカメラの上（ガラス片の向きの基準）
      aim(P.near, P.lookNear, lens(LENS.shoulder));
      cam.matrixWorld.extractBasis(B.R, B.U, B.F);
      const upNear = B.U.clone();
      // 肩越しのカメラの向き（小道具とガラス片の道の基準）
      aim(P.cam, P.look, lens(LENS.shoulder));
      cam.matrixWorld.extractBasis(B.R, B.U, B.F);
      B.F.negate();
      const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      const toWorld = (out, x, y, z) => out.copy(P.cam).addScaledVector(B.R, x).addScaledVector(B.U, y).addScaledVector(B.F, z);
      _a.copy(RD.head).sub(P.cam);
      const hc = { x: _a.dot(B.R), y: _a.dot(B.U), z: _a.dot(B.F) };
      const sx = _a.copy(P.glass).sub(P.cam).dot(B.R) < hc.x ? -1 : 1; // ガラス片の側（頭から見て）
      // 目が映るガラス片: 光の壁の際から現れ（t0）、ゆっくり回りながら飛んできて、乗り手の顔の前（光の壁の側）で止まりかける。
      // 寄ったカメラから見て頭に隠れない所（tM でカメラと乗り手の目の間を向き、乗り手の顔が映る）。一拍の終わり（t2）には
      // 頭の横（頭と反対の側）を抜けて画面の外へ
      HS.t0 = tl.contact - 0.12; HS.tM = (tl.eye[0] + tl.eye[1]) / 2; HS.t2 = tl.beatEnd;
      // 奥行き z での画面の半分の幅・高さ
      const halfW = (z) => z * tanV * cam.aspect, halfHt = (z) => z * tanV;
      const zW = hc.z + FINALE.riderGap;
      toWorld(HS.p0, sx * 0.45 * halfW(zW), 0.5 * halfHt(zW), zW);
      HS.p1.copy(P.glass);
      HS.p2.copy(P.glass).addScaledVector(RD.fwd, -1.6).add(side(1.3)).add(_b.set(0, 0.35, 0));
      const T1 = HS.tM - HS.t0, T2 = HS.t2 - HS.tM;
      _b.copy(HS.p2).sub(HS.p1).normalize().multiplyScalar(0.06); // 顔の前でのゆっくりした速さ（m/s）
      HS.m0.copy(HS.p1).sub(HS.p0).multiplyScalar(1.4);
      HS.m1a.copy(_b).multiplyScalar(T1); HS.m1b.copy(_b).multiplyScalar(T2);
      HS.m2.copy(HS.p2).sub(HS.p1).multiplyScalar(1.6);
      // 大きさ: 寄ったカメラから見て画面の幅の約 7 割（横長の画面は高さの約 7 割まで。窓ガラスの破片として 0.6 m まで）
      const zEye = P.glass.distanceTo(P.near);
      HS.width = Math.min(0.6, 0.7 * 2 * halfHt(zEye) / 0.62, 0.72 * 2 * halfW(zEye));
      const bU = B.U.clone();
      B.U.copy(upNear);
      mirrorQuat(HS.q0, HS.p1, P.near, RD.eye);
      B.U.copy(bU);
      const pc = perceivedTime(tl.contact);
      props.setup({ pos: p.camPos, fwd: B.F.toArray(), right: B.R.toArray(), up: B.U.toArray(), tanV, tanH: tanV * cam.aspect }, {
        wallDepth: hc.z + FINALE.riderGap,
        rider: [RD.pos.clone().add(_a.set(0, 0.6, 0)).toArray(), RD.head.toArray()],
        avoid: [HS.p1.toArray(), HS.p2.toArray()],
        perceived: (x) => perceivedTime(x), slowRate: FINALE.slowRate,
        birth: [tl.white + 0.05, tl.contact, tl.beatEnd - 0.7], contactP: pc,
      }, playTier);
      // 宇宙での大きさ: 大きな一発ほど大きい
      // 光の半球の最大の大きさは、宇宙のカメラの画面の高さに対して決める（縦長でも横長でも同じ見え方）
      spaceDist = aspect() < 1 ? 190 : 270;
      space.aim({ aspect: aspect(), dist: spaceDist, alt: 50, lookAhead: 420, lookUp: 0, fovH: SPACE_FOV.h, fovV: SPACE_FOV.v });
      const halfH = spaceDist * Math.tan(THREE.MathUtils.degToRad(space.camera.fov) / 2);
      // S8: 大きさの基準は S7 までの最大の半径（blast.smallRef）。広げた最大の一発（720 m）は前の最大より約 14% 大きく見える
      rMax = 0.17 * halfH * (0.5 + 0.5 * Math.sqrt(s.radius / (cfg.blast.smallRef ?? cfg.radius.max)));
      screen.grade.bars = 0; screen.grade.fade = 0; screen.grade.streak = 0;
      cue('silence');
      self.update(0);
    },
    // 'cinematicEnd': ゲーム側の止まった時間の終わり（この演出はゲームの時計を自分で進めるので、することはない）
    end() {},
    update(dt) {
      gameDt = 0; worldDt = 0;
      if (phase === 'off') return;
      // 最後の絵のまま待つ間: ゲームがまだ終わっていなければ（念のため）、ゲームの時間は現実の速さで進める
      if (phase === 'held') { gameDt = dt; updateSpace(); t += dt; return; }
      const t0 = t;
      t += dt;
      gameDt = tl.gameDt(t0, t);
      worldDt = tl.worldRate(t, dt) * dt;
      stage = tl.stage(t);
      screen.time = t;
      const g = screen.grade;
      g.bars = barsFor(aspect()) * smooth((t - tl.white) / 0.3);
      g.streak = 0;
      if (stage === 'hands') { screen.flash = 0; return; }
      // 演出の一人（乗り手）は、画面全体になってから決めた場所に描く（白の間に置き直す）
      if (!focusOn) { enemyView.setFocus?.({ id: plan.riderId, pose: riderPose }); focusOn = true; }
      if (stage === 'white') { screen.flash = 0; return; }
      // 肩越しのカットの間は、爆発の粉の板と壊れたビルの物理の破片を出さない: カメラの前に来て乗り手をおおってしまう。
      // この一拍の瓦礫と粉塵は小道具が受け持つ
      setExplosionDust(!(stage === 'contact' || stage === 'beat' || stage === 'snap'));
      if (stage === 'contact' || stage === 'beat' || stage === 'snap') {
        props.group.visible = true;
        dimLights(smooth((t - tl.white + 0.1) / 0.2) * (1 - smooth((t - tl.engulf) / 0.15)));
        if (stage === 'snap') cue('snap'); // 時間が戻る瞬間に爆発の音が開く
        const fr = tl.front(t);
        while (touchAt < touch.length && touch[touchAt][0] <= fr) veilBuilding(touch[touchAt++][1], true);
        updateShoulder();
        // 逃げる道は、世界がほぼ止まった一拍のはじめに求める（必要になるのは時間が戻ってから）
        if (stage === 'beat') ensureRetreat();
        return;
      }
      props.hide();
      dimLights(0);
      riderPose.keep = 0; // 吹き飛んだ乗り手は消える
      unveilAll(); // 追うカットでは、触れたビルは今までどおり飲まれてつぶれていく
      if (stage === 'chase') { cue('snap'); updateChase(dt); return; }
      cue('space');
      if (t >= tl.rumble) cue('rumble');
      updateSpace();
      if (stage === 'done') {
        phase = 'held';
        emit('end');
      }
    },
    // 演出をやめる（2画面へ戻る）
    stop() {
      phase = 'off'; stage = 'off';
      if (focusOn) enemyView.setFocus?.(null);
      focusOn = false;
      setExplosionDust(true);
      unveilAll();
      dimLights(0);
      props.hide();
    },
  };
  return self;
}


