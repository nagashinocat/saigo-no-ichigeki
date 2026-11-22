import { test, expect } from 'vitest';
import { createFlick } from '../../src/input/flick.js';
import { createControls } from '../../src/input/controls.js';
import { CONFIG } from '../../src/config.js';

// M2（持ち主 15:20「ジョイスティックを同じ向きに2回入力で隠れる」）: スティックを同じ向きに素早く 2 回倒す（flick）
const F = CONFIG.controls.flick;

test('M2: 2 回倒す の値は config にある（約 70% より深く・約 0.35 秒の内・向きのずれ約 30° 以内）', () => {
  expect(F.mag).toBeCloseTo(0.7, 1);
  expect(F.window).toBeCloseTo(0.35, 2);
  expect(F.angleDeg).toBeCloseTo(30, 0);
  expect(F.release).toBeLessThan(F.mag);
});

test('M2: 同じ向きに 0.35 秒の内に 2 回、深く倒すと、その向きを返す', () => {
  const f = createFlick();
  expect(f.push(0, 0, 0)).toBe(null);
  expect(f.push(0.9, 0.1, 0.05)).toBe(null); // 1 回目
  expect(f.push(0.1, 0, 0.12)).toBe(null); // 戻す
  const d = f.push(0.95, -0.05, 0.25); // 2 回目
  expect(d).not.toBe(null);
  expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 6);
  expect(d.x).toBeGreaterThan(0.99);
});

test('M2: 2 回倒すにならない: 遅い・向きが違う・戻さない・浅い・1 回だけ', () => {
  const run = (seq) => { const f = createFlick(); let got = null; for (const [x, y, t] of seq) got = f.push(x, y, t) ?? got; return got; };
  expect(run([[1, 0, 0], [0, 0, 0.2], [1, 0, F.window + 0.05]])).toBe(null); // 遅い
  const a = ((F.angleDeg + 10) * Math.PI) / 180;
  expect(run([[1, 0, 0], [0, 0, 0.1], [Math.cos(a), Math.sin(a), 0.2]])).toBe(null); // 向きが違う
  expect(run([[1, 0, 0], [0.8, 0, 0.1], [1, 0, 0.2]])).toBe(null); // 戻さない（ずっと倒したまま）
  expect(run([[0.6, 0, 0], [0, 0, 0.1], [0.6, 0, 0.2]])).toBe(null); // 浅い
  expect(run([[1, 0, 0], [0, 0, 0.1]])).toBe(null); // 1 回だけ
  // 3 回目は新しい 1 回目（2 回で一度使ったら数え直す）
  const f = createFlick();
  f.push(1, 0, 0); f.push(0, 0, 0.05);
  expect(f.push(1, 0, 0.1)).not.toBe(null);
  f.push(0, 0, 0.15);
  expect(f.push(1, 0, 0.2)).toBe(null);
});

test('M2: 浮かぶスティックで 2 回倒すと onHide（画面の向き）。スティックは消えず、払うにもならない', () => {
  const hides = [], puffs = [];
  const c = createControls({ onHide: (d) => hides.push(d), onPuff: () => puffs.push(1) });
  const R = CONFIG.controls.stickRadiusPx;
  c.down(1, 300, 600, 0); // 溜め
  c.down(2, 100, 600, 0.1);
  c.move(2, 100, 600 - R, 0.12); // 上へ 1 回目（スティックが出る）
  c.move(2, 100, 600, 0.18);
  c.move(2, 100, 600 - R, 0.26); // 2 回目
  expect(hides).toHaveLength(1);
  expect(hides[0].y).toBeLessThan(-0.99);
  expect(c.stick).not.toBe(null);
  expect(puffs).toHaveLength(0);
});
