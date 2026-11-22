import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createBlackhole } from '../../src/render/blackhole.js';
import { BLACKHOLE } from '../../src/render/blackholeTimeline.js';
import { BH_CAMERA } from '../../src/render/blackholePlan.js';
import { LENS_QUALITY } from '../../src/render/lensFx.js';
import { createHandView } from '../../src/render/handView.js';
import { buildHandModel } from '../../src/render/handModel.js';
import { layoutViews, createCityCamera, fitCityCamera } from '../../src/render/views.js';
import { createGame } from '../../src/game/game.js';
import { createStyle } from '../../src/render/style.js';
import { CONFIG } from '../../src/config.js';

const sunDir = createStyle('low').sunDir;
function fakeViews(w = 390, h = 844) {
  const layout = layoutViews(w, h), cityCamera = createCityCamera();
  fitCityCamera(cityCamera, layout.city.w / layout.city.h);
  return { size: { w, h }, layout, cityCamera };
}
// 描かないので renderer は空でよい（draw は呼ばない）
const make = (game, opts = {}) => {
  const hand = opts.hand ?? createHandView(null, 'high');
  const bh = createBlackhole(fakeViews(...(opts.size ?? [])), hand, { renderer: {}, scene: new THREE.Scene(), sunDir, buildings: game.city.buildings, ...opts });
  return { bh, hand };
};

// main.js と同じつなぎ方: 時間切れの 'over'（blackhole）で演出を始め、毎フレーム 演出 → ゲーム → 手 の順に進める
function runTimeout(dts, opts) {
  const game = createGame({ seed: 3, cfg: { ...CONFIG, roundSeconds: 2 } });
  const { bh, hand } = make(game, opts);
  const log = [], stages = [];
  let overAt = null, endAt = null, cutAt = null, collapseAtCut = null, clock = 0;
  game.on('over', ({ reason, total }) => { log.push(`over:${reason}:${total}`); overAt = clock; if (reason === 'blackhole') bh.play(); });
  game.on('shot', () => log.push('shot'));
  game.on('puff', () => log.push('puff'));
  bh.on('cue', ({ name }) => log.push(name));
  bh.on('end', () => { log.push('end'); endAt = clock; });
  game.pressStart(); // 押したまま時間切れ
  let i = 0;
  while (clock < 2 + BLACKHOLE.end + 1.5) {
    const dt = dts[i++ % dts.length];
    clock += dt;
    const wasFull = bh.fullscreen;
    bh.update(dt); // main.js と同じく、演出を先に進めてからゲーム（始まったフレームは時間を進めない）
    game.update(dt);
    hand.update(dt, game.power.level, game.charge.active, 1);
    if (!wasFull && bh.fullscreen) { cutAt = clock; collapseAtCut = hand.collapse; }
    if (bh.active && stages.at(-1) !== bh.stage) stages.push(bh.stage);
    // 演出の間に押しても、離しても、小爆発を押しても、何も起きない
    if (bh.active) { game.pressStart(); game.pressEnd(); game.puff(); }
    if (bh.active) {
      const c = bh.camera;
      expect([...c.position.toArray(), c.fov, ...c.quaternion.toArray()].every(Number.isFinite)).toBe(true);
    }
  }
  return { game, bh, hand, log, stages, overAt, endAt, cutAt, collapseAtCut };
}

for (const [name, dts] of [['60fps', [1 / 60]], ['20fps', [1 / 20]], ['でこぼこ', [1 / 60, 0.1, 1 / 30, 0.004, 0.07]]]) {
  test(`時間切れ → ブラックホールの演出 → end の一度きり（${name}）。演出の間は入力でゲームが動かない`, () => {
    const r = runTimeout(dts);
    expect(r.log).toEqual(['over:blackhole:0', 'collapse', 'cut', 'void', 'end']);
    expect(r.game.phase).toBe('over');
    expect(r.stages).toEqual(['collapse', 'swallow', 'void', 'fade', 'done']);
    // end は時間切れから時間割どおり（1 フレームの誤差まで）
    expect(r.endAt - r.overAt).toBeGreaterThanOrEqual(BLACKHOLE.end - 1e-9);
    expect(r.endAt - r.overAt).toBeLessThanOrEqual(BLACKHOLE.end + Math.max(...dts) + 1e-9);
    expect(r.cutAt - r.overAt).toBeGreaterThanOrEqual(BLACKHOLE.cut - 1e-9);
    // 画面全体に切り替わるときには、手の中の球はつぶれきっている
    expect(r.collapseAtCut).toBe(1);
    // end のあとも黒のまま待つ（結果を重ねる）
    expect(r.bh.active).toBe(true);
    expect(r.bh.finished).toBe(true);
  });
}

