import { test, expect } from 'vitest';
import * as THREE from 'three';
import { leadFor, minLeadFor, createChase, createCinematic, barsFor, shellRadius, FLING_LEAD } from '../../src/render/cinematic.js';
import { createTimeline } from '../../src/render/finaleTimeline.js';
import { planFinale, planRetreat } from '../../src/render/finalePlan.js';
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
  const enemyView = { setHeroYaw() {}, eyeCloseup: (id) => buildEyeCloseup(id) };
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
  // 爆発は宇宙の半球がふくらみきる時刻（domeEnd、押しつぶされる前）に終わる（ゲームは over になれる）。追う間はまだ広がっている
  expect(tl.gameClock(tl.domeEnd)).toBeGreaterThanOrEqual(CONFIG.cinematic.freezeSec + blastDuration(shot.radius) - 1e-9);
  expect(tl.gameClock(tl.chaseEnd)).toBeLessThan(CONFIG.cinematic.freezeSec + blastDuration(shot.radius));
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

test('画質の段は演出を始めるたびに読む: 始めは high でも、段が下がっていれば目の画像・雲の段数・星・ガラス片はその段の重さ', () => {
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
  expect(lo.eye[0]).toBeLessThan(hi.eye[0]);
  expect(lo.space.oct).toBeLessThan(hi.space.oct);
  expect(lo.space.stars).toBeLessThan(hi.space.stars);
  expect(lo.props.shards).toBeLessThan(hi.props.shards);
  expect(lo.props.motes).toBeLessThan(hi.props.motes);
});

test('逃げる道を後回しにした plan: 放つ瞬間には求めず、止まった一拍の間に一度だけ求め、追われて引く道に使う', () => {
  const { cin, shot } = makeCinematic();
  const lazy = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius), retreat: false });
  expect(lazy.retreat).toBeNull();
  let calls = 0;
  const resolve = () => { calls++; return planRetreat(lazy, { buildings: city.buildings, radius: shot.radius, lead: leadFor(shot.radius) }); };
  cin.play(lazy, shot, { retreat: resolve });
  const tl = cin.timeline;
  while (cin.time < tl.contact - 0.02) { cin.update(1 / 60); expect(calls).toBe(0); }
  while (cin.time < tl.beatEnd - 0.02) cin.update(1 / 60);
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
    const tl = createTimeline({ radius: shot.radius, hitDist: 30 });
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

// ---- ガラスの一拍（持ち主の絵コンテ 2026-11-21 09:40）----
function makeShoulder(shot = SHOTS[2], size = { w: 390, h: 844 }) {
  const focus = [];
  const enemyView = { setHeroYaw() {}, eyeCloseup: (id) => buildEyeCloseup(id), setFocus: (f) => focus.push(f && { id: f.id, pose: f.pose }) };
  const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const cin = createCinematic({ size }, enemyView, explosionView, { renderer, scene: new THREE.Scene() });
  const plan = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius) });
  return { cin, plan, shot, focus };
}

test('時間が戻る瞬間（resume）に snap の合図（爆発の音が開く）。それまでは鼓動だけ', () => {
  const { cin, plan, shot } = makeShoulder();
  const got = [];
  cin.on('cue', (c) => got.push([c.name + (c.arg ?? ''), cin.time, cin.stage]));
  cin.play(plan, shot);
  advance(cin, cin.timeline.snap + 0.2);
  const snap = got.find((x) => x[0] === 'snap');
  expect(snap[2]).toBe('snap');
  expect(snap[1] - cin.timeline.resume).toBeLessThan(1 / 60 + 1e-9);
  expect(got.filter((x) => x[1] < snap[1]).map((x) => x[0])).toEqual(['silence', 'heart0', 'heart1', 'heart2']);
});

