import { createRng } from '../rng.js';
import { LIMITER } from './audio.js';
import { INTRO, introBikes, whooshAt, introStreaks, streakAt, introCues, introHands, heroPan } from '../render/introTimeline.js';
import { scheduleIntroMusic } from './introMusic.js';

// 導入の音（S6）。音は画面に合わせる（持ち主 13:06）: どの音も導入の時刻表（introTimeline.js）の同じ時刻・同じ位置から決める。
//   バイク: 一台ごとの風切り（ノイズ）と推進の唸り。左右は画面の位置、大きさは近さ、高さはドップラー（whooshAt を 1/60 秒ごとに写す）
//   すき間の光の筋: 横切る向きへ流れる、帯域を絞った風切り
//   当たる音: カードの叩きつけ・すくむ・足音・握り込む・白・「最後の一撃」の各文字
//   手: 貯めの唸り（貯めた力に合わせて上がる）とせり上がり
//   3D の拍の間だけ街の低いざわめき（カードの黒では切る）
// ライブ（AudioContext）と録画（OfflineAudioContext）で同じものを組む。ノイズは決まった種で作る（録画が毎回同じ音になる）。
// ctx: BaseAudioContext、dest: つなぐ先、t0: 導入の 0 秒の ctx の時刻、tl: introTimeline。戻り値の cut() で全部すぐ止める（飛ばしたとき）
// bus: 効果音のまとめ（導入の音楽の下に置く。S6 fix1 で 0.72 → 0.55）
export const INTRO_SFX = { bus: 0.55, bike: 0.55, engine: 0.07, streak: 0.32, bed: 0.06 };

function noiseBuffers(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 2);
  const white = ctx.createBuffer(1, n, sr), brown = ctx.createBuffer(1, n, sr);
  const w = white.getChannelData(0), b = brown.getChannelData(0);
  const rng = createRng(0x1a7a0);
  let acc = 0, peak = 1e-9;
  for (let i = 0; i < n; i++) { w[i] = rng() * 2 - 1; acc = acc * 0.997 + w[i] * 0.06; b[i] = acc; peak = Math.max(peak, Math.abs(acc)); }
  for (let i = 0; i < n; i++) b[i] /= peak;
  return { white, brown };
}

