import { test, expect } from 'vitest';
import * as THREE from 'three';
import { leadFor, minLeadFor, createChase, createCinematic, barsFor } from '../../src/render/cinematic.js';
import { planFinale } from '../../src/render/finalePlan.js';
import { buildEyeCloseup } from '../../src/render/enemyView.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';
import { frontAt, blastDuration } from '../../src/game/blast.js';

const city = generateCity(3);
const shotOf = (amount) => ({ amount, radius: radiusFor(amount), isBig: true });
const SHOTS = [shotOf(CONFIG.power.minRelease), shotOf(60), shotOf(CONFIG.power.max)];
const enemy = (id, angle, dist, state = 'approach') => ({ id, angle, dist, state, deadTime: 0 });
const ARMY = [enemy(1, 0.3, 40), enemy(2, 2.1, 30), enemy(4, 5.2, 55)];

test('追われて引くカメラ: 生きた front を読み、常に front + minLead より先にいて、戻らず、front が急に速くなるとカメラも速くなる', () => {
  const chase = createChase(30);
  const dt = 1 / 60;
  let front = 0, prev = 30, slowV = 0, fastV = 0;
  for (let i = 0; i < 240; i++) {
    const speed = i < 120 ? 25 : 320; // じわじわ → 一気に
    front += speed * dt;
    const s = chase.update(dt, front);
    expect(s).toBeGreaterThanOrEqual(front + minLeadFor(front) - 1e-9);
    expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
    if (i === 110) slowV = (s - prev) / dt;
    if (i === 200) fastV = (s - prev) / dt;
    prev = s;
  }
  expect(fastV).toBeGreaterThan(slowV * 4);
  expect(fastV).toBeGreaterThan(300);
  // 大きな dt でも front を追い越されない
  const c2 = createChase(10);
  expect(c2.update(0.5, 200)).toBeGreaterThanOrEqual(200 + minLeadFor(200));
});

test('追われて引くカメラ: 実際の爆発曲線（じわじわ → 弾ける）でも飲まれない', () => {
  const R = CONFIG.radius.max, dur = blastDuration(R);
  const chase = createChase(30), dt = 1 / 60;
  let prev = 30, creepEnd = 0;
  for (let t = dt; t <= dur + 1e-9; t += dt) {
    const front = frontAt(t, R), s = chase.update(dt, front);
    expect(s).toBeGreaterThanOrEqual(front + minLeadFor(front) - 1e-9);
    expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
    if (t < CONFIG.blast.creepSec) creepEnd = s - 30; // じわじわ期はほとんど引かない
    prev = s;
  }
  expect(creepEnd).toBeLessThan(40);
  expect(prev).toBeGreaterThan(R); // 最後には球の外
});


// createCinematic の進み方（描画の部品は小さな身代わり）
function makeCinematic(size = { w: 390, h: 844 }, shot = SHOTS[2]) {
  const views = { size };
  const enemyView = { setHeroYaw() {}, eyeCloseup: (id) => buildEyeCloseup(id) };
  const explosionView = { screen: { flash: 0.3, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0.002 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const sun = new THREE.DirectionalLight(0xffffff, 4), fill = new THREE.HemisphereLight(0xffffff, 0x000000, 1.6);
  const cin = createCinematic(views, enemyView, explosionView, { renderer, scene: new THREE.Scene(), lights: { sun, fill } });
  const plan = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius) });
  const log = [];
  cin.on('cue', (c) => log.push(c.name + (c.arg ?? '')));
  cin.on('end', () => log.push('END'));
  return { cin, plan, log, shot, lights: { sun, fill } };
}
const advance = (cin, sec, dt = 1 / 60) => { const out = []; for (let t = 0; t < sec - 1e-9; t += dt) { cin.update(dt); out.push({ stage: cin.stage, g: cin.gameDt, w: cin.worldDt }); } return out; };

