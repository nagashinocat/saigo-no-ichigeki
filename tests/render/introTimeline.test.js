import { test, expect } from 'vitest';
import { heroPan, heroPath, INTRO, createIntroTimeline, introBikes, bikeAt, introStreaks, streakAt, introCues, introHands, BIKE_CAM, whooshAt, introRunFeet } from '../../src/render/introTimeline.js';

const names = (tl) => tl.beats.map((b) => b.name);

test('導入の流れ（持ち主 15:55）: バイク → ありったけを → ライト → 解き放て → 隠れる → 手 → 白 → 最後の一撃', () => {
  const tl = createIntroTimeline();
  expect(names(tl)).toEqual(['bikes', 'cardA', 'light', 'cardB', 'hide', 'orb', 'hands', 'white', 'title']);
  // 拍の境目はすき間なく続き、長さはブリーフの目安どおり
  const want = { bikes: 2.2, cardA: 1.7, light: 2.4, cardB: 1.7, hide: 2.2, orb: 0.75, hands: 2.5, white: 0.4 };
  let t = 0;
  for (const b of tl.beats) {
    expect(b.start).toBeCloseTo(t, 9);
    if (want[b.name] != null) expect(b.end - b.start, b.name).toBeCloseTo(want[b.name], 9);
    t = b.end;
  }
  expect(tl.beats.find((b) => b.name === 'cardA').text).toBe('ありったけを');
  expect(tl.beats.find((b) => b.name === 'cardB').text).toBe('解き放て');
  // 全体: 白が明けるまで 13.85 秒（持ち主 18:04 のスポットライトで +0.6、19:04 のカードの真っ黒と球の浮き上がりで +1.55）、
  // そのあと題字と TAP START
  expect(tl.beat('title').start).toBeCloseTo(13.85, 9);
  expect(tl.total).toBeLessThan(14.33 + 1.6);
  // カード: 最初の INTRO.card.black 秒は真っ黒
  expect(INTRO.card.black).toBeGreaterThanOrEqual(0.4);
  expect(INTRO.card.black).toBeLessThanOrEqual(0.6);
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
  expect(bikes.filter((b) => b.hero).length).toBe(1);
  const b0 = tl.beat('bikes');
  for (const b of bikes) {
    expect(b.tp).toBeGreaterThan(b0.start + 0.2);
    expect(b.tp).toBeLessThan(b0.end);
    // とても速い。見せ場の一台だけはゆっくりめ（それでも 120 km/h 超）で、レンズのすぐ上を通る
    if (b.hero) { expect(b.v).toBeGreaterThan(30); expect(b.y - BIKE_CAM.pos[1]).toBeLessThan(2); } else expect(b.v).toBeGreaterThan(60);
    // 通る瞬間はカメラの上（高さはカメラより上）で、そのとき z はカメラと同じ
    const p = bikeAt(b, b.tp);
    expect(p.y).toBeGreaterThan(BIKE_CAM.pos[1] + 1);
    expect(p.z).toBeCloseTo(BIKE_CAM.pos[2], 6);
    // 前は奥（-z）、後ろは手前（+z）
    const w = b.hero ? 0.7 : 0.5;
    expect(bikeAt(b, b.tp - w).z).toBeLessThan(BIKE_CAM.pos[2] - 20);
    expect(bikeAt(b, b.tp + w).z).toBeGreaterThan(BIKE_CAM.pos[2] + 20);
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

test('合図: すくむ・足音・握り込む（組んだ手が初めて映るコマ）・白（時刻順）。スポットライト（19:05）と文字の拍（カード・題字の各文字）には効果音を乗せない（持ち主 18:02）', () => {
  const tl = createIntroTimeline();
  const cues = introCues(tl);
  for (let i = 1; i < cues.length; i++) expect(cues[i].t).toBeGreaterThanOrEqual(cues[i - 1].t);
  const at = (name) => cues.filter((c) => c.name === name).map((c) => c.t);
  expect(at('slam')).toEqual([]);
  expect(at('char')).toEqual([]);
  for (const c of cues) for (const n of ['cardA', 'cardB', 'title']) {
    const B = tl.beat(n);
    expect(c.t >= B.start && c.t < B.end, `${c.name} at ${c.t} in ${n}`).toBe(false);
  }
  // スポットライトには音をつけない（持ち主 19:05）。白と題字も無音
  expect(at('lock')).toEqual([]);
  expect(at('flinch').length).toBe(1);
  expect(at('flinch')[0]).toBeGreaterThan(tl.beat('light').start);
  expect(at('flinch')[0]).toBeLessThan(tl.beat('light').end);
  expect(at('step').length).toBeGreaterThanOrEqual(4);
  for (const t of at('step')) expect(t).toBeGreaterThanOrEqual(tl.beat('light').start);
  expect(at('grip')).toEqual([tl.beat('hands').start + INTRO.hands.releaseAt + INTRO.hands.clampFrame]);
  expect(at('white')).toEqual([tl.beat('white').start]);
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

test('足音の左右は主人公の画面の位置から: ライトの拍では右へ走り去り、すき間では左の壁へ駆け込む', () => {
  const tl = createIntroTimeline();
  const feet = introRunFeet(tl);
  const light = feet.filter((t) => t < tl.beat('light').end), hide = feet.filter((t) => t >= tl.beat('hide').start);
  // 走り去るにつれて右へ流れる
  expect(heroPan(tl, light[light.length - 1])).toBeGreaterThan(heroPan(tl, light[0]));
  expect(heroPan(tl, light[light.length - 1])).toBeGreaterThan(0.2);
  // すき間の最後の足音は左（主人公は左の壁へ）
  expect(heroPan(tl, hide[hide.length - 1])).toBeLessThan(0);
  expect(heroPath('hide', 5)).toMatchObject({ x: expect.any(Number) });
});

test('スポットライト（持ち主 18:04）: 一台ずつ飛び込んできて主人公を捉え、捉える音はそのバイクの画面の左右から', async () => {
  const { LIGHT_BIKES, lightBikeAt, lightBikePan } = await import('../../src/render/introTimeline.js');
  const tl = createIntroTimeline();
  const len = tl.beat('light').dur;
  // 捉える前は捉えておらず、捉えたあとは捉えたまま。捉えた数は 1 から増えていく
  const count = (t) => LIGHT_BIKES.filter((b) => lightBikeAt(b, t).lock > 0.99).length;
  expect(count(LIGHT_BIKES[0].lockAt + 0.1)).toBe(1);
  expect(count(INTRO.light.flinchAt)).toBe(LIGHT_BIKES.length);
  let prev = 0;
  for (let t = 0; t < len; t += 0.02) { const c = count(t); expect(c).toBeGreaterThanOrEqual(prev); prev = c; }
  // 左右: 画面の右のバイクは右、左は左
  for (const b of LIGHT_BIKES) if (Math.abs(b.pos[0]) > 3) expect(Math.sign(lightBikePan(b, b.lockAt)), `${b.id}`).toBe(Math.sign(b.pos[0]));
});
