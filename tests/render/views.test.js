import { test, expect } from 'vitest';
import { layoutViews } from '../../src/render/views.js';

const SIZES = [[390, 844], [1280, 720], [375, 667], [768, 1024], [1024, 768], [1920, 1080], [333, 333], [801, 451], [1, 1], [2, 3]];

const area = (r) => r.w * r.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

for (const [w, h] of [[390, 844], [1280, 720]]) {
  test(`${w}x${h}: 街が上 65%（全幅）、手が下 35%（全幅）`, () => {
    const l = layoutViews(w, h);
    // 左下原点なので、上側は y が大きい側
    expect(l.city).toEqual({ x: 0, y: h - Math.round(h * 0.65), w, h: Math.round(h * 0.65) });
    expect(l.hand).toEqual({ x: 0, y: 0, w, h: h - Math.round(h * 0.65) });
  });

  test(`${w}x${h}: HUD は街の画面の上端の帯に重なる（別の区画を持たない）`, () => {
    const l = layoutViews(w, h);
    expect(inside(l.hud, l.city)).toBe(true);
    expect(l.hud).toMatchObject({ x: 0, w });
    expect(l.hud.y + l.hud.h).toBe(h);
    expect(l.hud.h).toBeGreaterThan(0);
    expect(l.hud.h).toBeLessThan(l.city.h * 0.25);
  });
}

test('どの大きさでも街と手の Rect は重ならず画面を埋め、HUD の帯は街の中にある', () => {
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
    expect(overlap(l.city, l.hand), `${w}x${h}`).toBe(false);
    expect(area(l.city) + area(l.hand), `${w}x${h}`).toBe(w * h);
    expect(inside(l.hud, l.city), `${w}x${h} hud`).toBe(true);
  }
});
