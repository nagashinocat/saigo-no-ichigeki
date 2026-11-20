// BGM をオフラインで数の並びに混ぜる（node のテストと、持ち主が聞くための WAV の書き出し用。ゲームでは使わない）。
// bgm.js の音のつくりを写す: 一音ごとに楽器の音を再生の速さで読み（線形補間）、等しい力の左右に置き、
// 小さなこだま（遅れ・曇り・戻し）を足し、出口の low-pass と音量を通す。
import { renderVoice } from './bgmVoices.js';
import { BGM_BUS, FADE_HOLD, FADE_END } from './bgm.js';
import { stretchWarp } from './bgmScore.js';

// RBJ の low-pass（Web Audio の BiquadFilterNode の lowpass と同じ式）
function lowpassCoef(fc, q, sr) {
  const w0 = 2 * Math.PI * Math.min(fc, sr * 0.45) / sr, al = Math.sin(w0) / (2 * q), c = Math.cos(w0);
  const a0 = 1 + al;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: -2 * c / a0, a2: (1 - al) / a0 };
}
function biquad() {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, k) => {
    const y = k.b0 * x + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// events: bgmScore の音の一覧。cutoff(t) / gainAt(t): 出口の low-pass（Hz）と音量（0〜1）の時刻ごとの値（なければ 20 kHz・1）。
// warp { at, sec }: ゲームの stretchOut と同じく、時刻 at に鳴っている音の読む速さも指数で落とし、
// 出口の low-pass を下げ、音量を sec × FADE_HOLD まで保って sec × FADE_END で 0 にする（cutoff / gainAt を渡せばそちらが先）
export function mixOffline(events, { sr = 44100, duration, cutoff = null, gainAt = null, warp = null } = {}) {
  const n = Math.ceil(duration * sr);
  let wf = null, wEnd = Infinity;
  if (warp) {
    wf = stretchWarp(warp.sec);
    wEnd = warp.at + warp.sec * FADE_END;
    const { at, sec } = warp;
    const h = at + sec * FADE_HOLD;
    cutoff ??= (t) => (t < at ? 20000 : wf.cutoff(t - at));
    gainAt ??= (t) => (t < h ? 1 : t >= wEnd ? 0 : 1 - (t - h) / (wEnd - h));
  }
  const L = new Float32Array(n), R = new Float32Array(n);
  const cache = new Map();
  for (const e of events) {
    let buf = cache.get(e.voice);
    if (!buf) { buf = renderVoice(e.voice, sr); cache.set(e.voice, buf); }
    const i0 = Math.round(e.t * sr);
    const th = (Math.max(-1, Math.min(1, e.pan)) + 1) * Math.PI / 4;
    const gl = e.gain * Math.cos(th), gr = e.gain * Math.sin(th);
    // 引き伸ばしの瞬間に鳴っている音は、そこから読む速さが落ちる。引き伸ばしの音は出口の音量が 0 になったら止める
    // （そのあとに始まる音、たとえば続く静かな変奏はそのまま）
    const iw = wf && e.t < warp.at ? Math.round(warp.at * sr) : Infinity;
    const iEnd = e.t < wEnd ? Math.min(n, Math.ceil(wEnd * sr)) : n;
    let x = 0;
    for (let i = i0; x < buf.length - 1; i++) {
      if (i >= iEnd) break;
      if (i >= 0) {
        const k = Math.floor(x), f = x - k;
        const v = buf[k] * (1 - f) + buf[k + 1] * f;
        L[i] += v * gl; R[i] += v * gr;
      }
      x += i >= iw ? e.rate * wf.rate((i - iw) / sr) : e.rate;
    }
  }
  // こだま: s = 入力 + 戻し × e、e = 曇り(s の D 標本前)、出口へは wet × e
  const D = Math.round(BGM_BUS.echoSec * sr);
  const ek = lowpassCoef(BGM_BUS.echoCutoff, 1, sr);
  const out = [L, R].map((ch) => {
    const s = new Float32Array(n), lpE = biquad(), lpO = biquad();
    const y = new Float32Array(n);
    let k = lowpassCoef(20000, 0.6, sr);
    for (let i = 0; i < n; i++) {
      const e = i >= D ? lpE(s[i - D], ek) : lpE(0, ek);
      s[i] = ch[i] + BGM_BUS.echoFeedback * e;
      if (cutoff && i % 64 === 0) k = lowpassCoef(cutoff(i / sr), 0.6, sr);
      const g = gainAt ? gainAt(i / sr) : 1;
      y[i] = lpO(ch[i] + BGM_BUS.echoWet * e, k) * g * BGM_BUS.gain;
    }
    return y;
  });
  return { left: out[0], right: out[1], sr };
}

// 16 bit・ステレオの WAV のバイト列
export function encodeWav({ left, right, sr }) {
  const n = left.length, data = n * 4;
  const buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data, true);
  const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, q(left[i]), true); v.setInt16(46 + i * 4, q(right[i]), true); }
  return new Uint8Array(buf);
}
