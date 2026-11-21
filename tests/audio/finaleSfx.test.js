// S3（持ち主の要望 2026-11-21 09:59「地響きみたいな音と瓦礫の崩れる音を足したい。あと最後の爆発音はもっと重くした方がいい」）:
// 地響きは演出の時刻表に沿って始まり・ふくらみ・宇宙でこもり・消える。瓦礫の崩れる音は命中ごと（頻度の上限つき）、左右に散り、
// リプレイでも同じ音、宇宙でこもり、払うでは鳴らない。最後の爆発音は前より低く・長く・超低域が厚い（オフラインで鳴らして測る）。
// 払うの音の設計図は前と同じ。
import { test, expect, afterEach } from 'vitest';
import { boomRecipe, createAudio, finaleBoomOpts, rumbleKeys, rumbleAt, RUMBLE, DEBRIS_LEVEL } from '../../src/audio/audio.js';
import { createHitFeed, COLLAPSE_STAGES } from '../../src/audio/hitFeed.js';
import { COLLAPSE, createCollapseGate, collapseVoice, collapseHitInfo, renderCollapse, renderCollapseVariant, idHash } from '../../src/audio/collapse.js';
import { createTimeline } from '../../src/render/finaleTimeline.js';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

const PUFF = Math.sqrt(CONFIG.puff.radius / CONFIG.radius.max);
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
// R0b: 遠くの軍勢の後ろ（乗り手は半径の 0.36〜0.56、カメラはその 14 m 後ろ）
const timelines = () => [
  createTimeline({ radius: CONFIG.radius.max, riderDist: CONFIG.radius.max * 0.46, camDist: CONFIG.radius.max * 0.46 + 14 }),
  createTimeline({ radius: CONFIG.radius.max * 0.5, riderDist: CONFIG.radius.max * 0.5 * 0.4, camDist: CONFIG.radius.max * 0.5 * 0.4 + 14 }),
  createTimeline({ radius: CONFIG.radius.max, riderDist: CONFIG.radius.max * 0.56, camDist: CONFIG.radius.max * 0.56 + 14 }),
];

// ---- 前の版の設計図（H2〜S5 の boomRecipe をそのまま写したもの。払う・ふつうの一発は今もこれと同じでなければならない）----
function oldRecipe(size, { hold = 0, open = 0, rng = Math.random } = {}) {
  const s = Math.max(0, Math.min(1, size));
  const h = Math.max(0, hold);
  const crack = { dur: 0.03 + 0.045 * s, attack: 0.001, hp: 1100 - 650 * s, gain: 0.62 - 0.17 * s };
  const punch = { f0: 150 - 95 * s, f1: 48 - 24 * s, dur: 0.16 + 0.55 * s, attack: 0.003, gain: 0.55 + 0.15 * s };
  const roarDur = 0.5 + 3.0 * s;
  const roar = {
    dur: roarDur + h, hold: h, open: Math.max(0, open), f0: 5200 - 3000 * s, f1: 170 - 100 * s,
    attack: 0.004 + 0.02 * s, gain: 0.34 + 0.2 * s, drop: 0.4, knee: 0.08 + 0.35 * s,
  };
  const air = { dur: 0.22 + 1.2 * s, freq: 1700 - 800 * s, q: 1.1, attack: 0.002, gain: 0.22 + 0.06 * s };
  const sub = {
    dur: 0.45 + 4.6 * s ** 1.3 + h, hold: h, cutoff: 115 - 60 * s, attack: 0.015 + 0.2 * s, gain: 0.3 + 0.6 * s,
    wobble: { rate: (6 - 3 * s) * (0.9 + 0.2 * rng()), depth: 0.1 + 0.18 * s },
  };
  const taps = [];
  const nTaps = 2 + Math.round(3 * s), first = 0.04 + 0.3 * s;
  for (let i = 0; i < nTaps; i++) {
    taps.push({
      delay: first * (1 + 0.85 * i) * (0.93 + 0.14 * rng()),
      gain: (0.5 - 0.12 * s) * 0.65 ** i,
      cutoff: (3200 - 2000 * s) * 0.72 ** i,
      pan: (i % 2 ? 1 : -1) * (0.25 + 0.45 * rng()),
    });
  }
  const grains = [];
  const n = Math.round(7 + 38 * s + 8 * h), start = crack.dur + 0.05 + 0.3 * s, span = 0.35 + 2.6 * s + 0.8 * h;
  const us = Array.from({ length: n }, () => rng()).sort((x, y) => x - y);
  for (const u of us) {
    const chunk = rng() < 0.15;
    let t = start + span * u ** 1.7;
    const prev = grains[grains.length - 1];
    if (prev && t <= prev.t + prev.len + 0.001) t = prev.t + prev.len + 0.002;
    const fade = 1 - 0.6 * Math.min(1, (t - start) / span);
    grains.push({
      t,
      len: chunk ? 0.04 + 0.03 * rng() : 0.008 + 0.025 * rng(),
      f: chunk ? 350 + 550 * rng() : 1800 + 4500 * rng(),
      g: (chunk ? 0.16 : 0.07 + 0.08 * rng()) * fade,
    });
  }
  return { size: s, level: 0.85 + 0.15 * s, crack, punch, roar, air, sub, taps, debris: { grains } };
}

test('払うの音の設計図は前と同じ（ふつうの一発・hold つきも、heavy を渡さなければ同じ値）', () => {
  for (const [s, o] of [[PUFF, {}], [0.5, {}], [1, {}], [0.9, { hold: 2.4, open: 0.75 }]]) {
    const now = boomRecipe(s, { ...o, rng: seeded(3) });
    const was = oldRecipe(s, { ...o, rng: seeded(3) });
    expect(now).toMatchObject(was);
    expect(now.deep).toBe(null);
    expect(now.heavy).toBe(0);
    expect(now.body).toBe(null);
    expect(now.swell).toBe(null);
    expect(now.roar.tail).toBe(0);
    expect(now.punch.drive).toBe(2.2); // 前と同じ歪みの曲線
    // 増えたのは heavy / deep / body / swell / roar.tail / punch.drive だけ
    const { heavy, deep, body, swell, ...rest } = now;
    const { tail, ...roar } = rest.roar;
    const { drive, ...punch } = rest.punch;
    expect({ ...rest, roar, punch }).toEqual(was);
  }
});

