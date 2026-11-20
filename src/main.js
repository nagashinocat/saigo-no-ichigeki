import * as THREE from 'three';
import { createGame } from './game/game.js';
import { TIERS, pickTier, nextTier, createFpsGovernor } from './render/quality.js';
import { createViews, createHandScene } from './render/views.js';
import { createStyle } from './render/style.js';
import { createCityView } from './render/cityView.js';
import { createDestruction } from './world/destruction.js';
import { createDebrisView } from './render/debrisView.js';

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

const views = createViews(renderer);
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
game.on('hit', (e) => destruction.onHit(e));

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

let last = performance.now();
function frame(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_FRAME_DT);
  last = now;
  if (governor.sample(dt) === 'down') lowerTier();
  game.update(dt);
  destruction.update(dt);
  debrisView.update();
  views.render(cityScene, hand.scene);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 撮影スクリプトや調査用
window.__game = game;
window.__tier = tier;
window.__cityView = cityView;
window.__destruction = destruction;
