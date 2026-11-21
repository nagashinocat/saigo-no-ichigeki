import { test, expect } from 'vitest';
import { INTRO, createIntroTimeline, introBikes, bikeAt, introStreaks, streakAt, introCues, introHands, BIKE_CAM, whooshAt, introRunFeet } from '../../src/render/introTimeline.js';

const names = (tl) => tl.beats.map((b) => b.name);

test('導入の流れ（持ち主 15:55）: バイク → ありったけを → ライト → 解き放て → 隠れる → 手 → 白 → 最後の一撃', () => {
  const tl = createIntroTimeline();
  expect(names(tl)).toEqual(['bikes', 'cardA', 'light', 'cardB', 'hide', 'hands', 'white', 'title']);
  // 拍の境目はすき間なく続き、長さはブリーフの目安どおり
  const want = { bikes: 2.2, cardA: 1.3, light: 1.8, cardB: 1.3, hide: 2.2, hands: 2.5, white: 0.4 };
  let t = 0;
  for (const b of tl.beats) {
    expect(b.start).toBeCloseTo(t, 9);
    if (want[b.name] != null) expect(b.end - b.start, b.name).toBeCloseTo(want[b.name], 9);
    t = b.end;
  }
  expect(tl.beats.find((b) => b.name === 'cardA').text).toBe('ありったけを');
  expect(tl.beats.find((b) => b.name === 'cardB').text).toBe('解き放て');
  // 全体: 白が明けるまで 11.7 秒、そのあと題字と TAP START
  expect(tl.beat('title').start).toBeCloseTo(11.7, 9);
  expect(tl.total).toBeGreaterThan(13);
  expect(tl.total).toBeLessThan(14.5);
  expect(tl.total).toBeCloseTo(tl.beat('title').end, 9);
});

test('「最後の一撃」は 1 文字ずつ約 0.22 秒おきに生まれ、最後の文字のあとで TAP START が出る', () => {
  const tl = createIntroTimeline();
  expect(tl.chars.map((c) => c.ch).join('')).toBe('最後の一撃');
  const title = tl.beat('title');
  expect(tl.chars[0].t).toBeGreaterThan(title.start);
  expect(tl.chars[0].t).toBeLessThan(title.start + 0.4);
  for (let i = 1; i < tl.chars.length; i++) expect(tl.chars[i].t - tl.chars[i - 1].t).toBeCloseTo(INTRO.title.step, 9);
  expect(INTRO.title.step).toBeCloseTo(0.22, 9);
  const last = tl.chars[tl.chars.length - 1].t;
  expect(tl.buttonAt).toBeGreaterThan(last + 0.2);
  expect(tl.total).toBeGreaterThanOrEqual(tl.buttonAt + INTRO.title.buttonFade - 1e-9);
});

test('beatAt: 時刻から拍と拍の中の秒。前は最初の拍、後ろは題字の終わりのまま', () => {
  const tl = createIntroTimeline();
  expect(tl.beatAt(0)).toMatchObject({ name: 'bikes', local: 0 });
  expect(tl.beatAt(2.3)).toMatchObject({ name: 'cardA' });
  expect(tl.beatAt(2.3).local).toBeCloseTo(0.1, 9);
  expect(tl.beatAt(-1).name).toBe('bikes');
  expect(tl.beatAt(99)).toMatchObject({ name: 'title' });
  expect(tl.beatAt(99).local).toBeCloseTo(tl.beat('title').end - tl.beat('title').start, 9);
});

test('飛ばす: 1〜7 拍のどこでタップしても題字の終わり（TAP START が出ている）へ', () => {
  const tl = createIntroTimeline();
  expect(tl.skipTarget).toBeCloseTo(tl.total, 9);
  const end = tl.titleState(tl.skipTarget);
  expect(end.chars.every((c) => c.k === 1)).toBe(true);
  expect(end.button).toBe(1);
  // 途中は文字がまだ出ていない
  const mid = tl.titleState(tl.chars[2].t - 0.01);
  expect(mid.chars.filter((c) => c.k > 0).length).toBe(2);
  expect(mid.button).toBe(0);
});

test('リトライ: 導入を飛ばした短い題字だけ（音を鳴らす拍はない）', () => {
  const tl = createIntroTimeline({ short: true });
  expect(names(tl)).toEqual(['title']);
  expect(tl.beat('title').start).toBe(0);
  expect(tl.total).toBeLessThan(2.2);
  expect(tl.chars.map((c) => c.ch).join('')).toBe('最後の一撃');
  for (let i = 1; i < tl.chars.length; i++) expect(tl.chars[i].t).toBeGreaterThan(tl.chars[i - 1].t);
  expect(tl.titleState(tl.total).button).toBe(1);
});

