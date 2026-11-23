import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { lineOfSight, seesHero } from '../../src/game/enemies.js';
import { findCover } from '../../src/game/cover.js';
import { CONFIG } from '../../src/config.js';

// M2（持ち主 15:20「払うをしたら一旦、見つからない物陰に隠れるモーション」「物陰にシュッと入る」、spec §16）:
//  - （R1e から 2 本目の指のシュッ。M2 ではスティックを同じ向きに 2 回倒す）と、その向きのいちばん近い物陰（ビルの陰・路地。追っている軍勢から見えない所）へシュッと滑り込む
//  - 物陰にいる間は見つからない。追っていた者は見失い、最後に見た所を探す（13:36 の「見失わない」の、ただ一つの例外）
//  - 掴まれている間は隠れられない。隠れたあと約 3 秒は次の隠れるができない。物陰から出て見られれば、また見つかる
const HC = CONFIG.hide;
const DT = 1 / 30;
const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 }, kinds: {} } };
const step = (g, sec) => { for (let t = 0; t < sec - 1e-9; t += DT) g.update(DT); };
function start(seed = 1) {
  const g = createGame({ seed, cfg: quiet });
  g.begin(); g.pressStart();
  return g;
}
const chaser = (id, x, z) => ({ id, state: 'chase', x, z, heading: Math.atan2(-z, -x), speed: 30, turn: 0, lane: [0, 0], dist: Math.hypot(x, z), angle: Math.atan2(z, x) });

// Pass 2（まとめ役）: 追われていて撒いた隠れるの次まで 3 → 6 秒（Fix round 3）、追われていない間の先回りの隠れるは evadeCooldown（tests/game/hideEvade.test.js）
test('M2 / Pass 2: 隠れるの値は config にある（シュッと 0.25〜0.4 秒、撒いた隠れるの次まで約 6 秒）', () => {
  expect(HC.dashSec).toBeGreaterThanOrEqual(0.25);
  expect(HC.dashSec).toBeLessThanOrEqual(0.4);
  expect(HC.cooldown).toBeCloseTo(6, 0);
  expect(HC.range).toBeGreaterThan(10);
});

test('M2: findCover は向きの先の、ビルの足元のそばで、見張る者から見えず、通り道がビルにさえぎられない所を返す', () => {
  const g = start();
  const b = g.city.buildings;
  const H = g.hero;
  const w = [{ x: -30, z: 0 }];
  for (const d of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, 0.7]]) {
    const p = findCover(H, { x: d[0], z: d[1] }, b, w, CONFIG);
    if (!p) continue;
    expect(Math.hypot(p.x - H.x, p.z - H.z)).toBeLessThanOrEqual(HC.range + 1e-6);
    expect((p.x - H.x) * d[0] + (p.z - H.z) * d[1]).toBeGreaterThan(0); // 向きの先
    expect(lineOfSight(H.x, H.z, b, CONFIG.hero.radius * 0.8, p.x, p.z)).toBe(true); // 通れる
    expect(lineOfSight(w[0].x, w[0].z, b, 0, p.x, p.z)).toBe(false); // 見えない
  }
  expect([[1, 0], [0, 1], [0, -1]].some((d) => findCover(H, { x: d[0], z: d[1] }, b, w, CONFIG))).toBe(true);
});