test('乗り手: 画面全体になってから決めた場所に、爆心を向いて描かれ、光の壁が届くまでほとんど動かず、届くとバイクごとカメラの方へ吹き飛び、追うカットで消え、やめると戻る', () => {
  const { cin, plan, shot, focus } = makeShoulder();
  cin.play(plan, shot);
  const tl = cin.timeline;
  expect(focus).toEqual([]); // 両手の間（2画面）はまだ
  advance(cin, tl.white + 0.05);
  expect(focus).toHaveLength(1);
  expect(focus[0].id).toBe(plan.riderId);
  const pose = focus[0].pose;
  const base = plan.rider.pos;
  advance(cin, tl.engulf - FLING_LEAD - 0.02 - cin.time);
  expect(pose.keep).toBe(1);
  expect(Math.hypot(pose.x - base[0], pose.y - base[1], pose.z - base[2])).toBeLessThan(0.1);
  expect(pose.yaw).toBeCloseTo(plan.rider.yaw, 1);
  expect(Math.abs(pose.head)).toBeGreaterThan(0.1); // ガラス片の方へ頭を向けている
  // 吹き飛ぶ間、乗り手は光の壁のすぐ前にいる（飲まれて透けずに、壁を背にした影のまま飛ぶ）。カメラが飲まれるまで
  while (cin.time < Math.min(tl.camHit, tl.snap) - 1e-9) {
    advance(cin, 1 / 60);
    expect(Math.hypot(pose.x, pose.y + 1, pose.z), `t=${cin.time.toFixed(3)}`).toBeGreaterThan(tl.front(cin.time));
  }
  advance(cin, tl.engulf + 0.2 - cin.time);
  const out = plan.rider.out;
  const moved = (pose.x - base[0]) * out[0] + (pose.z - base[2]) * out[2];
  expect(moved).toBeGreaterThan(2); // カメラの方（外）へ
  expect(pose.y).toBeGreaterThan(base[1] + 0.5);
  expect(Math.abs(pose.pitch)).toBeGreaterThan(0.8); // 回りながら
  advance(cin, tl.snap + 0.05 - cin.time);
  expect(pose.keep).toBe(0);
  cin.stop();
  expect(focus.at(-1)).toBeNull();
});

test('目が合う一瞬: 映り込みは tl.eye の間だけ（0.4〜0.7 秒）。その真ん中ではガラス片は乗り手の顔の前（カメラから見て頭より遠く、頭に隠れない）で、鏡の面はカメラと乗り手の目の間を向き（像のずれ ≈ 0）、目はまっすぐ前を見て、寄ったカメラの画面の中で幅の 6 割以上。ヘルメットは画面の縁', () => {
  for (const size of [{ w: 390, h: 844 }, { w: 1280, h: 720 }]) {
    const { cin, plan, shot } = makeShoulder(SHOTS[1], size);
    cin.play(plan, shot);
    const tl = cin.timeline;
    let seen = 0;
    const dt = 1 / 60;
    while (cin.time < tl.beatEnd) {
      advance(cin, dt);
      const g = cin.beat.glass;
      if (g && g.reflect > 0.5) seen += dt;
      if (g && g.reflect > 0) { expect(cin.time).toBeGreaterThanOrEqual(tl.eye[0] - 1e-9); expect(cin.time).toBeLessThanOrEqual(tl.eye[1] + 1e-9); }
    }
    expect(seen).toBeGreaterThanOrEqual(0.4);
    expect(seen).toBeLessThanOrEqual(0.7);
    // 真ん中
    const c2 = makeShoulder(SHOTS[1], size);
    c2.cin.play(c2.plan, shot);
    const mid = (tl.eye[0] + tl.eye[1]) / 2;
    advance(c2.cin, mid);
    const g = c2.cin.beat.glass;
    expect(g.reflect).toBe(1);
    const camPos = c2.cin.camera.position;
    const head = new THREE.Vector3(...c2.plan.rider.head), eyeP = c2.cin.beat.eyePos;
    // 鏡の面は後ろ（カメラと乗り手の目の間）を向く: カメラの視線がそこで返ると乗り手の目に届く（像のずれ ≈ 0）
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quat);
    const toC = camPos.clone().sub(g.pos).normalize(), toE = eyeP.clone().sub(g.pos).normalize();
    expect(n.dot(toC)).toBeGreaterThan(0.95);
    expect(Math.abs(n.dot(toC) - n.dot(toE))).toBeLessThan(0.01);
    expect(Math.hypot(...g.slide)).toBeLessThan(0.08);
    // ガラス片は乗り手の顔の前（光の壁の側）: カメラから見て乗り手の頭より遠く、頭と目より前にある
    expect(g.pos.distanceTo(camPos)).toBeGreaterThan(head.distanceTo(camPos) + 0.8);
    expect(g.pos.distanceTo(camPos)).toBeLessThan(3.5);
    const fwd = new THREE.Vector3(...c2.plan.rider.fwd);
    expect(g.pos.clone().sub(eyeP).dot(fwd)).toBeGreaterThan(0.8);
    // 頭とヘルメットに隠れない: カメラからガラス片の真ん中と左右の縁への線は、頭（半径 0.16 m）を通らない
    for (const k of [-0.5, 0, 0.5]) for (const v of [-0.25, 0, 0.25]) {
      const q = g.pos.clone().add(new THREE.Vector3(k * g.width, v * g.width, 0).applyQuaternion(g.quat));
      const ray = new THREE.Ray(camPos.clone(), q.clone().sub(camPos).normalize());
      expect(ray.distanceToPoint(head), `${k},${v}`).toBeGreaterThan(0.16);
    }
    expect(c2.cin.beat.eye.uLook.value).toBeCloseTo(-0.55, 2); // 黒目がまっすぐ（こちらを見る）
    expect(c2.cin.beat.eye.uOpen.value).toBeGreaterThan(0.4);
    // 画面の中、縦長では幅の 6 割以上
    const cam = c2.cin.camera;
    const ndc = g.pos.clone().project(cam);
    expect(Math.abs(ndc.x)).toBeLessThan(0.7);
    expect(Math.abs(ndc.y)).toBeLessThan(0.7);
    const edge = g.pos.clone().add(new THREE.Vector3(g.width / 2, 0, 0).applyQuaternion(g.quat)).project(cam);
    const e2 = g.pos.clone().add(new THREE.Vector3(-g.width / 2, 0, 0).applyQuaternion(g.quat)).project(cam);
    if (size.w < size.h) expect(Math.abs(edge.x - e2.x) / 2).toBeGreaterThan(0.6);
    // 乗り手のヘルメットは画面の縁に入る（肩越し）
    const hp = head.clone().project(cam);

    expect(Math.abs(hp.x)).toBeLessThan(1.05);
    expect(Math.abs(hp.y)).toBeLessThan(0.9);
  }
});

