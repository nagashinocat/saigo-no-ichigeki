import { test, expect } from 'vitest';
import { puffButtonRect, powerText, armyText } from '../../src/ui/hud.js';
import { layoutViews } from '../../src/render/views.js';

const inHandStrip = (r, layout, H) => {
  const top = H - layout.hand.y - layout.hand.h; // 手の帯の上端（上からの px）
  return r.left >= layout.hand.x && r.left + r.size <= layout.hand.x + layout.hand.w && r.top >= top && r.top + r.size <= H;
};

test('小爆発のボタンは手の帯の右下にあり、指で押せる大きさ（44px 以上）', () => {
  for (const [w, h] of [[390, 844], [360, 640], [320, 480], [1280, 720], [844, 390]]) {
    const l = layoutViews(w, h);
    const r = puffButtonRect(l, h);
    expect(r.size, `${w}x${h}`).toBeGreaterThanOrEqual(44);
    expect(inHandStrip(r, l, h), `${w}x${h}`).toBe(true);
    // 右下の四分の一（両手と球のある真ん中をふさがない）
    expect(r.left + r.size / 2).toBeGreaterThan(w * 0.75);
    expect(r.top + r.size / 2).toBeGreaterThan(h - l.hand.h / 2);
  }
});

test('貯めた力の文言は上限に対する割合（切り捨て）', () => {
  expect(powerText(0, 100)).toBe('力 0%');
  expect(powerText(41.9, 100)).toBe('力 41%');
  expect(powerText(100, 100)).toBe('力 100%');
  expect(powerText(150, 100)).toBe('力 100%');
});

test('S9: 街の軍勢の数（全員倒せばクリア。見回る者を含めた、生きている者の数）', () => {
  expect(armyText(95)).toBe('街の軍勢 95');
  expect(armyText(0)).toBe('街の軍勢 0');
});
