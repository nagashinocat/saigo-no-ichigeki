import { test, expect } from 'vitest';
import { createControls, screenToWorld } from '../../src/input/controls.js';
import { screenBearingDeg } from '../../src/ui/stickMarks.js';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// R1e（持ち主 16:45「2本目の指をシュッと払う」）: 溜めている間の 2 本目の指を、触れてから flick.maxSec 秒の内に flick.minPx px 以上
// すばやく動かす（まだスティックになっていない）と、その画面の向きの物陰へ隠れる（onHide）。短いタップは払う、長押しはスティックのまま。
// スティックの指を離しても隠れない・放たない。隠れる決まり（いちばん近い物陰・掴まれている間はできない・約 3 秒待つ）は M2 の game.hide
const C = CONFIG.controls, F = C.flick;
function rig() {
  const log = [];
  const c = createControls({
    onChargeStart: () => log.push('start'),
    onChargeEnd: () => log.push('fire'),
    onChargeCancel: () => log.push('cancel'),
    onPuff: (x, y) => log.push(['puff', x, y]),
    onHide: (d, s) => log.push(['hide', d, s]),
  });
  c.down(1, 300, 200, 0);
  return { c, log };
}
const hides = (log) => log.filter((e) => e[0] === 'hide');

test('R1e: シュッの値は config にある（約 40 px・約 0.18 秒）', () => {
  expect(F.minPx).toBe(40);
  expect(F.maxSec).toBeCloseTo(0.18, 6);
});

// R1e fix1（見直しの案 (a)、取りまとめ役の判断）: 10 px 動けばすぐ仮のスティック（すぐ動き始める）。触れてから 0.18 秒の内に 40 px 以上動かし、
// しかも 0.18 秒の内に離したときだけシュッ（仮のスティックを消して隠れる）。指を置いたままなら、どれだけ速くてもスティック
test('R1e fix1: 0.18 秒の内に 40 px 動かして離すとシュッ（離したときに onHide。画面の向き・長さ 1 と、払った線）。それまでは仮のスティックで動く', () => {
  const { c, log } = rig();
  c.down(2, 100, 600, 1);
  c.move(2, 120, 600, 1.03);
  expect(c.stick).not.toBe(null); // 仮のスティック（すぐ動き始める）
  expect(c.dir.x).toBeGreaterThan(0);
  c.move(2, 100 + F.minPx * 0.6, 600 - F.minPx * 0.8, 1.1); // ちょうど 40 px（右上）
  expect(hides(log)).toHaveLength(0); // 置いたままの間はまだ
  c.up(2, 100 + F.minPx * 0.6, 600 - F.minPx * 0.8, 1 + F.maxSec - 0.01);
  expect(hides(log)).toHaveLength(1);
  const [, d, s] = hides(log)[0];
  expect(d.x).toBeCloseTo(0.6, 6);
  expect(d.y).toBeCloseTo(-0.8, 6);
  expect(s).toMatchObject({ x0: 100, y0: 600, x1: 124, y1: 568 });
  expect(c.stick).toBe(null); // 仮のスティックは消える
  expect(c.dir).toEqual({ x: 0, y: 0 });
  expect(log.filter((e) => e[0] === 'puff')).toHaveLength(0);
  expect(c.charging).toBe(true);
});

test('R1e fix1: 速く 40 px 以上倒して、そのまま指を置いておく → スティック。隠れない（あとで離しても）', () => {
  const { c, log } = rig();
  c.down(2, 100, 600, 1);
  c.move(2, 100 + F.minPx + 30, 600, 1.04); // 0.04 秒で 70 px
  c.update(1 + F.maxSec); // 置いたまま 0.18 秒
  c.update(1.3);
  expect(c.stick).toMatchObject({ cx: 100, cy: 600 });
  expect(c.dir.x).toBeGreaterThan(0.9);
  c.up(2, 100 + F.minPx + 30, 600, 1.4);
  expect(hides(log)).toHaveLength(0);
  expect(log).toEqual(['start']);
});

test('R1e fix1: しきいの両側: 39 px で離す → 何もしない。40 px でも離すのが 0.18 秒ちょうど以降 → 隠れない', () => {
  const a = rig();
  a.c.down(2, 100, 600, 1);
  a.c.move(2, 100 + F.minPx - 1, 600, 1.05);
  a.c.up(2, 100 + F.minPx - 1, 600, 1.1);
  expect(a.log).toEqual(['start']); // 払うでもない（10 px 以上動いた）
  const b = rig();
  b.c.down(2, 100, 600, 1);
  b.c.move(2, 100 + F.minPx, 600, 1.05);
  b.c.up(2, 100 + F.minPx, 600, 1 + F.maxSec + 0.01);
  expect(hides(b.log)).toHaveLength(0);
  const c1 = rig();
  c1.c.down(2, 100, 600, 1);
  c1.c.move(2, 100 + F.minPx, 600, 1.05);
  c1.c.up(2, 100 + F.minPx, 600, 1 + F.maxSec - 0.01);
  expect(hides(c1.log)).toHaveLength(1);
});

