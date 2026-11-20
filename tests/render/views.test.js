import { test, expect } from 'vitest';
import { layoutViews } from '../../src/render/views.js';

const SIZES = [[390, 844], [1280, 720], [375, 667], [768, 1024], [1024, 768], [1920, 1080], [333, 333], [801, 451], [1, 1], [2, 3]];

const area = (r) => r.w * r.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('縦長: 街が上 65%、下を手と HUD で左右に分ける', () => {
  const l = layoutViews(390, 844);
  expect(l.city.h).toBeCloseTo(844 * 0.65, 0);
  expect(l.hand.w + l.hud.w).toBe(390);
  // 街は上側（左下原点なので y が大きい側）で全幅
  expect(l.city).toMatchObject({ x: 0, w: 390 });
  expect(l.city.y + l.city.h).toBe(844);
  // 下の帯: 左が手(60%)、右が HUD
  expect(l.hand).toMatchObject({ x: 0, y: 0, h: 844 - l.city.h });
  expect(l.hand.w).toBe(Math.round(390 * 0.6));
  expect(l.hud).toMatchObject({ x: l.hand.w, y: 0, h: 844 - l.city.h });
});

test('横長: 街が左 70%、右列の上が手で下が HUD', () => {
  const l = layoutViews(1280, 720);
  expect(l.city).toEqual({ x: 0, y: 0, w: Math.round(1280 * 0.7), h: 720 });
  const colX = l.city.w, colW = 1280 - l.city.w;
  // 右列: 上（y が大きい側）が手 60%、下が HUD
  expect(l.hand).toMatchObject({ x: colX, w: colW, h: Math.round(720 * 0.6) });
  expect(l.hand.y + l.hand.h).toBe(720);
  expect(l.hud).toMatchObject({ x: colX, y: 0, w: colW });
  expect(l.hand.h + l.hud.h).toBe(720);
  expect(l.hud.y + l.hud.h).toBe(l.hand.y);
});

test('どの大きさでも3つの Rect は重ならず画面を埋める', () => {
  for (const [w, h] of SIZES) {
    const l = layoutViews(w, h);
    const rects = [l.city, l.hand, l.hud];
    for (const r of rects) {
      for (const k of ['x', 'y', 'w', 'h']) expect(Number.isInteger(r[k]), `${w}x${h} ${k}`).toBe(true);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.w).toBeGreaterThanOrEqual(0);
      expect(r.h).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(w);
      expect(r.y + r.h).toBeLessThanOrEqual(h);
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      expect(overlap(rects[i], rects[j]), `${w}x${h} rect ${i} vs ${j}`).toBe(false);
    }
    // 重ならず、面積の合計が画面と同じ → 画面をすき間なく埋める
    expect(rects.reduce((s, r) => s + area(r), 0), `${w}x${h}`).toBe(w * h);
  }
});
