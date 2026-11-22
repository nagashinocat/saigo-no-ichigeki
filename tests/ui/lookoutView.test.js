import { test, expect } from 'vitest';
import { textOffset, LOOKOUT_TEXT, TEXT_PX } from '../../src/ui/lookoutView.js';

// R1e（持ち主 16:55）: 「LOOK OUT!」の字は、矢印（シュッの向き）の反対の側に置き、矢印と重ねない。矢印が無ければ主人公の真上
test('R1e: LOOK OUT! の字は矢印の反対の側（矢印が無ければ真上）', () => {
  expect(LOOKOUT_TEXT).toBe('LOOK OUT!');
  expect(textOffset(null)).toEqual({ x: 0, y: -TEXT_PX });
  const up = textOffset(-90); // 矢印が上 → 字は下
  expect(up.y).toBeGreaterThan(0);
  const right = textOffset(0); // 矢印が右 → 字は左
  expect(right.x).toBeLessThan(0);
  const dl = textOffset(135); // 矢印が左下 → 字は右上
  expect(dl.x).toBeGreaterThan(0);
  expect(dl.y).toBeLessThan(0);
});

// R1f（持ち主 18:14「LOOK OUT!の矢印をタップ」）: 矢印は大きく押しやすい当たり（72×72 CSS px 以上の丸）。物陰の向きの、主人公から少し離れた所に置き、
// 画面の内に収める（端では内へ寄せる）。当たりの中のタップで隠れる
import { arrowTarget, HIT_R, ARROW_R } from '../../src/ui/lookoutView.js';
test('R1f: 矢印の当たりは 72 px 四方以上の丸で、物陰の向きに置き、画面の内に収まる', () => {
  expect(2 * HIT_R).toBeGreaterThanOrEqual(72);
  const view = { w: 390, h: 844 };
  const t = arrowTarget({ sx: 195, sy: 500 }, 0, view);
  expect(t.cx).toBeCloseTo(195 + ARROW_R, 6); expect(t.cy).toBeCloseTo(500, 6);
  expect(t.r).toBe(HIT_R);
  const down = arrowTarget({ sx: 195, sy: 500 }, 90, view);
  expect(down.cy).toBeGreaterThan(500);
  // 画面の端: どの向き・どの位置でも、丸は画面の内
  for (const at of [{ sx: 5, sy: 5 }, { sx: 385, sy: 840 }, { sx: 195, sy: 422 }, { sx: 380, sy: 30 }]) {
    for (let deg = -180; deg < 180; deg += 15) {
      const q = arrowTarget(at, deg, view);
      expect(q.cx - q.r).toBeGreaterThanOrEqual(0); expect(q.cx + q.r).toBeLessThanOrEqual(view.w);
      expect(q.cy - q.r).toBeGreaterThanOrEqual(0); expect(q.cy + q.r).toBeLessThanOrEqual(view.h);
    }
  }
  expect(arrowTarget({ sx: 1, sy: 1 }, null, view)).toBeNull();
});

test('R1f: hit は出ている矢印の当たりの内だけ true（矢印が無い・出ていないときは false）', async () => {
  const { createLookoutView } = await import('../../src/ui/lookoutView.js');
  const mk = () => ({ hidden: true, style: {}, classList: { add() {}, remove() {} }, offsetWidth: 0, textContent: '' });
  const parts = { '.lo-text': mk(), '.lo-arrow': mk(), '.lo-hit': mk() };
  const el = { ...mk(), querySelector: (k) => parts[k] ?? null };
  const v = createLookoutView(el, { view: () => ({ w: 390, h: 844 }) });
  expect(v.hit(250, 500)).toBe(false);
  v.update({ show: true, deg: 0 }, { sx: 195, sy: 500 });
  const t = arrowTarget({ sx: 195, sy: 500 }, 0, { w: 390, h: 844 });
  expect(v.hit(t.cx, t.cy)).toBe(true);
  expect(v.hit(t.cx + t.r - 1, t.cy)).toBe(true);
  expect(v.hit(t.cx + t.r + 2, t.cy)).toBe(false);
  expect(v.hit(195, 500)).toBe(false); // 主人公の上は当たりの外（払う）
  v.update({ show: true, deg: null }, { sx: 195, sy: 500 });
  expect(v.hit(t.cx, t.cy)).toBe(false);
  v.update({ show: false }, null);
  expect(v.hit(t.cx, t.cy)).toBe(false);
  expect(el.hidden).toBe(true);
});
