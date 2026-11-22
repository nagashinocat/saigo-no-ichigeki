import { test, expect } from 'vitest';
import * as THREE from 'three';
import { leadFor, minLeadFor, createChase, createCinematic, barsFor, shellRadius, FLING, spaceSparkTime, VEIL_NEAR, VEIL_K, VEIL_ADD, VEIL_GROW, WHITE_AHEAD, CHASE_HOLD, BEAT_LENS, LENS, beatLens } from '../../src/render/cinematic.js';
import { createEnemies } from '../../src/game/enemies.js';
import { createTimeline, FINALE } from '../../src/render/finaleTimeline.js';
import { planFinale, planRetreat } from '../../src/render/finalePlan.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';
import { frontAt, blastDuration } from '../../src/game/blast.js';

const city = generateCity(3);
const shotOf = (amount) => ({ amount, radius: radiusFor(amount), isBig: true });
const SHOTS = [shotOf(CONFIG.power.minRelease), shotOf(60), shotOf(CONFIG.power.max)];
const enemy = (id, angle, dist, state = 'approach') => ({ id, angle, dist, state, deadTime: 0 });
const patrol = (id, angle, dist) => ({ ...enemy(id, angle, dist, 'search'), patrol: true });
const ARMY = [enemy(1, 0.3, 40), enemy(2, 2.1, 30), enemy(4, 5.2, 55), patrol(11, 0.8, 120), patrol(12, 2.6, 210), patrol(13, 4.4, 330), patrol(14, 5.9, 410)];

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


test('追われて引くカメラ: hold で止まり、ゆっくり進む光の壁を待ち受ける（それでも front + minLead より近づかない）', () => {
  const chase = createChase(30, { hold: 300 });
  const dt = 1 / 60;
  let front = 0, s = 30, held = 0;
  for (let i = 0; i < 600; i++) {
    front += 30 * dt;
    s = chase.update(dt, front);
    expect(s).toBeGreaterThanOrEqual(front + minLeadFor(front) - 1e-9);
    if (front < 250) expect(s).toBeLessThanOrEqual(300 + 1e-6);
    if (Math.abs(s - 300) < 0.5) held++;
  }
  expect(held).toBeGreaterThan(60); // しばらく止まって待つ
  expect(s).toBeGreaterThan(300);   // 壁が迫れば、それより先へ押し出される
});

// createCinematic の進み方（描画の部品は小さな身代わり）
function makeCinematic(size = { w: 390, h: 844 }, shot = SHOTS[2], opts = {}) {
  const views = { size };
  const enemyView = { setHeroYaw() {} };
  const explosionView = { screen: { flash: 0.3, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0.002 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const sun = new THREE.DirectionalLight(0xffffff, 4), fill = new THREE.HemisphereLight(0xffffff, 0x000000, 1.6);
  const cin = createCinematic(views, enemyView, explosionView, { renderer, scene: new THREE.Scene(), lights: { sun, fill }, ...opts });
  const plan = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius) });
  const log = [];
  cin.on('cue', (c) => log.push(c.name + (c.arg ?? '')));
  cin.on('end', () => log.push('END'));
  return { cin, plan, log, shot, lights: { sun, fill } };
}
const advance = (cin, sec, dt = 1 / 60) => { const out = []; for (let t = 0; t < sec - 1e-9; t += dt) { cin.update(dt); out.push({ stage: cin.stage, g: cin.gameDt, w: cin.worldDt }); } return out; };

