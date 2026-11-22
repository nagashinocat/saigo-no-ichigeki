import { test, expect } from 'vitest';
import { puffButtonRect, powerText, armyText, comboText, comboPos, BOSS_TEXT } from '../../src/ui/hud.js';
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

// R1（spec §15 払うの腕前・大物）
test('R1: まとめて払った「×k」の文言。大物の知らせは「大物が来る」', () => {
  expect(comboText(3)).toBe('×3');
  expect(comboText(12)).toBe('×12');
  expect(BOSS_TEXT).toBe('大物が来る');
});

test('R1: 「×k」は主人公の少し上（群がる軍勢に重ねない）で、どの画面でも街の画面の内', () => {
  for (const [w, h] of [[390, 844], [360, 640], [1280, 720], [844, 390]]) {
    const l = layoutViews(w, h);
    const top = h - l.city.y - l.city.h, bottom = h - l.city.y;
    const sx = l.city.x + l.city.w / 2, sy = top + l.city.h / 2; // 主人公は上空の画面の真ん中ほど
    const p = comboPos(l, h, sx, sy);
    expect(p.y, `${w}x${h}`).toBeLessThan(sy - 40);
    expect(p.y).toBeGreaterThan(top);
    expect(p.x).toBeCloseTo(sx, 6);
    // 画面の外の主人公でも、街の画面の内へ寄せる
    const q = comboPos(l, h, -500, h * 3);
    expect(q.x).toBeGreaterThanOrEqual(l.city.x);
    expect(q.y).toBeLessThanOrEqual(bottom);
  }
});
