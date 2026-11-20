import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createTimeline, perceivedTime, FINALE } from './finaleTimeline.js';
import { retreatPoint } from './finalePlan.js';
import { createCinematicProps } from './cinematicProps.js';
import { createCineEye } from './cineEye.js';
import { createSpaceView } from './spaceView.js';

// 最後の一発の演出（画面全体を使う。仕様 12 章の絵コンテ 1〜5）。時間割は finaleTimeline.js、撮る場所は finalePlan.js。
//   1. 離す → 両手が組み合わさる（2画面のまま）→ 画面全体が真っ白
//   2. 軍勢の一人の体感時間: 前線がビルに届き、窓ガラスが光に押されて砕ける。時間がほぼ止まり、宙に浮いたガラス片に
//      その一人の目が映る。目がゆっくり見開き、瞳の中で光が育つ。音は心臓の鼓動だけ
//   3. 瞳の光があふれて白 → 時間が戻り一気に弾ける。追ってくる爆発から、カメラが通りを上へ・外へ逃げ、
//      ゆっくり進む光の壁（見せる期）を止まって待ち受ける: 手前のビルが飲まれ、球の全体がだんだん大きく迫る
//   4. 宇宙（光の壁がまだ進んでいるうちに切り替わる）: 夕暮れの地球の丸みの上で、光の半球が街の前線の残りと同じく
//      ゆっくりゆるみながら 2 秒あまりかけてふくらみ、止まる（domeAt）。衝撃波の輪が雲の上を走る
//   5. 半球が地平に沿って押しつぶされ、横一線の光になり、細くなって消える。無音のあと、低い地鳴り
// 終わると 'end' を知らせ（結果へ。G4 のリプレイはここに入る）、最後の宇宙の絵を出したまま待つ（held）。
// ゲームの時計はこの演出が決める（gameDt）。前線の進みは演出の時刻表どおりになる。

// 追われて引くカメラは front からこの距離だけ先にいたい（lead）、決してこれより近づかない（minLead）
export const leadFor = (front) => 20 + 0.6 * front;
export const minLeadFor = (front) => 6 + 0.08 * front;

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
  building: { portrait: 74, landscape: 46 },   // 2: 前線がビルに届く（見上げる）
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
// 宇宙のカメラの画角（縦長は横の、横長は縦の、度）
const SPACE_FOV = { h: 54, v: 36 };

