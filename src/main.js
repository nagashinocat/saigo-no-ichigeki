import * as THREE from 'three';
import { createGame } from './game/game.js';
import { TIERS, pickTier, nextTier, createFpsGovernor } from './render/quality.js';
import { createViews, createHandScene } from './render/views.js';
import { createStyle } from './render/style.js';
import { createCityView } from './render/cityView.js';
import { createDestruction } from './world/destruction.js';
import { createDebrisView } from './render/debrisView.js';
import { createExplosionView } from './render/explosionView.js';
import { createFrontTracker } from './render/sphereDeform.js';

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
const hand = createHandScene();

const views = createViews(renderer, () => TIERS[tier]);
// CSS で決まったキャンバスの実寸に合わせる（スマホのアドレスバーで 100vh がずれる問題を避ける）
const resize = () => views.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

// 仮の入力（Task 12 で本物の入力に置き換える）: キャンバスの長押しで貯め、離して撃つ
function bindTemporaryInput(target) {
  target.addEventListener('pointerdown', (e) => { target.setPointerCapture?.(e.pointerId); game.pressStart(); });
  target.addEventListener('pointerup', () => game.pressEnd());
  target.addEventListener('pointercancel', () => game.pressEnd());
}
bindTemporaryInput(canvas);

// 壊れたものは破片になる（手前の物理の焦点は Task 11 で演出カメラに合わせる。null なら全部プール）
const destruction = createDestruction({ cityView, getTier: () => TIERS[tier], seed });
const debrisView = createDebrisView(style, destruction.pool, destruction.near, TIERS.high.debrisMax + TIERS.high.nearPhysicsMax);
cityScene.add(debrisView.mesh);

// 爆発の見た目（光の球・衝撃波・閃光・粉・光に溶ける建物）
const explosionView = createExplosionView(cityScene, tier, { sunDir: style.sunDir, seed });
explosionView.warmup(renderer, views.cityCamera);
game.on('shot', (shot) => explosionView.begin(shot));

// 光に溶ける対象の見た目の箱（隠す前に色と位置を読む）
function vaporTarget({ hit, target }) {
  const id = Number(hit.id.slice(1));
  if (hit.id[0] === 'b') return { x: target.x, z: target.z, w: target.w, d: target.d, h: target.h, color: cityView.getBuildingColor(id) };
  const vis = cityView.getPropVisual(id);
  return { x: vis?.x ?? target.x, z: vis?.z ?? target.z, w: 2.6, d: 2.6, h: 2.2, color: vis?.color };
}
game.on('hit', (e) => {
  if (e.hit.kind === 'vaporize') explosionView.vaporize(vaporTarget(e));
  destruction.onHit(e);
});

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

// 1m を光の粒の画素の大きさへ直す係数
const pointScale = () => views.layout.city.h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(views.cityCamera.fov) / 2));

// 地面のえぐれ（爆発が終わっても残る）と、今の球の半径。ビルのつぶれ・地面・破片が同じものを使う
const fronts = createFrontTracker();

function simulate(dt) {
  game.update(dt);
  const blasts = game.blasts;
  const list = fronts.update(blasts);
  destruction.pool.setCrater(fronts.crater);
  explosionView.dust(destruction.update(dt, list));
  debrisView.update();
  explosionView.update(dt, blasts, views.cityCamera, pointScale(), fronts.crater);
  cityView.update(dt, { fronts: list, heat: explosionView.ground.heat, ember: explosionView.ground.ember });
  views.updateCamera(dt, explosionView.cameraInfo);
}
const draw = () => views.render(cityScene, hand.scene, explosionView.screen);

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
