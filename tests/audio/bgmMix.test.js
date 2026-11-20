import { test, expect } from 'vitest';
import { createSequencer } from '../../src/audio/bgmScore.js';
import { mixOffline, encodeWav } from '../../src/audio/bgmOffline.js';

const SR = 16000;
const rms = ({ left, right }, t0, t1) => {
  const i0 = Math.floor(t0 * SR), i1 = Math.floor(t1 * SR);
  let s = 0;
  for (let i = i0; i < i1; i++) s += left[i] ** 2 + right[i] ** 2;
  return Math.sqrt(s / (2 * (i1 - i0)));
};
const peak = ({ left, right }) => { let p = 0; for (let i = 0; i < left.length; i++) p = Math.max(p, Math.abs(left[i]), Math.abs(right[i])); return p; };
const render = (cond, { start = 0.5, until = 8, stopAt = Infinity, duration = 9 } = {}) => {
  const seq = createSequencer({ start });
  const ev = seq.advance(until, () => cond).filter((e) => e.t < stopAt);
  return mixOffline(ev, { sr: SR, duration, gainAt: (t) => (t < stopAt ? 1 : 0) });
};

test('混ぜた音: 始まる前は無音、鳴っている間は音があり、止めた瞬間から無音', () => {
  const m = render({ elapsed: 20, power: 0.3, holding: false }, { stopAt: 6 });
  expect(rms(m, 0, 0.45)).toBeLessThan(1e-6);
  for (let t = 1; t < 5.5; t += 0.5) expect(rms(m, t, t + 0.5)).toBeGreaterThan(0.004);
  expect(rms(m, 6.01, 8)).toBeLessThan(1e-6);
});

test('音量: 最高潮でもクリップしない（効果音より一段下）、最高潮は始まりより大きい', () => {
  const calm = render({ elapsed: 3, power: 0, holding: false });
  const peakMix = render({ elapsed: 56, power: 1, holding: true });
  expect(peak(peakMix)).toBeLessThan(0.5);
  expect(rms(peakMix, 1, 8)).toBeGreaterThan(rms(calm, 1, 8) * 1.5);
});

test('静かな変奏は、遊んでいる間の始まりよりも静か', () => {
  const calm = render({ elapsed: 20, power: 0, holding: false });
  const q = createSequencer({ start: 0.5, mode: 'quiet' });
  const quiet = mixOffline(q.advance(8, () => ({ elapsed: 0, power: 0, holding: false })), { sr: SR, duration: 9 });
  expect(rms(quiet, 1, 8)).toBeGreaterThan(0.001);
  expect(rms(quiet, 1, 8)).toBeLessThan(rms(calm, 1, 8) * 0.6);
});

test('引き伸ばし: 音はだんだん小さく暗くなり、sec 秒のあとは無音', () => {
  const seq = createSequencer({ start: 0 });
  const before = seq.advance(4, () => ({ elapsed: 55, power: 0.5, holding: true })).filter((e) => e.t < 4);
  seq.stretch(4, 3);
  const after = seq.advance(20, () => ({ elapsed: 55, power: 0.5, holding: true }));
  const m = mixOffline([...before, ...after], { sr: SR, duration: 8.5 });
  const a = rms(m, 4.0, 4.8), b = rms(m, 5.5, 6.3), c = rms(m, 6.6, 7.0);
  expect(a).toBeGreaterThan(b);
  expect(b).toBeGreaterThan(c);
  expect(rms(m, 7.6, 8.5)).toBeLessThan(a * 0.02);
});

test('WAV: 見出しと長さ', () => {
  const w = encodeWav({ left: new Float32Array(10), right: new Float32Array(10), sr: 8000 });
  expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
  expect(w.length).toBe(44 + 40);
});