test('createCinematic: 手の画面 → 真っ白 → 体感時間（街） → 追われて引く → 宇宙 → 終わると end を一度だけ知らせ、最後の絵のまま待つ', () => {
  const { cin, plan, log, shot } = makeCinematic();
  expect(cin.active).toBe(false);
  expect(cin.gameDt).toBeNull();
  cin.play(plan, shot);
  const tl = cin.timeline;
  expect(cin.active).toBe(true);
  advance(cin, 0.1);
  expect(cin.stage).toBe('hands');
  expect(cin.fullscreen).toBe(false); // 両手が組み合わさる間は2画面
  advance(cin, tl.white - 0.15);
  expect(cin.white).toBe(true);
  expect(cin.fullscreen).toBe(true);
  advance(cin, 0.3);
  expect(cin.stage).toBe('contact');
  expect(cin.white).toBe(false);
  expect(cin.renderScene).toBeNull(); // 街の場面
  advance(cin, 1.2);
  expect(cin.stage).toBe('beat');
  advance(cin, tl.snap + 0.2 - cin.time);
  expect(cin.stage).toBe('chase');
  expect(cin.renderScene).toBeNull();
  advance(cin, tl.chaseEnd + 0.1 - cin.time);
  expect(cin.stage).toBe('space');
  expect(cin.renderScene).not.toBeNull(); // 宇宙の場面
  expect(cin.camera).not.toBeNull();
  advance(cin, tl.end - cin.time + 0.2);
  expect(cin.finished).toBe(true);
  expect(cin.active).toBe(true);
  expect(cin.fullscreen).toBe(true);
  advance(cin, 1);
  expect(log.filter((x) => x === 'END')).toHaveLength(1);
  cin.stop();
  expect(cin.active).toBe(false);
  expect(cin.fullscreen).toBe(false);
});

test('音の段取り: 無音 → 心臓の鼓動（一拍の間だけ、3回） → 時間が戻る → 宇宙 → 地鳴り → 終わり（それぞれ一度だけ）', () => {
  const { cin, plan, log, shot } = makeCinematic();
  cin.play(plan, shot);
  const stages = [];
  cin.on('cue', (c) => stages.push([c.name, cin.stage]));
  advance(cin, cin.timeline.end + 0.5);
  expect(log).toEqual(['silence', 'heart0', 'heart1', 'heart2', 'snap', 'space', 'rumble', 'END']);
  for (const [name, stage] of stages) if (name === 'heart') expect(stage).toBe('beat');
});

test('ゲームの時計は演出の時刻表どおりに進み（合計が一致）、体感時間の一拍の間は世界がほとんど止まる', () => {
  const { cin, plan, shot } = makeCinematic();
  cin.play(plan, shot);
  const tl = cin.timeline;
  const frames = advance(cin, tl.end);
  const sum = frames.reduce((a, f) => a + f.g, 0);
  expect(sum).toBeCloseTo(tl.gameClock(cin.time), 6);
  // 爆発は追う間に終わる（ゲームは over になれる）
  expect(tl.gameClock(tl.chaseEnd)).toBeGreaterThanOrEqual(CONFIG.cinematic.freezeSec + blastDuration(shot.radius));
  for (const f of frames.filter((x) => x.stage === 'beat')) expect(f.w).toBeLessThan(0.02 / 60);
  for (const f of frames.filter((x) => x.stage === 'hands')) { expect(f.g).toBe(0); expect(f.w).toBe(0); }
});

test('一拍の間は街の光を弱め（光を背にした壁が影に沈む）、時間が戻ると元に戻す', () => {
  const { cin, plan, shot, lights } = makeCinematic();
  const base = [lights.sun.intensity, lights.fill.intensity];
  cin.play(plan, shot);
  advance(cin, 2);
  expect(lights.fill.intensity).toBeLessThan(base[1] * 0.5);
  advance(cin, cin.timeline.snap + 0.3 - cin.time);
  expect([lights.sun.intensity, lights.fill.intensity]).toEqual(base);
});

test('黒い帯: 縦長は 9:16、横長は 2.39:1 に切る（それより細長くない画面には帯なし）', () => {
  expect(barsFor(390 / 844)).toBeCloseTo((1 - (390 / 844) / (9 / 16)) / 2, 6);
  expect(barsFor(1280 / 720)).toBeCloseTo((1 - (1280 / 720) / 2.39) / 2, 6);
  expect(barsFor(9 / 16)).toBeCloseTo(0, 6);
  expect(barsFor(3)).toBe(0);
  for (const size of [{ w: 390, h: 844 }, { w: 1280, h: 720 }]) {
    const { cin, plan, shot } = makeCinematic(size);
    cin.play(plan, shot);
    advance(cin, 2);
    expect(cin.screen.grade.bars).toBeCloseTo(barsFor(size.w / size.h), 6);
  }
});

test('追われて引くカメラは、前線（迫る球の表面）より外にいる。宇宙では地球の外にいる', () => {
  for (const shot of SHOTS) {
    const { cin, plan } = makeCinematic(undefined, shot);
    cin.play(plan, shot);
    const tl = cin.timeline;
    advance(cin, tl.snap + 0.02);
    while (cin.stage === 'chase') {
      const front = tl.front(cin.time);
      expect(cin.camera.position.length()).toBeGreaterThan(front);
      advance(cin, 1 / 60);
    }
    advance(cin, 0.5);
    const p = cin.camera.position;
    expect(p.distanceTo(new THREE.Vector3(0, -1000, 0))).toBeGreaterThan(1000);
  }
});
