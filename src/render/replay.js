import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createReplayTimeline } from './replayTimeline.js';
import { planReplay, aftermathView, sideWideView, sideWidePose, SIDE_WIDE } from './replayPlan.js';
import { createReplayLight } from './replayLight.js';
import { toLocal } from './blastFrame.js';

// 最後の一発のリプレイ（画面全体。仕様 12 章の絵コンテ 6〜7）。時間割は replayTimeline.js、撮る場所は replayPlan.js。
// 放つ直前の街へ戻し（onRestore）、同じ一発を決まった刻み（REPLAY.tick）で起こし直す（onTick(爆発の秒, カメラ)）。
// 刻みの並びはいつも同じなので、同じ写しと同じ種から同じリプレイになる（画面の速さによらない）。
//   street → side → top → hero の4カット。黒い帯。時間の進みは「始まりはスローでじわじわふくらむ → 弾けて現実の速さ」の
//   ひとつの流れ（持ち主 22:18、replayTimeline.js）。画面をタップすると飛ばして結果へ。
// 知らせ: 'replayStart'（始まる。BGM のリプレイ版の合図）、'cut'（{ name }）、'skip'（飛ばした）、
//   'aftermath'（撃退失敗: 生き残りの引きの絵へ切り替わった）、'replayEnd'（結果を出してよい。撃退失敗は引きの絵を見せてから）。
// 終わったら最後の絵のまま待つ（finished。撃退失敗は引きの絵を見せて replayEnd を出してから）。もう一度 play すれば何度でも見せ直せる。
// M1（spec §16）: 爆心は放った瞬間の主人公の位置（shot.centre）。撮る場所（replayPlan）は爆心を原点として解き（ビルと生き残りを写して渡す）、
// カメラの位置と見る先・光の芯だけを世界へ戻す（aim）

const MAX_TICKS = 4;          // 1フレームに進める刻みの上限（遅い機械ではリプレイがゆっくりになるが、中身は同じ）
const SKIP_FADE = 0.22;       // 飛ばす: この秒で暗くし、暗いうちに最後まで早送りする
const FF_TICK = 1 / 15;       // 早送りの刻み（リプレイの秒）
const FF_TICKS = 10;          // 早送りで1フレームに進める刻みの上限
const OUTRO_FADE = 0.5;       // 飛ばしたあと、最後の絵へ明けるまで
const END_FADE = 0.38;        // 結果の後ろの最後の絵の暗さ
const HELD_RATE = 0.25;       // 待つ間の世界の進み（粉や熾火がゆっくり動く）
// S9: 撃退失敗のとき、最後の絵は生き残りを見せる引きの絵（暗転を挟んで切り替える）。結果の後ろでも光が読めるよう暗くしすぎない
// fadeIn: 暗転から引きの絵へ明けるまで。hold: 明けきってから結果を出すまで（生き残りだけの絵を、文字なしで見せる間）
export const AFTERMATH_TIMING = { fadeIn: 0.9, hold: 1.3 };
const AFTER_FADE_IN = AFTERMATH_TIMING.fadeIn;
const AFTER_END_FADE = 0.16;  // 引きの絵の結果の後ろの暗さ
// 黒い帯: 縦長はこの縦横比、横長はシネマスコープ
export const REPLAY_BARS = { portrait: 0.6, landscape: 2.39 };
// レンズ（縦の画角、度）
export const REPLAY_LENS = {
  street: { portrait: 80, landscape: 52 },
  streetSwell: { portrait: 22, landscape: 15 }, // fix1: street のスローの間（遠くの光の玉を大きく）
  side: SIDE_WIDE.fov, // R1b: ずっと引いた所からの長めのレンズ（replayPlan.js の sideWideView）
  top: { portrait: 62, landscape: 44 },
  hero: { portrait: 40, landscape: 27 },
};

// 真上のカット（top）の引き: 画面の短い辺の半分に収める半径 = max(半径 · ring, min(街の端, 半径 · cityMax)) / fill
export const TOP_FRAME = { ring: 1.18, cityMax: 1.45, fill: 0.86 };
export function topHeight(radius, tanShort, F = TOP_FRAME, cfg = CONFIG) {
  const frame = Math.max(radius * F.ring, Math.min(cfg.cityRadius, radius * F.cityMax));
  return frame / F.fill / tanShort;
}