test('R1e fix1: 0.18 秒を過ぎてから 40 px を越えた動きは数えない（ゆっくり倒したスティックは、離しても隠れない）', () => {
  // 0.18 秒の内には 30 px、0.18 秒を過ぎて 60 px → 置いたままのスティック。離しても隠れない
  const { c, log } = rig();
  c.down(2, 100, 600, 1);
  c.move(2, 130, 600, 1.1);
  c.move(2, 160, 600, 1 + F.maxSec + 0.02);
  c.up(2, 160, 600, 1 + F.maxSec + 0.05);
  expect(hides(log)).toHaveLength(0);
});

test('R1e fix1: 0.18 秒の内に 40 px 先まで払って少し戻してから離しても、シュッ（いちばん遠くまで払った向き）', () => {
  const { c, log } = rig();
  c.down(2, 100, 600, 1);
  c.move(2, 100, 600 + 50, 1.05);
  c.up(2, 100, 600 + 25, 1.1);
  expect(hides(log)).toHaveLength(1);
  expect(hides(log)[0][1].y).toBeCloseTo(1, 6);
});

test('R1e: 離したときに 40 px（move が来なかった）でも、0.18 秒の内ならシュッ。0.18 秒を過ぎて離せば何もしない', () => {
  const a = rig();
  a.c.down(2, 100, 600, 1);
  a.c.up(2, 100, 600 + F.minPx, 1.1);
  expect(hides(a.log)).toHaveLength(1);
  expect(hides(a.log)[0][1]).toEqual({ x: 0, y: 1 });
  const b = rig();
  b.c.down(2, 100, 600, 1);
  b.c.up(2, 100, 600 + F.minPx, 1 + F.maxSec + 0.01);
  expect(hides(b.log)).toHaveLength(0);
});

test('R1e: 短いタップ（0.18 秒未満・10 px 未満）は払うのまま、長押し（0.18 秒以上）はスティックのまま（しきいの両側）', () => {
  const a = rig();
  a.c.down(2, 100, 600, 1);
  a.c.up(2, 100 + C.tapMovePx - 1, 600, 1 + C.longPressSec - 0.01);
  expect(a.log).toEqual(['start', ['puff', 100 + C.tapMovePx - 1, 600]]);
  const b = rig();
  b.c.down(2, 100, 600, 1);
  b.c.up(2, 100 + C.tapMovePx, 600, 1.05); // 10 px: 払うではない
  expect(b.log).toEqual(['start']);
  const c1 = rig();
  c1.c.down(2, 100, 600, 1);
  c1.c.update(1 + C.longPressSec - 0.01);
  expect(c1.c.stick).toBe(null);
  c1.c.update(1 + C.longPressSec + 1e-9);
  expect(c1.c.stick).not.toBe(null);
});

test('R1e: スティックの指は、すばやく大きく動かしても・離しても、隠れない・放たない（新しく触れた指だけがシュッになる）', () => {
  const { c, log } = rig();
  c.down(2, 100, 600, 1);
  c.update(1 + C.longPressSec + 0.01);
  expect(c.stick).not.toBe(null);
  // スティックを同じ向きに 2 回すばやく倒す（M2 の 2 回倒す）も、もう隠れない
  const R = C.stickRadiusPx;
  c.move(2, 100, 600 - R, 1.25); c.move(2, 100, 600, 1.3); c.move(2, 100, 600 - R, 1.35);
  c.move(2, 100 + 200, 600, 1.36);
  c.up(2, 300, 600, 1.37);
  expect(log).toEqual(['start']);
  expect(c.charging).toBe(true);
});

test('R1e: 3 本目の指は無視する（スティックがあっても、シュッの途中の指が離れる前でも）', () => {
  const { c, log } = rig();
  c.down(2, 100, 600, 1);
  c.update(1.3); // スティック
  c.down(3, 200, 500, 1.4);
  c.move(3, 300, 500, 1.42);
  c.up(3, 300, 500, 1.45);
  expect(log).toEqual(['start']);
  c.up(2, 100, 600, 1.5);
  c.down(4, 100, 600, 2);
  c.move(4, 100, 600 - F.minPx, 2.05); // シュッの途中（仮のスティック）
  c.down(5, 200, 500, 2.08); // その指はまだ離れていない: 3 本目
  c.move(5, 200 + F.minPx * 2, 500, 2.09);
  c.up(5, 200 + F.minPx * 2, 500, 2.1);
  expect(hides(log)).toHaveLength(0);
  c.up(4, 100, 600 - F.minPx, 2.12); // 2 本目を 0.18 秒の内に離す: シュッ
  expect(hides(log)).toHaveLength(1);
  expect(log.filter((e) => e[0] === 'puff')).toHaveLength(0);
});

