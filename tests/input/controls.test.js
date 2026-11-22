import { test, expect } from 'vitest';
import { createControls, stickVector, keyVector } from '../../src/input/controls.js';
import { CONFIG } from '../../src/config.js';

// M1（持ち主 09:15、spec §16）: 左右に分けない操作。1 本目の指はどこでも溜め（離すと放つ）。溜めている間の 2 本目の指は、
// 長押し（約 0.18 秒）でその場に浮かぶジョイスティック、短いタップ（0.18 秒未満・10 px 未満）で払う。3 本目は無視
const C = CONFIG.controls;
function rig() {
  const log = [];
  const c = createControls({
    onChargeStart: () => log.push('start'),
    onChargeEnd: () => log.push('fire'),
    onChargeCancel: () => log.push('cancel'),
    onPuff: (x, y) => log.push(['puff', x, y]),
  });
  return { c, log };
}

test('M1: 1 本目の指はどこに触れても溜めになり、離すと放つ。溜めていないときは 2 本目もない（最初の指は必ず溜め）', () => {
  const { c, log } = rig();
  c.down(1, 300, 200, 0);
  expect(log).toEqual(['start']);
  expect(c.charging).toBe(true);
  expect(c.stick).toBe(null);
  c.update(1);
  expect(c.stick).toBe(null); // 1 本目の長押しはスティックにならない
  c.up(1, 300, 200, 1.2);
  expect(log).toEqual(['start', 'fire']);
  expect(c.charging).toBe(false);
  // 次の指はまた 1 本目（溜め）
  c.down(2, 40, 700, 2);
  expect(log.at(-1)).toBe('start');
});

test('M1: 溜めている間の 2 本目の短いタップ（0.18 秒未満・10 px 未満）は払う（押した所で）。スティックは出ない', () => {
  const { c, log } = rig();
  c.down(1, 300, 200, 0);
  c.down(2, 80, 600, 0.5);
  c.move(2, 84, 604, 0.55); // 動きは 10 px 未満
  c.update(0.6);
  expect(c.stick).toBe(null);
  c.up(2, 84, 604, 0.5 + C.longPressSec - 0.02);
  expect(log).toEqual(['start', ['puff', 84, 604]]);
  expect(c.charging).toBe(true);
});

test('M1: 2 本目の長押し（0.18 秒以上）は、押した所に浮かぶスティック。滑らせた向きと量で動き、離すと消える（払わず、放たない）', () => {
  const { c, log } = rig();
  c.down(1, 300, 200, 0);
  c.down(7, 100, 600, 1);
  c.update(1 + C.longPressSec - 0.01);
  expect(c.stick).toBe(null);
  c.update(1 + C.longPressSec + 0.01);
  expect(c.stick).toMatchObject({ cx: 100, cy: 600, kx: 100, ky: 600 });
  expect(c.dir).toEqual({ x: 0, y: 0 });
  c.move(7, 100 + C.stickRadiusPx, 600, 1.4); // 右いっぱい
  expect(c.dir.x).toBeCloseTo(1, 6);
  expect(c.dir.y).toBeCloseTo(0, 6);
  c.move(7, 100, 600 - 3 * C.stickRadiusPx, 1.5); // 上へ輪の外まで: 長さ 1 に収まり、つまみは輪の縁
  expect(c.dir.y).toBeCloseTo(-1, 6);
  expect(c.stick.ky).toBeCloseTo(600 - C.stickRadiusPx, 6);
  c.up(7, 100, 400, 1.6);
  expect(c.stick).toBe(null);
  expect(c.dir).toEqual({ x: 0, y: 0 });
  expect(log).toEqual(['start']); // 払わず、放たない
  expect(c.charging).toBe(true);
});

