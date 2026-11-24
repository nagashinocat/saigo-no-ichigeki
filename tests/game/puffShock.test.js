import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// 持ち主 2026-11-24「無敵は短く、払うを強く」: 守り（触れた者が倒れる間）は約 4 秒のまま、払うそのものを強くする。
//  - 巻き込む範囲（倒す前線）を広く: puff.radius 22 → 40 m
//  - 衝撃波（puff.shock）: 払った瞬間、shock.radius m の内の、追う・近づく・掴む・群がる・よろめく者を外へ約 knock m（sec 秒）弾き飛ばし、
//    目をくらませる（弾かれ終わると主人公を見失い、知らされた所も忘れて探し直す）。知らされて向かってくる探す者も忘れる
//  - 閃光の残り（hazeSec 秒、払った所から hazeR m の内）: その内の探す者は主人公を見つけられない。ただ見回るだけの者は弾かない
const E = CONFIG.enemy, P = CONFIG.puff, S = P.shock;
const DT = 1 / 30;
const quiet = { ...CONFIG, enemy: { ...E, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...E.patrol, count: 0 }, kinds: {} } };
const rider = (id, d, a, state, extra = {}) => ({ id, state, x: Math.cos(a) * d, z: Math.sin(a) * d, heading: a + Math.PI, speed: E.speed, turn: 0, searchTime: 0, lane: [0, 0], seenT: 0, sees: true, dist: d, angle: a, ...extra });
function start(cfg = quiet) {
  const g = createGame({ seed: 3, cfg });
  g.begin(); g.pressStart();
  g.power.add(50);
  return g;
}
const far = (g, e) => Math.hypot(e.x - g.hero.x, e.z - g.hero.z);

test('2026-11-24: 守りは約 4 秒のまま、払うは強く（前線 40 m、衝撃波は前線の 2 倍より広く、25〜40 m 弾く、目をくらませる、閃光の残りがある）', () => {
  expect(P.guardSec).toBeGreaterThanOrEqual(3.5);
  expect(P.guardSec).toBeLessThanOrEqual(5);
  expect(P.radius).toBeGreaterThan(22);
  expect(S.radius).toBeGreaterThanOrEqual(2 * P.radius);
  expect(S.knock).toBeGreaterThanOrEqual(25);
  expect(S.knock).toBeLessThanOrEqual(40);
  expect(S.sec).toBeGreaterThan(E.stagger.sec);
  expect(S.blind).toBe(true);
  expect(S.hazeSec).toBeGreaterThan(0);
  expect(P.cost).toBeGreaterThanOrEqual(2.2);
});

test('2026-11-24 / Fix round 2: 前線が広がりきったとき、前線の外・衝撃波の内の追う者は約 knock m 外へ弾かれ、弾かれ終わると主人公を見失って探し直す（知らせも忘れる）', () => {
  const g = start();
  const e = rider(901, S.radius - 2, 0.3, 'chase');
  g.enemies.list.push(e);
  let at = null;
  g.on('shock', () => { at = far(g, e); });
  expect(g.puff()).toBe(true);
  expect(e.state).toBe('chase'); // 払った瞬間にはまだ弾かない（前線が先）
  for (let i = 0; i < 60 && at == null; i++) g.update(DT);
  expect(at).not.toBeNull();
  expect(at).toBeGreaterThan(P.radius); // 前線の外（倒れていない）
  expect(e.state).toBe('stagger');
  let t = 0;
  for (; t < S.sec - 0.05; t += DT) g.update(DT);
  expect(e.state).toBe('stagger');
  expect(far(g, e)).toBeGreaterThan(at + S.knock * 0.5); // 街の中なので壁に沿って滑る分を見込む
  for (; t < S.sec + 0.2; t += DT) g.update(DT);
  expect(e.state).toBe('search');
  expect(e.alert).toBe(false);
  expect(e.heard).toBeUndefined();
});