test('R1e: 溜めていないとき（1 本目がない）、最初の指のシュッは溜めであって隠れない', () => {
  const log = [];
  const c = createControls({ onChargeStart: () => log.push('start'), onHide: () => log.push('hide') });
  c.down(1, 100, 600, 0);
  c.move(1, 100 + F.minPx * 2, 600, 0.05);
  expect(log).toEqual(['start']);
});

test('R1e: 画面の向き → 街の向き（上空カメラ。スティックと同じ写し。stickMarks の screenBearingDeg の逆）', () => {
  // azimuth 0: 画面の右 = 世界の +x、画面の下 = 世界の +z
  expect(screenToWorld(1, 0)).toEqual({ x: 1, z: 0 });
  const d = screenToWorld(0, -1);
  expect(d.x).toBeCloseTo(0, 9); expect(d.z).toBeCloseTo(-1, 9);
  // どのカメラの向きでも、街の向きを画面へ戻すと同じ角
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

// シュッ → 街の向き → M2 の game.hide（main.js の配線と同じつなぎ方）
const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 }, kinds: {} } };
const DT = 1 / 30;
const step = (g, sec) => { for (let t = 0; t < sec - 1e-9; t += DT) g.update(DT); };
function wired() {
  const g = createGame({ seed: 1, cfg: quiet });
  g.begin(); g.pressStart();
  step(g, 1);
  const got = [];
  const c = createControls({ onHide: (d) => { const w = screenToWorld(d.x, d.y); got.push(g.hide(w.x, w.z)); } });
  c.down(1, 200, 300, 0);
  let t = 1, id = 10;
  const flick = (sx, sy) => { const k = id++; c.down(k, 200, 600, t); c.move(k, 200 + sx * F.minPx, 600 + sy * F.minPx, t + 0.05); c.up(k, 200 + sx * F.minPx, 600 + sy * F.minPx, t + 0.08); t += 0.2; };
  return { g, got, flick };
}
const SCREEN = [[1, 0], [0, 1], [0, -1], [-1, 0]];

test('R1e: シュッで、その向きの物陰へ隠れる（M2 の hide。向きは画面 → 街）', () => {
  const { g, got, flick } = wired();
  const from = { x: g.hero.x, z: g.hero.z };
  for (const [sx, sy] of SCREEN) { flick(sx, sy); if (got.at(-1)) break; }
  expect(got.at(-1)).toBe(true);
  const [sx, sy] = SCREEN[got.length - 1];
  const w = screenToWorld(sx, sy);
  const to = g.hero.hideSpot;
  expect((to.x - from.x) * w.x + (to.z - from.z) * w.z).toBeGreaterThan(0); // 払った向きの先
});

test('R1e: 掴まれている間のシュッは隠れない', () => {
  const { g, got, flick } = wired();
  g.enemies.list.push({ id: 902, state: 'grab', x: g.hero.x + 2.5, z: g.hero.z, dist: 2.5, angle: 0, heading: Math.PI / 2, speed: 15, turn: 0, lane: [0, 0], grabTime: 0 });
  g.update(DT);
  for (const [sx, sy] of SCREEN) flick(sx, sy);
  expect(got).toEqual([false, false, false, false]);
  expect(g.hero.hidden).toBeFalsy();
});

test('R1e: 隠れたあと約 3 秒は、シュッしても隠れない（待ち時間）。過ぎればまた隠れる', () => {
  const { g, got, flick } = wired();
  for (const [sx, sy] of SCREEN) { flick(sx, sy); if (got.at(-1)) break; }
  expect(got.at(-1)).toBe(true);
  step(g, CONFIG.hide.dashSec + 0.1);
  const n = got.length;
  for (const [sx, sy] of SCREEN) flick(sx, sy);
  expect(got.slice(n).every((x) => x === false)).toBe(true);
  expect(g.hideBlock).toBe('cooldown');
  step(g, CONFIG.hide.cooldown);
  g.hero.hidden = false; // 物陰から出た（M2: 出れば隠れていない）
  const m = got.length;
  for (const [sx, sy] of SCREEN) { flick(sx, sy); if (got.at(-1)) break; }
  expect(got.slice(m)).toContain(true);
});