test('createCinematic: 手の画面 → 真っ白 → 遠くの軍勢の後ろ（スローでふくらむ → 弾けて飲まれる） → 追われて引く → 宇宙 → 終わると end を一度だけ知らせ、最後の絵のまま待つ', () => {
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
  expect(cin.stage).toBe('swell');
  expect(cin.white).toBe(false);
  expect(cin.renderScene).toBeNull(); // 街の場面
  advance(cin, tl.burst + 0.02 - cin.time);
  expect(cin.stage).toBe('race');
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

test('音の段取り（音は画面に従う）: 無音 → 白が晴れて爆発が始まる（erupt）→ 弾けた瞬間（burst）→ 宇宙 → 地鳴り → 終わり（それぞれ一度だけ。鼓動はもうない）', () => {
  const { cin, plan, log, shot } = makeCinematic();
  const at = [];
  cin.on('cue', (c) => at.push([c.name, cin.time, cin.stage]));
  cin.play(plan, shot);
  advance(cin, cin.timeline.end + 0.5);
  expect(log).toEqual(['silence', 'erupt', 'burst', 'space', 'rumble', 'END']);
  const tl = cin.timeline;
  const t = (n) => at.find((x) => x[0] === n)[1];
  expect(t('erupt') - tl.white).toBeGreaterThanOrEqual(0);
  expect(t('erupt') - tl.white).toBeLessThan(1 / 60 + 1e-9);
  expect(t('burst') - tl.burst).toBeGreaterThanOrEqual(0);
  expect(t('burst') - tl.burst).toBeLessThan(1 / 60 + 1e-9);
});

test('ゲームの時計は演出の時刻表どおりに進み（合計が一致）、世界の進みはスローの間に減らず、弾けたあと現実の速さ', () => {
  const { cin, plan, shot } = makeCinematic();
  cin.play(plan, shot);
  const tl = cin.timeline;
  const frames = advance(cin, tl.end);
  const sum = frames.reduce((a, f) => a + f.g, 0);
  expect(sum).toBeCloseTo(tl.gameClock(cin.time), 6);
  expect(tl.gameClock(tl.domeEnd)).toBeGreaterThanOrEqual(CONFIG.cinematic.freezeSec + blastDuration(shot.radius) - 1e-9);
  expect(tl.gameClock(tl.chaseEnd)).toBeLessThan(CONFIG.cinematic.freezeSec + blastDuration(shot.radius));
  for (const f of frames.filter((x) => x.stage === 'hands')) { expect(f.g).toBe(0); expect(f.w).toBe(0); }
  // 世界の進み（1 フレームあたり）: 白が晴れてから弾けるまで減らない（小さな丸めは許す）。弾けたあとは現実の速さ
  let prev = 0;
  for (const f of frames.filter((x) => x.stage === 'swell')) { expect(f.w).toBeGreaterThanOrEqual(prev - 1e-9); prev = f.w; }
  for (const f of frames.filter((x) => x.stage === 'chase')) expect(f.w).toBeCloseTo(1 / 60, 6);
});

test('軍勢の後ろのカットの間は街の光を少し弱め（遠くの爆発の光が際立つ）、追うカットで元に戻す', () => {
  const { cin, plan, shot, lights } = makeCinematic();
  const base = [lights.sun.intensity, lights.fill.intensity];
  cin.play(plan, shot);
  advance(cin, 1.5);
  expect(lights.fill.intensity).toBeLessThan(base[1] * 0.8);
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

test('画質の段は演出を始めるたびに読む: 始めは high でも、段が下がっていれば雲の段数・星はその段の重さ', () => {
  let tier = 'high';
  const { cin, plan, shot } = makeCinematic(undefined, undefined, { tier: 'high', getTier: () => tier });
  cin.play(plan, shot);
  const hi = cin.quality;
  expect(hi.tier).toBe('high');
  tier = 'low';
  cin.stop();
  cin.play(plan, shot);
  const lo = cin.quality;
  expect(lo.tier).toBe('low');
  expect(lo.space.oct).toBeLessThan(hi.space.oct);
  expect(lo.space.stars).toBeLessThan(hi.space.stars);
});

test('逃げる道を後回しにした plan: 放つ瞬間・白の間には求めず、スローの間に一度だけ求め、追われて引く道に使う', () => {
  const { cin, shot } = makeCinematic();
  const lazy = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius), retreat: false });
  expect(lazy.retreat).toBeNull();
  let calls = 0;
  const resolve = () => { calls++; return planRetreat(lazy, { buildings: city.buildings, radius: shot.radius, lead: leadFor(shot.radius) }); };
  cin.play(lazy, shot, { retreat: resolve });
  const tl = cin.timeline;
  while (cin.time < tl.white - 0.02) { cin.update(1 / 60); expect(calls).toBe(0); }
  while (cin.time < tl.burst - 0.02) cin.update(1 / 60);
  expect(calls).toBe(1);
  expect(lazy.retreat).toBeNull(); // 渡した plan は書き換えない
  while (cin.time < tl.snap + 0.5) cin.update(1 / 60);
  expect(calls).toBe(1);
  expect(cin.stage).toBe('chase');
  expect(cin.camera.position.toArray().every(Number.isFinite)).toBe(true);
  expect(() => makeCinematic().cin.play(lazy, shot)).toThrow();
});

test('宇宙の衝撃波の殻もゆっくりふくらむ: いつも半球の少し先にいて、ふくらむ速さは 1 秒あたり 0.6 rMax 以下', () => {
  for (const shot of SHOTS) {
    const tl = createTimeline({ radius: shot.radius });
    const dt = 1 / 120;
    let prev = shellRadius(tl.domeAt(tl.chaseEnd)), maxRate = 0;
    for (let t = tl.chaseEnd + dt; t <= tl.flatten; t += dt) {
      const p = tl.domeAt(t), s = shellRadius(p);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(s).toBeGreaterThan(0.4 + 0.6 * p); // 半球（DOME0 = 0.4）より外
      maxRate = Math.max(maxRate, (s - prev) / dt);
      prev = s;
    }
    expect(maxRate).toBeLessThanOrEqual(0.6);
  }
});

// ---- R0b: 遠くの軍勢の後ろ（持ち主 22:15）----
function makeBeat(shot = SHOTS[2], size = { w: 390, h: 844 }, opts = {}) {
  const focus = [];
  const enemyView = { setHeroYaw() {}, setFocus: (f) => focus.push(f && { id: f.id, pose: f.pose, group: f.group }) };
  const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const cin = createCinematic({ size }, enemyView, explosionView, { renderer, scene: new THREE.Scene(), ...opts });
  const plan = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius) });
  return { cin, plan, shot, focus };
}
const project = (cam, p) => new THREE.Vector3(...p).project(cam);

