import { test, expect } from 'vitest';
import { createControls, screenToWorld } from '../../src/input/controls.js';
import { screenBearingDeg } from '../../src/ui/stickMarks.js';
import { createGame } from '../../src/game/game.js';
import { createLookout } from '../../src/game/lookout.js';
import { CONFIG } from '../../src/config.js';

// R1f（持ち主 18:14「払うが反応し辛いのかスワイプと誤認識してるのか…似た操作はやめよう」→「LOOK OUT!の矢印をタップ」）:
//  - 2 本目の指のシュッ（なぞって隠れる）はやめた。2 本目の指は、短いタップ＝払う、長押しか 10 px 以上の動き＝スティック、だけ
//  - タップ: 触れてから longPressSec（0.18 秒）より前に離し、触れた所からの動きがいちばん遠くでも tapSlopPx（約 14 px）未満。
//    10 px で仮のスティックが出ていても、その条件ならタップ（払う）。前は 10 px で仮のスティックになった指は離しても払わなかった
//    （実機の指は軽いタップでも 10 px ほど転がる: 払うの取りこぼしの元）
//  - タップが LOOK OUT! の矢印の当たり（hideHit）に触れたら隠れる（onHide）。矢印の外のタップは払う
const C = CONFIG.controls;
function rig(hit = null) {
  const log = [];
  const c = createControls({
    onChargeStart: () => log.push('start'),
    onChargeEnd: () => log.push('fire'),
    onChargeCancel: () => log.push('cancel'),
    onPuff: (x, y) => log.push(['puff', x, y]),
    onHide: (x, y) => log.push(['hide', x, y]),
    hideHit: hit,
  });
  c.down(1, 300, 200, 0);
  return { c, log };
}

test('R1f: シュッの値は config から消え、タップのゆるさ（約 14 px）がある', () => {
  expect(C.flick).toBeUndefined();
  expect(C.tapSlopPx).toBeGreaterThanOrEqual(12);
  expect(C.tapSlopPx).toBeLessThanOrEqual(16);
  expect(C.tapSlopPx).toBeGreaterThan(C.tapMovePx);
  expect(C.longPressSec).toBeCloseTo(0.18, 6);
});

test('R1f: タップのゆるさの両側: 触れた所から slop 未満の動きで 0.18 秒より前に離せば、10 px で仮のスティックが出ていても払う。slop 以上なら払わない', () => {
  for (const [d, puff] of [[C.tapSlopPx - 0.5, true], [C.tapMovePx + 1, true], [C.tapSlopPx, false], [C.tapSlopPx + 6, false]]) {
    const { c, log } = rig();
    c.down(2, 100, 600, 1);
    c.move(2, 100 + d, 600, 1.05);
    if (d >= C.tapMovePx) expect(c.stick).not.toBeNull(); // 仮のスティック
    c.up(2, 100 + d, 600, 1.1);
    expect(log.some((x) => x[0] === 'puff'), `${d} px`).toBe(puff);
    expect(c.stick).toBeNull();
  }
});

test('R1f: ゆるさは触れた所から測る（一度遠くまで動かして戻しても、いちばん遠い所で決める）', () => {
  const { c, log } = rig();
  c.down(2, 100, 600, 1);
  c.move(2, 100 + C.tapSlopPx + 2, 600, 1.04);
  c.move(2, 101, 600, 1.08);
  c.up(2, 101, 600, 1.1);
  expect(log).toEqual(['start']);
});

test('R1f: 時間の両側: 0.18 秒より前に離せば払う。0.18 秒ちょうど以降（スティック）は払わない', () => {
  const a = rig();
  a.c.down(2, 100, 600, 1);
  a.c.up(2, 102, 601, 1 + C.longPressSec - 0.005);
  expect(a.log.at(-1)).toEqual(['puff', 102, 601]);
  const b = rig();
  b.c.down(2, 100, 600, 1);
  b.c.update(1 + C.longPressSec + 1e-9);
  expect(b.c.stick).not.toBeNull();
  b.c.up(2, 100, 600, 1 + C.longPressSec + 0.001);
  expect(b.log).toEqual(['start']);
  // move が来ないまま、離す知らせの時刻で 0.18 秒を越えていても払わない（update が遅れたフレーム）
  const d = rig();
  d.c.down(2, 100, 600, 1);
  d.c.up(2, 100, 600, 1 + C.longPressSec + 0.02);
  expect(d.log).toEqual(['start']);
});

test('R1f: シュッはもうない: 0.18 秒の内に 60 px すばやく払って離しても、隠れず・払わない（何もしない）', () => {
  const { c, log } = rig(() => false);
  c.down(2, 100, 600, 1);
  c.move(2, 160, 600, 1.05);
  c.up(2, 160, 600, 1.08);
  expect(log).toEqual(['start']);
});

