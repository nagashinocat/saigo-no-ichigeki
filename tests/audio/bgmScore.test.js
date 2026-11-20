import { test, expect } from 'vitest';
import {
  intensityAt, levelFor, tempoFor, nextTempo, degreeRate, createSequencer, stretchWarp, MELODY, QUIET_TEMPO,
} from '../../src/audio/bgmScore.js';

const cond = (elapsed, power = 0, holding = false) => ({ elapsed, power, holding });
const run = (seq, until, c) => seq.advance(until, typeof c === 'function' ? c : () => c);

test('強さは時間とともに上がり、貯めた力でも上がる（0〜1）', () => {
  expect(intensityAt(0, 0)).toBe(0);
  expect(intensityAt(15, 0)).toBeCloseTo(0.25);
  expect(intensityAt(40, 0)).toBeCloseTo(0.6);
  expect(intensityAt(60, 0)).toBeCloseTo(1);
  expect(intensityAt(20, 1)).toBeGreaterThan(intensityAt(20, 0));
  expect(intensityAt(60, 1)).toBe(1);
  for (let t = 0; t < 60; t += 0.5) expect(intensityAt(t + 0.5, 0.3)).toBeGreaterThanOrEqual(intensityAt(t, 0.3));
});

test('層: 0〜15 秒は 0、15〜40 秒は 1、40 秒〜は 2、残り 10 秒は最高潮の 3。長押しの間は一段上', () => {
  expect(levelFor(cond(5))).toBe(0);
  expect(levelFor(cond(20))).toBe(1);
  expect(levelFor(cond(45))).toBe(2);
  expect(levelFor(cond(50))).toBe(3);
  expect(levelFor(cond(59))).toBe(3);
  expect(levelFor(cond(5, 0, true))).toBe(1);
  expect(levelFor(cond(55, 0, true))).toBe(4);
  // 力をたくさん貯めると、時間より早く層が増える
  expect(levelFor(cond(30, 1))).toBe(2);
});

test('テンポは強さで上がり、一小節ごとに少しずつしか変わらない', () => {
  expect(tempoFor(0)).toBeLessThan(tempoFor(0.5));
  expect(tempoFor(1)).toBeGreaterThan(tempoFor(0) * 1.25);
  expect(nextTempo(84, 116)).toBeCloseTo(87);
  expect(nextTempo(100, 99)).toBeCloseTo(99);
});

test('音程: 五音の音階の度数から再生の速さ（D4 が 1、1 オクターブで 2 倍）', () => {
  expect(degreeRate(5)).toBeCloseTo(1);
  expect(degreeRate(10)).toBeCloseTo(2);
  expect(degreeRate(0)).toBeCloseTo(0.5);
  expect(degreeRate(1)).toBeCloseTo(0.5 * 2 ** (3 / 12)); // F3（短三度）
  expect(degreeRate(-1)).toBeCloseTo(0.5 * 2 ** (-2 / 12)); // C3
});

test('旋律は 8 小節で、音はみな 12 刻みの中にあり、ほぼ 1 オクターブ半に収まる', () => {
  expect(MELODY.length).toBe(8);
  for (const bar of MELODY) for (const [p, d] of bar) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(12); expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(10); }
});

test('拍と小節の時刻: 小節は 4 拍・12 刻み。テンポは小節の頭でだけ変わり、拍の長さは小節の中で一定', () => {
  const seq = createSequencer({ start: 1 });
  const ev = run(seq, 40, (t) => cond(t * 3, 0)); // 時間がどんどん進む（テンポが上がり続ける）
  const bars = seq.history; // [{ bar, t, tempo, level }]
  expect(bars[0].t).toBeCloseTo(1);
  for (let i = 1; i < bars.length; i++) {
    const beat = 60 / bars[i - 1].tempo;
    expect(bars[i].t - bars[i - 1].t).toBeCloseTo(4 * beat, 6);
    expect(Math.abs(bars[i].tempo - bars[i - 1].tempo)).toBeLessThanOrEqual(3 + 1e-9);
  }
  expect(bars.at(-1).tempo).toBeGreaterThan(bars[0].tempo);
  // すべての音は刻み（小節頭 + 刻み × n、フィルは半分の刻み）に乗る
  for (const e of ev) {
    const b = [...bars].reverse().find((x) => x.t <= e.t + 1e-9);
    const step = 60 / b.tempo / 6;
    const k = (e.t - b.t) / step;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
  }
  // 時刻順。作るのは until より前に始まる拍まで（音はその拍の終わりより前）
  for (let i = 1; i < ev.length; i++) expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t - 1e-9);
  expect(bars.at(-1).t).toBeLessThan(40);
  expect(ev.at(-1).t).toBeLessThan(40 + 60 / bars.at(-1).tempo);
});

