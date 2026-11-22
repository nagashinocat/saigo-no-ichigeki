import { test, expect } from 'vitest';
import { createEnemies, roadNode, seesHero } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';
import { GRID } from '../../src/world/cityGen.js';

// M2（持ち主 09:11「敵の前方ライトを少し広くして敵に見つかったらどんどん集まってくる感じ」、spec §16）:
//  - 見つけるのは前を照らすライトの中だけ（前の 28 m の丸より遠くまで届く、前向きの扇。建物にさえぎられない所）。ごく近く（spotNear）は向きによらず
//  - 見つけた者は光り、まわり（alert.radius m の内）の探す者・見回る者へ知らせ、知らされた者も relayDelay 秒で次へ伝える（hops 段まで）
//  - 知らされただけの者は、知らされた位置（最後に見えた所）へ向かい、そこを探し回る。自分で見つけたら今の主人公を追う
//  - 一度 chase に入った者は知らせでは変わらない（持ち主 13:36「見つけた軍勢は見失わない」。今の主人公を追い続ける）
const E = CONFIG.enemy;
const A = E.alert;
const P = GRID.PITCH;
const cfgWith = (enemy) => ({ ...CONFIG, enemy: { ...E, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...E.patrol, count: 0 }, ...enemy } });
const still = { searchSpeed: 0, accel: 0 };
let nid = 1;
// 次の交差点（進む向きの先）。enemies.js の spawn と同じ決め方
const ahead = (v, s) => { const u = v / P - 0.5; return s > 0 ? Math.floor(u) + 1 : s < 0 ? Math.ceil(u) - 1 : Math.round(u); };
const rider = (x, z, heading, more = {}) => {
  const di = Math.round(Math.cos(heading)), dj = Math.round(Math.sin(heading));
  const e = { id: nid++, state: 'search', speed: 0, turn: 0, searchTime: 0, lane: [0, 0], x, z, heading, ni: ahead(x, di), nj: ahead(z, dj), di, dj, ...more };
  e.dist = Math.hypot(x, z); e.angle = Math.atan2(z, x);
  return e;
};
function field(riders, enemy = still, opts = {}) {
  const e = createEnemies(createRng(3), cfgWith(enemy), { patrolRng: createRng(9), ...opts });
  for (const r of riders) e.list.push(r);
  return e;
}
const run = (e, sec, dt = 1 / 30) => { for (let t = 0; t < sec - 1e-9; t += dt) e.update(dt); };

test('M2: ライトは前の 28 m の丸より遠くまで届き、前向きの広い扇（半分の角 35〜60°）。ごく近くは向きによらない', () => {
  expect(E.spotDist).toBeGreaterThan(28);
  expect(E.spotHalfAngle).toBeGreaterThanOrEqual((35 * Math.PI) / 180);
  expect(E.spotHalfAngle).toBeLessThanOrEqual((60 * Math.PI) / 180);
  expect(E.spotNear).toBeLessThan(E.spotDist / 3);
  const H = { x: 0, z: 0 };
  // 前・扇の内・届く距離
  expect(seesHero(rider(0, E.spotDist - 2, -Math.PI / 2), H, [], CONFIG)).toBe(true);
  // 後ろ向き（主人公を背にしている）
  expect(seesHero(rider(0, E.spotDist - 2, Math.PI / 2), H, [], CONFIG)).toBe(false);
  // 扇の外（横向き）
  const a = E.spotHalfAngle + 0.15;
  expect(seesHero(rider(Math.sin(a) * 20, Math.cos(a) * 20, -Math.PI / 2), H, [], CONFIG)).toBe(false);
  // 遠すぎる
  expect(seesHero(rider(0, E.spotDist + 2, -Math.PI / 2), H, [], CONFIG)).toBe(false);
  // ごく近くは後ろ向きでも
  expect(seesHero(rider(0, E.spotNear - 0.5, Math.PI / 2), H, [], CONFIG)).toBe(true);
  // 建物にさえぎられる
  const wall = { x: 0, z: 15, w: 6, d: 3 };
  expect(seesHero(rider(0, E.spotDist - 2, -Math.PI / 2), H, [wall], CONFIG)).toBe(false);
  // 主人公が動いた先（heroPos）から測る
  expect(seesHero(rider(200, 30, -Math.PI / 2), { x: 200, z: 0 }, [], CONFIG)).toBe(true);
});

test('M2: 前の丸（28 m）より遠い所でも、ライトの中なら見つけて突っ込む。背を向けて通り過ぎる者は見つけない', () => {
  const ahead = rider(roadNode(0, 0)[0], 36, -Math.PI / 2);
  const away = rider(-roadNode(0, 0)[0], 14, Math.PI / 2);
  const e = field([ahead, away]);
  run(e, 0.5);
  expect(ahead.state).toBe('chase');
  expect(away.state).toBe('search');
});