export function replayBars(aspect) {
  const target = aspect < 1 ? REPLAY_BARS.portrait : REPLAY_BARS.landscape;
  return Math.max(0, (1 - aspect / target) / 2);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3;
const easeInOut = (x) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

// views: createViews の戻り値（全画面の大きさ）。opts.scene: 光の殻を置く街の場面、opts.lights: { sun, fill }（影絵のために弱める）
// opts.onRestore(): 世界を放つ直前へ戻す。opts.onTick(dt, camera): 世界を爆発の dt 秒進める（camera はそのときのカメラ）
// opts.fog: 霞み始める距離の uniform（style.uniforms.uFogStart）。真上のカメラは遠いので、その間だけ延ばす
// opts.blastLight: 爆心の光（explosionView.light）。最後のカットでは主人公を影絵にするため、描く前に弱める
// opts.dust: 爆発の粉の板（fix1: street のスローの間は隠す。爆心の光の玉を雲でおおってしまう）
export function createReplay(views, { scene, lights = null, fog = null, blastLight = null, dust = null, onRestore = () => {}, onTick = () => {} } = {}) {
  const listeners = {};
  const emit = (name, arg) => { for (const fn of listeners[name] ?? []) fn(arg); };
  const cam = new THREE.PerspectiveCamera(60, 1, 0.3, 9000);
  const light = createReplayLight();
  scene.add(light.mesh);

  let heroK = 0; // 最後のカットで爆心の光を弱める割合（描く前に掛ける）
  // 爆心の光の元の強さ（爆発の見た目が決めた値）と、こちらが最後に書いた値。刻みのないフレームでは爆発が書き直さないので、
  // 今の値へ掛け直すと重ねて弱まってしまう。元の値から作り直す
  let blastBase = 0, blastWritten = NaN;
  let phase = 'off', t = 0, acc = 0, b = 0, tl = null, plan = null, cutName = '', skipK = 0, outro = 0, heldT = 0;
  let survivors = null, after = null, ended = false; // S9: 撃退失敗の生き残り（[{ x, z }]）と、その引きの絵（最後まで見せたら）
  const screen = { flash: 0, time: 0, heat: null, grade: { bars: 0, ca: 0, vig: 0, sat: 1, grain: 0, streak: 0, exposure: 1, fade: 1, warm: 0, contrast: 1, bloom: 1 } };
  const baseLight = lights ? { sun: lights.sun?.intensity ?? 0, fill: lights.fill?.intensity ?? 0 } : null;
  function dimLights(k) {
    if (!lights) return;
    if (lights.sun) lights.sun.intensity = baseLight.sun * (1 - 0.85 * k);
    if (lights.fill) lights.fill.intensity = baseLight.fill * (1 - 0.8 * k);
  }

  const aspect = () => views.size.w / Math.max(1, views.size.h);
  const lens = (l) => (aspect() < 1 ? l.portrait : l.landscape);
  const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _up = new THREE.Vector3(), _lw = new THREE.Vector3();
  const C = { x: 0, z: 0 }; // M1: 爆心（世界の x, z）
  function aim(pos, look, fov, roll = 0, up = null) {
    cam.aspect = aspect();
    cam.position.set(pos.x + C.x, pos.y, pos.z + C.z);
    if (up) cam.up.copy(up); else cam.up.set(0, 1, 0);
    cam.lookAt(_lw.set(look.x + C.x, look.y, look.z + C.z));
    if (roll) cam.rotateZ(roll);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
  const setGrade = (o) => Object.assign(screen.grade, o);
  const fog0 = fog?.value ?? 0;
  const setFog = (extra) => { if (fog) fog.value = fog0 + extra; };

  // ---- カットごとのカメラと画づくり（t の関数。刻みのたびと、描く前に呼ぶ） ----
  function shotStreet(u) {
    const s = plan.street, F = tl.frontAt(t);
    const gap = Math.max(0, s.dist - F);
    const prox = clamp01(1 - gap / 70);                 // 壁が近いほど 1
    const burst = smooth((F - tl.radius * 0.07) / 25);   // 弾けた
    // fix1: スローでふくらむ間はゆっくり通りの先へ押し込み、弾けたら後ずさる（壁から逃げたいが逃げられない）
    const sw = clamp01((t - tl.intro) / Math.max(0.1, tl.burst - tl.intro));
    const back = t >= tl.burst ? smooth((t - tl.burst) / 0.6) : 0;
    const dolly = 10 * easeInOut(sw) - 6 * back;
    _pos.set(s.pos[0] + s.dir[0] * dolly, s.pos[1], s.pos[2] + s.dir[1] * dolly);
    const sh = 0.004 * burst + 0.018 * prox * prox;
    _pos.x += sh * 9 * Math.sin(t * 31); _pos.y += sh * 6 * Math.sin(t * 23 + 1);
    // R0b（持ち主 22:18）: スローでふくらむ間は、通りの突き当たり（爆心）の光の玉を少し長いレンズで見る。弾けて壁が迫るにつれて
    // 通りの先の上を見上げ（壁の上の縁が頭の上を越えていく）、レンズは広がる
    const up = smooth(burst * 0.6 + prox) * (t >= tl.burst ? 1 : 0);
    // fix2: スローの間は爆心そのもの（通りの真ん中から横へ半区画ずれる）を見る。長いレンズの狭い画面から光の玉が外れない
    // （通りは爆心の光を見通せるものを選ぶ: replayPlan の sees）
    const ahead = 60, lift = 14 + 16 * up + 10 * prox;
    _look.set(0, Math.max(2.5, 0.45 * F), 0);
    _look.lerp(_up.set(s.pos[0] + s.dir[0] * ahead, lift, s.pos[2] + s.dir[1] * ahead), up);
    // fix1（I-2）: スローの間は長いレンズ（縦長 22°・横長 15°）でふくらむ光の玉を大きく、弾けると一気に広がる
    const wideAt = t >= tl.burst ? smooth((t - tl.burst) / 0.25) : 0;
    const swellLens = lens(REPLAY_LENS.streetSwell) * (1 - 0.1 * easeInOut(sw));
    const fov = swellLens + (lens(REPLAY_LENS.street) - swellLens) * Math.max(wideAt, up) + 6 * prox;
    aim(_pos, _look, fov, 0.055 * up);
    // 壁が近づくほど暗く・硬くして、光の壁の模様を白く飛ばさない
    setGrade({ sat: 1.1, warm: 0.45, contrast: 1.2 + 0.25 * prox, vig: 0.42 + 0.2 * prox, ca: 0.25 + 1.6 * prox * prox, grain: 0.04, exposure: 0.95 - 0.35 * prox, streak: 0, bloom: 1 - 0.4 * prox });
    setFog(0);
    if (dust) dust.visible = t >= tl.burst;
    // 弾けた瞬間の閃き。呑み込まれる: 壁がカメラの数 m 手前に来ると白へ（カットの終わりで白。時間は止めない）
    const tb = tl.burst;
    screen.flash = (t >= tb ? 0.3 * Math.exp(-(t - tb) / 0.1) : 0) + smooth((F - (s.dist - 14)) / 11);
    light.hide();
    dimLights(0);
  }

  // R1b（持ち主 08:24「もう少し離れた状態で全体見れた方がかっこいい」）: 前は前線のすぐ外を壁と並んで走っていた。
  // いまは、その約 1.5〜2 倍の距離の斜め上から、このカットで前線が届く半径（tl.sideFront）までの光の球・穴の縁・その外の街を
  // 画面に収めたまま、爆心のまわりを横へ流れる引きの移動撮影
  // （距離は画面の縦横比と黒い帯ごとに解く。replayPlan.js の sideWideView）
  let sideView = null, sideKey = '';
  function shotSide(u) {
    if (dust) dust.visible = true;
    const s = plan.side, a = aspect();
    const key = `${tl.radius}|${a.toFixed(4)}`;
    if (key !== sideKey) { sideView = sideWideView({ radius: tl.radius, aspect: a, bars: replayBars(a), reach: tl.sideFront }); sideKey = key; }
    const p = sideWidePose(sideView, { u, az: s.az, look: s.look });
    _pos.fromArray(p.pos); _look.fromArray(p.look);
    aim(_pos, _look, sideView.fov);
    setFog(_pos.length() * 0.8);
    setGrade({ sat: 1.0, warm: 0.3, contrast: 1.15, vig: 0.38, ca: 0.3, grain: 0.035, exposure: 0.92, streak: 0, bloom: 1 });
    screen.flash = 1 - smooth(u / 0.05);
    light.hide();
    dimLights(0);
  }

  function shotTop(u) {
    const a = aspect();
    const fov = lens(REPLAY_LENS.top);
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    // 横長は黒い帯（シネマスコープ）が縦を削るので、見えている高さで測る
    const tanShort = a < 1 ? tanV * a : tanV * (1 - 2 * replayBars(a));
    // 持ち主 23:01（全体を撮るカメラはもう少し引く）: 光の円と穴、その外の街（街の端か、半径の TOP_FRAME.ring 倍まで）が画面の短い辺に
    // 余白をもって収まる高さ（前は半径が画面の端に届く高さで、広がりきると画面からあふれていた）
    const H = topHeight(tl.radius, tanShort) * (1.04 - 0.08 * easeInOut(u));
    setFog(H);
    const ang = plan.top.az + 0.3 * u;
    _pos.set(0, H, 0);
    _look.set(0, 0, 0);
    _up.set(Math.cos(ang), 0, Math.sin(ang));
    aim(_pos, _look, fov, 0, _up);
    setGrade({ sat: 0.95, warm: 0.15, contrast: 1.15, vig: 0.5, ca: 0.2, grain: 0.03, exposure: 0.95, streak: 0, bloom: 1 });
    screen.flash = 0;
    light.hide();
    dimLights(0);
  }

  function shotHero(u) {
    const h = plan.hero;
    const az = h.az + 0.24 * easeInOut(u);
    const d = 5.4 - 0.9 * easeOut(u);
    _pos.set(Math.sin(az) * d, -1.5 + 0.35 * u, Math.cos(az) * d);
    _look.set(0, 1.0, 0);
    aim(_pos, _look, lens(REPLAY_LENS.hero), 0.03);
    // 光の中: はじめは真っ白な光の中に影だけ。光は主人公の向こうの芯へ引いていき、穴と空が現れる
    // はじめは真っ白（光の中）→ 影が浮かび上がる → 光は主人公の向こうの芯へ引いていく
    const I = 2.2 * (1 - smooth(u / 0.14)) + 0.8 * (1 - smooth((u - 0.2) / 0.7)) + 0.25;
    light.update({ camera: cam, intensity: I, coreK: 1 + 0.6 * smooth(u / 0.7), time: t, radius: 160, center: [C.x, 1.05, C.z] });
    setFog(0);
    dimLights(1);
    heroK = 0.9;
    setGrade({ sat: 1.0, warm: 0.6, contrast: 1.3, vig: 0.55 + 0.15 * u, ca: 0.25, grain: 0.05, exposure: 0.85, streak: 0, bloom: 0.3 * smooth((u - 0.65) / 0.35) });
    screen.flash = 1 - smooth(u / 0.04);
  }

  // S9: 撃退失敗の引きの絵（爆心と生き残り全員を斜め上から）。生き残りの光は patrolGlow が赤と緑に脈打たせる
  function shotAfter() {
    heroK = 0;
    screen.grade.bars = replayBars(aspect());
    _pos.fromArray(after.pos); _look.fromArray(after.look);
    aim(_pos, _look, after.fov);
    setFog(_pos.distanceTo(_look) * 0.8);
    setGrade({ sat: 1.0, warm: 0.2, contrast: 1.12, vig: 0.45, ca: 0.15, grain: 0.03, exposure: 0.95, streak: 0, bloom: 1 });
    screen.flash = 0;
    light.hide();
    dimLights(0);
  }

  function shot(tt) {
    const { name, u } = tl.cutAt(tt);
    heroK = 0;
    screen.time = tt;
    screen.grade.bars = replayBars(aspect()) * smooth(tt / 0.35);
    if (name === 'intro') {
      // 暗転の間はカメラを street の始まりに置いておく（物理の焦点と、最初の絵の準備）
      shotStreet(0);
      screen.flash = 0;
      return name;
    }
    if (name === 'street') shotStreet(u);
    else if (name === 'side') shotSide(u);
    else if (name === 'top') shotTop(u);
    else shotHero(Math.min(1, u));
    return name;
  }

  // リプレイの時計を h 進め、世界を爆発の差の分だけ進める
  function tickOnce(h) {
    t += h;
    const name = shot(t);
    if (name !== cutName && name !== 'done') { cutName = name; if (name !== 'intro') emit('cut', { name }); }
    const nb = tl.blastAt(t);
    onTick(Math.max(0, nb - b), cam);
    b = nb;
  }

  function finish() {
    phase = 'held'; heldT = 0;
    if (survivors) {
      // 撃退失敗: 引きの絵へ。明けきって hold 秒見せてから結果（advance の held）
      after = aftermathView({ survivors: toLocal(survivors, C), aspect: aspect(), az: plan.top.az, radius: tl.radius }); outro = AFTER_FADE_IN;
      emit('aftermath');
      return;
    }
    end();
  }
  function end() {
    if (ended) return;
    ended = true;
    emit('replayEnd');
  }

  // リプレイの時計を進める（刻みごとに世界を進める）。飛ばす・待つの段取りもここ
  function advance(dt) {
    if (phase === 'play' || (phase === 'skip' && skipK < 1)) {
      acc += dt;
      let n = 0;
      while (acc >= tl.tick - 1e-9 && n < MAX_TICKS && t < tl.end) { tickOnce(tl.tick); acc -= tl.tick; n++; }
      if (n >= MAX_TICKS) acc = 0;
    }
    const g = screen.grade;
    if (phase === 'play') {
      g.fade = 1 - smooth((t - tl.intro) / 0.25);
      // 最後: 結果の後ろへ少し暗くなる
      // （撃退失敗は暗転しきって、生き残りの引きの絵へ）
      g.fade = Math.max(g.fade, (survivors ? 1 : END_FADE) * smooth((t - (tl.end - 0.6)) / 0.6));
      if (t >= tl.end - 1e-9) { finish(); g.fade = after ? 1 : END_FADE; }
      return;
    }
    if (phase === 'skip') {
      if (skipK < 1) {
        skipK = Math.min(1, skipK + dt / SKIP_FADE);
        shot(t);
        g.fade = Math.max(g.fade, smooth(skipK));
        return;
      }
      // 暗いうちに最後まで早送り
      for (let n = 0; n < FF_TICKS && t < tl.end - 1e-9; n++) tickOnce(Math.min(FF_TICK, tl.end - t));
      g.fade = 1;
      if (t >= tl.end - 1e-9) { outro = OUTRO_FADE; finish(); }
      if (after) shotAfter();
      return;
    }
    // held: 最後の絵のまま。世界はゆっくり進む（粉・熾火・主人公のまわりのゆらぎ）
    heldT += dt;
    if (!ended && heldT >= AFTER_FADE_IN + AFTERMATH_TIMING.hold - 1e-9) end();
    if (after) shotAfter(); else shot(tl.end);
    onTick(dt * HELD_RATE, cam);
    if (outro > 0) outro = Math.max(0, outro - dt);
    if (after) g.fade = AFTER_END_FADE + (1 - AFTER_END_FADE) * smooth(outro / AFTER_FADE_IN);
    else g.fade = END_FADE + (1 - END_FADE) * smooth(outro / OUTRO_FADE);
  }

  const self = {
    get active() { return phase !== 'off'; },
    // 最後まで見せ終わった（飛ばした場合も）。最後の絵のまま待つ
    get finished() { return phase === 'held' && ended; },
    get fullscreen() { return phase !== 'off'; },
    get camera() { return cam; },
    get screen() { return phase === 'off' ? null : screen; },
    get phase() { return phase; },
    get time() { return t; },
    get cut() { return cutName; },
    get timeline() { return tl; },
    get plan() { return plan; },
    // M1: 今のリプレイの爆心（世界の { x, z }）
    get centre() { return { x: C.x, z: C.z }; },
    // S9: 撃退失敗の引きの絵（最後まで見せたあと。成功なら null）
    get aftermath() { return after; },
    // 最後のカットで主人公を影絵にする強さ（0〜1）。爆発の光で白く光らせない
    get silhouette() { return heroK; },
    get light() { return light; },
    on(name, fn) { (listeners[name] ??= []).push(fn); },
    // 初めて使う材質を先に作っておく（リプレイの最後のカットで止まらないように）
    // 画面へ直接描く段（low）と、画面効果のレンダーターゲットへ描く段（high/mid）では、同じ材質でも別のシェーダーになる
    // （トーンマップの有無）。両方を作っておく
    warmup(r, camera) {
      light.mesh.visible = true;
      const prev = r.getRenderTarget();
      const tmp = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
      r.setRenderTarget(null);
      r.compile(scene, camera);
      r.setRenderTarget(tmp);
      r.compile(scene, camera);
      r.setRenderTarget(prev);
      tmp.dispose();
      light.mesh.visible = false;
    },
    // shot: 最後の一発、buildings: 放つ直前の（壊れていない）ビル、heroYaw: 主人公の向き
    // survivors: 撃退失敗の生き残り（[{ x, z }]。最後の絵を生き残りの引きの絵にする）。成功・省けば前のまま
    play({ shot: s, buildings, heroYaw = 0, survivors: sv = null }) {
      survivors = sv && sv.length ? sv : null; after = null;
      C.x = s.centre?.x ?? 0; C.z = s.centre?.z ?? 0;
      plan = planReplay({ radius: s.radius, buildings: toLocal(buildings, C), heroYaw });
      tl = createReplayTimeline({ radius: s.radius, streetDist: plan.street.dist });
      phase = 'play'; t = 0; acc = 0; cutName = 'intro'; skipK = 0; outro = 0; ended = false;
      onRestore();
      // 暗転の間に、爆発の時計を street の始まりまで決まった刻みで進めておく
      b = 0;
      shot(0);
      const h = tl.tick;
      while (b + h < tl.bStart - 1e-9) { onTick(h, cam); b += h; }
      onTick(tl.bStart - b, cam);
      b = tl.bStart;
      screen.grade.fade = 1;
      emit('replayStart');
    },
    // R4（縦動画、share/clip.js）: リプレイの時刻 target まで、ふつうの再生と同じ決まった刻み（REPLAY.tick）で進める（戻らない。最後で止まる）。
    // 暗転はしない（fade 0）、結果へも進まない（'aftermath'・'replayEnd' は出さない）。描くのは呼ぶ側。
    // maxFine: 1 回に細かい刻みで進める数の上限。超えた分は早送りの刻み（FF_TICK）で進める（遅い端末で録画が現実の時間に遅れていかない）
    seek(target, { maxFine = Infinity } = {}) {
      if (!tl || phase === 'off') return;
      const end = Math.min(target, tl.end);
      let n = 0;
      while (t + tl.tick <= end + 1e-9) {
        if (n++ < maxFine) tickOnce(tl.tick);
        else tickOnce(Math.min(FF_TICK, Math.max(tl.tick, end - t)));
      }
      if (n === 0) shot(t);
      screen.grade.fade = 0;
    },
    // 画面をタップ: 暗くして最後まで早送りし、結果へ
    skip() {
      if (phase === 'play') { phase = 'skip'; skipK = 0; emit('skip'); }
      // 撃退失敗の引きの絵の間: すぐ結果へ。Fix round 1: このときも 'skip' を知らせる（main.js がリプレイの音を止める）。見せ終えたあとは知らせない
      else if (phase === 'held' && !ended) { emit('skip'); end(); }
    },
    update(dt) {
      if (phase === 'off') return;
      advance(dt);
      if (blastLight) {
        if (blastLight.intensity !== blastWritten) blastBase = blastLight.intensity; // 爆発が書き直した
        blastWritten = blastBase * (1 - heroK);
        blastLight.intensity = blastWritten;
      }
    },
    // やめる（何も描かない）
    stop() {
      phase = 'off'; cutName = ''; after = null;
      if (dust) dust.visible = true;
      light.hide();
      dimLights(0);
      setFog(0);
    },
  };
  return self;
}