test('乗り手の列: 画面全体になってから決めた隊形に描かれ（撮る一人と列の者）、光の壁が届くまで浮いて爆心を向き、届くと壁の前を外へ運ばれて回り、追いつかれたら消える。やめると戻る', () => {
  for (const shot of SHOTS) {
    const { cin, plan, focus } = makeBeat(shot);
    cin.play(plan, shot);
    const tl = cin.timeline;
    expect(focus).toEqual([]); // 両手の間（2画面）はまだ
    advance(cin, tl.white + 0.05);
    expect(focus).toHaveLength(1);
    expect(focus[0].id).toBe(plan.riderId);
    expect(focus[0].group.map((g) => g.id)).toEqual(plan.riders.slice(1).map((r) => r.id));
    const poses = [focus[0].pose, ...focus[0].group.map((g) => g.pose)];
    // スローの間: 決めた場所のそばに浮いて、爆心を向く
    advance(cin, tl.burst - 0.05 - cin.time);
    plan.riders.forEach((r, i) => {
      const p = poses[i];
      expect(p.keep).toBe(1);
      expect(Math.hypot(p.x - r.pos[0], p.y - r.pos[1], p.z - r.pos[2])).toBeLessThan(0.3);
      expect(Math.abs(Math.atan2(Math.sin(p.yaw - r.yaw), Math.cos(p.yaw - r.yaw)))).toBeLessThan(0.1);
    });
    // 弾けてから: 見えている間は、いつも光の壁（球の表面）の外（壁を背にした影）。押されると外へ動き、回る
    const moved = poses.map(() => 0), spun = poses.map(() => 0), gone = poses.map(() => false);
    while (cin.time < tl.snap - 1e-9) {
      advance(cin, 1 / 60);
      const f = tl.front(cin.time);
      poses.forEach((p, i) => {
        const r = plan.riders[i];
        if (p.keep > 0) expect(Math.hypot(p.x, p.y, p.z), `rider ${i} t=${cin.time.toFixed(3)}`).toBeGreaterThan(f - 0.31);
        else gone[i] = true;
        moved[i] = Math.max(moved[i], Math.hypot(p.x, p.z) - Math.hypot(r.pos[0], r.pos[2]));
        spun[i] = Math.max(spun[i], Math.abs(p.pitch));
      });
    }
    expect(gone.every(Boolean)).toBe(true); // カメラが飲まれるまでに全員飲まれる
    for (const m of moved) expect(m).toBeGreaterThan(1);
    for (const sp of spun) expect(sp).toBeGreaterThan(0.3);
    advance(cin, 0.05);
    for (const p of poses) expect(p.keep).toBe(0);
    cin.stop();
    expect(focus.at(-1)).toBeNull();
  }
});

const SIZES = [{ w: 390, h: 844 }, { w: 1280, h: 720 }];
// 画面の上の乗り手の箱（NDC）: 体（バイクの底から 1.9 m）を写し、遠くで小さすぎる者は enemyView と同じく最低 16 px に大きく描く
function riderBox(cam, size, p) {
  const lo = project(cam, [p[0], p[1], p[2]]), hi = project(cam, [p[0], p[1] + 1.9, p[2]]);
  const minH = 16 / (size.h / 2), h = Math.max(minH, hi.y - lo.y), cy = (lo.y + hi.y) / 2;
  const hw = h * 0.6 / 2 * (size.h / size.w);
  return { x0: lo.x - hw, x1: lo.x + hw, y0: cy - h / 2, y1: cy + h / 2, z: lo.z, h };
}

test('fix2 スローの間のレンズ: スローの終わりに、じわじわ期の光の玉（半径 f0）が画面の高さの 0.25〜0.4 倍（画角は 18〜35°）', () => {
  expect(beatLens(10, 100)).toBeCloseTo(Math.min(35, Math.max(18, 2 * Math.atan(0.1) * 180 / Math.PI / 0.33)), 9);
  expect(beatLens(1, 1000)).toBe(BEAT_LENS.min);
  expect(beatLens(500, 100)).toBe(BEAT_LENS.max);
  for (const size of SIZES) {
    for (const shot of SHOTS) {
      const { cin, plan } = makeBeat(shot, size);
      cin.play(plan, shot);
      const tl = cin.timeline;
      advance(cin, tl.white + 0.05);
      while (cin.time < tl.burst - 1 / 60) {
        expect(cin.camera.fov).toBeGreaterThanOrEqual(BEAT_LENS.min - 1e-9);
        expect(cin.camera.fov).toBeLessThanOrEqual(BEAT_LENS.max + 1e-9);
        advance(cin, 1 / 60);
      }
      const d = cin.camera.position.length(), ball = 2 * Math.atan(tl.creepFront / d) / THREE.MathUtils.degToRad(cin.camera.fov);
      expect(ball, `${size.w} r=${shot.radius.toFixed(0)}`).toBeGreaterThanOrEqual(0.25);
      expect(ball, `${size.w} r=${shot.radius.toFixed(0)}`).toBeLessThanOrEqual(0.4);
    }
  }
});

test('fix2 スローの間: 手前の撮る一人は画面の中（下 1/3、画面の高さの 12% 以上）で、爆心の光の玉の真ん中より下。光の玉（爆心の 0.5·f0 の高さ）も画面の中', () => {
  for (const size of SIZES) {
    for (const shot of SHOTS) {
      const { cin, plan } = makeBeat(shot, size);
      cin.play(plan, shot);
      const tl = cin.timeline;
      advance(cin, tl.white + 0.05);
      while (cin.time < tl.burst) {
        const cam = cin.camera, b = riderBox(cam, size, plan.riders[0].pos), gz = project(cam, [0, 0.5 * tl.creepFront, 0]);
        const tag = `${size.w} r=${shot.radius.toFixed(0)} t=${cin.time.toFixed(2)}`;
        expect(Math.abs(gz.x), tag).toBeLessThan(0.8);
        expect(Math.abs(gz.y), tag).toBeLessThan(0.8);
        // 撮る一人: 画面の中（体の大半が入る）、下 1/3 の高さ、大きく、爆心の光の玉の真ん中より下（バイクの底）
        expect((b.x0 + b.x1) / 2, tag).toBeGreaterThan(-0.95);
        expect((b.x0 + b.x1) / 2, tag).toBeLessThan(0.95);
        expect((b.y0 + b.y1) / 2, tag).toBeLessThan(-1 / 3);
        expect(b.y0, tag).toBeGreaterThan(-1);
        expect(b.h / 2, tag).toBeGreaterThanOrEqual(0.12);
        expect(project(cam, plan.riders[0].pos).y, tag).toBeLessThan(gz.y);
        advance(cin, 0.1);
      }
    }
  }
});