test('先読み: advance を細かく刻んでも一度に進めても、同じ音が同じ時刻に鳴る', () => {
  const a = createSequencer({ start: 0 }), b = createSequencer({ start: 0 });
  const c = () => cond(20, 0.4);
  const all = run(a, 12, c);
  const parts = [];
  for (let t = 0.05; t <= 12; t += 0.05) parts.push(...run(b, t, c));
  parts.push(...run(b, 12, c));
  expect(parts.map((e) => [e.voice, e.t.toFixed(6)])).toEqual(all.map((e) => [e.voice, e.t.toFixed(6)]));
});

const voicesIn = (ev) => new Set(ev.map((e) => e.voice));
const barEvents = (level, holding = false, bars = 4) => {
  const elapsed = [5, 20, 45, 55][level];
  const seq = createSequencer({ start: 0 });
  return run(seq, bars * 4 * 60 / 60, cond(elapsed, 0, holding));
};

test('層の選び方: 0 は低い太鼓とマリンバだけ、1 で高い太鼓とシェイカー、2 で木と深い太鼓とフィル', () => {
  const l0 = voicesIn(barEvents(0));
  expect(l0).toEqual(new Set(['low', 'marimba']));
  const l1 = voicesIn(barEvents(1));
  for (const v of ['low', 'marimba', 'slap', 'shaker']) expect(l1.has(v)).toBe(true);
  expect(l1.has('wood')).toBe(false);
  const l2 = voicesIn(barEvents(2, false, 8));
  for (const v of ['wood', 'deep', 'tone']) expect(l2.has(v)).toBe(true);
});

test('音の数は層とともに増え、最高潮がいちばん多く大きい。長押しでさらに増える', () => {
  const perSec = (ev) => ev.length / (ev.at(-1).t - ev[0].t);
  const loud = (ev) => ev.reduce((s, e) => s + e.gain, 0) / (ev.at(-1).t - ev[0].t);
  const n = [0, 1, 2, 3].map((l) => barEvents(l, false, 8));
  for (let i = 1; i < 4; i++) { expect(perSec(n[i])).toBeGreaterThan(perSec(n[i - 1])); expect(loud(n[i])).toBeGreaterThan(loud(n[i - 1])); }
  expect(perSec(barEvents(3, true, 8))).toBeGreaterThan(perSec(n[3]));
});

test('長押しの層は拍の頭で切り替わる（拍の途中では切らない）', () => {
  const seq = createSequencer({ start: 0 });
  let holding = false;
  const ev = [];
  // 0.37 秒ごとに advance し、2.0 秒で押しはじめる
  for (let t = 0.1; t < 8; t += 0.37) { if (t > 2) holding = true; ev.push(...seq.advance(t, () => cond(5, 0, holding))); }
  const firstSlap = ev.find((e) => e.voice === 'slap' || e.voice === 'shaker');
  expect(firstSlap).toBeTruthy();
  const beat = 60 / seq.history[0].tempo;
  const k = firstSlap.t / beat;
  // 層が上がって初めて鳴る音は、ある拍の中にあり、その拍は押しはじめたあとに先読みされた拍
  const beatStart = Math.floor(k + 1e-9) * beat;
  expect(beatStart).toBeGreaterThan(2 - 0.37 - 1e-9);
});

test('フィル: 層 2 は 4 小節に 1 回、最高潮は 2 小節に 1 回、最後の拍が細かい連打になる', () => {
  const fills = (level) => {
    const seq = createSequencer({ start: 0 });
    const ev = run(seq, 60, cond([5, 20, 45, 55][level]));
    const bars = seq.history;
    return bars.filter((b, i) => {
      const t0 = b.t, t1 = bars[i + 1]?.t ?? Infinity, step = 60 / b.tempo / 6;
      return ev.some((e) => e.voice === 'slap' && e.t > t0 && e.t < t1 && Math.round((e.t - t0) / step) % 2 === 1);
    }).map((b) => b.bar);
  };
  const f2 = fills(2), f3 = fills(3);
  expect(f2.length).toBeGreaterThan(0);
  for (const b of f2) expect(b % 4).toBe(3);
  expect(f3.length).toBeGreaterThan(f2.length);
  for (const b of f3) expect(b % 2).toBe(1);
});

