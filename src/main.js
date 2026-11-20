import * as THREE from 'three';
import { createGame } from './game/game.js';
import { TIERS, pickTier, nextTier, createFpsGovernor } from './render/quality.js';
import { createViews } from './render/views.js';
import { createHandView } from './render/handView.js';
import { buildHandModel } from './render/handModel.js';
import { CONFIG } from './config.js';
import { createStyle } from './render/style.js';
import { createCityView } from './render/cityView.js';
import { createDestruction } from './world/destruction.js';
import { createDebrisView } from './render/debrisView.js';
import { createExplosionView } from './render/explosionView.js';
import { createFrontTracker } from './render/sphereDeform.js';
import { createEnemyView } from './render/enemyView.js';
import { chooseShot, createCinematic } from './render/cinematic.js';
import { createRng } from './rng.js';
import { createPressTracker } from './input/press.js';
import { createHud } from './ui/hud.js';
import { createResult } from './ui/result.js';
import { createAudio } from './audio/audio.js';

const MAX_FRAME_DT = 0.1;

const params = new URLSearchParams(location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : Math.floor(Math.random() * 2 ** 31);
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches;
const tierParam = params.get('tier');
let tier = tierParam in TIERS ? tierParam : pickTier({ isMobile, deviceMemory: navigator.deviceMemory, cores: navigator.hardwareConcurrency });

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'high', stencil: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = TIERS[tier].shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;

const applyPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[tier].pixelRatioMax));
applyPixelRatio();

const game = createGame({ seed });
const style = createStyle(tier);
const cityView = createCityView(game.city, style, tier);

const cityScene = new THREE.Scene();
cityScene.add(style.sky, ...style.lights, cityView.group);
// 手の画面: 主人公の右手はコードで組み立てる（読み込みを待たない）。low の段は粗い手にする
const handDetail = tier === 'high' ? 'high' : 'low';
// 左手は右手の形を鏡に映して使い回す（組み立ては1回ぶん）
const hand = createHandView({ right: buildHandModel({ detail: handDetail }), left: buildHandModel({ detail: handDetail, side: 'left' }) }, tier);

// 入力・HUD・結果・音
const audio = createAudio();
const hud = createHud(document.getElementById('hud'));
const startHint = document.getElementById('start');
const result = createResult(document.getElementById('result'), {
  // 壊れた街や地面のえぐれは作り直せないので、新しい種でページを読み直す
  onRetry() {
    const q = new URLSearchParams(location.search);
    q.set('seed', String(Math.floor(Math.random() * 2 ** 31)));
    location.search = q.toString();
  },
});
const press = createPressTracker({
  onStart() { startHint.hidden = true; game.pressStart(); },
  onEnd() { game.pressEnd(); },
});
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture?.(e.pointerId); press.down(e.pointerId); });
canvas.addEventListener('pointerup', (e) => press.up(e.pointerId));
canvas.addEventListener('pointercancel', (e) => press.cancel(e.pointerId));
// 指が画面の外へ出ても、キャプチャが外れたら離したことにする
canvas.addEventListener('lostpointercapture', (e) => press.cancel(e.pointerId));
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });
document.addEventListener('visibilitychange', () => {
  game.setHidden(document.hidden);
  if (document.hidden) audio.suspend(); else audio.resume();
});
game.on('over', ({ reason, total }) => { audio.chargeHum(0); audio.rumble(0); result.show(total, reason); });

const views = createViews(renderer, () => TIERS[tier]);
// CSS で決まったキャンバスの実寸に合わせる（スマホのアドレスバーで 100vh がずれる問題を避ける）
const resize = () => {
  views.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  const r = views.layout.hand;
  hand.resize(r.w / Math.max(1, r.h));
  hud.place(views.layout, views.size.h);
};
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

// 壊れたものは破片になる（手前の物理の焦点は Task 11 で演出カメラに合わせる。null なら全部プール）
const destruction = createDestruction({ cityView, getTier: () => TIERS[tier], seed });
const debrisView = createDebrisView(style, destruction.pool, destruction.near, TIERS.high.debrisMax + TIERS.high.nearPhysicsMax);
cityScene.add(debrisView.mesh);