test('M2: 見つけた者は光り（callT）、alert.radius の内の探す者・見回る者へ知らせる。知らされた者は最後に見えた所（heard）を覚え、relayDelay 秒で次へ伝える', () => {
  expect(A.radius).toBeGreaterThanOrEqual(100);
  expect(A.radius).toBeLessThanOrEqual(140);
  const spotter = rider(roadNode(0, 0)[0], 30, -Math.PI / 2);
  const near = rider(100, 40, Math.PI / 2); // 見つけた者から 100 m 足らず（主人公は見えない）
  const relay = rider(100 + A.radius - 10, 40, Math.PI / 2); // 見つけた者からは遠く、near からは radius の内
  const far = rider(1000, 40, Math.PI / 2); // どこからも遠い
  const pat = rider(roadNode(1, 3)[0] + 5, roadNode(1, 3)[1], 0, { patrol: true, id: 100500 }); // 見回る者も
  const e = field([spotter, near, relay, far, pat]);
  let t = 0;
  while (spotter.state === 'search' && t < 1) { e.update(1 / 30); t += 1 / 30; }
  expect(spotter.state).toBe('chase');
  expect(spotter.callT).toBeLessThan(0.1);
  expect(near.heard).toBeTruthy();
  expect(Math.hypot(near.heard.x, near.heard.z)).toBeLessThan(1e-6); // 主人公のいた所
  expect(near.alert).toBe(true);
  expect(pat.hunting).toBe(true);
  expect(pat.heard).toBeTruthy();
  expect(relay.heard).toBeFalsy(); // まだ伝わっていない
  run(e, A.relayDelay + 0.1);
  expect(relay.heard).toBeTruthy();
  expect(near.callT).toBeGreaterThanOrEqual(0); // 伝えた者も光る
  expect(far.heard).toBeFalsy();
});

test('M2: 伝わるのは alert.hops 段まで（街じゅうが一度に来ない）', () => {
  const spotter = rider(roadNode(0, 0)[0], 30, -Math.PI / 2);
  const chain = [];
  for (let k = 1; k <= A.hops + 2; k++) chain.push(rider(13 + k * (A.radius - 15), 40, Math.PI / 2));
  const e = field([spotter, ...chain], { ...still, alert: { ...A, callEvery: 99 } });
  run(e, (A.hops + 3) * (A.relayDelay + 0.1));
  const got = chain.map((c) => !!c.heard);
  expect(got.slice(0, A.hops)).toEqual(Array(A.hops).fill(true));
  expect(got.slice(A.hops)).toEqual(Array(chain.length - A.hops).fill(false));
});

test('M2: 見えている間は、追う者が callEvery 秒ごとに知らせ直す（最後に見えた所が今の主人公へ更新され、群れが集まり続ける）', () => {
  const H = { x: 0, z: 0 };
  const spotter = rider(roadNode(0, 0)[0], 30, -Math.PI / 2);
  const near = rider(90, 40, Math.PI / 2);
  const e = field([spotter, near], { ...still, speed: 0, chaseAccel: 0 }, { heroPos: H });
  run(e, 0.5);
  expect(near.heard).toBeTruthy();
  H.x = 6; // 追う者からまだ見える所へ少し動く
  run(e, A.callEvery + 0.2);
  expect(near.heard.x).toBeCloseTo(6, 5);
});

test('M2: 知らされただけの者は、最後に見えた所へ向かい、そこを探し回る（主人公が見えないうちは、今の主人公へは向かわない）', () => {
  const H = { x: 0, z: 0 };
  const spotter = rider(roadNode(0, 0)[0], 30, -Math.PI / 2);
  const [nx, nz] = roadNode(3, 2);
  const L = rider(nx, nz + 1, Math.PI / 2);
  const e = field([spotter, L], { speed: 0, chaseAccel: 0 }, { heroPos: H });
  e.update(1 / 30);
  for (let i = 0; i < 15 && !L.heard; i++) e.update(1 / 30);
  expect(L.heard).toBeTruthy();
  // 主人公は遠くへ（誰からも見えない）。追う者は消す
  spotter.state = 'dead'; spotter.deadTime = 0;
  H.x = -400; H.z = 0;
  let minToHeard = Infinity;
  for (let t = 0; t < 8; t += 1 / 30) {
    e.update(1 / 30);
    minToHeard = Math.min(minToHeard, Math.hypot(L.x - L.heard.x, L.z - L.heard.z));
    expect(L.state).toBe('search');
  }
  expect(minToHeard).toBeLessThan(P); // 最後に見えた所まで来た
  expect(Math.hypot(L.x - L.heard.x, L.z - L.heard.z)).toBeLessThan(A.sweepDist + P); // その近くを探し回る
});

test('M2: chase の者に知らせが来ても変わらない（heard を持たず、今の主人公を追う）', () => {
  const spotter = rider(roadNode(0, 0)[0], 30, -Math.PI / 2);
  const chaser = rider(-30, 0, 0, { state: 'chase', speed: 20 });
  const e = field([spotter, chaser]);
  run(e, 0.4);
  expect(chaser.heard).toBeFalsy();
  expect(['chase', 'grab', 'cling']).toContain(chaser.state);
});

test('M2（M1 の見直しの持ち越し）: 主人公が街の端のそばにいても、湧くのは街の中（外の畑の道には湧かない）', () => {
  const H = { x: CONFIG.cityRadius - CONFIG.hero.edgePad, z: 0 };
  const e = createEnemies(createRng(5), { ...CONFIG, enemy: { ...E, spawnPerSec: 20, surgeMul: 1 } }, { heroPos: H });
  let worst = 0;
  for (let t = 0; t < 4; t += 1 / 30) {
    e.update(1 / 30);
    for (const x of e.list) worst = Math.max(worst, Math.hypot(x.x, x.z));
  }
  expect(e.list.length).toBeGreaterThan(40);
  expect(worst).toBeLessThanOrEqual(CONFIG.cityRadius);
});