test('最後の一発の取り決めは heavy: 1。立ち上がり（attack）はそのまま鋭く、低い一打は低く長く強く歪み、胴（80〜180 Hz）と圧のふくらみがあり、うなりと地響きは長い。超低域の層は 30 Hz より上だけ', () => {
  const tl = timelines()[0];
  const o = finaleBoomOpts(tl);
  expect(o.heavy).toBe(1);
  const was = oldRecipe(1, { hold: o.hold, open: o.open, rng: seeded() });
  const now = boomRecipe(1, { ...o, rng: seeded() });
  expect({ ...now.crack, gain: 0 }).toEqual({ ...was.crack, gain: 0 });
  expect(now.crack.gain).toBeCloseTo(was.crack.gain * 0.9); // 頭の標本の間の山を少し抑える
  expect(now.punch.attack).toBe(was.punch.attack);
  expect(now.roar.attack).toBe(was.roar.attack);
  expect(now.punch.f0).toBeLessThan(was.punch.f0 * 0.75);
  expect(now.punch.f1).toBeLessThan(was.punch.f1 * 0.75);
  expect(now.punch.dur).toBeGreaterThan(was.punch.dur * 1.5);
  expect(now.roar.dur).toBeGreaterThan(was.roar.dur + 1);
  expect(now.sub.dur).toBeGreaterThan(was.sub.dur + 1);
  expect(now.sub.gain).toBeGreaterThan(was.sub.gain);
  expect(now.roar.f1).toBe(was.roar.f1); // うなりの尾は暗くしすぎない（70 Hz）
  expect(now.punch.drive).toBeGreaterThanOrEqual(3.4);
  expect(now.deep.f1).toBeGreaterThanOrEqual(30);
  expect(now.deep.hp).toBeGreaterThanOrEqual(30);
  expect(now.deep.f1).toBeLessThan(now.deep.f0);
  expect(now.body.f0).toBeGreaterThanOrEqual(80);
  expect(now.body.f0).toBeLessThanOrEqual(180);
  expect(now.body.noise.freq).toBeGreaterThanOrEqual(80);
  expect(now.body.noise.freq).toBeLessThanOrEqual(180);
  expect(now.body.dur).toBeGreaterThanOrEqual(1.2);
  expect(now.swell.at).toBeCloseTo(0.15);
  expect(now.swell.end).toBeCloseTo(0.6);
  expect(20 * Math.log10(now.swell.gain)).toBeCloseTo(3, 1);
  expect(now.swell.lp).toBeGreaterThanOrEqual(300);
});