test('R1f: LOOK OUT! の矢印の当たりに触れたタップは隠れる（払わない）。当たりの外のタップは払う。矢印の上の長押しはスティック', () => {
  const inArrow = (x, y) => Math.hypot(x - 200, y - 400) <= 40;
  const a = rig(inArrow);
  a.c.down(2, 210, 395, 1);
  a.c.up(2, 212, 396, 1.08);
  expect(a.log).toEqual(['start', ['hide', 210, 395]]);
  const b = rig(inArrow);
  b.c.down(2, 300, 600, 1);
  b.c.up(2, 300, 600, 1.08);
  expect(b.log).toEqual(['start', ['puff', 300, 600]]);
  const s = rig(inArrow);
  s.c.down(2, 200, 400, 1);
  s.c.update(1.3);
  expect(s.c.stick).not.toBeNull();
  s.c.up(2, 200, 400, 1.4);
  expect(s.log).toEqual(['start']);
  // 溜めていないとき（1 本目）は、矢印の上でも溜め
  const n = createControls({ onChargeStart: () => s.log.push('start2'), onHide: () => s.log.push('hide2'), hideHit: inArrow });
  n.down(9, 200, 400, 5); n.up(9, 200, 400, 5.05);
  expect(s.log).not.toContain('hide2');
});

test('R1e: 画面の向き → 街の向き（上空カメラ。スティックと同じ写し。stickMarks の screenBearingDeg の逆）', () => {
  expect(screenToWorld(1, 0)).toEqual({ x: 1, z: 0 });
  const d = screenToWorld(0, -1);
  expect(d.x).toBeCloseTo(0, 9); expect(d.z).toBeCloseTo(-1, 9);
  for (const az of [0, 30, 90, -135]) {
    for (const a of [0, 45, 100, -170]) {
      const r = (a * Math.PI) / 180;
      const w = screenToWorld(Math.cos(r), Math.sin(r), az);
      expect(Math.hypot(w.x, w.z)).toBeCloseTo(1, 9);
      const back = screenBearingDeg(w.x, w.z, az);
      expect(Math.abs(((back - a + 540) % 360) - 180)).toBeCloseTo(0, 6);
    }
  }
});

// 矢印のタップ → game.hideToward(矢印の物陰)（main.js と同じつなぎ方）
const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 }, kinds: {} } };
const DT = 1 / 30;
test('R1f: 見つかりそうなときの矢印をタップすると、その物陰へ隠れる。掴まれていると矢印は出ず、タップは払う', () => {
  let tried = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = createGame({ seed, cfg: quiet });
    g.begin(); g.pressStart();
    for (let i = 0; i < 20; i++) g.update(DT);
    // 主人公の 45 m 先から主人公の方を向いて来る探す者（ライトがもうすぐ届く）
    const H = g.hero;
    const r = { id: 950, state: 'search', x: H.x + 45, z: H.z, heading: Math.PI, speed: 0, turn: 0, searchTime: 0, lane: [0, 0], ni: 0, nj: 0, di: -1, dj: 0 };
    r.dist = 45; r.angle = 0;
    const lo = createLookout();
    const out = lo.update(DT, { hero: H, enemies: [r], buildings: g.city.buildings, hideBlock: g.hideBlock, azimuthDeg: 0 });
    if (!out.show || !out.spot) continue;
    tried++;
    const spot = { ...out.spot };
    const got = [];
    const c = createControls({ onHide: () => got.push(g.hideToward(spot)), onPuff: () => got.push('puff'), hideHit: (x, y) => Math.hypot(x - 50, y - 50) < 40 });
    c.down(1, 300, 300, 0);
    c.down(2, 55, 52, 0.5); c.up(2, 55, 52, 0.55);
    expect(got).toEqual([true]);
    for (let i = 0; i < 12; i++) g.update(DT);
    expect(g.hero.hidden).toBe(true);
    expect(Math.hypot(g.hero.x - spot.x, g.hero.z - spot.z)).toBeLessThan(6);
  }
  expect(tried).toBeGreaterThanOrEqual(2);
  // 掴まれている: 矢印は出ない（hideBlock: grabbed）
  const g = createGame({ seed: 1, cfg: quiet });
  g.begin(); g.pressStart();
  g.enemies.list.push({ id: 902, state: 'grab', x: g.hero.x + 2.5, z: g.hero.z, dist: 2.5, angle: 0, heading: Math.PI / 2, speed: 15, turn: 0, lane: [0, 0], grabTime: 0 });
  g.update(DT);
  const r = { id: 951, state: 'search', x: g.hero.x + 45, z: g.hero.z, heading: Math.PI, speed: 0, turn: 0, lane: [0, 0] };
  expect(createLookout().update(DT, { hero: g.hero, enemies: [...g.enemies.list, r], buildings: g.city.buildings, hideBlock: g.hideBlock }).show).toBe(false);
});
