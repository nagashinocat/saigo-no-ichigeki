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

test('2026-11-24: 払うと、前線の外・衝撃波の内の追う者は約 knock m 外へ弾かれ、弾かれ終わると主人公を見失って探し直す（知らせも忘れる）', () => {
  const g = start();
  const d0 = P.radius + 10;
  const e = rider(901, d0, 0.3, 'chase');
  g.enemies.list.push(e);
  expect(g.puff()).toBe(true);
  expect(e.state).toBe('stagger');
  let t = 0;
  for (; t < S.sec - 0.05; t += DT) g.update(DT);
  expect(e.state).toBe('stagger');
  // 前線に追いつかれない（弾かれて外へ）。押し戻しは主人公から外へ、壁に当たれば沿う
  expect(far(g, e)).toBeGreaterThan(d0 + S.knock * 0.6);
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

test('2026-11-24: 払った知らせ（puff）に衝撃波の大きさと弾いた数が載る（見た目・音を強くする）', () => {
  const g = start();
  const shots = [];
  g.on('puff', (s) => shots.push(s));
  g.enemies.list.push(rider(905, P.radius + 5, 0, 'chase'), rider(906, S.radius - 5, 2, 'approach'), rider(907, S.radius + 20, 4, 'chase'));
  g.puff();
  expect(shots[0].shock).toEqual({ radius: S.radius, hits: 2 });
});