// 爆発の見た目（光の球・衝撃波・閃光・粉・光に溶ける建物）
const explosionView = createExplosionView(cityScene, tier, { sunDir: style.sunDir, seed });
explosionView.warmup(renderer, views.cityCamera);
game.on('shot', (shot) => {
  explosionView.begin(shot); hand.release(shot);
  // 放つ瞬間は無音。大きな一発は、白くなってから目が映る一拍まで（時間が止まっている間）ずっと無音
  audio.releaseSilence(shot.isBig ? CONFIG.cinematic.freezeSec : 0.3);
});

// 軍勢と主人公の姿
const enemyView = createEnemyView(cityScene, tier, { sunDir: style.sunDir });

// 大きな一発を放つ瞬間の演出（画面全体）: 白くなり、主人公の目から後ろ上へ引き、ガラスに軍団の一人の目が映り、
// 追ってくる爆発の front を読みながら引き続けて、上空のカメラへ戻る（cinematic.js）
const cinematic = createCinematic(views, enemyView, explosionView, { renderer, scene: cityScene, sunDir: style.sunDir });
cinematic.warmup(renderer, views.cityCamera);
const shotRng = createRng(seed ^ 0xc1a3e);
const standing = new Set(game.city.buildings.map((b) => b.id)); // まだ壊れていないビル
game.on('cinematicStart', (shot) => {
  const plan = chooseShot({
    shot, rng: shotRng, crater: fronts.crater,
    buildings: game.city.buildings.filter((b) => standing.has(b.id)),
    enemies: game.enemies.list,
  });
  cinematic.play(plan, shot);
});
// ゲームが動き出す。演出は爆発に追われて引き続け、上空のカメラへなじんでから終わる
game.on('cinematicEnd', () => cinematic.end());

// 光に溶ける対象の見た目の箱（隠す前に色と位置を読む）
function vaporTarget({ hit, target }) {
  const id = Number(hit.id.slice(1));
  if (hit.id[0] === 'b') return { x: target.x, z: target.z, w: target.w, d: target.d, h: target.h, color: cityView.getBuildingColor(id) };
  const vis = cityView.getPropVisual(id);
  return { x: vis?.x ?? target.x, z: vis?.z ?? target.z, w: 2.6, d: 2.6, h: 2.2, color: vis?.color };
}
game.on('hit', (e) => {
  if (e.hit.id[0] === 'b') standing.delete(e.target.id);
  if (e.hit.kind === 'vaporize') explosionView.vaporize(vaporTarget(e));
  destruction.onHit(e);
  hitsThisFrame++;
});
let hitsThisFrame = 0;
const burstSeen = new Set();

// 画質の自動調整。ここでは画素比だけを下げる（破片数などの他の値は後の Task が TIERS[tier] から読む）
const governor = createFpsGovernor({ target: isMobile ? 30 : 55 });
function lowerTier() {
  const next = nextTier(tier);
  if (next === tier) return;
  tier = next;
  window.__tier = tier;
  applyPixelRatio();
  resize();
}

// 地面のえぐれ（爆発が終わっても残る）と、今の球の半径。ビルのつぶれ・地面・破片が同じものを使う
const fronts = createFrontTracker();

// 撮影用に手の画面への入力を固定する（null で実際のゲームの値に戻す）
let handInput = null;

// 今描いている街のカメラ（演出の間は画面全体の演出のカメラ）と、1m を光の粒の画素の大きさへ直す係数
const cityCam = () => (cinematic.fullscreen ? cinematic.camera : views.cityCamera);
const pointScaleFor = (cam) => (cinematic.fullscreen ? views.size.h : views.layout.city.h) * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));

function simulate(dt) {
  game.update(dt);
  // 大きな一発の演出でゲームが止まっている間は、描画側の世界（破片・粉・ビルのつぶれ・軍勢の歩み・爆発の見た目）も止める。
  // 動くのは演出が自分で動かすもの（カメラ・飛んでくるガラス片・目のアップ）と手の画面だけで、一拍の後から世界がまた動き出す。
  cinematic.update(dt, game.blasts);
  const wdt = dt * cinematic.worldScale;
  const cam = cityCam(), ps = pointScaleFor(cam);
  // 手前の物理は、演出の間は演出のカメラの近くの破片だけ（ふだんは null で全部プール）
  destruction.setPhysicsFocus(cinematic.active ? cam.position.toArray() : null);
  const live = game.blasts;
  const list = fronts.update(live);
  destruction.pool.setCrater(fronts.crater);
  if (wdt > 0) explosionView.dust(destruction.update(wdt, list));
  debrisView.update();
  explosionView.update(wdt, live, cam, ps, fronts.crater);
  cityView.update(wdt, { fronts: list, heat: explosionView.ground.heat, ember: explosionView.ground.ember });
  enemyView.sync(game.enemies.list, { fronts: list, pointScale: ps, glow: explosionView.ground.heat, dt: wdt, pixelRatio: renderer.getPixelRatio() });
  // 上空カメラは、ゲームが動いている間はいつも進める（演出の終わりにこの姿勢へなじむ）
  if (!cinematic.frozen) views.updateCamera(dt, explosionView.cameraInfo);
  const h = handInput ?? { level: game.charge.level(), active: game.charge.active, reserve: game.reserve.value / CONFIG.reserve.max };
  hand.update(dt, h.level, h.active, h.reserve);
  hud.update({ total: game.score.total, remaining: game.timer.remaining, reserve: game.reserve.value, max: CONFIG.reserve.max });
  hud.setVisible(!cinematic.fullscreen);
  updateAudio(live);
}