test('2026-11-24: 掴んでいる重い者（払う 1 回では倒れない）も、掴みを外されて弾き飛ばされる', () => {
  const g = start({ ...quiet, enemy: { ...quiet.enemy, kinds: E.kinds } });
  const e = rider(902, 2.5, 1, 'grab', { kind: 'heavy', hp: 2, grabTime: 0 });
  g.enemies.list.push(e);
  g.update(DT);
  expect(g.grabbing).toBeGreaterThan(0);
  expect(g.puff()).toBe(true);
  for (let t = 0; t < S.sec * 0.9; t += DT) g.update(DT);
  expect(e.state).toBe('stagger');
  expect(g.grabbing).toBe(0);
  // 広場のまわりの建物に当たれば壁に沿って滑る（押し戻しの道のりの一部は横へ）。それでも knock の半分より外
  expect(far(g, e)).toBeGreaterThan(S.knock * 0.5);
});

test('2026-11-24: 閃光の残り: 払った所から hazeR m の内にいる探す者は、ライトが主人公に当たっていても hazeSec 秒は見つけない。過ぎれば見つける', () => {
  const g = start();
  expect(g.puff()).toBe(true);
  for (let t = 0; t < 1; t += DT) g.update(DT);
  // 主人公の 15 m 先から主人公を向いて止まる探す者（ライトの扇の内・見通しあり）
  const H = g.hero;
  const e = { ...rider(903, 15, 0, 'search', { sees: false, seenT: null }), x: H.x + 15, z: H.z, speed: 0, ni: 0, nj: 0, di: -1, dj: 0 };
  g.enemies.list.push(e);
  let spottedAt = null, t = 1;
  for (; t < S.hazeSec + 3 && spottedAt == null; t += DT) {
    e.x = g.hero.x + 15; e.z = g.hero.z; e.heading = Math.PI; e.speed = 0; // その場で主人公を照らし続ける
    g.update(DT);
    if (e.state === 'chase') spottedAt = t;
  }
  expect(spottedAt).not.toBeNull();
  expect(spottedAt).toBeGreaterThanOrEqual(S.hazeSec - 0.2);
});

test('2026-11-24: ただ見回るだけの者（見つけていない・知らされていない）は弾かない', () => {
  const g = start();
  const e = rider(904, P.radius + 10, 2, 'search', { patrol: true, alert: false, sees: false });
  g.enemies.list.push(e);
  g.puff();
  expect(e.state).toBe('search');
  expect(e.stg).toBeUndefined();
});

test('2026-11-24: 払った知らせ（puff）に衝撃波の大きさと弾く見込みの数（衝撃波の内の追う・近づく者）が載る（見た目・音を強くする）', () => {
  const g = start();
  const shots = [];
  g.on('puff', (s) => shots.push(s));
  g.enemies.list.push(rider(905, P.radius + 5, 0, 'chase'), rider(906, S.radius - 5, 2, 'approach'), rider(907, S.radius + 20, 4, 'chase'));
  g.puff();
  expect(shots[0].shock).toEqual({ radius: S.radius, hits: 2 });
});

// Fix round 2（再見直し Important 1）: 衝撃波が前線より先に弾くと、40 m の前線が届かず倒せなかった（25 m の者が生き残り、重い者の hp も減らない）。
// 前線が先に当たり（倒す・重い者は hp −1 でよろめく）、衝撃波は前線が広がりきったとき、倒れなかった者（よろめく重い者も）だけを弾く。出荷の設定（衝撃波あり）
const shipped = { ...CONFIG, enemy: { ...E, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...E.patrol, count: 0 } } };
const settle = (g) => { for (let i = 0; i < 90 && g.blasts.length; i++) g.update(DT); g.update(DT); };
test('Fix round 2: 出荷の設定で、払うの前線の内（25 m・38 m）の追う者・近づく者は倒れる（衝撃波に先に弾かれない）', () => {
  for (const d of [25, 38]) for (const state of ['chase', 'approach']) {
    const g = start(shipped);
    const e = rider(910, d, 0.7, state);
    g.enemies.list.push(e);
    expect(g.puff()).toBe(true);
    settle(g);
    expect(e.state, `${state} ${d} m`).toBe('dead');
  }
});