// ---- 設計図の低い層（低い一打・腹に響く層・地響き・うなり）を、Web Audio と同じ式でオフラインに鳴らす ----
const SR = 8000;
// AudioParam の予定（setValueAtTime / linear / exponential）を標本ごとの値に
function automation(events, n) {
  const out = new Float32Array(n);
  let k = 0, v = events[0].v, t0 = 0, v0 = v;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    while (k < events.length && events[k].t <= t) { v0 = events[k].v; t0 = events[k].t; v = v0; k++; }
    const e = events[k];
    if (e && e.type !== 'set') {
      const u = (t - t0) / Math.max(1e-9, e.t - t0);
      v = e.type === 'lin' ? v0 + (e.v - v0) * u : v0 * (e.v / v0) ** u;
    }
    out[i] = v;
  }
  return out;
}
const envEvents = (attack, peak, dur) => [{ type: 'set', t: 0, v: 0.0001 }, { type: 'lin', t: attack, v: peak }, { type: 'exp', t: dur, v: 0.0001 }];
function lowpass(x, fcAt, q = 0.9) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = typeof fcAt === 'number' ? fcAt : fcAt[i];
    const w0 = 2 * Math.PI * Math.min(fc, SR * 0.45) / SR, al = Math.sin(w0) / (2 * q), c = Math.cos(w0), a0 = 1 + al;
    const v = ((1 - c) / 2 * x[i] + (1 - c) * x1 + (1 - c) / 2 * x2 + 2 * c * y1 - (1 - al) * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function biq(x, kind, fc, q) {
  const y = new Float32Array(x.length);
  const w0 = 2 * Math.PI * Math.min(fc, SR * 0.45) / SR, al = Math.sin(w0) / (2 * q), c = Math.cos(w0), a0 = 1 + al;
  const b = kind === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [al, 0, -al];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b[0] * x[i] + b[1] * x1 + b[2] * x2 + 2 * c * y1 - (1 - al) * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const highpass = (x, fc) => biq(x, 'hp', fc, 0.707);
const bandpass = (x, fc, q) => biq(x, 'bp', fc, q);
const tanhClip = (k) => (x) => Math.tanh(k * Math.max(-1, Math.min(1, x))) / Math.tanh(k);
function sweepSine(f0, f1, sweepEnd, env, n) {
  const y = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = t < sweepEnd ? f0 * (f1 / f0) ** (t / sweepEnd) : f1;
    ph += 2 * Math.PI * f / SR; y[i] = Math.sin(ph) * env[i];
  }
  return y;
}
function renderLow(r, dur = 14) {
  const n = Math.ceil(dur * SR), rng = seeded(11);
  const p = r.punch, driveCurve = tanhClip(p.drive ?? 2.2), subCurve = tanhClip(1.6);
  const punch = sweepSine(p.f0, p.f1, p.dur * 0.6, automation(envEvents(p.attack, p.gain, p.dur), n), n).map(driveCurve);
  // 圧のふくらみ（最後の一発だけ）: うなりと胴の gain、地響きの low-pass
  const sw = r.swell;
  const swG = sw ? automation([{ type: 'set', t: 0, v: 1 }, { type: 'set', t: sw.at, v: 1 }, { type: 'lin', t: sw.peak, v: sw.gain }, { type: 'lin', t: sw.end, v: 1 }], n) : null;
  let body = new Float32Array(n);
  if (r.body) {
    const y = r.body, nz = y.noise;
    const tone = sweepSine(y.f0, y.f1, y.dur * 0.7, automation(envEvents(y.attack, y.gain, y.dur), n), n);
    const nEnv = automation(envEvents(nz.attack, nz.gain, nz.dur), n);
    const bn = bandpass(new Float32Array(n).map(() => rng() * 2 - 1), nz.freq, nz.q);
    body = tone.map((v, i) => driveCurve(v + bn[i] * nEnv[i]) * swG[i]);
  }
  const b = r.sub;
  const sEv = [{ type: 'set', t: 0, v: 0.0001 }, { type: 'lin', t: b.attack, v: b.gain }];
  if (b.hold > b.attack) sEv.push({ type: 'exp', t: b.hold, v: b.gain * 0.7 });
  sEv.push({ type: 'exp', t: b.dur, v: 0.0001 });
  const brown = new Float32Array(n); let acc = 0, pk = 1e-9;
  for (let i = 0; i < n; i++) { acc = acc * 0.998 + (rng() * 2 - 1) * 0.05; brown[i] = acc; pk = Math.max(pk, Math.abs(acc)); }
  const sCut = sw ? automation([{ type: 'set', t: 0, v: b.cutoff }, { type: 'set', t: sw.at, v: b.cutoff }, { type: 'exp', t: sw.peak, v: sw.lp }, { type: 'exp', t: sw.end, v: b.cutoff }], n) : b.cutoff;
  const sEnv = automation(sEv, n), sf = lowpass(brown.map((v) => v / pk), sCut);
  const wob = (i) => 1 + b.wobble.depth * Math.sin(2 * Math.PI * b.wobble.rate * i / SR);
  const deep = r.deep ? highpass(sweepSine(r.deep.f0, r.deep.f1, r.deep.dur * 0.8, automation(envEvents(r.deep.attack, r.deep.gain, r.deep.dur), n), n), r.deep.hp ?? 1) : new Float32Array(n);
  const sub = sf.map((v, i) => subCurve((v * sEnv[i] + deep[i]) * wob(i)));
  const w = r.roar;
  const rEv = [{ type: 'set', t: 0, v: 0.0001 }, { type: 'lin', t: w.attack, v: w.gain }, { type: 'exp', t: w.knee, v: w.gain * w.drop }];
  if (w.hold > w.knee) rEv.push({ type: 'exp', t: w.hold, v: w.gain * w.drop * 0.6 });
  if (w.tail > 0) rEv.push({ type: 'exp', t: Math.max(w.hold, w.knee) + w.tail, v: w.gain * w.drop * 0.45 });
  rEv.push({ type: 'exp', t: w.dur, v: 0.0001 });
  const fEv = w.open > 0 ? [{ type: 'set', t: 0, v: w.f0 * 0.18 }, { type: 'exp', t: w.open, v: w.f0 }] : [{ type: 'set', t: 0, v: w.f0 }];
  fEv.push({ type: 'exp', t: Math.max(w.open + 0.1, w.dur * 0.7), v: w.f1 });
  const white = new Float32Array(n).map(() => rng() * 2 - 1);
  const rEnv = automation(rEv, n);
  const roar = lowpass(white, automation(fEv, n), 0.7).map((v, i) => v * rEnv[i] * (swG ? swG[i] : 1));
  return { punch, body, sub, roar, n };
}
const dominant = (x, t0, t1) => {
  const z = x.subarray(Math.round(t0 * SR), Math.round(t1 * SR));
  let best = -1, at = 0;
  for (let f = 15; f <= 150; f++) {
    const k = 2 * Math.cos(2 * Math.PI * f / SR); let s1 = 0, s2 = 0;
    for (const v of z) { const s0 = v + k * s1 - s2; s2 = s1; s1 = s0; }
    const pw = s1 * s1 + s2 * s2 - k * s1 * s2;
    if (pw > best) { best = pw; at = f; }
  }
  return at;
};
const energy = (x, t0 = 0, t1 = x.length / SR) => { let s = 0; for (let i = Math.round(t0 * SR); i < Math.min(x.length, t1 * SR); i++) s += x[i] * x[i]; return s / SR; };
const lastAbove = (x, rms) => { let last = 0; for (let t = 0; t + 0.1 <= x.length / SR; t += 0.1) if (Math.sqrt(energy(x, t, t + 0.1) / 0.1) > rms) last = t + 0.1; return last; };

// S8 fix1: 今の時刻表（最大 730 m、見せる期 4.3 秒）の hold で比べる。hold が延びた分、うなりの尾が 14 秒の窓の端にかかるので、
// 鳴らす窓を 16 秒に広げた
test('最後の爆発音は前より重い（オフラインで鳴らして測る）: スマホで聞こえる 100〜300 Hz が最初の 1.5 秒で +3 dB 以上、低い一打の基音が低く、うなりが長く、超低域も厚い', () => {
  const tl = timelines()[0];
  const o = finaleBoomOpts(tl);
  const was = renderLow(oldRecipe(1, { hold: o.hold, open: o.open, rng: seeded() }), 16);
  const now = renderLow(boomRecipe(1, { ...o, rng: seeded() }), 16);
  // 基音（一打の最初の 0.5 秒でいちばん力のある周波数）
  const fWas = dominant(was.punch, 0.01, 0.5), fNow = dominant(now.punch, 0.01, 0.5);
  expect(fNow).toBeLessThan(fWas * 0.8);
  // うなりの長さ（100 ms ごとの RMS が -40 dB を下回るまで）
  const lWas = lastAbove(was.roar, 0.01), lNow = lastAbove(now.roar, 0.01);
  expect(lNow).toBeGreaterThan(lWas + 1);
  // 超低域の力: 一打 + 胴 + 地響き（超低域の層を含む）を 80 Hz の low-pass に通した 0〜10 秒の力
  const mix = (x) => x.punch.map((v, i) => v + x.body[i] + x.sub[i] + x.roar[i]);
  const low = (x) => energy(lowpass(mix(x), 80), 0, 10);
  expect(low(now)).toBeGreaterThan(low(was) * 1.2); // +0.8 dB 以上
  // スマホで聞こえる重さ: 100〜300 Hz の最初の 1.5 秒の力が +3 dB 以上
  const body = (x) => energy(highpass(highpass(lowpass(lowpass(mix(x), 300, 0.707), 300, 0.707), 100), 100), 0, 1.5);
  const bodyDb = 10 * Math.log10(body(now) / body(was));
  expect(bodyDb).toBeGreaterThanOrEqual(3);
  if (process.env.S3_LOG) console.log(JSON.stringify({ fWas, fNow, lWas, lNow, lowWas: low(was), lowNow: low(now), bodyDb, subWas: lastAbove(was.sub, 0.01), subNow: lastAbove(now.sub, 0.01) }));
  // 地響き（超低域の層を含む地響きの層）も厚く長い。S8 fix2: −40 dB を下回る時刻（100 ms 刻み）は保つ秒が延びると差が
  // 刻みの幅ほどに縮んで揺れるので、120 Hz より下の力で測る（今の時刻表の hold で、前の版の設計図と比べる）。
  //   - 放ってから 6 秒の力: +0.5 dB 以上（R0b fix2 で測ると +0.82 dB。一打・胴・うなりも含めた全体では +1.42 dB）
  //   - 尾の厚さ: hold + 1 〜 hold + 3.7 秒の力が +1.5 dB 以上（測ると +4.88 dB。hold は R0b の時刻表で 2.62 秒）
  //   - hold 〜 hold + 2.7 秒（R0b より前の窓の長さ）の力が −1.0 dB 以上（測ると −0.68 dB）
  //   - −40 dB を下回る時刻は前の版より早くならない
  const below120 = (x) => lowpass(lowpass(x, 120, 0.707), 120, 0.707);
  const sWas = below120(was.sub), sNow = below120(now.sub);
  const db = (t0, t1) => 10 * Math.log10(energy(sNow, t0, t1) / energy(sWas, t0, t1));
  if (process.env.S3_LOG) console.log(JSON.stringify({ hold: o.hold, sub06: db(0, 6), subTail: db(o.hold, 6), t27: db(o.hold, o.hold + 2.7), t2: db(o.hold + 1, o.hold + 3.7), mix06: 10 * Math.log10(energy(below120(mix(now)), 0, 6) / energy(below120(mix(was)), 0, 6)) }));
  expect(db(0, 6)).toBeGreaterThanOrEqual(0.5);
  // R0b: hold は 3.3 → 2.6 秒に縮んだ（弾けてから追うカットまでが短い）。hold の直後の 1 秒は前の版とほぼ同じ大きさ（-0.7 dB）で、
  // 重い一発の尾はその先で長く残る（hold + 1 〜 hold + 3.7 秒で +4.9 dB）。尾の厚さはそこで測る
  expect(db(o.hold + 1, o.hold + 3.7)).toBeGreaterThanOrEqual(1.5);
  // fix1（I-3）: もとの窓（hold〜hold + 2.7 秒、前の hold 3.3 秒で 6 秒まで）も見張る。測ると −0.68 dB（hold が縮んで、hold の直後の尾は
  // 前の版よりわずかに弱い）。持ち主が 23:01 に実機で「音は大丈夫」と言ったのは R0b より前の音で、R0b のこの尾はまだ聞いていない。
  // その音から離れすぎないよう、前の版より 1 dB 以上弱くはしない
  expect(db(o.hold, o.hold + 2.7)).toBeGreaterThanOrEqual(-1.0);
  expect(lastAbove(now.sub, 0.01)).toBeGreaterThanOrEqual(lastAbove(was.sub, 0.01));
});

// ---- 地響き（時刻表に沿う）----
test('地響きの折れ線（R0b、音は画面に従う）: 白が晴れて爆発が始まる（erupt）まで 0、スローの間に遠い地鳴りがふくらみ、弾けて光の壁が軍勢を飲むと轟き、追うカットの直後に最大、見せる期はうなり続け、宇宙でこもって弱まり、横一線の光とともに消える', () => {
  for (const tl of timelines()) {
    const keys = rumbleKeys(tl);
    for (let i = 1; i < keys.length; i++) expect(keys[i].t).toBeGreaterThan(keys[i - 1].t);
    expect(keys[0].t).toBe(tl.erupt);
    const at = (t) => rumbleAt(keys, t);
    // 白の間とその前は無音
    for (const t of [0, tl.hands, tl.erupt - 1e-3]) expect(at(t).g).toBe(0);
    // スローの間: 遠く小さく、だんだんふくらむ（弾けるまで 0.35 以下・こもった低い音）
    let prev = 0;
    for (let t = tl.erupt + 0.05; t < tl.burst; t += 0.05) { const g = at(t).g; expect(g).toBeGreaterThanOrEqual(prev); expect(g).toBeLessThanOrEqual(0.35); prev = g; }
    expect(at(tl.burst - 0.01).f).toBeLessThanOrEqual(95);
    // 弾けてから光の壁が軍勢を飲むまでに大きくなる
    expect(at(tl.engulf).g).toBeGreaterThan(at(tl.burst).g + 0.3);
    // 最大は追うカットへ切り替わった直後（snap から 0.5 秒以内）
    let peakT = 0, peak = 0;
    for (let t = tl.erupt; t < tl.end; t += 0.01) if (at(t).g > peak) { peak = at(t).g; peakT = t; }
    expect(peak).toBeCloseTo(1, 2);
    expect(at(tl.snap + 0.3).g).toBeCloseTo(1, 9);
    expect(peakT).toBeGreaterThanOrEqual(tl.snap);
    expect(peakT).toBeLessThan(tl.snap + 0.5);
    for (let t = tl.snap + 0.3; t < tl.chaseEnd; t += 0.05) expect(at(t).g).toBeGreaterThanOrEqual(0.8);
    const sp = at(tl.chaseEnd + 0.5);
    expect(sp.f).toBeLessThanOrEqual(80);
    expect(sp.g).toBeLessThan(at(tl.chaseEnd - 0.05).g);
    expect(sp.g).toBeGreaterThan(0.2);
    expect(at(tl.chaseEnd - 0.05).f).toBeGreaterThanOrEqual(140);
    for (const t of [tl.lineEnd, (tl.lineEnd + tl.rumble) / 2, tl.rumble, tl.end]) expect(at(t).g).toBe(0);
  }
});

test('爆発の音の取り決め（R0b）: 弾けた瞬間（burst = resume）に開き、うなりは光の壁が軍勢を飲む（engulf）までかけて開いて、宇宙へ切り替わるまで鳴り続ける', () => {
  for (const tl of timelines()) {
    const o = finaleBoomOpts(tl);
    expect(o.hold).toBeCloseTo(tl.chaseEnd - tl.burst, 9);
    expect(o.open).toBeCloseTo(Math.min(1.2, Math.max(0.15, tl.engulf - tl.burst)), 9);
    expect(o.heavy).toBe(1);
  }
});

// ---- 音の部品（身代わりの AudioContext）----
function fakeParam(v0) {
  const ev = [];
  return {
    value: v0, ev,
    setValueAtTime(v, t) { ev.push({ t, v }); }, linearRampToValueAtTime(v, t) { ev.push({ t, v }); },
    exponentialRampToValueAtTime(v, t) { ev.push({ t, v }); }, setTargetAtTime(v, t) { ev.push({ t, v }); },
    cancelScheduledValues(t) { for (let i = ev.length - 1; i >= 0; i--) if (ev[i].t >= t) ev.splice(i, 1); },
    final() { return ev.length ? ev.reduce((a, b) => (b.t >= a.t ? b : a)).v : this.value; },
  };
}
function fakeCtx() {
  const links = [], nodes = [];
  const node = (extra) => { const n = { connect(to) { links.push([n, to]); return to; }, start(t) { n.startT = t; }, stop(t) { n.stopT = t; }, ...extra }; nodes.push(n); return n; };
  return {
    state: 'running', currentTime: 10, sampleRate: 8000, destination: { name: 'dest' }, links, nodes,
    resume() {}, suspend() {},
    createBiquadFilter: () => node({ kind: 'filter', type: '', frequency: fakeParam(350), Q: fakeParam(1) }),
    createGain: () => node({ kind: 'gain', gain: fakeParam(1) }),
    createOscillator: () => node({ kind: 'osc', type: '', frequency: fakeParam(440) }),
    createBufferSource: () => node({ kind: 'src', buffer: null, loop: false, playbackRate: fakeParam(1) }),
    createBuffer(ch, n) { const d = new Float32Array(n); return { length: n, duration: n / 8000, getChannelData: () => d }; },
    createDelay: () => node({ kind: 'delay', delayTime: fakeParam(0) }),
    createStereoPanner: () => node({ kind: 'pan', pan: fakeParam(0) }),
    createWaveShaper: () => node({ kind: 'shaper', curve: null, oversample: 'none' }),
    createDynamicsCompressor: () => node({ kind: 'comp', threshold: fakeParam(-24), knee: fakeParam(30), ratio: fakeParam(12), attack: fakeParam(0.003), release: fakeParam(0.25) }),
  };
}
afterEach(() => { delete globalThis.window; });
function setup() {
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio();
  audio.unlock();
  const gains = ctx.nodes.filter((n) => n.kind === 'gain');
  const lim = ctx.nodes.find((n) => n.kind === 'comp');
  const out = ctx.nodes.find((n) => n.kind === 'filter');
  return { ctx, audio, master: gains[0], cine: gains[1], lim, out };
}
const reaches = (ctx, n, target, seen = new Set()) => {
  if (n === target) return true;
  if (seen.has(n)) return false;
  seen.add(n);
  const owner = (to) => ctx.nodes.find((x) => x === to || Object.values(x).includes(to)) ?? to;
  return ctx.links.some(([a, to]) => a === n && reaches(ctx, owner(to), target, seen));
};
const hit = (id, o = {}) => ({ id, size: 0.6, near: 0.7, pan: 0, ...o });

test('地響きの音: 爆発が始まる瞬間（erupt）に時刻表どおり最後まで予定され、演出の道（cine）を通ってこもりの out へ（世界の音 master は通らない）。横一線の光が消えたら止まる', () => {
  const tl = timelines()[0];
  const { ctx, audio, master, cine, out } = setup();
  const n0 = ctx.nodes.length;
  audio.finaleRumble(tl);
  const mine = ctx.nodes.slice(n0);
  expect(mine.length).toBeLessThanOrEqual(16);
  const srcs = mine.filter((n) => n.kind === 'src' || n.kind === 'osc');
  expect(srcs.length).toBeGreaterThanOrEqual(2);
  for (const s of srcs) {
    expect(reaches(ctx, s, cine)).toBe(true);
    expect(reaches(ctx, s, out)).toBe(true);
    expect(reaches(ctx, s, master)).toBe(false);
    // 地鳴り（tl.rumble）の前に止まる
    expect(s.stopT).toBeGreaterThan(10 + (tl.lineEnd - tl.erupt) - 1e-6);
    expect(s.stopT).toBeLessThan(10 + (tl.rumble - tl.erupt));
  }
  // 大きさの予定は rumbleKeys の時刻（erupt を今として）どおり。最大は追うカットの直後
  const env = mine.filter((n) => n.kind === 'gain').find((g) => g.gain.ev.length >= rumbleKeys(tl).length);
  const keys = rumbleKeys(tl);
  expect(env.gain.ev.map((e) => e.t)).toEqual(keys.map((k) => 10 + k.t - tl.erupt).map((t) => expect.closeTo(t, 6)));
  expect(Math.max(...env.gain.ev.map((e) => e.v))).toBeCloseTo(RUMBLE.gain, 6);
  // 低域の通し幅も宇宙で下がる
  const lp = mine.find((n) => n.kind === 'filter' && n.frequency.ev.length >= keys.length);
  const fSpace = lp.frequency.ev.find((e) => e.t > 10 + tl.chaseEnd - tl.erupt + 0.1).v;
  expect(fSpace).toBeLessThanOrEqual(80);
  // 宇宙へ: out がこもる（地響きも一緒にこもる）
  audio.muffle(1.4);
  expect(out.frequency.final()).toBeLessThanOrEqual(150);
  // 呼び直し・止めても壊れない
  audio.rumbleStop();
  for (const s of srcs) expect(s.stopT).toBeLessThan(10 + 0.1);
});

test('瓦礫の音の頻度の上限: 毎フレーム 10 発ずつ命中しても、1 秒あたり perSec 以下・同時 maxVoices 以下・間隔 gap 以上。ためた命中はいちばん大きい一つにまとめる', () => {
  const gate = createCollapseGate();
  const starts = [];
  for (let f = 0; f < 60 * 4; f++) {
    const now = f / 60;
    const hits = Array.from({ length: 10 }, (_, k) => hit(`b${f * 10 + k}`, { size: (k + 1) / 10 }));
    const p = gate.take(hits, now);
    if (p) {
      starts.push({ now, dur: collapseVoice(p.hit, p.merged).dur });
      expect(p.hit.size).toBeCloseTo(1); // いちばん大きいビル
      expect(p.merged).toBeGreaterThanOrEqual(10);
    }
    expect(gate.active).toBeLessThanOrEqual(COLLAPSE.maxVoices);
  }
  expect(starts.length).toBeGreaterThan(4);
  for (let i = 1; i < starts.length; i++) expect(starts[i].now - starts[i - 1].now).toBeGreaterThanOrEqual(COLLAPSE.gap - 1e-9);
  for (const s of starts) {
    expect(starts.filter((x) => x.now >= s.now && x.now < s.now + 1).length).toBeLessThanOrEqual(COLLAPSE.perSec);
    expect(starts.filter((x) => x.now <= s.now && x.now + x.dur > s.now).length).toBeLessThanOrEqual(COLLAPSE.maxVoices);
  }
  // まばらな命中はひとつずつ鳴る。鳴らせなかった古い命中（stale より前）は捨てる
  const g2 = createCollapseGate();
  expect(g2.take([hit('b1')], 0)?.hit.id).toBe('b1');
  expect(g2.take([hit('b2')], 0.01)).toBe(null);
  expect(g2.take([], 0.01 + COLLAPSE.stale + 0.05)).toBe(null);
  expect(g2.take([hit('b3')], 1)?.merged).toBe(1);
});

test('瓦礫の音の部品: 一つの命中で 4 つだけ（音のもと・こもり・大きさ・左右。音のもとは起動時に書き出したものを使い回す）、リミッターへ届き世界の音（master）は通らない、上限を超えて増えない', () => {
  const { ctx, audio, master, lim } = setup();
  const bufs = new Set();
  let n0 = ctx.nodes.length;
  audio.collapse([hit('b1', { pan: -0.8 })]);
  const one = ctx.nodes.slice(n0);
  expect(one.length).toBe(4);
  expect(one.find((n) => n.kind === 'filter').frequency.value).toBeCloseTo(collapseVoice(hit('b1', { pan: -0.8 })).lp, 6);
  const src = one.find((n) => n.kind === 'src');
  expect(reaches(ctx, src, lim)).toBe(true);
  expect(reaches(ctx, src, master)).toBe(false);
  expect(one.find((n) => n.kind === 'pan').pan.value).toBeCloseTo(-0.8);
  bufs.add(src.buffer);
  // 3 秒、毎フレーム 20 発: 部品は上限の分だけ
  n0 = ctx.nodes.length;
  for (let f = 1; f <= 90; f++) {
    ctx.currentTime = 10 + f / 30;
    audio.collapse(Array.from({ length: 20 }, (_, k) => hit(`b${f * 20 + k}`)));
  }
  const made = ctx.nodes.slice(n0);
  const srcs = made.filter((n) => n.kind === 'src');
  expect(srcs.length).toBeLessThanOrEqual(COLLAPSE.perSec * 3 + 1);
  expect(made.length).toBe(srcs.length * 4);
  for (const s of srcs) bufs.add(s.buffer);
  expect(bufs.size).toBeLessThanOrEqual(COLLAPSE.variants);
  // 落ちて止まった破片（'s…'）は短い音のもと（ビルの音のもとの後ろの番号）
  n0 = ctx.nodes.length;
  ctx.currentTime += 5;
  audio.collapse([hit('s12_40', { kind: 'settle', size: 0.3 })]);
  const sb = ctx.nodes.slice(n0).find((n) => n.kind === 'src').buffer;
  expect(sb.length).toBe(Math.ceil(COLLAPSE.settleSec * Math.min(8000, COLLAPSE.sampleRate)));
});

test('瓦礫の音: 近い・大きいほど低く大きい、遠いほどこもる、読む速さは 0.74〜1.12 倍だけ（遠く小さい命中が高くならない）、左右はカメラから見た向き、同じビルはいつも同じ音（リプレイでも同じ）', () => {
  const small = collapseVoice(collapseHitInfo({ id: 'b1', w: 4, d: 4, h: 6 }, { camX: 0, camZ: -300, dist: 300 }));
  const big = collapseVoice(collapseHitInfo({ id: 'b1', w: 30, d: 30, h: 90 }, { camX: 0, camZ: -15, dist: 15 }));
  expect(big.rate).toBeLessThan(small.rate);
  expect(big.gain).toBeGreaterThan(small.gain * 3);
  expect(small.lp).toBeLessThan(2500); // 遠い崩落は高い粒が抜ける（23:01 のチリチリの元）
  expect(big.lp).toBeGreaterThan(10000);
  for (const id of ['b1', 'b2', 'b77', 'p3', 's1_2']) {
    for (const [w, dist] of [[1, 600], [4, 300], [30, 15]]) {
      const v = collapseVoice(collapseHitInfo({ id, w, d: w, h: w * 2 }, { camX: 0, camZ: -dist, dist }));
      expect(v.rate).toBeGreaterThanOrEqual(0.74);
      expect(v.rate).toBeLessThanOrEqual(1.12);
    }
  }
  expect(collapseHitInfo({ id: 'b2' }, { camX: 30, camZ: -10, dist: 32 }).pan).toBeGreaterThan(0.5);
  expect(collapseHitInfo({ id: 'b2' }, { camX: -30, camZ: 10, dist: 32 }).pan).toBeLessThan(-0.5); // 後ろでも左右に散る
  expect(collapseHitInfo({ id: 'p2' }, { camX: 0, camZ: -10, dist: 10 }).size).toBeLessThan(0.1); // 小物は小さい
  expect(collapseHitInfo({ id: 's3_4', w: 3, d: 2, h: 2 }, { camX: 0, camZ: -10, dist: 10 }).kind).toBe('settle');
  const h = collapseHitInfo({ id: 'b42', w: 10, d: 12, h: 40 }, { camX: 5, camZ: -40, dist: 41 });
  expect(collapseVoice(h)).toEqual(collapseVoice({ ...h }));
  expect(idHash('b42')).toBe(idHash('b42'));
  // 音のもと: 種で決まり、頂点 0.9、始めが大きく終わりは消える
  const a = renderCollapse(8000, 1), b = renderCollapse(8000, 1), c = renderCollapse(8000, 2);
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
  expect(Math.max(...a.map(Math.abs))).toBeCloseTo(0.9, 5);
  expect(Math.abs(a[a.length - 1])).toBeLessThan(1e-3);
  const head = energy(a.subarray(0, 0.3 * 8000).map((v) => v)), tail = energy(a.subarray(1.1 * 8000).map((v) => v));
  expect(head).toBeGreaterThan(tail * 4);
});

// 持ち主 23:01（リプレイの後のチリチリした音を、しっかりした瓦礫の崩れる音に）: 音のもとの中身を帯域で測る
test('瓦礫の音のもとは重い: スマホで聞こえる 150〜600 Hz の胴が、2 kHz より上（ガラス・金属の粒）より 6 dB 以上強い。上の粒はわずかに残る（-35 dB より上）。前の音のもと（高い粒が胴より強かった）と逆', () => {
  const SR = 24000;
  const bq = (x, type, fc) => {
    const w0 = 2 * Math.PI * fc / SR, al = Math.sin(w0) / (2 * 0.707), c = Math.cos(w0), a0 = 1 + al;
    const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = (b[0] * x[i] + b[1] * x1 + b[2] * x2 + 2 * c * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  };
  const E = (x) => x.reduce((a, v) => a + v * v, 0);
  const bandDb = (x) => {
    const tot = E(x);
    const mid = E(bq(bq(bq(bq(x, 'hp', 150), 'hp', 150), 'lp', 600), 'lp', 600));
    const hi = E(bq(bq(x, 'hp', 2000), 'hp', 2000));
    return { mid: 10 * Math.log10(mid / tot), hi: 10 * Math.log10(hi / tot) };
  };
  for (let v = 0; v < COLLAPSE.variants + COLLAPSE.settleVariants; v++) {
    const { mid, hi } = bandDb(renderCollapseVariant(SR, v));
    expect(mid - hi, `variant ${v}`).toBeGreaterThanOrEqual(6);
    expect(hi).toBeGreaterThan(-35);
  }
});

test('瓦礫の音の道: 演出の無音（白の間）では黙り、爆発が始まると開き、宇宙ではこもって弱まり、リプレイでは開いて少し控えめ', () => {
  const { ctx, audio, lim } = setup();
  audio.collapse([hit('b1')]);
  const src = ctx.nodes.find((n) => n.kind === 'src' && n.playbackRate.value !== 1);
  // 一つの音: 音のもと → こもり（その命中の low-pass）→ 大きさ → 左右。瓦礫の道の gain と low-pass（左右 → bus → lp → リミッター）
  const voiceLp = ctx.links.find(([a]) => a === src)[1];
  expect(voiceLp.kind).toBe('filter');
  const gainNode = ctx.links.find(([a]) => a === voiceLp)[1];
  expect(gainNode.kind).toBe('gain');
  const panNode = ctx.links.find(([a]) => a === gainNode)[1];
  const bus = ctx.links.find(([a]) => a === panNode)[1];
  const lp = ctx.links.find(([a]) => a === bus)[1];
  expect(lp.kind).toBe('filter');
  expect(ctx.links.some(([a, to]) => a === lp && to === lim)).toBe(true);
  audio.silence();
  expect(bus.gain.final()).toBe(0);
  audio.unsilence();
  expect(bus.gain.final()).toBe(DEBRIS_LEVEL.open);
  expect(lp.frequency.final()).toBeGreaterThanOrEqual(20000);
  audio.muffle(1.4);
  expect(lp.frequency.final()).toBeLessThanOrEqual(200);
  expect(bus.gain.final()).toBeLessThan(DEBRIS_LEVEL.open * 0.6);
  expect(bus.gain.final()).toBeGreaterThan(0);
  audio.debrisMode('replay');
  expect(lp.frequency.final()).toBeGreaterThanOrEqual(20000);
  expect(bus.gain.final()).toBe(DEBRIS_LEVEL.replay);
  expect(DEBRIS_LEVEL.replay).toBeLessThan(DEBRIS_LEVEL.open);
});

test('払うでは瓦礫の音は鳴らない: 小爆発はビルも小物も壊さず（命中なし）、爆発の音（払う）は瓦礫の音の部品を作らない', () => {
  const cfg = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0 } };
  const g = createGame({ seed: 3, cfg });
  const { ctx, audio } = setup();
  const debrisBuf = (n) => n.kind === 'src' && n.buffer?.length === Math.ceil(COLLAPSE.bufSec * Math.min(8000, COLLAPSE.sampleRate));
  let hits = [];
  g.on('hit', (e) => hits.push(e)); // main.js と同じ: 命中だけが瓦礫の音になる
  g.on('puff', () => audio.boom(PUFF));
  g.pressStart();
  for (let i = 0; i < Math.ceil(20 / CONFIG.power.chargePerSec / 0.1); i++) g.update(0.1); // 押したまま、別の指で払う
  const n0 = ctx.nodes.length;
  let puffs = 0;
  for (let k = 0; k < 3; k++) {
    if (g.canPuff && g.puff()) puffs++;
    for (let i = 0; i < 15; i++) {
      g.update(0.1);
      ctx.currentTime += 0.1;
      audio.collapse(hits.map(({ hit, target }) => collapseHitInfo({ id: hit.id, ...target }, { camX: 1, camZ: -20, dist: 20 })));
      hits = [];
    }
  }
  expect(puffs).toBeGreaterThan(0);
  const mine = ctx.nodes.slice(n0);
  expect(mine.some((n) => n.kind === 'src' || n.kind === 'osc')).toBe(true); // 払うの爆発の音は鳴った
  expect(mine.filter(debrisBuf)).toEqual([]); // 瓦礫の音は鳴らない
  expect(g.score.total).toBe(0);
  // 命中があれば鳴る（同じ道で）
  audio.collapse([hit('b7')]);
  expect(ctx.nodes.filter(debrisBuf).length).toBe(1);
});