// 音: 貯めの唸り、じわじわ期の脈動、弾けた瞬間の爆発、崩落
function updateAudio(live) {
  audio.chargeHum(game.charge.active ? game.charge.level() : 0);
  let creep = 0;
  for (const b of live) {
    const k = Math.sqrt(b.shot.radius / CONFIG.radius.max);
    if (b.front >= CONFIG.blast.creepFrac * b.shot.radius) {
      if (!burstSeen.has(b.id)) { burstSeen.add(b.id); audio.boom(k); }
    } else creep = Math.max(creep, k);
  }
  audio.rumble(creep);
  if (hitsThisFrame > 0) audio.crumble(hitsThisFrame);
  hitsThisFrame = 0;
}
function draw() {
  if (cinematic.white) views.renderWhite();
  else if (cinematic.fullscreen) views.renderFull(cityScene, cinematic.camera, cinematic.screen);
  else views.render(cityScene, hand.scene, cinematic.screen ?? explosionView.screen, hand.camera);
}

let last = performance.now();
let paused = false;
function frame(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_FRAME_DT);
  last = now;
  if (!paused) {
    if (governor.sample(dt) === 'down') lowerTier();
    simulate(dt);
    draw();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 撮影スクリプト用: 実時間を止め、決まった dt で進めてから描く（ヘッドレスは実時間より遅いため）
window.__debug = {
  pause() { paused = true; },
  resume() { paused = false; last = performance.now(); },
  // sec 秒ぶん dt 刻みで進め、最後に1回描く。1フレームあたりの JS の時間（ms、描画は最後の1回）を返す
  step(sec, dt = 1 / 60) {
    const n = Math.max(1, Math.round(sec / dt));
    const t0 = performance.now();
    for (let i = 0; i < n; i++) simulate(dt);
    const t1 = performance.now();
    draw();
    return { simMs: (t1 - t0) / n, drawMs: performance.now() - t1 };
  },
  draw,
  // 手の画面の入力を固定する: { level, active, reserve }（reserve は器の残りの割合 0〜1）。null で戻す
  hand(input) { handInput = input ? { level: 0, active: false, reserve: 1, ...input } : null; },
  // 手の画面だけに、放つ瞬間を起こす（shot = { amount, isBig }）
  handRelease(shot) { hand.release(shot); },
  // 実際のフレームと同じく毎フレーム進めて描いたときの時間 (ms)。
  // js: simulate+draw の JS の時間, sim: そのうち simulate の時間, gpu: 前のフレームの描画が終わるのを待った時間。
  // gl.finish だけでは Chrome は描画の完了を待ち切らず、ソフトウェア描画の遅れが次のフレームの JS に混ざる。
  // そこで 1 画素を読み出して、本当に完了するまで待ってから測る。
  timeFrames(count, dt = 1 / 60) {
    const js = [], sim = [], gpu = [];
    const gl = renderer.getContext(), px = new Uint8Array(4);
    for (let i = 0; i < count; i++) {
      const g0 = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      gpu.push(t0 - g0);
      simulate(dt);
      const t1 = performance.now();
      draw();
      js.push(performance.now() - t0);
      sim.push(t1 - t0);
    }
    return { js, sim, gpu };
  },
};

// 撮影スクリプトや調査用
window.__game = game;
window.__tier = tier;
window.__cityView = cityView;
window.__destruction = destruction;
window.__explosionView = explosionView;
window.__views = views;
window.__hand = hand;
window.__enemyView = enemyView;
window.__cinematic = cinematic;