// R1e（持ち主 16:45）: 10 px 以上動いても 0.18 秒まではスティックにしない（40 px のシュッになりうるので）。0.18 秒で、押した所を中心に
// スティックになり、つまみはそのときの指の所。それより前に 10〜40 px だけ動かして離すと、払うでもシュッでもない（何もしない）
test('R1e: 2 本目が 10 px 以上・40 px 未満動いても、0.18 秒まではスティックにならない。0.18 秒でスティック（押した所が中心）。その前に離すと何もしない', () => {
  const { c, log } = rig();
  c.down(1, 300, 200, 0);
  c.down(2, 100, 600, 1);
  c.move(2, 100 + C.tapMovePx + 1, 600, 1.05);
  expect(c.stick).toBe(null);
  c.move(2, 100 + 30, 600, 1 + C.longPressSec + 0.01);
  expect(c.stick).toMatchObject({ cx: 100, cy: 600, kx: 130, ky: 600 });
  expect(c.dir.x).toBeGreaterThan(0);
  c.up(2, 130, 600, 1.3);
  expect(log).toEqual(['start']);
  c.down(3, 100, 600, 2);
  c.move(3, 120, 600, 2.05);
  c.up(3, 125, 600, 2.1);
  expect(log).toEqual(['start']);
  expect(c.stick).toBe(null);
});

test('M1: スティックを動かしている間に溜めの指を離すと、放ち、スティックは消える', () => {
  const { c, log } = rig();
  c.down(1, 300, 200, 0);
  c.down(2, 100, 600, 0.2);
  c.update(0.6);
  c.move(2, 140, 600, 0.7);
  expect(c.dir.x).toBeGreaterThan(0.5);
  c.up(1, 300, 200, 0.8);
  expect(log).toEqual(['start', 'fire']);
  expect(c.stick).toBe(null);
  expect(c.dir).toEqual({ x: 0, y: 0 });
  // 残った指は何もしない（離しても払わず、放たない。動かしても動かない）
  c.move(2, 60, 600, 0.9);
  expect(c.dir).toEqual({ x: 0, y: 0 });
  c.up(2, 60, 600, 1);
  expect(log).toEqual(['start', 'fire']);
  // その指が離れるまでは、次の指が 1 本目（溜め）になる
  c.down(3, 10, 10, 1.1);
  expect(log.at(-1)).toBe('start');
});

test('M1: 溜めの指のタップのあと残った 2 本目は、指が離れても払わない（溜めていないときは払えない）', () => {
  const { c, log } = rig();
  c.down(1, 300, 200, 0);
  c.down(2, 100, 600, 0.05);
  c.up(1, 300, 200, 0.08);
  c.up(2, 100, 600, 0.1);
  expect(log).toEqual(['start', 'fire']);
});

test('M1: pointercancel: 溜めの指なら放たずに打ち切り（スティックも消す）、2 本目なら払わずスティックも消える', () => {
  const a = rig();
  a.c.down(1, 300, 200, 0);
  a.c.down(2, 100, 600, 0.1);
  a.c.update(0.5);
  a.c.cancel(1);
  expect(a.log).toEqual(['start', 'cancel']);
  expect(a.c.stick).toBe(null);
  const b = rig();
  b.c.down(1, 300, 200, 0);
  b.c.down(2, 100, 600, 0.1);
  b.c.cancel(2);
  b.c.up(2, 100, 600, 0.12);
  expect(b.log).toEqual(['start']);
  b.c.down(2, 100, 600, 0.2);
  b.c.update(0.5);
  b.c.cancel(2);
  expect(b.c.stick).toBe(null);
  expect(b.log).toEqual(['start']);
  // reset（タブを隠した・blur）: 放たずに打ち切る
  b.c.reset();
  expect(b.log).toEqual(['start', 'cancel']);
  expect(b.c.charging).toBe(false);
});