test('fix2 乗り手どうしは画面の上で重ならない（スローの終わりと弾けた直後。遠くで大きく描かれる分も見込む）。弾けると画角が広がり、乗り手の大半が画面に入る。白いのは光の壁がカメラの数 m 手前に来てから', () => {
  for (const size of SIZES) {
    for (const shot of SHOTS) {
      const { cin, plan } = makeBeat(shot, size);
      cin.play(plan, shot);
      const tl = cin.timeline;
      const check = () => {
        const boxes = plan.riders.map((r) => riderBox(cin.camera, size, r.pos));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i], q = boxes[j];
          const overlap = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
          expect(overlap, `${size.w} r=${shot.radius.toFixed(0)} riders ${i},${j} t=${cin.time.toFixed(2)}`).toBe(false);
        }
      };
      advance(cin, tl.burst - 0.02);
      const fov0 = cin.camera.fov;
      check();
      advance(cin, Math.min(tl.burst + 0.3, tl.firstEngulf - 0.02) - cin.time);
      check();
      advance(cin, Math.min(tl.burst + 0.3, tl.camHit - 0.1) - cin.time);
      expect(cin.camera.fov).toBeGreaterThan(fov0 + 8);
      const inView = plan.riders.filter((r) => { const q = project(cin.camera, [r.pos[0], r.pos[1] + 1, r.pos[2]]); return Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && q.z < 1; });
      expect(inView.length, `${size.w} r=${shot.radius.toFixed(0)}`).toBeGreaterThanOrEqual(Math.ceil(plan.riders.length / 2));
      while (cin.time < tl.camHit - 0.05) {
        const gap = tl.camDist - tl.front(cin.time);
        if (gap > WHITE_AHEAD + 1) expect(cin.screen.flash, `t=${cin.time.toFixed(3)}`).toBeLessThan(0.02);
        advance(cin, 1 / 60);
      }
      expect(cin.screen.grade.exposure).toBeLessThan(0.8);
    }
  }
});

test('fix2 時刻表は撮る場所の乗り手とカメラの距離（riderDist・firstDist・camDist）で作る', () => {
  for (const shot of SHOTS) {
    const { cin, plan } = makeBeat(shot);
    cin.play(plan, shot);
    const tl = cin.timeline, ref = createTimeline({ radius: shot.radius, riderDist: plan.riderDist, firstDist: plan.firstDist, camDist: plan.camDist });
    expect(tl.riderDist).toBeCloseTo(plan.riderDist, 9);
    expect(tl.camDist).toBeCloseTo(plan.camDist, 9);
    expect(tl.firstDist).toBeCloseTo(plan.firstDist, 9);
    for (const k of ['burst', 'firstEngulf', 'engulf', 'camHit', 'snap', 'chaseEnd', 'end']) expect(tl[k]).toBeCloseTo(ref[k], 9);
  }
});

test('fix2/fix3 撮る場所は放つ瞬間ではなく、白を描いた次のフレームで一度だけ決める（その間の重い計算で、画面は白のまま）。ゲームの時計・段は撮る場所を先に渡したときと同じ（60/30/20 fps）', () => {
  for (const fps of [60, 30, 20]) {
    const shot = SHOTS[2];
    const eager = makeBeat(shot), lazy = makeBeat(shot);
    eager.cin.play(eager.plan, shot);
    let calls = 0, rCalls = 0, rAt = null;
    const lp = { ...lazy.plan, retreat: null };
    lazy.cin.play(() => { calls++; return lp; }, shot, { retreat: () => { rCalls++; rAt = { white: lazy.cin.white, t: lazy.cin.time }; return lazy.plan.retreat; } });
    const dt = 1 / fps;
    expect(calls).toBe(0);
    let whiteFrames = 0, frames = 0, planAt = 0;
    while (eager.cin.time < eager.cin.timeline.snap + 0.5) {
      eager.cin.update(dt); lazy.cin.update(dt); frames++;
      if (calls === 1 && !planAt) planAt = frames;
      if (rCalls === 1 && !rAt.frame) rAt.frame = frames;
      if (lazy.cin.white) whiteFrames++;
      // 白の最初のフレーム（白を描く）までは決めない。その次のフレームで決める（まだ白の間）
      if (whiteFrames <= 1) expect(calls).toBe(0);
      else expect(calls).toBe(1);
      if (whiteFrames === 2) { expect(lazy.cin.white).toBe(true); expect(rCalls).toBe(0); }
      expect(lazy.cin.stage).toBe(eager.cin.stage);
      expect(lazy.cin.gameDt).toBeCloseTo(eager.cin.gameDt, 12);
      expect(lazy.cin.worldDt).toBeCloseTo(eager.cin.worldDt, 12);
    }
    expect(lazy.cin.timeline.camHit).toBeCloseTo(eager.cin.timeline.camHit, 12);
    // fix3: 重い逃げる道は、撮る場所を決めた次の白のフレームで一度だけ（スローの最初のフレームで止まらない）
    expect(rCalls).toBe(1);
    // fix4: 20 fps でも白のうち（撮る場所を決めた次のフレーム。20 fps の白は 0.25・0.30・0.35・0.40 s の 4 フレーム）
    expect(rAt.white, `${fps} fps`).toBe(true);
    expect(rAt.frame, `${fps} fps`).toBe(planAt + 1);
    expect(lazy.cin.camera.position.distanceTo(eager.cin.camera.position)).toBeLessThan(1e-9);
  }
});