test('肩越しのカットの間だけ、光の壁が触れたビルをその瞬間に一時的に隠し（半分だけ球の面へ押されたビルの壁が引き伸ばされてレンズの前を横切らない）、追うカットへ切り替わると戻す（そこから先はつぶれていく）。触れる前は隠さない', () => {
  const veiled = new Map(), restored = new Map();
  const shot = SHOTS[0];
  const enemyView = { setHeroYaw() {}, eyeCloseup: (id) => buildEyeCloseup(id), setFocus() {} };
  const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const cin = createCinematic({ size: { w: 390, h: 844 } }, enemyView, explosionView, { renderer, scene: new THREE.Scene(),
    veilBuilding: (id, on) => (on ? veiled.set(id, cin.time) : restored.set(id, cin.time)) });
  const plan = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius) });
  cin.play(plan, shot, { buildings: city.buildings });
  const tl = cin.timeline;
  const near = (b) => Math.hypot(Math.max(0, Math.abs(b.x) - b.w / 2), Math.max(0, Math.abs(b.z) - b.d / 2));
  while (cin.time < tl.snap + 0.5) {
    cin.update(1 / 60);
    for (const b of city.buildings) {
      if (veiled.has(b.id)) continue;
      if (cin.time >= tl.white && cin.time < tl.snap) expect(near(b), `building ${b.id} t=${cin.time.toFixed(3)}`).toBeGreaterThan(tl.front(cin.time) - 1e-6);
    }
    if (cin.time < tl.snap) expect(restored.size).toBe(0);
  }
  expect(veiled.size).toBeGreaterThan(0);
  for (const [id, at] of veiled) {
    const b = city.buildings.find((x) => x.id === id);
    expect(at).toBeGreaterThanOrEqual(tl.white);
    expect(at).toBeLessThan(tl.snap + 1e-9);
    expect(near(b)).toBeLessThanOrEqual(tl.front(at) + 1e-6);
    // 追うカットへ切り替わった最初のフレームで戻す
    expect(restored.get(id)).toBeGreaterThanOrEqual(tl.snap);
    expect(restored.get(id)).toBeLessThan(tl.snap + 1 / 60 + 1e-9);
  }
  // やめたときも戻す（一度だけ）
  const n = restored.size;
  cin.stop();
  expect(restored.size).toBe(n);
});

test('光の壁の面は不透明で深さを書く（後ろの明るい爆発の球や街の影が透けたり上に描かれたりして、壁の中に段々の板が見えない）', () => {
  const { cin, plan, shot } = makeShoulder();
  cin.play(plan, shot);
  advance(cin, 2);
  let wall = null;
  cin.propsGroup.traverse((o) => { if (o.name === 'cine-wall') wall = o; });
  expect(wall.visible).toBe(true);
  expect(wall.material.transparent).toBe(false);
  expect(wall.material.depthTest).toBe(true);
  expect(wall.material.depthWrite).toBe(true);
  expect(wall.renderOrder).toBeGreaterThan(0); // 不透明の街・乗り手・瓦礫のあと
  expect(wall.material.fragmentShader).toMatch(/gl_FragColor = vec4\([^;]*, 1\.0\);/);
});