test('リプレイの始まりで瓦礫の音の上限をまっさらに（演出の終わりにためた命中・数を持ち越さない）', () => {
  const { ctx, audio } = setup();
  const srcCount = () => ctx.nodes.filter((n) => n.kind === 'src' && n.playbackRate.value !== 1).length;
  // 演出の終わり: 上限いっぱいまで鳴らし、さらに命中をためる
  for (let f = 0; f < 30; f++) { ctx.currentTime = 10 + f / 30; audio.collapse([hit(`b${f}`), hit(`c${f}`)]); }
  const before = srcCount();
  audio.collapse([hit('x1')]); // 同時の数が埋まっていて鳴らない
  expect(srcCount()).toBe(before);
  audio.debrisMode('replay');
  audio.collapse([hit('r1')]); // リプレイの最初の崩落はすぐ鳴る（ためた古い命中ではなく、この命中）
  expect(srcCount()).toBe(before + 1);
});

test('main.js の命中の渡し方（hitFeed）: settle が一気に進めた命中はリプレイがあるとき音にしない、演出の段で選ぶ、リプレイの命中も同じ道、使ったら空', () => {
  const feed = createHitFeed();
  const target = { x: 10, z: -30, w: 12, d: 12, h: 40 };
  const project = () => ({ camX: 5, camZ: -20, dist: 25 });
  expect(feed.gameHit({ hit: { id: 'b1' }, target, settled: true }, { replayPending: true })).toBe(false);
  expect(feed.pending).toBe(0);
  expect(feed.gameHit({ hit: { id: 'b2' }, target, settled: true }, { replayPending: false })).toBe(true); // 写しが無ければ鳴らす
  feed.gameHit({ hit: { id: 'b3' }, target });
  expect(feed.drain(project).map((h) => h.id)).toEqual(['b2', 'b3']);
  expect(feed.pending).toBe(0);
  // 両手・白の間・横一線の光のあとは鳴らさない（ためない）。白が晴れて爆発が始まった段（swell）からは鳴らす
  for (const stage of ['hands', 'white', 'silence', 'rumble', 'done']) {
    feed.gameHit({ hit: { id: 'b4' }, target });
    expect(feed.drain(project, { stage })).toEqual([]);
    expect(feed.pending).toBe(0);
  }
  for (const stage of COLLAPSE_STAGES) {
    feed.gameHit({ hit: { id: 'b5' }, target });
    expect(feed.drain(project, { stage })).toHaveLength(1);
  }
  feed.replayHit({ hit: { id: 'b6' }, target });
  const [h] = feed.drain(project);
  expect(h).toEqual(collapseHitInfo({ id: 'b6', w: 12, d: 12, h: 40 }, project()));
  // 持ち主 23:01: 落ちて止まった大きな破片も、その場所から鳴る（小さな破片は鳴らさない）。id は場所から（リプレイでも同じ）
  expect(feed.settleHit({ pos: [3, 1, -7], dims: [2.5, 1.2, 1.8], size: 2.5 })).toBe(true);
  expect(feed.settleHit({ pos: [5, 1, -7], dims: [0.6, 0.4, 0.5], size: 0.6 })).toBe(false);
  const [sh] = feed.drain(project);
  expect(sh.kind).toBe('settle');
  expect(sh.id).toBe('s12_-28');
  expect(feed.pending).toBe(0);
});