// views: createViews の戻り値（全画面の大きさ）、enemyView: 目の色と主人公の向き、explosionView: 揺れと閃光。
// opts.renderer: 目のレンダーターゲット、opts.scene: 小道具を置く街の場面、opts.tier: 画質の段
// opts.lights: { sun, fill }（街の光。一拍の間は、光を背にしたビルの壁が影に沈むよう弱める）
// opts.getTier: 今の画質の段（演出を始めるたびに読み、目の画像の大きさ・雲の細かさ・星やガラス片の数を合わせる。
// 部品は始めの段の大きさで作る。段は下がるだけなので、それより重くはならない）
export function createCinematic(views, enemyView, explosionView, { renderer, scene, sunDir, tier = 'high', getTier = () => tier, cfg = CONFIG, lights = null } = {}) {
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
  let gameDt = 0, worldDt = 0, chase = null, chaseC = 1, chaseR0 = 0, cuesDone = new Set();
  // 逃げる道（planFinale の retreat: false で後回しにしたもの）を求める関数。一拍の間に一度だけ呼ぶ
  let resolveRetreat = null;
  function ensureRetreat() {
    if (!plan.retreat && resolveRetreat) plan.retreat = resolveRetreat();
    resolveRetreat = null;
    return plan.retreat;
  }
  const P = { cam: new THREE.Vector3(), look: new THREE.Vector3(), shard: new THREE.Vector3(), fwd: new THREE.Vector3(), radial: new THREE.Vector3() };
  const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const facing = new THREE.Quaternion();
  const screen = { flash: 0, time: 0, heat: null, grade: { bars: 0, ca: 0, vig: 0, sat: 1, grain: 0, streak: 0, exposure: 1, fade: 0, warm: 0, contrast: 1, bloom: 1 } };
  let rMax = 20, spaceDist = 260, wideK = 0;

  const baseLight = lights ? { sun: lights.sun?.intensity ?? 0, fill: lights.fill?.intensity ?? 0 } : null;
  function dimLights(k) {
    if (!lights) return;
    if (lights.sun) lights.sun.intensity = baseLight.sun * (1 - 0.6 * k);
    if (lights.fill) lights.fill.intensity = baseLight.fill * (1 - 0.7 * k);
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

  // ガラス片（幅 0.9 m）が画面の短い辺の fill の割合を占める縦の画角
  function fitFov(dist, fill) {
    const a = aspect();
    const need = a < 1 ? 0.9 / fill / a : 0.58 / (fill * 0.8);
    return THREE.MathUtils.radToDeg(2 * Math.atan(need / 2 / dist));
  }

  function cue(name, arg) {
    const key = name + (arg ?? '');
    if (cuesDone.has(key)) return;
    cuesDone.add(key);
    emit('cue', { name, arg });
  }

  // ---- 2: 前線がビルに届き、時間が止まる ----
  function updateCity() {
    const c = tl.contact, be = tl.beatEnd;
    const Pt = perceivedTime(t);
    // カメラ: ビルを見上げる広い絵 → ガラス片が飛んできて止まる → ガラス片へゆっくり寄る
    const toShard = smooth((t - (c - 0.42)) / 0.72);
    const b = clamp01((t - c) / (be - c));
    const dolly = 0.25 * smooth((t - tl.white) / (c - tl.white)) + 0.45 * easeInOut(b);
    _pos.copy(P.cam).addScaledVector(P.fwd, dolly);
    // 光の方へ少し見上げる
    const lookAt = _look.copy(P.look);
    lookAt.y += 2.5 * smooth((t - tl.white) / 0.8);
    lookAt.lerp(P.shard, toShard);
    const shardDist = _pos.distanceTo(P.shard);
    const fill = 0.55 + 0.45 * easeInOut(b);
    const hb = pulse(t, tl.beats);
    let fov = THREE.MathUtils.lerp(lens(LENS.building), fitFov(shardDist, fill), toShard);
    fov *= 1 - 0.014 * hb; // 鼓動のたびに、わずかに寄る
    aim(_pos, lookAt, fov, -0.035 * easeInOut(b));
    // 目のガラス片はカメラの方を向き、少しだけ傾く
    facing.copy(cam.quaternion).multiply(_q.setFromEuler(_e.set(0.1, -0.16, 0.05)));
    // 窓の光: 前線が近づくほど強く、止まった一拍の間もじわじわ強まる
    const light = 0.15 + 0.5 * smooth((t - tl.white) / (c - tl.white)) + 0.35 * b;
    const reflect = smooth((t - (c - 0.05)) / 0.3);
    const ps = views.size.h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    props.update({ t, P: Pt, light, reflect, facing, pointScale: ps, fade: 1, front: tl.front(t), camera: cam });
    // 目: 細いにらみ → 鼓動ごとに少しずつ → 光が迫った瞬間に凍りついたように見開く。瞳の光は育ち、最後にあふれる
    if (reflect > 0) {
      const u = eye.uniforms;
      const steps = tl.beats.filter((x) => t >= x).length;
      u.uOpen.value = Math.min(1, 0.1 + 0.16 * steps + 0.25 * smooth((b - 0.5) / 0.5) + 0.12 * hb);
      u.uLight.value = 0.06 + 0.94 * b ** 1.7;
      u.uFlood.value = smooth((t - (be - 0.1)) / 0.16);
      u.uLook.value = 0.15 * Math.sin(b * 2.0);
      u.uTime.value = t;
      eye.render(renderer, rt);
    }
    const g = screen.grade;
    g.sat = 0.7; g.warm = 0.7; g.contrast = 1.35;
    g.vig = 0.45 + 0.3 * smooth((t - c) / 0.5) + 0.18 * hb;
    g.ca = 0.35 + 0.25 * b + 0.5 * hb;
    g.exposure = 0.5 - 0.06 * hb;
    g.bloom = 0.55;
    g.grain = 0.05;
    screen.flash = Math.max(0, 0.95 * Math.exp(-(t - tl.white) / 0.03)) + smooth((t - (be - 0.03)) / 0.08);
    for (let i = 0; i < tl.beats.length; i++) if (t >= tl.beats[i]) cue('heart', i);
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
    // 衝撃波の殻: 半球のまわりに、薄い光の殻がふくらんで消える
    space.setShell(r * (1.05 + 1.6 * easeOut(u / 0.75)), (1 - smooth(u / 0.75)) * smooth(u / 0.06) * (1 - f));
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
    play(p, s, { retreat = null } = {}) {
      plan = { ...p }; phase = 'play'; t = 0; stage = 'hands';
      resolveRetreat = retreat;
      if (!plan.retreat && !resolveRetreat) throw new Error('cinematic.play: plan.retreat がなく、求める関数もない');
      playTier = getTier();
      const [ew, eh] = EYE_RT[playTier] ?? EYE_RT.mid;
      if (ew !== rt.width || eh !== rt.height) rt.setSize(ew, eh);
      space.setTier(playTier);
      tl = createTimeline({ radius: s.radius, hitDist: p.hitDist }, undefined, cfg);
      chase = null; cuesDone = new Set();
      P.cam.fromArray(p.camPos); P.look.fromArray(p.look); P.shard.fromArray(p.shardPos);
      P.fwd.copy(P.shard).sub(P.cam).setY(0).normalize();
      P.radial.set(p.camPos[0], 0, p.camPos[2]).normalize();
      chaseR0 = Math.hypot(p.camPos[0], p.camPos[2]);
      // 主人公は狙ったビルの方を向く
      enemyView.setHeroYaw(Math.atan2(P.radial.x, P.radial.z));
      // 同じ人は同じ目
      const src = enemyView.eyeCloseup?.(p.riderId)?.material?.uniforms;
      if (src) eye.setIdentity({ iris: src.uIris?.value, skin: src.uSkin?.value, seed: src.uSeed?.value });
      // 一拍のカメラ（ガラス片を見る）の向き: 小道具の並べ方に使う
      aim(P.cam, P.shard, lens(LENS.building));
      const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
      cam.matrixWorld.extractBasis(right, up, fwd);
      fwd.negate();
      const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      const pc = perceivedTime(tl.contact);
      props.setup(p, { pos: p.camPos, fwd: fwd.toArray(), right: right.toArray(), up: up.toArray(), tanV, tanH: tanV * cam.aspect },
        { contact: pc, breakAt: [pc * 0.45, pc * 0.82] }, [tl.contact - 0.55, tl.contact + 0.12], playTier);
      // 宇宙での大きさ: 大きな一発ほど大きい
      // 光の半球の最大の大きさは、宇宙のカメラの画面の高さに対して決める（縦長でも横長でも同じ見え方）
      spaceDist = aspect() < 1 ? 190 : 270;
      space.aim({ aspect: aspect(), dist: spaceDist, alt: 50, lookAhead: 420, lookUp: 0, fovH: SPACE_FOV.h, fovV: SPACE_FOV.v });
      const halfH = spaceDist * Math.tan(THREE.MathUtils.degToRad(space.camera.fov) / 2);
      rMax = 0.17 * halfH * (0.5 + 0.5 * Math.sqrt(s.radius / cfg.radius.max));
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
      if (stage === 'hands' || stage === 'white') { screen.flash = 0; return; }
      if (stage === 'contact' || stage === 'beat' || stage === 'snap') {
        props.group.visible = true;
        dimLights(smooth((t - tl.white + 0.1) / 0.2));
        updateCity();
        // 逃げる道は、世界がほぼ止まった一拍のはじめに求める（必要になるのは時間が戻ってから）
        if (stage === 'beat') ensureRetreat();
        return;
      }
      props.hide();
      dimLights(0);
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
      dimLights(0);
      props.hide();
    },
  };
  return self;
}