test('M2: 隠れると、シュッと物陰へ滑り込み、追っていた者は見失って最後に見た所（隠れる前の主人公の位置）を探す。物陰にいる間は見つからない', () => {
  const g = start();
  step(g, 1);
  const c = chaser(901, -34, 0);
  g.enemies.list.push(c);
  g.update(DT);
  expect(c.state).toBe('chase');
  const from = { x: g.hero.x, z: g.hero.z };
  let ok = false, dir = null;
  for (const d of [[1, 0], [0, 1], [0, -1], [0.7, 0.7], [0.7, -0.7]]) if ((ok = g.hide(d[0], d[1]))) { dir = d; break; }
  expect(ok).toBe(true);
  expect(g.hero.dashing).not.toBeNull(); // 滑り込みの進み具合 0〜1
  expect(c.state).toBe('search');
  expect(Math.hypot(c.heard.x - from.x, c.heard.z - from.z)).toBeLessThan(1e-6);
  step(g, HC.dashSec + 0.05);
  expect(g.hero.dashing).toBeNull();
  expect(g.hero.hidden).toBe(true);
  const moved = Math.hypot(g.hero.x - from.x, g.hero.z - from.z);
  expect(moved).toBeGreaterThan(2);
  expect(moved).toBeLessThanOrEqual(HC.range + 1e-6);
  // 物陰にいる間（動かない）は誰にも見つからず、追っていた者は今の主人公ではなく最後に見た所へ向かう
  // Pass 2: 物陰にいられるのは隠れてから holdSec 秒（6.5 秒）まで。2 秒かその少し前まで見る
  for (let t = 0; t < Math.min(2, HC.holdSec - HC.dashSec - 0.25); t += DT) {
    g.update(DT);
    expect(c.state).toBe('search');
    expect(seesHero({ ...c, heading: Math.atan2(g.hero.z - c.z, g.hero.x - c.x) }, g.hero, [], CONFIG)).toBe(false);
  }
  expect(Math.hypot(c.x - from.x, c.z - from.z)).toBeLessThan(34);
  expect(c.heard).toBeTruthy();
});

test('M2: 掴まれている間は隠れられない（hideBlock: grabbed）', () => {
  const g = start();
  step(g, 1);
  g.enemies.list.push({ id: 902, state: 'grab', x: g.hero.x + 2.5, z: g.hero.z, dist: 2.5, angle: 0, heading: Math.PI / 2, speed: 15, turn: 0, lane: [0, 0], grabTime: 0 });
  g.update(DT);
  expect(g.grabbing).toBe(1);
  expect(g.hideBlock).toBe('grabbed');
  expect(g.hide(1, 0)).toBe(false);
  expect(g.hero.hidden).toBeFalsy();
});

test('M2: 隠れたあと cooldown 秒は次の隠れるができない（hideBlock: cooldown）。過ぎればまたできる', () => {
  const g = start();
  step(g, 1);
  const dirs = [[1, 0], [0, 1], [0, -1], [-1, 0]];
  expect(dirs.some((d) => g.hide(d[0], d[1]))).toBe(true);
  step(g, HC.dashSec + 0.1);
  expect(g.hideBlock).toBe('cooldown');
  expect(dirs.some((d) => g.hide(d[0], d[1]))).toBe(false);
  step(g, HC.cooldown);
  expect(g.hideBlock).not.toBe('cooldown');
  expect(dirs.some((d) => g.hide(d[0], d[1]))).toBe(true);
});

test('M2: 物陰から出る（leaveDist より離れる）と隠れていない。ライトの中で見られれば、また見つかる', () => {
  const g = start();
  step(g, 1);
  expect([[1, 0], [0, 1], [0, -1], [-1, 0]].some((d) => g.hide(d[0], d[1]))).toBe(true);
  step(g, HC.dashSec + 0.1);
  expect(g.hero.hidden).toBe(true);
  const spot = { x: g.hero.x, z: g.hero.z };
  // 広場の真ん中へ戻る
  for (let t = 0; t < 3 && Math.hypot(g.hero.x, g.hero.z) > 2; t += DT) { g.setMove(-g.hero.x, -g.hero.z); g.update(DT); }
  g.setMove(0, 0);
  expect(Math.hypot(g.hero.x - spot.x, g.hero.z - spot.z)).toBeGreaterThan(HC.leaveDist);
  expect(g.hero.hidden).toBe(false);
  // 主人公の前の道を、主人公の方を向いて来る者は見つける
  const r = { id: 903, state: 'search', x: 13, z: 30, heading: -Math.PI / 2, speed: 0, turn: 0, searchTime: 0, lane: [0, 0], ni: 0, nj: 0, di: 0, dj: -1 };
  r.dist = Math.hypot(r.x - g.hero.x, r.z - g.hero.z); r.angle = 0;
  g.enemies.list.push(r);
  step(g, 0.4);
  expect(['chase', 'grab', 'cling']).toContain(r.state);
});
