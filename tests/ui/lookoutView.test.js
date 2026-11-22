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
