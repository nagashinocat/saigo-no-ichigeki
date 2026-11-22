import { test, expect } from 'vitest';
import { puffButtonRect, powerText, armyText, comboText, comboPos, BOSS_TEXT, powerPct, powerStage, gaugeRect, pctRect, lostText, SHORT_TEXT, shortPos } from '../../src/ui/hud.js';
import { clearThreshold } from '../../src/game/charge.js';
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

// R1b（持ち主 08:24「力のパーセントをもう少しわかりやすくしよう」）: 大きな数字と、手の帯の上の太いゲージ（撃退ラインの目盛り）
test('R1b: 大きな数字は切り捨ての整数。段は 撃退ライン未満 low（琥珀）・以上 ready（白熱）・満タン full（脈打つ）', () => {
  const L = clearThreshold();
  expect(powerPct(0, 100)).toBe(0);
  expect(powerPct(41.9, 100)).toBe(41);
  expect(powerPct(150, 100)).toBe(100);
  expect(powerStage(30, 100, L)).toBe('low');
  expect(powerStage(90, 100, L)).toBe('low');
  expect(powerStage(98, 100, L)).toBe('low'); // 約 98.6% の手前
  expect(powerStage(L, 100, L)).toBe('ready');
  expect(powerStage(99.5, 100, L)).toBe('ready');
  expect(powerStage(100, 100, L)).toBe('full');
});

test('R1b: 手の帯の上端の一列に、左に大きな数字、その右に太いゲージ（10px 以上、帯の幅の半分以上）。上の HUD の帯とも、払うのボタンとも重ならない', () => {
  for (const [w, h] of [[390, 844], [360, 640], [320, 480], [1280, 720], [844, 390]]) {
    const l = layoutViews(w, h);
    const handTop = h - l.hand.y - l.hand.h;
    const g = gaugeRect(l, h), n = pctRect(l, h);
    expect(n.fontSize, `${w}x${h}`).toBeGreaterThanOrEqual(30); // 前の「力 N%」（最大 30px）より大きい
    expect(n.top).toBeGreaterThanOrEqual(handTop);
    // 両手の指先より上の、手の帯の上の方に収まる
    expect(n.top + n.fontSize, `${w}x${h}`).toBeLessThanOrEqual(handTop + Math.max(56, l.hand.h * 0.2));
    expect(n.top).toBeGreaterThan(h - l.hud.y); // 上の HUD の帯（残り時間・街の軍勢）より下
    expect(g.height, `${w}x${h}`).toBeGreaterThanOrEqual(10);
    expect(g.left).toBeGreaterThanOrEqual(n.left + n.width);
    expect(g.left + g.width).toBeLessThanOrEqual(l.hand.x + l.hand.w);
    expect(g.width, `${w}x${h}`).toBeGreaterThan(l.hand.w * 0.5);
    expect(Math.abs(g.top + g.height / 2 - (n.top + n.fontSize / 2))).toBeLessThanOrEqual(n.fontSize * 0.25); // 数字と同じ高さ
    const r = puffButtonRect(l, h);
    expect(g.top + g.height + 30).toBeLessThan(r.top); // 目盛りの文字の下も、ボタンより上
  }
});

test('R1b: 吸われた量の「−N」と、足りないときの「足りない」', () => {
  expect(lostText(0.4)).toBe('−0.4');
  expect(lostText(7.25)).toBe('−7.3');
  expect(lostText(12.6)).toBe('−13');
  expect(SHORT_TEXT).toBe('足りない');
  // 「足りない」は押した所のすぐ上、画面の内
  const l = layoutViews(390, 844);
  const p = shortPos(l, 844, 350, 820);
  expect(p.y).toBeLessThan(820);
  expect(p.x).toBeLessThanOrEqual(390 - 30);
  expect(p.y).toBeGreaterThan(0);
});

// R1b fix1（レビュー Important 1）: 吸われている間はゲージも赤紫に脈打つ（数字だけでなく）。ゲージの上の赤紫の層の不透明度は
// --drain（index.html の .hud-pulse が var(--drain) で読む）。DOM は無いので、hud が使う分だけの小さな偽物で確かめる
function fakeRoot() {
  const els = new Map();
  const make = () => {
    const style = { setProperty(k, v) { style[k] = v; }, getPropertyValue(k) { return style[k] ?? ''; } };
    const cls = new Set();
    return {
      style, textContent: '', offsetWidth: 0,
      classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
      setAttribute() {}, addEventListener() {},
      querySelector: (sel) => get(sel),
    };
  };
  const get = (sel) => { if (!els.has(sel)) els.set(sel, make()); return els.get(sel); };
  const root = make();
  let html = '';
  Object.defineProperty(root, 'innerHTML', { get: () => html, set: (v) => { html = v; } });
  return { root, get };
}

test('R1b fix1: 吸われている間はゲージの赤紫の層（--drain）が 0 より大きく脈打ち、吸われていなければ 0。CSS がそれを読む', async () => {
  const { createHud } = await import('../../src/ui/hud.js');
  const { createDrainFx } = await import('../../src/ui/drainFx.js');
  const { readFileSync } = await import('node:fs');
  const { root, get } = fakeRoot();
  const hud = createHud(root, { threshold: 98.6 });
  expect(root.innerHTML).toContain('hud-pulse');
  const css = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  expect(css).toMatch(/\.hud-pulse\s*\{[^}]*opacity:\s*var\(--drain\)/);
  const gauge = get('.hud-gauge');
  const base = { remaining: 30, power: 60, max: 100, canPuff: true, alive: 50, dt: 1 / 60 };
  hud.update({ ...base, drain: null });
  expect(Number(gauge.style.getPropertyValue('--drain'))).toBe(0);
  // 6 人に掴まれた: 脈打ちの 1 周（2.6 Hz 以下）の間、ゲージの層はいつも 0 より大きく、山と谷がある
  const fx = createDrainFx();
  const seen = [];
  for (let i = 0; i < 60; i++) {
    const d = fx.update(1 / 60, { load: 6, drained: 0.1 });
    hud.update({ ...base, drain: d });
    seen.push(Number(gauge.style.getPropertyValue('--drain')));
  }
  const tail = seen.slice(20);
  expect(Math.min(...tail)).toBeGreaterThan(0);
  expect(Math.max(...tail)).toBeGreaterThan(0.6);
  expect(Math.max(...tail) - Math.min(...tail)).toBeGreaterThan(0.3);
  // はがれたら 0 へ
  for (let i = 0; i < 30; i++) hud.update({ ...base, drain: fx.update(1 / 60, { load: 0, drained: 0 }) });
  expect(Number(gauge.style.getPropertyValue('--drain'))).toBe(0);
  hud.update({ ...base, drain: null });
  expect(Number(gauge.style.getPropertyValue('--drain'))).toBe(0);
});