test('fix1/fix2 隠すビル: 白の間に plan.hide を先に隠す。光の壁が触れたビルは、カメラのそば（VEIL_NEAR 以内）か、画面の中でカメラの近く（壁の残りの道のりの VEIL_K 倍 + VEIL_ADD 以内）なら触れた瞬間に隠す。追うカットへ切り替わると戻す。遠くのビルは隠さない（fix3: 飲まれたビルは不透明な光の壁の中に隠れる）', () => {
  const hides = [];
  for (const shot of SHOTS) {
    const veiled = new Map(), restored = new Map();
    const { cin, plan } = makeBeat(shot, undefined, { veilBuilding: (id, on) => (on ? veiled.set(id, cin.time) : restored.set(id, cin.time)) });
    cin.play(plan, shot, { buildings: city.buildings });
    const tl = cin.timeline;
    const near = (b) => Math.hypot(Math.max(0, Math.abs(b.x) - b.w / 2), Math.max(0, Math.abs(b.z) - b.d / 2));
    const byCam = (b) => Math.hypot(Math.max(0, Math.abs(b.x - plan.camPos[0]) - b.w / 2), Math.max(0, Math.abs(b.z - plan.camPos[2]) - b.d / 2));
    let why = new Map();
    while (cin.time < tl.snap + 0.3) {
      cin.update(1 / 60);
      if (cin.time < tl.snap) { expect(restored.size).toBe(0); why = new Map(cin.veilReasons); }
    }
    const hide = new Set(plan.hide);
    hides.push(plan.hide.length);
    for (const id of plan.hide) expect(veiled.get(id)).toBeLessThan(tl.white + 1e-9);
    for (const [id, at] of veiled) {
      const b = city.buildings.find((x) => x.id === id);
      expect(restored.get(id)).toBeGreaterThanOrEqual(tl.snap);
      expect(restored.get(id)).toBeLessThan(tl.snap + 1 / 60 + 1e-9);
      if (at < tl.white) { expect(hide.has(id)).toBe(true); expect(at).toBeGreaterThanOrEqual(tl.hands); expect(why.get(id)).toBe('hide'); continue; }
      expect(at).toBeLessThan(tl.snap + 1e-9);
      expect(near(b)).toBeLessThanOrEqual(tl.front(at) + 1e-6);
      expect(byCam(b) < VEIL_NEAR || byCam(b) < VEIL_K * (tl.camDist - near(b)) + VEIL_ADD).toBe(true);
    }
    // 遠くのビル（どの決まりにも入らない）は隠さない
    const far = city.buildings.filter((b) => !hide.has(b.id) && near(b) < tl.front(tl.snap - 1e-6) && byCam(b) >= VEIL_K * (tl.camDist - near(b)) + VEIL_ADD && byCam(b) >= VEIL_NEAR);
    expect(far.length).toBeGreaterThan(0);
    for (const b of far) expect(veiled.has(b.id)).toBe(false);
    const n = restored.size;
    cin.stop();
    expect(restored.size).toBe(n);
  }
  if (process.env.R0B_LOG) console.log('hide', hides);
  expect(hides.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
});

test('fix2 画面の外と決めた触れたビルも、画角が広がり向きが変わって画面に入る前に隠す（60 fps の毎フレーム、近いもので隠れていないものは画面の外）', () => {
  for (const size of SIZES) {
    for (const shot of SHOTS) {
      const veiled = new Set();
      const { cin, plan } = makeBeat(shot, size, { veilBuilding: (id, on) => (on ? veiled.add(id) : veiled.delete(id)) });
      cin.play(plan, shot, { buildings: city.buildings });
      const tl = cin.timeline;
      const near = (b) => Math.hypot(Math.max(0, Math.abs(b.x) - b.w / 2), Math.max(0, Math.abs(b.z) - b.d / 2));
      const byCam = (b) => Math.hypot(Math.max(0, Math.abs(b.x - plan.camPos[0]) - b.w / 2), Math.max(0, Math.abs(b.z - plan.camPos[2]) - b.d / 2));
      const frus = new THREE.Frustum(), m = new THREE.Matrix4(), box = new THREE.Box3();
      while (cin.time < tl.snap - 1 / 60) {
        cin.update(1 / 60);
        if (cin.stage !== 'race' && cin.stage !== 'swell') continue;
        const cam = cin.camera, f = tl.front(cin.time);
        frus.setFromProjectionMatrix(m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        for (const b of city.buildings) {
          if (near(b) > f || veiled.has(b.id) || byCam(b) >= VEIL_K * (tl.camDist - near(b)) + VEIL_ADD) continue;
          box.min.set(b.x - b.w / 2, 0, b.z - b.d / 2); box.max.set(b.x + b.w / 2, b.h, b.z + b.d / 2);
          expect(frus.intersectsBox(box), `${size.w} r=${shot.radius.toFixed(0)} b${b.id} t=${cin.time.toFixed(3)}`).toBe(false);
        }
      }
    }
  }
});

test('fix1 軍勢の後ろのカットの間は、軍勢と主人公を爆発の光で白く光らせない（glowScale 0: 光の壁を背にした黒い影）。追うカットで戻す', () => {
  const { cin, plan, shot } = makeBeat();
  cin.play(plan, shot);
  const tl = cin.timeline;
  advance(cin, tl.burst + 0.1);
  expect(cin.glowScale).toBe(0);
  advance(cin, tl.snap + 0.1 - cin.time);
  expect(cin.glowScale).toBe(1);
});

test('持ち主 23:01: 追うカットで引ききったカメラは、宇宙へ切り替わる直前の球（前線の半径）を、縦長でも横長でも画面の内に余白をもって収める', () => {
  expect(1 + CHASE_HOLD.gap).toBeGreaterThanOrEqual(1.9);
  for (const size of [{ w: 390, h: 844 }, { w: 1280, h: 720 }]) {
    for (const shot of SHOTS) {
      const { cin, plan } = makeCinematic(size, shot);
      cin.play(plan, shot);
      const tl = cin.timeline;
      advance(cin, tl.chaseEnd - 0.02);
      expect(cin.stage).toBe('chase');
      const cam = cin.camera, f = tl.front(cin.time);
      // 球の見かけの半径（中心から）が、短い向きの画角の半分の 0.9 倍以内
      const d = cam.position.length();
      const halfV = THREE.MathUtils.degToRad(cam.fov) / 2, half = cam.aspect < 1 ? Math.atan(Math.tan(halfV) * cam.aspect) : halfV;
      expect(Math.asin(Math.min(1, f / d)), `${size.w} r=${shot.radius.toFixed(0)}`).toBeLessThan(0.9 * half);
      // 球の左右の縁と頂は画面の内
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
      for (const p of [right.clone().multiplyScalar(f), right.clone().multiplyScalar(-f), new THREE.Vector3(0, f, 0)]) {
        const q = p.project(cam);
        expect(Math.abs(q.x)).toBeLessThan(1);
        expect(Math.abs(q.y)).toBeLessThan(1);
      }
    }
  }
});

// S8 fix2: 宇宙の火花は一斉に弾けず、宇宙の光の半球の縁に沿って広がる輪になる（前は追う間に飲まれた者が、宇宙の最初の
// フレームで一斉に弾けていた）
test('fix2: spaceSparkTime は時刻表の半球の縁から決まり、遠い者ほど遅い。半球の中の者は -Infinity、半径の外は Infinity', () => {
  const R = CONFIG.radius.max;
  const tl = createTimeline({ radius: R });
  expect(spaceSparkTime(tl, 0.3 * R, R)).toBe(-Infinity);
  expect(spaceSparkTime(tl, 1.05 * R, R)).toBe(Infinity);
  let prev = tl.chaseEnd;
  for (let f = 0.42; f <= 1.0001; f += 0.04) {
    const at = spaceSparkTime(tl, f * R, R);
    expect(at).toBeGreaterThan(prev - 1e-9);
    expect(at).toBeGreaterThanOrEqual(tl.chaseEnd);
    expect(at).toBeLessThanOrEqual(tl.domeEnd + 1e-9);
    // 縁がちょうどその者に届いている
    expect(0.4 + 0.6 * tl.domeAt(at)).toBeCloseTo(Math.min(1, f), 3);
    prev = at;
  }
});

test('fix2: 宇宙の火花は街じゅうの見回る者が波のように弾ける（宇宙の最初のフレームに一斉に弾けず、どの 0.1 秒にも 15% 以下）', () => {
  const { cin, plan, shot } = makeCinematic();
  const city7 = generateCity(7);
  const E = createEnemies(createRng(2), CONFIG, { buildings: city7.buildings, patrolRng: createRng(9) });
  const pats = E.list.filter((e) => e.patrol);
  expect(pats.length).toBe(CONFIG.enemy.patrol.count);
  cin.play(plan, shot, { enemies: () => pats });
  const tl = cin.timeline;
  // 追う間に前線に飲まれた者（ゲームではもう倒れている）
  const engulfed = pats.filter((e) => e.dist <= tl.front(tl.chaseEnd)).length;
  expect(engulfed / pats.length).toBeGreaterThan(0.5);
  advance(cin, tl.chaseEnd + 1 / 60 - cin.time);
  expect(cin.stage).toBe('space');
  const firstAt = new Map();
  const bins = new Map();
  let firstFrame = null;
  while (cin.time < tl.flatten) {
    const sp = cin.spaceSparks;
    const fresh = sp.filter((s) => s.age >= 0 && s.age < 1 / 60 + 1e-9).length;
    if (firstFrame === null) firstFrame = sp.filter((s) => s.age >= 0).length;
    const b = Math.floor((cin.time - tl.chaseEnd) / 0.1);
    bins.set(b, (bins.get(b) ?? 0) + fresh);
    for (const s of sp) if (s.age >= 0 && !firstAt.has(`${s.x},${s.z}`)) firstAt.set(`${s.x},${s.z}`, cin.time);
    advance(cin, 1 / 60);
  }
  // 最初のフレームで弾けているのは 1 割以下（前は約 74%）
  expect(firstFrame).toBeLessThanOrEqual(Math.ceil(pats.length * 0.1));
  // 半球の外にいた者は宇宙のうちに火花になる（半分以上）、どの 0.1 秒にも 15% 以下
  expect(firstAt.size).toBeGreaterThan(pats.length * 0.5);
  for (const n of bins.values()) expect(n).toBeLessThanOrEqual(Math.ceil(pats.length * 0.15));
  // 波: 火花の始まる時刻が 1 秒以上に広がる
  const ts = [...firstAt.values()];
  expect(Math.max(...ts) - Math.min(...ts)).toBeGreaterThan(1);
});

// ---- R0b fix3 ----
test('fix3 光の壁: 軍勢の後ろのカット（swell・race）の間だけ blastWall 1（不透明な光の壁）。粉の板・物理の破片・光に溶ける箱は隠し、追うカットで戻す', () => {
  const group = new THREE.Group();
  const dust = new THREE.Object3D(); dust.name = 'dust';
  // fix4: 光に溶ける組（vaporize）のうち、箱（vaporizeBoxes）だけを隠す。立ちのぼる光の粒（vaporizeEmbers）は残す
  const vaporGroup = new THREE.Group(); vaporGroup.name = 'vaporize';
  const vapor = new THREE.Object3D(); vapor.name = 'vaporizeBoxes';
  const embers = new THREE.Object3D(); embers.name = 'vaporizeEmbers';
  vaporGroup.add(vapor, embers);
  group.add(dust, vaporGroup);
  const scene = new THREE.Scene(), debris = new THREE.Object3D(); debris.name = 'debris'; scene.add(debris);
  const enemyView = { setHeroYaw() {}, setFocus() {} };
  const explosionView = { group, screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const cin = createCinematic({ size: { w: 390, h: 844 } }, enemyView, explosionView, { renderer, scene });
  const shot = SHOTS[2];
  const plan = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius) });
  expect(cin.blastWall).toBe(0);
  cin.play(plan, shot);
  const tl = cin.timeline;
  while (cin.time < tl.chaseEnd + 0.1) {
    cin.update(1 / 60);
    const beat = cin.stage === 'swell' || cin.stage === 'race';
    expect(cin.blastWall, cin.stage).toBe(beat ? 1 : 0);
    if (beat) for (const o of [dust, vapor, debris]) expect(o.visible, `${o.name} ${cin.stage}`).toBe(false);
    expect(vaporGroup.visible).toBe(true);
    expect(embers.visible, `embers ${cin.stage}`).toBe(true);
    if (cin.stage === 'chase') for (const o of [dust, vapor, debris]) expect(o.visible).toBe(true);
  }
  cin.stop();
  expect(cin.blastWall).toBe(0);
});

