import { test, expect } from 'vitest';
import { renderVoice, VOICES, MARIMBA_BASE_HZ } from '../../src/audio/bgmVoices.js';

const SR = 22050;
const rms = (a, t0, t1) => {
  const i0 = Math.floor(t0 * SR), i1 = Math.min(a.length, Math.floor(t1 * SR));
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, i1 - i0));
};
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
// 区間で一番強い周波数（粗い DFT、lo〜hi Hz を step 刻み）
function dominantHz(a, t0, t1, lo, hi, step = 2) {
  const i0 = Math.floor(t0 * SR), i1 = Math.floor(t1 * SR);
  let best = 0, bestP = -1;
  for (let f = lo; f <= hi; f += step) {
    let re = 0, im = 0;
    for (let i = i0; i < i1; i++) { const p = 2 * Math.PI * f * i / SR; re += a[i] * Math.cos(p); im += a[i] * Math.sin(p); }
    const pw = re * re + im * im;
    if (pw > bestP) { bestP = pw; best = f; }
  }
  return best;
}

// ゆっくりふくらむ音（ドローンと擦れる音）は、鳴りはじめが小さいのが正しい。別に確かめる
const SWELL = ['drone', 'scrape'];
test('どの楽器も、鳴りはじめに音があり、尾は消えていく（クリップしない・NaN がない・終わりは無音）', () => {
  for (const name of VOICES.filter((v) => !SWELL.includes(v))) {
    const a = renderVoice(name, SR);
    expect(a.length, name).toBeGreaterThan(SR * 0.05);
    expect(a.every(Number.isFinite), name).toBe(true);
    expect(peak(a), name).toBeGreaterThan(0.2);
    expect(peak(a), name).toBeLessThanOrEqual(1);
    const len = a.length / SR;
    const head = rms(a, 0, Math.min(0.03, len / 4));
    const tail = rms(a, len * 0.9, len);
    expect(tail, name).toBeLessThan(head * 0.02);
    // 最初の 1 標本は 0 付近（立ち上がりでプツッと鳴らない）
    expect(Math.abs(a[0]), name).toBeLessThan(0.05);
  }
});

test('同じ楽器は毎回同じ波形（ノイズは種で決まる）', () => {
  expect(renderVoice('shaker', SR)).toEqual(renderVoice('shaker', SR));
});

// 区間の、ある周波数の強さ（DFT 一点）
function bandPower(a, t0, t1, f) {
  const i0 = Math.floor(t0 * SR), i1 = Math.floor(t1 * SR);
  let re = 0, im = 0;
  for (let i = i0; i < i1; i++) { const p = 2 * Math.PI * f * i / SR; re += a[i] * Math.cos(p); im += a[i] * Math.sin(p); }
  return (re * re + im * im) / (i1 - i0) ** 2;
}

test('ゆっくりふくらむ音（ドローン・擦れる音）: 0 から立ち上がり、ふくらんで、終わりは無音。クリップしない', () => {
  for (const name of SWELL) {
    const a = renderVoice(name, SR);
    expect(a.every(Number.isFinite), name).toBe(true);
    expect(peak(a), name).toBeGreaterThan(0.2);
    expect(peak(a), name).toBeLessThanOrEqual(1);
    expect(Math.abs(a[0]), name).toBeLessThan(0.01);
    const len = a.length / SR;
    let top = 0;
    for (let t = 0; t < len - 0.05; t += 0.05) top = Math.max(top, rms(a, t, t + 0.05));
    expect(rms(a, 0, 0.03), name).toBeLessThan(top * 0.3);
    expect(rms(a, len - 0.03, len), name).toBeLessThan(top * 0.02);
  }
});

test('ドローン: 底でうなる D2（約 73 Hz）。長く（6 秒以上）、中で音量と音色がゆっくり揺れる', () => {
  const d = renderVoice('drone', SR);
  const len = d.length / SR;
  expect(len).toBeGreaterThan(6);
  expect(dominantHz(d, len / 2 - 0.5, len / 2 + 0.5, 50, 400, 1)).toBeCloseTo(73.4, -1);
  // 真ん中の数秒で、音量（0.25 秒ごとの rms）が揺れる（うなり）
  const lv = [];
  for (let t = len * 0.3; t < len * 0.7; t += 0.25) lv.push(rms(d, t, t + 0.25));
  expect(Math.max(...lv) / Math.min(...lv)).toBeGreaterThan(1.25);
  // 音色: 高めの倍音（8 倍音あたり）の割合が時間で変わる
  const br = [];
  for (let t = len * 0.25; t < len * 0.75; t += 0.5) br.push(bandPower(d, t, t + 0.5, 73.42 * 8) / bandPower(d, t, t + 0.5, 73.42));
  expect(Math.max(...br) / Math.min(...br)).toBeGreaterThan(2);
});