test('バイク: 4〜7 台。どれも最初の拍の中でカメラの真上を通り、決まった種で毎回同じ', () => {
  const tl = createIntroTimeline();
  const bikes = introBikes();
  expect(bikes.length).toBeGreaterThanOrEqual(4);
  expect(bikes.length).toBeLessThanOrEqual(7);
  expect(introBikes()).toEqual(bikes);
  const b0 = tl.beat('bikes');
  for (const b of bikes) {
    expect(b.tp).toBeGreaterThan(b0.start + 0.2);
    expect(b.tp).toBeLessThan(b0.end);
    expect(b.v).toBeGreaterThan(60); // とても速い
    // 通る瞬間はカメラの上（高さはカメラより上）で、そのとき z はカメラと同じ
    const p = bikeAt(b, b.tp);
    expect(p.y).toBeGreaterThan(BIKE_CAM.pos[1] + 1);
    expect(p.z).toBeCloseTo(BIKE_CAM.pos[2], 6);
    // 前は奥（-z）、後ろは手前（+z）
    expect(bikeAt(b, b.tp - 0.5).z).toBeLessThan(BIKE_CAM.pos[2] - 20);
    expect(bikeAt(b, b.tp + 0.5).z).toBeGreaterThan(BIKE_CAM.pos[2] + 20);
  }
});

test('音は画面に合わせる（13:06）: 風切りの左右はバイクのいる側、いちばん大きいのは一番近づいた瞬間', () => {
  for (const b of introBikes()) {
    const at = (t) => whooshAt(b, t);
    // 通る少し前の左右は、画面のバイクのいる側（x の符号）
    const p = at(b.tp - 0.05);
    if (Math.abs(b.x) > 0.3) expect(Math.sign(p.pan), `bike ${b.id}`).toBe(Math.sign(b.x));
    // 大きさのいちばん大きい時刻は、一番近づいた瞬間（tp）
    let best = -1, bestT = 0;
    for (let t = b.tp - 0.8; t <= b.tp + 0.8; t += 0.005) { const g = at(t).gain; if (g > best) { best = g; bestT = t; } }
    expect(Math.abs(bestT - b.tp), `bike ${b.id}`).toBeLessThan(0.02);
    // ドップラー: 近づく間は高く、遠ざかると低い
    expect(at(b.tp - 0.3).rate).toBeGreaterThan(1.02);
    expect(at(b.tp + 0.3).rate).toBeLessThan(0.98);
    // 遠いと小さい
    expect(at(b.tp - 0.8).gain).toBeLessThan(best * 0.25);
  }
});

test('すき間の光の筋: 隠れる拍の中で開口部を横切り、風切りは横切る向きへ左右に流れる', () => {
  const tl = createIntroTimeline();
  const hide = tl.beat('hide');
  const ss = introStreaks();
  expect(ss.length).toBeGreaterThanOrEqual(3);
  for (const s of ss) {
    expect(s.t).toBeGreaterThan(0.6);
    expect(s.t).toBeLessThan(hide.end - hide.start);
    const before = streakAt(s, s.t - s.dur * 0.4), after = streakAt(s, s.t + s.dur * 0.4);
    expect(Math.sign(after.u - before.u)).toBe(s.dir);
    expect(Math.sign(before.pan)).toBe(-s.dir);
    expect(Math.sign(after.pan)).toBe(s.dir);
    expect(Math.abs(streakAt(s, s.t).pan)).toBeLessThan(0.05);
  }
});

test('合図: カードの叩きつけ・すくむ・足音・握り込む・白・各文字に音が乗る（時刻順）', () => {
  const tl = createIntroTimeline();
  const cues = introCues(tl);
  for (let i = 1; i < cues.length; i++) expect(cues[i].t).toBeGreaterThanOrEqual(cues[i - 1].t);
  const at = (name) => cues.filter((c) => c.name === name).map((c) => c.t);
  expect(at('slam')).toEqual([tl.beat('cardA').start, tl.beat('cardB').start]);
  expect(at('flinch').length).toBe(1);
  expect(at('flinch')[0]).toBeGreaterThan(tl.beat('light').start);
  expect(at('flinch')[0]).toBeLessThan(tl.beat('light').end);
  expect(at('step').length).toBeGreaterThanOrEqual(4);
  for (const t of at('step')) expect(t).toBeGreaterThanOrEqual(tl.beat('light').start);
  expect(at('grip')).toEqual([tl.beat('hands').start + INTRO.hands.releaseAt]);
  expect(at('white')).toEqual([tl.beat('white').start]);
  expect(at('char')).toEqual(tl.chars.map((c) => c.t));
  // 足音は走る脚の接地と同じ時刻
  const feet = introRunFeet(tl);
  expect(at('step')).toEqual(feet);
});

test('手の拍: 貯め始め（球が生まれ育つ）→ 最後の一撃を放つ瞬間（握り込む）', () => {
  const tl = createIntroTimeline();
  const len = tl.beat('hands').end - tl.beat('hands').start;
  const h = (t) => introHands(t);
  expect(h(0).level).toBeLessThan(0.1);
  expect(h(0.5).level).toBeGreaterThan(h(0.1).level);
  expect(h(INTRO.hands.releaseAt - 0.05).level).toBeGreaterThan(0.9);
  expect(h(INTRO.hands.releaseAt - 0.05).active).toBe(true);
  expect(h(INTRO.hands.releaseAt + 0.05).active).toBe(false);
  expect(INTRO.hands.releaseAt).toBeLessThan(len - 0.3); // 握り込みを見せてから白
});
