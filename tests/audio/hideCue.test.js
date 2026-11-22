import { test, expect } from 'vitest';
import { hideRecipe, HIDE_CUE } from '../../src/audio/cues.js';

// R1f（持ち主 18:14「派手でかっこいいアクション…短い効果音」）: 物陰へ跳ぶ音は短く（0.3 秒以内）、重なっても天井より十分下
test('R1f: 跳ぶ音（シュッ）と着地の音（トン）は短く、大きさは控えめ', () => {
  const j = hideRecipe('jump'), l = hideRecipe('land');
  expect(j.whoosh.length).toBe(2);
  for (const w of j.whoosh) expect((w.when ?? 0) + w.dur).toBeLessThanOrEqual(0.3);
  expect(j.whoosh.reduce((a, w) => a + w.gain, 0)).toBeLessThan(0.3);
  expect(l.thud.dur).toBeLessThanOrEqual(0.2);
  expect(l.thud.gain + l.grit.gain).toBeLessThan(0.3);
  expect(l.thud.f1).toBeLessThan(l.thud.f0); // 下がる一打
  expect(HIDE_CUE.thud.gain).toBe(l.thud.gain);
});