test('擦れる音: 金属的（ほとんど高い音・倍音が整数倍でない）で、だんだん強くなってから消える', () => {
  const s = renderVoice('scrape', SR);
  const len = s.length / SR;
  expect(rms(s, len * 0.6, len * 0.7)).toBeGreaterThan(rms(s, 0.05, 0.15) * 2);
  let d = 0, e = 0;
  for (let i = 1; i < s.length; i++) { d += (s[i] - s[i - 1]) ** 2; e += s[i] ** 2; }
  expect(d / e).toBeGreaterThan(0.5);
  expect(dominantHz(s, len * 0.4, len * 0.8, 200, 2000)).toBeGreaterThan(900);
});

test('マリンバは暗く濁る: 高い倍音（約 10 倍）はほとんどなく、わずかにずらした 2 音のうなりで音量が揺れる', () => {
  const m = renderVoice('marimba', SR);
  const f = MARIMBA_BASE_HZ;
  expect(bandPower(m, 0, 0.02, 9.86 * f) / bandPower(m, 0, 0.02, f)).toBeLessThan(0.01);
  // 基音のうなり: 減衰を割り戻した音量が、単調でなく上下する
  const lv = [];
  for (let t = 0.05; t < 0.6; t += 0.02) lv.push(Math.sqrt(bandPower(m, t, t + 0.02, f)) * Math.exp(t / 0.2));
  let ups = 0;
  for (let i = 1; i < lv.length; i++) if (lv[i] > lv[i - 1] * 1.03) ups++;
  expect(ups).toBeGreaterThan(2);
});

test('マリンバ: 基音は D4、減衰は速い（0.5 秒で 1/10 以下）、打った直後は倍音と打鍵の音で明るい', () => {
  const m = renderVoice('marimba', SR);
  expect(dominantHz(m, 0.05, 0.25, 200, 1400)).toBeCloseTo(MARIMBA_BASE_HZ, -1);
  expect(rms(m, 0.5, 0.55)).toBeLessThan(rms(m, 0.0, 0.05) * 0.1);
  // 明るさ: 4 倍音（約 1175 Hz）は最初の 30 ms に強く、そのあと先に消える
  const hi = (t0, t1) => { let s = 0; const i0 = Math.floor(t0 * SR), i1 = Math.floor(t1 * SR); for (let i = i0 + 1; i < i1; i++) { const d = m[i] - m[i - 1]; s += d * d; } return s / (i1 - i0); };
  expect(hi(0, 0.03) / rms(m, 0, 0.03) ** 2).toBeGreaterThan(hi(0.2, 0.23) / rms(m, 0.2, 0.23) ** 2 * 2);
});

test('柔らかいマリンバ（リプレイ用）は、ふつうのマリンバより丸く、少し長く鳴る', () => {
  const m = renderVoice('marimba', SR), s = renderVoice('marimbaSoft', SR);
  const edge = (a, t0, t1) => { let d = 0, e = 0; const i0 = Math.floor(t0 * SR), i1 = Math.floor(t1 * SR); for (let i = i0 + 1; i < i1; i++) { d += (a[i] - a[i - 1]) ** 2; e += a[i] ** 2; } return d / e; };
  expect(edge(s, 0, 0.03)).toBeLessThan(edge(m, 0, 0.03));
  expect(rms(s, 0.4, 0.45) / rms(s, 0, 0.05)).toBeGreaterThan(rms(m, 0.4, 0.45) / rms(m, 0, 0.05));
});

test('低い太鼓は低く（100 Hz 未満）、高い太鼓のスラップは短く、シェイカーは高い音だけ', () => {
  const low = renderVoice('low', SR);
  expect(dominantHz(low, 0.06, 0.3, 30, 400)).toBeLessThan(100);
  const slap = renderVoice('slap', SR);
  expect(rms(slap, 0.15, 0.2)).toBeLessThan(rms(slap, 0, 0.02) * 0.1);
  const sh = renderVoice('shaker', SR);
  // 隣の標本との差が大きい = 高い音（低い成分はほとんどない）
  let d = 0, e = 0;
  for (let i = 1; i < sh.length; i++) { d += (sh[i] - sh[i - 1]) ** 2; e += sh[i] ** 2; }
  expect(d / e).toBeGreaterThan(1.0);
});