// from: この導入の秒より前に始まる音は組まない（音の時計を合わせ直して途中から鳴らすとき。過去の時刻の音がまとめて鳴らない）
export function scheduleIntroSfx(ctx, dest, t0, tl, { from = 0 } = {}) {
  const { white, brown } = noiseBuffers(ctx);
  const bus = ctx.createGain();
  bus.gain.value = INTRO_SFX.bus;
  bus.connect(dest);
  const sources = [];
  const rng = createRng(0x5f0);
  const at = (t) => t0 + t;
  const past = (t) => t < from - 1e-9;

  // 音のもと
  const noise = (buf, when, dur, offset = 0) => {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.start(when, offset % 1.9); s.stop(when + dur + 0.05);
    sources.push(s);
    return s;
  };
  const osc = (type, when, dur) => {
    const o = ctx.createOscillator(); o.type = type;
    o.start(when); o.stop(when + dur + 0.05);
    sources.push(o);
    return o;
  };
  const gainNode = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const pan = (v = 0) => { const p = ctx.createStereoPanner(); p.pan.value = v; return p; };
  const env = (param, when, attack, peak, dur, curve = 'exp') => {
    param.setValueAtTime(0.0001, when);
    param.linearRampToValueAtTime(peak, when + attack);
    if (curve === 'exp') param.exponentialRampToValueAtTime(0.0001, when + dur);
    else param.linearRampToValueAtTime(0, when + dur);
  };
  // 低い一打（f0 → f1 へ下がる正弦波）
  const thump = (when, f0, f1, dur, peak, p = 0, attack = 0.004) => {
    const o = osc('sine', when, dur);
    o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = gainNode(); env(g.gain, when, attack, peak, dur);
    const pn = pan(p);
    o.connect(g); g.connect(pn); pn.connect(bus);
  };
  // ノイズの破裂（type のフィルタで f0 → f1）
  const burst = (when, dur, peak, type, f0, f1, q = 0.8, p = 0, attack = 0.002) => {
    const s = noise(white, when, dur, rng() * 1.5);
    const f = filt(type, f0, q);
    f.frequency.setValueAtTime(f0, when); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), when + dur);
    const g = gainNode(); env(g.gain, when, attack, peak, dur);
    const pn = pan(p);
    s.connect(f); f.connect(g); g.connect(pn); pn.connect(bus);
  };
  // 澄んだ響き（題字の文字。倍音を少し）
  const ring = (when, f, dur, peak, p = 0) => {
    for (const [k, a] of [[1, 1], [2.76, 0.4], [5.4, 0.16]]) {
      const o = osc('sine', when, dur);
      o.frequency.setValueAtTime(f * k, when);
      const g = gainNode(); env(g.gain, when, 0.003, peak * a, dur / Math.sqrt(k));
      const pn = pan(p);
      o.connect(g); g.connect(pn); pn.connect(bus);
    }
  };
  // 時刻 t0..t1 の値を 1/60 秒ごとに写す（setValueCurveAtTime）
  const curve = (param, when, dur, fn) => {
    const n = Math.max(2, Math.ceil(dur * 60) + 1);
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = fn((i / (n - 1)) * dur);
    param.setValueCurveAtTime(arr, when, dur);
  };

  // ---- バイク: 一台ごと ----
  const bikes = tl.beat('bikes') ? introBikes() : [];
  for (const b of bikes) {
    const start = Math.max(0, b.tp - 0.95), to = b.tp + 0.75, dur = to - start, when = at(start);
    if (past(start)) continue;
    const w = (u) => whooshAt(b, start + u);
    // 風切り: 帯域ノイズ。近いほど開いて明るく、ドップラーで帯域も動く
    const s = noise(white, when, dur, b.id * 0.31);
    const bp = filt('bandpass', 900, 0.6);
    curve(bp.frequency, when, dur, (u) => { const x = w(u); return 500 + 2600 * x.gain * x.rate ** 2; });
    const g = gainNode();
    curve(g.gain, when, dur, (u) => INTRO_SFX.bike * w(u).gain * Math.min(1, u / 0.05) * Math.min(1, (dur - u) / 0.08));
    const pn = pan();
    curve(pn.pan, when, dur, (u) => w(u).pan);
    s.connect(bp); bp.connect(g); g.connect(pn); pn.connect(bus);
    // 推進の唸り: のこぎり波をこもらせ、ドップラーで高さが落ちる
    const o = osc('sawtooth', when, dur);
    curve(o.frequency, when, dur, (u) => 150 * (0.9 + 0.2 * (b.id % 3) / 2) * w(u).rate);
    const lp = filt('lowpass', 1200, 1.2);
    const og = gainNode();
    curve(og.gain, when, dur, (u) => INTRO_SFX.engine * Math.sqrt(w(u).gain) * Math.min(1, u / 0.1) * Math.min(1, (dur - u) / 0.1));
    o.connect(lp); lp.connect(og); og.connect(pn);
    // 真上を抜ける瞬間の空気の圧
    thump(at(b.tp), 90, 42, 0.32, 0.32, Math.max(-1, Math.min(1, b.x * 0.3)));
  }

  // ---- 3D の拍の街の低いざわめき（カード・手の拍では止める）----
  for (const n of ['bikes', 'hide']) { // スポットライトの拍は街のざわめきもなし（BGM だけ）
    const B = tl.beat(n);
    if (!B || past(B.start)) continue;
    const s = noise(brown, at(B.start), B.end - B.start, B.start * 0.17);
    const lp = filt('lowpass', 260, 0.5);
    const g = gainNode();
    g.gain.setValueAtTime(0, at(B.start));
    g.gain.linearRampToValueAtTime(INTRO_SFX.bed, at(B.start) + 0.03);
    g.gain.setValueAtTime(INTRO_SFX.bed, at(B.end) - 0.02);
    g.gain.linearRampToValueAtTime(0, at(B.end));
    s.connect(lp); lp.connect(g); g.connect(bus);
  }

  // ---- 3: スポットライトには音をつけない（持ち主 19:05。BGM だけ）----

  // ---- 5: すき間の光の筋 ----
  const hide = tl.beat('hide');
  if (hide) {
    for (const st of introStreaks()) {
      const s0 = st.t - st.dur * 0.75, dur = st.dur * 1.5, when = at(hide.start + s0);
      if (past(hide.start + s0)) continue;
      const s = noise(white, when, dur, st.id * 0.41);
      const bp = filt('bandpass', 1500, 1.1);
      curve(bp.frequency, when, dur, (u) => 2400 - 1200 * Math.min(1, Math.max(0, (u - dur * 0.4) / (dur * 0.6))));
      const g = gainNode();
      curve(g.gain, when, dur, (u) => { const a = streakAt(st, s0 + u); return INTRO_SFX.streak * (1 - st.depth * 0.5) * Math.exp(-(a.u * a.u) * 1.6); });
      const pn = pan();
      curve(pn.pan, when, dur, (u) => streakAt(st, s0 + u).pan);
      s.connect(bp); bp.connect(g); g.connect(pn); pn.connect(bus);
    }
  }

  // ---- 6: 手の貯め（唸りとせり上がり）----
  const hands = tl.beat('hands');
  if (hands && !past(hands.start)) {
    const dur = INTRO.hands.releaseAt, when = at(hands.start);
    const o1 = osc('sine', when, dur), o2 = osc('sine', when, dur);
    curve(o1.frequency, when, dur, (u) => 55 + 150 * introHands(u).level);
    curve(o2.frequency, when, dur, (u) => 58.5 + 154 * introHands(u).level);
    const hg = gainNode();
    curve(hg.gain, when, dur, (u) => 0.2 * Math.min(1, introHands(u).level * 1.4) * Math.min(1, (dur - u) / 0.02));
    o1.connect(hg); o2.connect(hg); hg.connect(bus);
    // せり上がり: 帯域ノイズが上がっていく
    const s = noise(white, when, dur, 0.7);
    const bp = filt('bandpass', 400, 2);
    curve(bp.frequency, when, dur, (u) => 300 + 3200 * introHands(u).level ** 2);
    const g = gainNode();
    curve(g.gain, when, dur, (u) => 0.12 * introHands(u).level ** 1.5 * Math.min(1, (dur - u) / 0.02));
    s.connect(bp); bp.connect(g); g.connect(bus);
    // 満ちてくると、ぱちぱちと弾ける
    for (let k = 0; k < 14; k++) {
      const u = 0.8 + rng() * (dur - 0.85);
      burst(at(hands.start + u), 0.03 + 0.03 * rng(), 0.06 + 0.12 * introHands(u).level, 'highpass', 3000 + 3000 * rng(), 2500, 0.7, rng() * 1.2 - 0.6);
    }
  }

  // ---- 当たる音 ----
  for (const c of introCues(tl)) {
    if (past(c.t)) continue;
    const w = at(c.t);
    if (c.name === 'flinch') {
      burst(w, 0.14, 0.4, 'highpass', 2600, 1500, 0.8);
      thump(w, 150, 55, 0.4, 0.55);
      ring(w, 1180, 0.5, 0.05, 0);
    } else if (c.name === 'step') {
      const p = heroPan(tl, c.t); // 主人公の画面の左右（走り去る・駆け込む向きに足音が流れる）
      thump(w, 130, 70, 0.1, 0.24, p, 0.002);
      burst(w, 0.05, 0.1, 'lowpass', 1600, 400, 0.7, p);
    } else if (c.name === 'grip') {
      thump(w, 120, 32, 0.95, 0.9, 0, 0.002);
      burst(w, 0.2, 0.42, 'lowpass', 6000, 300, 0.6);
      // 握り込んだ芯が燃える低い唸り（白まで）
      const o = osc('sine', w, 0.8);
      o.frequency.setValueAtTime(66, w);
      const g = gainNode();
      g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.16, w + 0.08); g.gain.setValueAtTime(0.16, w + 0.65); g.gain.linearRampToValueAtTime(0, w + 0.75);
      o.connect(g); g.connect(bus);
    }
    // 白と「最後の一撃」の文字は無音（持ち主 18:02 / 18:07）
  }

  // 導入の音楽（BGM の最高潮。力を放つ瞬間で止まる）。効果音のまとめとは別の道で同じ出口へ
  const music = scheduleIntroMusic(ctx, dest, t0, tl, { from });

  let cutDone = false;
  return {
    bus, music,
    // 飛ばした: すぐ（30 ms で）消して、鳴る予定の音も止める
    cut() {
      if (cutDone) return;
      cutDone = true;
      music.cut(0.25);
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + 0.03);
      for (const s of sources) { try { s.stop(now + 0.05); } catch { /* もう止まっている */ } }
      setTimeout(() => { try { bus.disconnect(); } catch { /* もう外れている */ } }, 120);
    },
  };
}

// 録画用: 導入の音を OfflineAudioContext で書き出す（ライブと同じ組み方、同じリミッター）。左右の Float32Array と、
// リミッターの前後の一番大きな値（割れていないかの確かめ）を返す
export async function renderIntroAudio(tl, { sampleRate = 48000, tail = 1.5 } = {}) {
  const len = Math.ceil((tl.total + tail) * sampleRate);
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  const limiter = ctx.createDynamicsCompressor();
  for (const k of Object.keys(LIMITER)) limiter[k].value = LIMITER[k];
  limiter.connect(ctx.destination);
  scheduleIntroSfx(ctx, limiter, 0, tl);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  // リミッターの前（そのままつないだ音）の一番大きな値
  const raw = new OfflineAudioContext(2, len, sampleRate);
  scheduleIntroSfx(raw, raw.destination, 0, tl);
  const rb = await raw.startRendering();
  let rawPeak = 0;
  for (const ch of [rb.getChannelData(0), rb.getChannelData(1)]) for (let i = 0; i < ch.length; i++) rawPeak = Math.max(rawPeak, Math.abs(ch[i]));
  return { left: L, right: R, sampleRate, peak, rawPeak };
}