test('最後の一発を放ったときは始まらない（演出は時間切れだけ）', () => {
  const game = createGame({ seed: 3, cfg: { ...CONFIG, roundSeconds: 30 } });
  const { bh } = make(game);
  game.on('over', ({ reason }) => { if (reason === 'blackhole') bh.play(); });
  game.pressStart();
  for (let i = 0; i < 600; i++) game.update(1 / 60);
  game.power.add(CONFIG.power.max); // M2: 貯める速さが遅くなり、掴まれると足りずに放てないことがあるので、放てる力にしておく
  game.pressEnd();
  for (let i = 0; i < 1200 && game.phase !== 'over'; i++) game.update(1 / 60);
  expect(game.phase).toBe('over');
  expect(bh.active).toBe(false);
});

for (const size of [[390, 844], [1280, 720]]) {
  test(`画面全体のカメラ: 黒い球（主人公）はいつも画面の中、カメラは地面より上（${size.join('x')}）`, () => {
    const game = createGame({ seed: 7 });
    const { bh } = make(game, { size });
    bh.play();
    const hero = new THREE.Vector3(...BH_CAMERA.hero);
    for (let t = 0; t < BLACKHOLE.end; t += 1 / 30) {
      bh.update(1 / 30);
      if (!bh.fullscreen) continue;
      const p = hero.clone().project(bh.camera);
      expect(p.z).toBeLessThan(1);
      expect(Math.abs(p.x)).toBeLessThan(0.5);
      expect(Math.abs(p.y)).toBeLessThan(0.85);
      expect(bh.camera.position.y).toBeGreaterThan(20);
    }
  });
}

test('画質の段は始めるたびに読む（途中で段が下がれば、光の筋の重ね数と解像度を下げる）', () => {
  const game = createGame({ seed: 3 });
  let tier = 'high';
  const { bh } = make(game, { tier: 'high', getTier: () => tier });
  bh.play();
  expect(bh.quality).toEqual({ tier: 'high', lens: LENS_QUALITY.high });
  tier = 'low';
  bh.stop();
  bh.play();
  expect(bh.quality).toEqual({ tier: 'low', lens: LENS_QUALITY.low });
  expect(LENS_QUALITY.low.taps).toBeLessThan(LENS_QUALITY.mid.taps);
  expect(LENS_QUALITY.mid.taps).toBeLessThan(LENS_QUALITY.high.taps);
  expect(LENS_QUALITY.low.scale).toBeLessThan(LENS_QUALITY.high.scale);
});

test('手の画面: つぶれるほど球は小さくなって消え、両手は球のほうへ引き込まれる。stop で元に戻る', () => {
  const hand = createHandView({ right: buildHandModel({ detail: 'low' }), left: buildHandModel({ detail: 'low', side: 'left' }) }, 'low');
  const game = createGame({ seed: 3 });
  const { bh } = make(game, { hand });
  const gap = () => { const p = hand.palms, c = hand.orbSphere.center; return p.right.distanceTo(c) + p.left.distanceTo(c); };
  for (let i = 0; i < 30; i++) hand.update(1 / 60, 0.8, true, 1);
  const r0 = hand.orbSphere.radius, g0 = gap();
  bh.play();
  for (let t = 0; t < BLACKHOLE.cut; t += 1 / 60) { bh.update(1 / 60); hand.update(1 / 60, 0.8, false, 1); }
  expect(hand.collapse).toBe(1);
  expect(hand.orbSphere.radius).toBeLessThan(r0 * 0.05);
  expect(gap()).toBeLessThan(g0 * 0.7);
  hand.scene.traverse((o) => {
    for (const v of [o.position, o.scale]) expect(v.toArray().every(Number.isFinite)).toBe(true);
    if (o.isLight) expect(Number.isFinite(o.intensity)).toBe(true);
  });
  bh.stop();
  expect(hand.collapse).toBe(0);
});