test('fix3 スローの終わりに、光の玉（じわじわ期の前線）の幅の 90% 以上が画面の中（縦長・横長、3 つの大きさ、3 つの街）', () => {
  for (const seed of [3, 7, 11]) {
    const c = generateCity(seed);
    for (const size of SIZES) {
      for (const shot of SHOTS) {
        const enemyView = { setHeroYaw() {}, setFocus() {} };
        const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
        const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
        const cin = createCinematic({ size }, enemyView, explosionView, { renderer, scene: new THREE.Scene() });
        const plan = planFinale({ shot, buildings: c.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius) });
        cin.play(plan, shot);
        const tl = cin.timeline;
        advance(cin, tl.burst - 1 / 60);
        const cam = cin.camera, f0 = tl.creepFront;
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
        const xs = [-1, 1].map((k) => right.clone().multiplyScalar(k * f0).setY(0.05 * f0).project(cam).x).sort((a, b) => a - b);
        const onScreen = (Math.min(1, xs[1]) - Math.max(-1, xs[0])) / (xs[1] - xs[0]);
        expect(onScreen, `seed ${seed} ${size.w} r=${shot.radius.toFixed(0)}`).toBeGreaterThanOrEqual(0.9);
      }
    }
  }
});

test('fix3 弾けてから光の壁が乗り手の半分を飲むまで、どのフレームにも 3 人以上の乗り手が画面の中で光の壁の外にいる（読める影）', () => {
  const log = [];
  for (const seed of [3, 7, 11]) {
    const c = generateCity(seed);
    for (const size of SIZES) {
      for (const shot of SHOTS) {
        const focus = [];
        const enemyView = { setHeroYaw() {}, setFocus: (f) => focus.push(f) };
        const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
        const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
        const cin = createCinematic({ size }, enemyView, explosionView, { renderer, scene: new THREE.Scene() });
        const plan = planFinale({ shot, buildings: c.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius) });
        cin.play(plan, shot);
        const tl = cin.timeline;
        advance(cin, tl.burst + 1 / 60);
        const poses = [focus[0].pose, ...focus[0].group.map((g) => g.pose)];
        // 半分が飲まれる時刻: 乗り手の距離の中央値に前線が届く時刻
        const ds = plan.riders.map((r) => Math.hypot(...r.pos)).sort((a, b) => a - b);
        const tHalf = tl.timeAtFront(ds[Math.floor(ds.length / 2)]);
        let worst = Infinity;
        while (cin.time < tHalf) {
          const F = tl.front(cin.time);
          const n = poses.filter((p) => {
            if (!(p.keep > 0) || Math.hypot(p.x, p.y, p.z) < F + 0.5) return false;
            const q = project(cin.camera, [p.x, p.y + 0.95, p.z]);
            return Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && q.z < 1;
          }).length;
          worst = Math.min(worst, n);
          advance(cin, 1 / 60);
        }
        log.push([seed, size.w, Math.round(shot.radius), worst]);
      }
    }
  }
  if (process.env.R0B_LOG) console.log(JSON.stringify(log));
  for (const [seed, w, r, n] of log) expect(n, `seed ${seed} ${w} r=${r}`).toBeGreaterThanOrEqual(3);
});