test('Fix round 2: 出荷の設定で、重い者は払う 1 回で hp が 1 減ってよろめき（衝撃波でも弾かれ）、2 回目で倒れる', () => {
  const g = start(shipped);
  const h = rider(911, 12, 0.2, 'chase', { kind: 'heavy', hp: 2 });
  g.enemies.list.push(h);
  expect(g.puff()).toBe(true);
  settle(g);
  expect(h.hp).toBe(1);
  expect(h.state).toBe('stagger');
  expect(h.stg).toBeTruthy(); // 衝撃波で弾かれている
  for (let t = 0; t < S.sec * 0.8; t += DT) g.update(DT);
  expect(far(g, h)).toBeGreaterThan(P.radius); // 前線の外まで弾かれた
  // 戻ってきたところをもう一度払う
  for (let t = 0; t < 3; t += DT) g.update(DT);
  Object.assign(h, { state: 'chase', x: g.hero.x + 15, z: g.hero.z, dist: 15, heading: Math.PI, speed: E.speed });
  g.power.add(20);
  expect(g.puff()).toBe(true);
  settle(g);
  expect(h.state).toBe('dead');
});

// Fix round 2（Minor）: 閃光の残りは「払った所」から hazeR m の円（主人公が動いてもついて来ない）。境目の内と外。2 回目の払うは、前の残りを捨てて
// 新しく払った所から hazeSec 秒をやり直す（残りの長い方を保たない）
import { createEnemies } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
const R = S.hazeR;
// 建物のない街で、主人公 H を照らす向きに止まって探す者（道あり）
const looker = (id, x, z, H) => ({ id, state: 'search', x, z, heading: Math.atan2(H.z - z, H.x - x), speed: 0, turn: 0, searchTime: 0, lane: [0, 0], ni: 0, nj: 0, di: -1, dj: 0, dist: Math.hypot(H.x - x, H.z - z), angle: 0 });
function spotsWithin(en, e, H, sec = 1) {
  for (let t = 0; t < sec; t += DT) { e.speed = 0; e.heading = Math.atan2(H.z - e.z, H.x - e.x); en.update(DT); if (e.state === 'chase') return true; }
  return false;
}
test('Fix round 2: 閃光の残りは払った所が中心。主人公が動いても動かず、hazeR m の内の者は見つけず、外の者は見つける', () => {
  const H = { x: 0, z: 0 };
  const en = createEnemies(createRng(1), quiet, { heroPos: H });
  en.haze({ x: 0, z: 0 }, S);
  H.x = R + 15; // 主人公は払った所から離れた
  expect(en.hazeInfo(S.hazeSec)).toMatchObject({ x: 0, z: 0, r: R });
  const inside = looker(1, R - 1, 0, H);   // 払った所から R − 1 m（主人公まで 16 m）
  en.list.push(inside);
  expect(spotsWithin(en, inside, H)).toBe(false);
  const outside = looker(2, R + 1, 6, H);  // 払った所から R + 1 m より外（主人公まで約 15 m）
  expect(Math.hypot(outside.x, outside.z)).toBeGreaterThan(R);
  en.list.push(outside);
  expect(spotsWithin(en, outside, H)).toBe(true);
});

test('Fix round 2: 2 回目の払うは閃光の残りをやり直す（新しく払った所から hazeSec 秒）。前の所は守られなくなる', () => {
  const H = { x: 0, z: 0 };
  const en = createEnemies(createRng(1), quiet, { heroPos: H });
  en.haze({ x: 0, z: 0 }, S);
  for (let t = 0; t < 2; t += DT) en.update(DT);
  en.haze({ x: 200, z: 0 }, S);
  const h = en.hazeInfo(S.hazeSec);
  expect(h).toMatchObject({ x: 200, z: 0 });
  expect(h.left).toBeCloseTo(S.hazeSec, 6);
  // 前の所（原点）のそばの者は、もう閃光の内ではない
  const e = looker(3, 10, 0, H);
  en.list.push(e);
  expect(spotsWithin(en, e, H)).toBe(true);
  // 残りが尽きれば null
  for (let t = 0; t < S.hazeSec + 0.1; t += DT) en.update(DT);
  expect(en.hazeInfo(S.hazeSec)).toBeNull();
});
