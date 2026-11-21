import { test, expect } from 'vitest';
import { introMusicPlan, INTRO_MUSIC } from '../../src/audio/introMusic.js';
import { createIntroTimeline, INTRO } from '../../src/render/introTimeline.js';
import { levelFor } from '../../src/audio/bgmScore.js';

// 持ち主 18:02「BGM の一番盛り上がるやつ」/ 18:07「BGM は力を放つタイミングで止めて」
test('導入の音楽: BGM の最高潮（層 4）を導入の 0 秒から、力を放つ瞬間（握り込む）の小節の頭でぴたりと止める', () => {
  const tl = createIntroTimeline();
  const p = introMusicPlan(tl);
  const release = tl.beat('hands').start + INTRO.hands.releaseAt;
  const cut = release + INTRO.hands.clampFrame; // 組んだ手が初めて映るコマ
  expect(Math.abs(release * 30 - Math.round(release * 30))).toBeLessThan(1e-6); // 放つ瞬間も止める所も録画のコマの頭
  expect(Math.abs(cut * 30 - Math.round(cut * 30))).toBeLessThan(1e-6);
  expect(p.cut).toBeCloseTo(cut, 9);
  // 最高潮の層（残り 10 秒の層 3 に長押しの +1）
  expect(levelFor(INTRO_MUSIC.cond)).toBe(4);
  // ゲームの最高潮と同じテンポ 116。小節の途中から入り（曲の頭は 0 秒より前）、0 秒から鳴る。止める瞬間はちょうど小節の頭
  expect(p.tempo).toBe(116);
  expect(p.start).toBeLessThan(0);
  expect(p.events[0].t).toBeGreaterThanOrEqual(0);
  expect(p.events[0].t).toBeLessThan(0.3);
  expect(Math.max(...p.events.map((e) => e.t))).toBeLessThan(cut);
  expect(((cut - p.start) / p.barSec) % 1).toBeCloseTo(0, 6);
  // 毎小節のフィル（最高潮）があり、テンポはゲームの範囲（84〜120 前後）
  expect(p.events.filter((e) => e.role === 'fill').length).toBeGreaterThanOrEqual((p.bars - 1) * 5);
  // 毎回同じ（録画とライブが同じ音）
  expect(introMusicPlan(tl).events).toEqual(p.events);
  // 白と題字には何も鳴らない
  expect(p.events.some((e) => e.t >= tl.beat('white').start)).toBe(false);
});