// R0b fix4: 縦長の最大の一発で、手前の撮る一人が画面の端で体の半分ほど切れていた（1.8 / 2.9 s）。撮る場所を選ぶ側が縦横比を受け取り、
// 横のずれ・左右（足りなければスローのレンズ）を、光の玉と撮る一人の体がまるごと入るように選ぶ
test('fix4 スローの間ずっと（と弾けた直後）、光の玉の幅の 90% 以上と、手前の撮る一人の体の箱の 80% 以上が画面の中（縦長・横長、力 10/60/100、3 つの街）', async () => {
  const { NEAR_FRAME } = await import('../../src/render/finalePlan.js');
  const B = NEAR_FRAME.body;
  const log = [];
  for (const seed of [3, 7, 11]) {
    const c = generateCity(seed);
    for (const size of SIZES) {
      for (const amount of [10, 60, 100]) {
        const shot = shotOf(amount);
        const enemyView = { setHeroYaw() {}, setFocus() {} };
        const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
        const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
        const cin = createCinematic({ size }, enemyView, explosionView, { renderer, scene: new THREE.Scene() });
        const plan = planFinale({ shot, buildings: c.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius), aspect: size.w / size.h });
        expect(plan.lens.ball).toBeGreaterThanOrEqual(BEAT_LENS.minBall - 1e-9);
        expect(plan.lens.ball).toBeLessThanOrEqual(BEAT_LENS.ball + 1e-9);
        cin.play(plan, shot);
        const tl = cin.timeline, f0 = tl.creepFront, r0 = plan.riders[0];
        advance(cin, tl.white + 0.05);
        let worstR = 1, worstD = 1;
        while (cin.time < tl.burst + 0.1) {
          const cam = cin.camera;
          const xs = [];
          const cy = Math.cos(r0.yaw), sy = Math.sin(r0.yaw);
          for (const x of [-B.halfW, B.halfW]) for (const z of [B.back, B.front]) for (const y of [0, B.h]) {
            xs.push(project(cam, [r0.pos[0] + x * cy + z * sy, r0.pos[1] + y, r0.pos[2] - x * sy + z * cy]).x);
          }
          const a = Math.min(...xs), b = Math.max(...xs);
          worstR = Math.min(worstR, (Math.min(1, b) - Math.max(-1, a)) / (b - a));
          if (cin.time < tl.burst) {
            const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
            const ds = [-1, 1].map((k) => right.clone().multiplyScalar(k * f0).setY(0.05 * f0).project(cam).x).sort((p, q) => p - q);
            worstD = Math.min(worstD, (Math.min(1, ds[1]) - Math.max(-1, ds[0])) / (ds[1] - ds[0]));
          }
          advance(cin, 1 / 60);
        }
        log.push([seed, size.w, amount, +worstR.toFixed(3), +worstD.toFixed(3), +plan.lens.ball.toFixed(3)]);
      }
    }
  }
  if (process.env.R0B_LOG) console.log(JSON.stringify(log));
  for (const [seed, w, amount, r, d] of log) {
    expect(r, `rider seed ${seed} ${w} power ${amount}`).toBeGreaterThanOrEqual(0.8);
    expect(d, `dome seed ${seed} ${w} power ${amount}`).toBeGreaterThanOrEqual(0.9);
  }
});