test('M1: 3 本目の指は無視する（溜め・スティック・払うのどれにもならない）', () => {
  const { c, log } = rig();
  c.down(1, 300, 200, 0);
  c.down(2, 100, 600, 0.1);
  c.update(0.5);
  c.down(3, 200, 500, 0.6);
  c.move(3, 260, 500, 0.62);
  c.up(3, 260, 500, 0.65);
  expect(log).toEqual(['start']);
  expect(c.stick).toMatchObject({ cx: 100, cy: 600 });
  expect(c.dir).toEqual({ x: 0, y: 0 });
  // スティックの指を離したあとの 3 本目の新しい押下は、2 本目として扱う
  c.up(2, 100, 600, 0.7);
  c.down(4, 90, 610, 0.8);
  c.up(4, 90, 610, 0.85);
  expect(log).toEqual(['start', ['puff', 90, 610]]);
});

test('M1: スティックのベクトル: 輪の半径で長さ 1、deadPx の内は 0、輪の外は 1 に収める', () => {
  expect(stickVector(0, 0)).toEqual({ x: 0, y: 0 });
  expect(stickVector(C.deadPx - 1, 0)).toEqual({ x: 0, y: 0 });
  const v = stickVector(C.stickRadiusPx / 2, 0);
  expect(v.x).toBeGreaterThan(0.3);
  expect(v.x).toBeLessThan(0.6);
  const f = stickVector(300, 400);
  expect(Math.hypot(f.x, f.y)).toBeCloseTo(1, 9);
  expect(f.x / f.y).toBeCloseTo(0.75, 9);
});

test('M1: PC: 矢印キーか WASD で動く（斜めも長さ 1）', () => {
  expect(keyVector(new Set(['ArrowUp']))).toEqual({ x: 0, y: -1 });
  expect(keyVector(new Set(['KeyD']))).toEqual({ x: 1, y: 0 });
  const d = keyVector(new Set(['KeyA', 'KeyS']));
  expect(d.x).toBeCloseTo(-Math.SQRT1_2, 9);
  expect(d.y).toBeCloseTo(Math.SQRT1_2, 9);
  expect(keyVector(new Set(['ArrowLeft', 'ArrowRight']))).toEqual({ x: 0, y: 0 });
  expect(keyVector(new Set())).toEqual({ x: 0, y: 0 });
});

// R1c（M1 の見直し Minor 3）: 使われなくなった press.js のテストを、本番の createControls へ移した（同じ決まりを守る）
test('R1c: 溜めの指の up のあとに来る cancel（lostpointercapture）は何もしない。押していない指の up / cancel も何もしない', () => {
  const { c, log } = rig();
  c.up(9, 0, 0, 0); c.cancel(9);
  expect(log).toEqual([]);
  c.down(1, 10, 10, 0);
  c.up(1, 10, 10, 0.5);
  c.cancel(1);
  expect(log).toEqual(['start', 'fire']);
});

test('R1c: cancel は放たずに打ち切る（一度だけ）。その後は押し直せる', () => {
  const { c, log } = rig();
  c.down(1, 10, 10, 0);
  c.cancel(1);
  c.cancel(1);
  c.up(1, 10, 10, 0.3);
  expect(log).toEqual(['start', 'cancel']);
  c.down(1, 10, 10, 1);
  c.up(1, 10, 10, 1.4);
  expect(log).toEqual(['start', 'cancel', 'start', 'fire']);
});

test('R1c: reset は押している指を放たずに打ち切り（一度）、その後は別の id の指で押せる。押していなければ何も知らせない', () => {
  const { c, log } = rig();
  c.reset();
  expect(log).toEqual([]);
  c.down(1, 10, 10, 0);
  c.down(2, 50, 50, 0.01);
  c.reset();
  expect(log).toEqual(['start', 'cancel']);
  expect(c.charging).toBe(false);
  expect(c.stick).toBe(null);
  c.up(1, 10, 10, 0.5); c.up(2, 50, 50, 0.5); // 来なかったかもしれない up が遅れて来ても何もしない
  expect(log).toEqual(['start', 'cancel']);
  c.down(5, 10, 10, 1);
  c.up(5, 10, 10, 1.5);
  expect(log).toEqual(['start', 'cancel', 'start', 'fire']);
});