test('静かな変奏: 同じ旋律を、ゆっくり、柔らかいマリンバで、小さく', () => {
  const seq = createSequencer({ start: 0 });
  const play = run(seq, 20, cond(45));
  const q = createSequencer({ start: 0, mode: 'quiet' });
  const quiet = run(q, 40, cond(0));
  expect(q.history[0].tempo).toBe(QUIET_TEMPO);
  expect(QUIET_TEMPO).toBeLessThan(tempoFor(0));
  const mel = quiet.filter((e) => e.voice === 'marimbaSoft' && e.role === 'melody');
  // 一小節目の旋律の音程は MELODY[0] と同じ順
  const beat = 60 / QUIET_TEMPO;
  const bar0 = mel.filter((e) => e.t < 4 * beat - 1e-9).map((e) => e.rate);
  expect(bar0).toEqual(MELODY[0].map(([, d]) => degreeRate(d)));
  expect(voicesIn(quiet).has('slap')).toBe(false);
  expect(voicesIn(quiet).has('marimba')).toBe(false);
  const loud = (ev, dur) => ev.reduce((s, e) => s + e.gain, 0) / dur;
  expect(loud(quiet, 40)).toBeLessThan(loud(play, 20) * 0.25);
});

test('途中から静かな変奏へ: 指定の時刻から一小節目として始め直す', () => {
  const seq = createSequencer({ start: 0 });
  run(seq, 5, cond(30));
  seq.setMode('quiet', 7.25);
  const ev = run(seq, 20, cond(0));
  expect(ev[0].t).toBeCloseTo(7.25);
  expect(seq.history.at(-1).mode).toBe('quiet');
  const firstQuiet = seq.history.find((b) => b.mode === 'quiet');
  expect(firstQuiet.bar).toBe(0);
  expect(firstQuiet.t).toBeCloseTo(7.25);
});

test('引き伸ばし: 音程（再生の速さ）が下がりながら間隔が開き、渦のように左右を回り、sec 秒で消える', () => {
  const w = stretchWarp(3);
  expect(w.time(0)).toBeCloseTo(0);
  expect(w.rate(0)).toBeCloseTo(1);
  expect(w.rate(3)).toBeLessThan(0.2);
  // 曲の中の時間が等しく進むほど、実際の時間は長くかかる
  expect(w.time(0.6) - w.time(0.3)).toBeGreaterThan(w.time(0.3) - w.time(0));
  expect(w.fade(3)).toBe(0);
  expect(w.cutoff(3)).toBeLessThan(w.cutoff(0) / 10);

  const seq = createSequencer({ start: 0 });
  run(seq, 10, cond(52));
  seq.stretch(10, 3);
  const ev = run(seq, 20, cond(52));
  expect(ev.length).toBeGreaterThan(3);
  expect(ev.every((e) => e.t >= 10 - 1e-9 && e.t < 13)).toBe(true);
  // 時刻とともに音程が下がり、音量が下がる
  for (let i = 1; i < ev.length; i++) {
    const a = ev[i - 1], b = ev[i];
    if (b.t > a.t + 1e-6) expect(b.stretch).toBeLessThan(a.stretch);
  }
  const lateGain = ev.filter((e) => e.t > 12).reduce((m, e) => Math.max(m, e.gain), 0);
  const earlyGain = ev.filter((e) => e.t < 10.5).reduce((m, e) => Math.max(m, e.gain), 0);
  expect(lateGain).toBeLessThan(earlyGain * 0.4);
  // 渦: 左右の位置は時間とともに入れ替わる
  expect(Math.min(...ev.map((e) => e.pan))).toBeLessThan(-0.3);
  expect(Math.max(...ev.map((e) => e.pan))).toBeGreaterThan(0.3);
  expect(seq.done).toBe(true);
  expect(run(seq, 30, cond(52))).toEqual([]);
});