// R1d（持ち主 14:13「ドーム型の光が消える時に縦 1 本の線になって消える感じ」）: 宇宙の光の半球そのものが、両側から押しつぶされるように
// 幅が 0 へ細り（高さは半球の高さより低くならず、縦へ伸び）、そのまま縦一本の線になって消える。半球の幅が始めの 30% より広いうちは、
// 別の柱（光の線）は見えない。線が見え始めるときは、半球の描かれる高さと同じくらいの長さで、同じ所に立つ（一続きの動き）。時刻表は R1b のまま
for (const size of [{ w: 390, h: 844 }, { w: 1280, h: 720 }]) {
  test(`R1d: 宇宙の半球は横から押しつぶされて縦一本の線になって消える（${size.w}×${size.h}）`, () => {
    const { cin, plan, shot } = makeCinematic(size);
    cin.play(plan, shot);
    const tl = cin.timeline;
    advance(cin, tl.flatten - 0.02 - cin.time);
    const scene = cin.renderScene;
    const dome = scene.children.find((o) => o.isMesh && o.material.uniforms?.uFlat);
    const line = scene.children.find((o) => o.isMesh && o.material.uniforms?.uThin);
    const W0 = dome.scale.x, H0 = dome.scale.y;
    expect(dome.visible).toBe(true);
    expect(line.visible).toBe(false); // ふくらみきった半球だけ
    let prevW = W0, handoff = null, gap = 0, n = 0;
    const lit = (o, k) => o.visible && o.material.uniforms[k].value > 0.02;
    while (cin.time < tl.lineEnd + 0.05) {
      cin.update(1 / 60);
      n++;
      const w = dome.scale.x;
      expect(w, `t=${cin.time.toFixed(3)}`).toBeLessThanOrEqual(prevW + 1e-9); // 幅は細るだけ
      expect(dome.scale.y).toBeGreaterThanOrEqual(H0 - 1e-9); // 高さは半球より低くならない
      if (w > 0.3 * W0) expect(lit(line, 'uI') ? line.material.uniforms.uI.value : 0, `線が早すぎる t=${cin.time.toFixed(3)} w=${(w / W0).toFixed(2)}`).toBeLessThanOrEqual(0.001);
      if (!handoff && line.visible && line.material.uniforms.uI.value > 0.001) handoff = { len: line.scale.y, domeH: dome.scale.y, thick: line.scale.x, domeW: 2 * w };
      // 線へ変わる間（押しつぶしの間と、細って消える前半）は、半球か線のどちらかが光っている（途切れない）
      if (cin.time < tl.flatten + FINALE.flattenSec + FINALE.thinSec * 0.3 && !lit(dome, 'uI') && !lit(line, 'uI')) gap++;
      prevW = w;
    }
    expect(n).toBeGreaterThan(60);
    expect(gap).toBe(0);
    expect(prevW).toBeLessThan(0.02 * W0); // 幅はほぼ 0
    // 線は押しつぶされた半球の続き: 長さ（光る部分）は半球の描かれる高さと同じくらい、太さは半球の幅より細い
    expect(handoff).not.toBeNull();
    expect(handoff.len * 0.6).toBeGreaterThan(handoff.domeH * 0.7);
    expect(handoff.len * 0.6).toBeLessThan(handoff.domeH * 1.5);
    // 線は最後に消える（時刻表は R1b のまま: lineEnd までに）
    expect(line.visible && line.material.uniforms.uI.value > 0.001).toBe(false);
  });
}
