// Web Audio で合成する音。素材ファイルは使わない。
import { COLLAPSE, createCollapseGate, collapseVoice, renderCollapse } from './collapse.js';
// 世界の音は master を経由するので、silence で全部まとめて黙らせられる（演出の音は cine から鳴る）。
// boom を鳴らすまでの待ち（秒）: 無音の間（silenceEnd まで）に弾けても、無音が明けてから鳴らす
export function boomDelay(silenceEnd, now) {
  return Math.max(0, silenceEnd - now);
}

// 最後の天井（リミッター）: 効果音・演出の音・BGM はすべてこれを通ってスピーカーへ。
// 最高潮の BGM に払うの爆発と貯めの唸りが重なっても 1 を超えず、スマホで割れない（天井 -2 dBFS、強い比、速いアタック）
export const LIMITER = { threshold: -2, knee: 0, ratio: 20, attack: 0.002, release: 0.2 };

// 爆発の音の設計図（音の部品は知らない純粋な関数。boom が組み立てる）。実際の爆発の聞こえ方を層に分ける:
//   crack  最初の衝撃。数十 ms の広帯域のノイズの破裂（近いほど明るく大きい）
//   punch  衝撃の芯。急に下がる低い一打（大きいほど低く長い）
//   roar   続くうなり。明るい轟音が暗く落ちていく（大きいほど長く暗い。最後の一発は hold の間鳴り続け、open の間に開く）
//   air    空気を裂く中域のノイズ（帯域が下がりながら消える）
//   sub    地響き。超低域がゆっくり来てゆっくり引き、揺れる（wobble）
//   taps   遠くのビルから遅れて届く反射音（大きいほど遅く、遠いものほど暗く小さく、左右に散る）
//   debris 崩れる破片のぱらぱら（衝撃のあとに始まり、だんだん疎らに。粒は重ならない）
// 時間はすべて爆発の瞬間からの秒。rng は粒と反射音のばらつき（テストで決まった値にする）
// heavy 0〜1（最後の一発だけ 1。持ち主の要望 09:59「最後の爆発音はもっと重く」）: 立ち上がり（attack）はそのまま鋭く、
//   低い一打をさらに低く長く強く歪ませ（drive。120〜250 Hz の倍音でスマホでも重い）、80〜180 Hz の胴（body: 下がる正弦波と
//   帯域ノイズ）を足し、衝撃の 0.15〜0.6 秒あとに圧がふくらむ（swell: うなりと胴を +3 dB、地響きの low-pass を 400 Hz まで開く）。
//   うなりの尾を長く、地響きを少し厚く、超低域の層（deep）は 30 Hz より上だけ（スマホで鳴らない音でリミッターの余裕を食わない）。
//   heavy 0 のとき（払う・ふつうの一発）は前と同じ値（乱数の使い方も同じ）
export function boomRecipe(size, { hold = 0, open = 0, heavy = 0, rng = Math.random } = {}) {
  const s = Math.max(0, Math.min(1, size));
  const h = Math.max(0, hold);
  const hv = Math.max(0, Math.min(1, heavy));
  const crack = { dur: 0.03 + 0.045 * s, attack: 0.001, hp: 1100 - 650 * s, gain: (0.62 - 0.17 * s) * (1 - 0.1 * hv) };
  const punch = {
    f0: (150 - 95 * s) * (1 - 0.32 * hv), f1: (48 - 24 * s) * (1 - 0.3 * hv), dur: (0.16 + 0.55 * s) * (1 + 0.7 * hv),
    attack: 0.003, gain: 0.55 + 0.15 * s + 0.05 * hv, drive: 2.2 + 1.3 * hv,
  };
  const roarDur = (0.5 + 3.0 * s) * (1 + 0.55 * hv);
  const roar = {
    dur: roarDur + h, hold: h, open: Math.max(0, open), f0: 5200 - 3000 * s, f1: 170 - 100 * s,
    attack: 0.004 + 0.02 * s, gain: 0.34 + 0.2 * s, drop: 0.4, knee: (0.08 + 0.35 * s) * (1 + 0.6 * hv),
    tail: 2.2 * hv, // 重い一発だけ: hold のあと、この秒をかけてゆっくり半分へ（うなりの尾が長く残る）
  };
  const air = { dur: 0.22 + 1.2 * s, freq: 1700 - 800 * s, q: 1.1, attack: 0.002, gain: 0.22 + 0.06 * s };
  const sub = {
    // S8 fix1: 重い一発の地響きの尾（保つ秒のあと消えるまで）を 1.4 → 1.8 倍に（見せる期を延ばして保つ秒が延びた分、前の版より
    // 長く残る差が縮んでいた）
    dur: (0.45 + 4.6 * s ** 1.3) * (1 + 0.8 * hv) + h, hold: h, cutoff: 115 - 60 * s,
    attack: 0.015 + 0.2 * s, gain: (0.3 + 0.6 * s) * (1 + 0.15 * hv),
    wobble: { rate: (6 - 3 * s) * (0.9 + 0.2 * rng()), depth: 0.1 + 0.18 * s },
  };
  // 超低域の層: 一打のあとに残る、ゆっくり下がる低い正弦波（30 Hz より下は high-pass で切る）
  const deep = hv > 0 ? { f0: 52 - 4 * s, f1: 34 - 2 * s, dur: 3.0 * hv + 0.4 * Math.min(h, 3), attack: 0.03, gain: 0.3 * hv, hp: 30 } : null;
  // 胴（80〜180 Hz）: 一打の倍の高さで下がる正弦波と、帯域ノイズ。一打と同じ強い歪みに通す
  const body = hv > 0 ? {
    f0: 2 * (150 - 95 * s) * (1 - 0.32 * hv) + 15, f1: 55, dur: 1.4, attack: 0.004, gain: 0.25 * hv,
    noise: { freq: 130, q: 0.9, gain: 0.3 * hv, dur: 1.3, attack: 0.006 },
  } : null;
  // 圧のふくらみ: 衝撃の at〜end 秒、うなりと胴を gain 倍（peak 秒が最大）、地響きの low-pass を lp Hz へ開く
  const swell = hv > 0 ? { at: 0.15, peak: 0.35, end: 0.6, gain: 10 ** (3 * hv / 20), lp: 400 } : null;
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
    const chunk = rng() < 0.15; // ときどき重い塊
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
  // 全体の大きさ: 大きいほど少しだけ大きい（リミッターが重なりを受け止める）
  return { size: s, heavy: hv, level: (0.85 + 0.15 * s) * (1 - 0.15 * hv), crack, punch, roar, air, sub, deep, body, swell, taps, debris: { grains } };
}

// 最後の一発の爆発の音の取り決め（演出の時刻表 tl から）: 時間が戻る瞬間（resume。ガラスの一拍の終わり、肩越しの乗り手が
// 光の壁に飲まれる直前）から宇宙へ切り替わる（chaseEnd）までうなりと地響きが鳴り続け、burstRamp 秒でこもった音から開く
// heavy: 最後の一発はいちばん重い音（boomRecipe）
export function finaleBoomOpts(tl, burstRamp) {
  return { hold: Math.max(0, tl.chaseEnd - (tl.resume ?? tl.snap)), open: Math.max(0, burstRamp), heavy: 1 };
}

// 最後の一発の地響き（持ち主の要望 09:59）: 時間が戻る（resume）と地の底から湧き、じわじわ期の残りの間にふくらみ、
// 弾ける（snap）直後に最大、見せる期（追われる間）ずっとうなり、宇宙（chaseEnd）でこもって弱まり、横一線の光が消える
// （lineEnd）ときに消える。そのあとの無音 → 地鳴り（deepRumble）へつなぐ。
// 演出の秒ごとの大きさ g（0〜1）と、低域の通し幅 f（Hz。宇宙でこもる）の折れ線
export const RUMBLE = { gain: 0.42, slow: { rate: 0.85, depth: 0.32 }, shake: { rate: 6.5, depth: 0.12 }, grit: 0.16 };
// 瓦礫の崩れる音の道の大きさ（ふつう・リプレイ・宇宙でこもったとき）。重くした最後の一発と地響きの上でリミッターの余裕を残す
export const DEBRIS_LEVEL = { open: 0.8, replay: 0.6, muffled: 0.35 };
export function rumbleKeys(tl) {
  const r0 = tl.resume ?? tl.beatEnd, snap = tl.snap, ce = Math.max(tl.chaseEnd, snap + 0.6);
  const lineEnd = Math.max(tl.lineEnd, ce + 0.6), flat = Math.min(Math.max(tl.flatten, ce + 0.45), lineEnd - 0.1);
  return [
    { t: r0, g: 0, f: 90 },
    { t: snap, g: 0.45, f: 130 },
    { t: snap + 0.3, g: 1, f: 170 },
    { t: (snap + 0.3 + ce) / 2, g: 0.92, f: 160 },
    { t: ce, g: 0.85, f: 150 },
    { t: ce + 0.4, g: 0.5, f: 70 },
    { t: flat, g: 0.3, f: 60 },
    { t: lineEnd, g: 0, f: 50 },
  ];
}
// 演出の t の地響き（折れ線の間はまっすぐ。前後は 0）
export function rumbleAt(keys, t) {
  if (t <= keys[0].t || t >= keys[keys.length - 1].t) return { g: 0, f: t <= keys[0].t ? keys[0].f : keys[keys.length - 1].f };
  let i = 1;
  while (keys[i].t < t) i++;
  const a = keys[i - 1], b = keys[i], u = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return { g: a.g + (b.g - a.g) * u, f: a.f + (b.f - a.f) * u };
}

// 爆発の衝撃と地響きを軽く歪ませる曲線（tanh。k が大きいほど強く）
function softClip(k, n = 1024) {
  const c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}
const punchCurve = softClip(2.2), subCurve = softClip(1.6), rumbleCurve = softClip(2.6);
const driveCurves = new Map([[2.2, punchCurve]]); // 一打の歪みの曲線（drive ごとに一度だけ作る。払う・ふつうの一発は前と同じ曲線）
const driveCurve = (k) => { if (!driveCurves.has(k)) driveCurves.set(k, softClip(k)); return driveCurves.get(k); };

// 爆発の音のまとめの道の天井: 払うが続けて重なる・大きな一発と重なると、鋭い衝撃の頭がリミッター（アタック 2 ms）を
// すり抜けて 1 を超えることがある。爆発の音だけをまとめて、knee までは素通し、その上はなめらかに ceil へ寄せる
// （入力 ±range を曲線の ±1 に写す。ゲインは前段の 1 / range）
export const BOOM_CLIP = { range: 2, knee: 0.6, ceil: 1.0 };
export function boomClipCurve({ range, knee, ceil } = BOOM_CLIP, n = 2049) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * range, a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
  }
  return c;
}

// AudioParam の一打の形: 無音から attack で peak へ、dur で無音へ（指数）
function env(param, t, attack, peak, dur) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + dur);
}

export function createAudio() {
  let silenceEnd = 0;
  let ctx = null, master = null, hum = null, rumbleNode = null, noiseBuf = null, brownBuf = null;
  // 最後の一発の演出: 世界の音（master）と演出の音（cine: 心臓の鼓動・地鳴り）は、どちらも out のこもりを通る
  let cine = null, out = null;
  // BGM の出口（bgm.js が鳴らす）。最後の一発の演出の無音・こもり・地鳴り（master と out を動かす）とは別の道で、
  // master・out を通さずリミッターへ直接つなぐ: 地鳴りが master を 0 に保つ間にも、リプレイの静かな変奏を鳴らせるように。
  // BGM は放った瞬間に自分で止まるので、演出の無音を邪魔しない
  let bgmBus = null;
  let boomBus = null; // 爆発の音のまとめ（天井の曲線を通って master へ）
  let drone = null; // 時間切れの結末の低い唸り（鳴っている間だけ）
  let hidden = false; // タブが隠れている間（suspend から resume まで）
  // 瓦礫の崩れる音の道: 音のもと（起動時に数種類だけ書き出して使い回す）→ 一つごとの大きさ・左右 → debrisBus → debrisLp →
  // リミッター。master を通さない（地鳴りが master を 0 に保つ間に始まるリプレイでも鳴らせるように）。
  // 演出の無音の間は黙り、宇宙ではこもる（debrisMode）
  let debrisBus = null, debrisLp = null, collapseBufs = [];
  const collapseGate = createCollapseGate();
  let rumbleSrcs = null; // 最後の一発の地響き（鳴っている間だけ）
  let transitNodes = null; // S8: 電車と高速の音（最初に鳴らすときに作る）
  let clatterPhase = 0;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const limiter = ctx.createDynamicsCompressor();
    for (const k of Object.keys(LIMITER)) limiter[k].value = LIMITER[k];
    limiter.connect(ctx.destination);
    out = ctx.createBiquadFilter();
    out.type = 'lowpass'; out.frequency.value = 20000; out.Q.value = 0.5;
    out.connect(limiter);
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(out);
    cine = ctx.createGain();
    cine.gain.value = 0.9;
    cine.connect(out);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // 地響き用のブラウンノイズ（低域に力がある。白いノイズを積分して、ずれを漏らし、大きさをそろえる）
    brownBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const bd = brownBuf.getChannelData(0);
    let acc = 0, peak = 1e-9;
    for (let i = 0; i < bd.length; i++) { acc = acc * 0.998 + d[i] * 0.05; bd[i] = acc; peak = Math.max(peak, Math.abs(acc)); }
    for (let i = 0; i < bd.length; i++) bd[i] /= peak;
    // 貯めの唸り: 低い正弦波 2 つの周波数差がうなりになる
    const humGain = ctx.createGain(); humGain.gain.value = 0;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = o2.type = 'sine';
    o1.connect(humGain); o2.connect(humGain); humGain.connect(master);
    o1.start(); o2.start();
    hum = { o1, o2, gain: humGain };
    // 爆発のじわじわ期の低い脈動
    const rg = ctx.createGain(); rg.gain.value = 0;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
    lfo.connect(lfoGain); lfoGain.connect(rg.gain);
    src.connect(lp); lp.connect(rg); rg.connect(master);
    src.start(); lfo.start();
    rumbleNode = { gain: rg, lfoGain };
    bgmBus = ctx.createGain();
    bgmBus.gain.value = 1;
    bgmBus.connect(limiter);
    boomBus = ctx.createGain();
    boomBus.gain.value = 1 / BOOM_CLIP.range;
    const clip = ctx.createWaveShaper(); clip.curve = boomClipCurve(); clip.oversample = '2x';
    boomBus.connect(clip); clip.connect(master);
    debrisLp = ctx.createBiquadFilter();
    debrisLp.type = 'lowpass'; debrisLp.frequency.value = 20000; debrisLp.Q.value = 0.5;
    debrisLp.connect(limiter);
    debrisBus = ctx.createGain(); debrisBus.gain.value = DEBRIS_LEVEL.open;
    debrisBus.connect(debrisLp);
    // 音のもとは最初のタップで一度に作らず、一つずつ間をあけて書き出す（中くらいの Android で、タップの瞬間に引っかからない）。
    // 鳴らす時までにできていなければ、そのとき作る
    // 24 kHz で作る（崩れる音の上の方は 12 kHz までで足りる。書き出しの手間が半分。再生のときに出口の速さへ直される）。
    // ブラウザの手が空いたとき（requestIdleCallback。無ければ少し間をあけた setTimeout）に一つずつ
    collapseBufs = new Array(COLLAPSE.variants).fill(null);
    let next = 0;
    const later = (f) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 2000 })
      : typeof setTimeout === 'function' ? setTimeout(f, 50) : null);
    const idle = () => { if (next < COLLAPSE.variants) { collapseBuf(next++); later(idle); } };
    later(idle);
  }
  function collapseBuf(v) {
    if (!collapseBufs[v]) {
      const sr = Math.min(ctx.sampleRate, COLLAPSE.sampleRate);
      const data = renderCollapse(sr, v + 1);
      const b = ctx.createBuffer(1, data.length, sr);
      b.getChannelData(0).set(data);
      collapseBufs[v] = b;
    }
    return collapseBufs[v];
  }

  // 瓦礫の音の道の状態: open（ふつう）・off（演出の無音）・muffled（宇宙。こもって弱く）・replay（リプレイ。少し控えめ）
  function setDebris(mode) {
    if (!debrisBus) return;
    const t = now(), g = debrisBus.gain, f = debrisLp.frequency;
    g.cancelScheduledValues(t); f.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t); f.setValueAtTime(f.value, t);
    if (mode === 'off') { g.linearRampToValueAtTime(0, t + 0.02); f.setValueAtTime(20000, t + 0.02); }
    else if (mode === 'muffled') { f.exponentialRampToValueAtTime(160, t + 0.4); g.linearRampToValueAtTime(DEBRIS_LEVEL.muffled, t + 0.4); }
    else { f.setValueAtTime(20000, t); g.setValueAtTime(mode === 'replay' ? DEBRIS_LEVEL.replay : DEBRIS_LEVEL.open, t); }
  }

  const ready = () => ctx && ctx.state === 'running';
  const now = () => ctx.currentTime;

  function noiseBurst({ dur, freq, gain, attack = 0.005, when = 0, q = 0.7, dest = null }) {
    const t = now() + when;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = q;
    lp.frequency.setValueAtTime(freq, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.15), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(g); g.connect(dest ?? master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  // 低い正弦波の一打（周波数は f0 から f1 へ下がる）
  function thump({ f0, f1, dur, gain, when = 0, dest, attack = 0.008 }) {
    const t = now() + when;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  return {
    // 最初のユーザー操作で呼ぶ（ブラウザの自動再生の制限）
    unlock() {
      if (!ctx) build();
      if (ctx && ctx.state !== 'running') ctx.resume();
    },
    get running() { return !!ctx && ctx.state === 'running'; },
    // BGM の出口（unlock の前は null）
    get bgmOutput() { return ctx && bgmBus ? { ctx, dest: bgmBus } : null; },
    // タブが隠れた / 戻った。止める処理（suspend）は少しあとで終わるので、終わったときにもう戻っていたら鳴らし直す
    // （すぐ戻ると、戻した時点ではまだ running のままで、そのあと止まりっぱなしになる）。
    // 戻ったら suspended でなくても（iOS の interrupted など）鳴らし直す
    suspend() {
      hidden = true;
      if (!ctx || ctx.state !== 'running') return;
      Promise.resolve(ctx.suspend()).then(() => { if (!hidden && ctx.state !== 'running') ctx.resume(); }, () => {});
    },
    resume() {
      hidden = false;
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') Promise.resolve(ctx.resume()).catch(() => {});
    },
    // level 0〜1。0 で止まる
    chargeHum(level) {
      if (!ready()) return;
      const l = Math.max(0, Math.min(1, level));
      const t = now();
      const f = 55 + 150 * l;
      hum.o1.frequency.setTargetAtTime(f, t, 0.05);
      hum.o2.frequency.setTargetAtTime(f + 2 + 7 * l, t, 0.05);
      hum.gain.gain.setTargetAtTime(l > 0 ? 0.05 + 0.2 * l : 0, t, 0.08);
    },
    // 爆発のじわじわ期の低い脈動。level 0〜1、0 で止まる
    rumble(level) {
      if (!ready()) return;
      const l = Math.max(0, Math.min(1, level));
      const t = now();
      rumbleNode.gain.gain.setTargetAtTime(l > 0 ? 0.25 * l + 0.08 : 0, t, 0.15);
      rumbleNode.lfoGain.gain.setTargetAtTime(0.12 * l, t, 0.15);
    },
    // ---- 最後の一発の演出 ----
    // 放った瞬間から、世界の音を消す（演出の音だけが鳴る）
    silence() {
      if (!ready()) return;
      const t = now();
      silenceEnd = Infinity;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0, t);
      out.frequency.cancelScheduledValues(t);
      out.frequency.setValueAtTime(20000, t);
      setDebris('off');
    },
    // 時間が戻る: 世界の音が一気に戻る
    unsilence() {
      if (!ready()) return;
      const t = now();
      silenceEnd = t;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.8, t);
      setDebris('open');
    },
    // 心臓の鼓動（ドクン）。i: 何回目か（だんだん強く）
    heartbeat(i = 0) {
      if (!ready()) return;
      const k = Math.min(1, 0.6 + 0.2 * i);
      thump({ f0: 62, f1: 38, dur: 0.22, gain: 0.85 * k, dest: cine });
      noiseBurst({ dur: 0.09, freq: 160, gain: 0.25 * k, attack: 0.004, dest: cine });
      thump({ f0: 70, f1: 44, dur: 0.18, gain: 0.55 * k, when: 0.21, dest: cine });
      noiseBurst({ dur: 0.07, freq: 140, gain: 0.15 * k, attack: 0.004, when: 0.21, dest: cine });
    },
    // 宇宙へ: 音が遠くこもって消えていく（sec 秒で無音へ）
    muffle(sec = 1.5) {
      if (!ready()) return;
      const t = now();
      out.frequency.cancelScheduledValues(t);
      out.frequency.setValueAtTime(900, t);
      out.frequency.exponentialRampToValueAtTime(140, t + 0.4);
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.8, t);
      master.gain.linearRampToValueAtTime(0, t + sec);
      setDebris('muffled');
    },
    // 最後の一発の地響き（rumbleKeys）。時間が戻る瞬間（演出の resume。cue 'snap'）に呼ぶと、時刻表どおりに最後まで予定する。
    // 演出の道（cine）から鳴る（世界の音が宇宙で消えても、こもって残る）。ブラウンノイズの超低域に、軽い歪みの倍音と
    // 低い帯域のざらつき（スマホでも聞こえる）、ゆっくりしたうねりと細かい揺れを持たせる
    finaleRumble(tl) {
      if (!ready()) return;
      this.rumbleStop();
      const keys = rumbleKeys(tl), t0 = now() - keys[0].t, end = keys[keys.length - 1].t;
      const src = ctx.createBufferSource(); src.buffer = brownBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
      const grit = ctx.createBufferSource(); grit.buffer = noiseBuf; grit.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 230; bp.Q.value = 1.1;
      const gg = ctx.createGain(); gg.gain.value = RUMBLE.grit;
      const g = ctx.createGain();
      for (const [i, k] of keys.entries()) {
        const at = t0 + k.t, v = Math.max(0.0001, k.g * RUMBLE.gain);
        if (i === 0) { g.gain.setValueAtTime(0.0001, at); lp.frequency.setValueAtTime(k.f, at); }
        else { g.gain.linearRampToValueAtTime(v, at); lp.frequency.linearRampToValueAtTime(k.f, at); }
      }
      const wob = ctx.createGain(); wob.gain.value = 1;
      const lfos = [RUMBLE.slow, RUMBLE.shake].map(({ rate, depth }) => {
        const o = ctx.createOscillator(); o.frequency.value = rate;
        const og = ctx.createGain(); og.gain.value = depth;
        o.connect(og); og.connect(wob.gain);
        return o;
      });
      const ss = ctx.createWaveShaper(); ss.curve = rumbleCurve;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 24; hp.Q.value = 0.7;
      src.connect(lp); lp.connect(g); grit.connect(bp); bp.connect(gg); gg.connect(g);
      g.connect(wob); wob.connect(ss); ss.connect(hp); hp.connect(cine);
      const stopAt = t0 + end + 0.1;
      rumbleSrcs = [src, grit, ...lfos];
      for (const n of rumbleSrcs) { n.start(now()); n.stop(stopAt); }
    },
    rumbleStop() {
      if (!rumbleSrcs || !ready()) { rumbleSrcs = null; return; }
      for (const n of rumbleSrcs) n.stop(now() + 0.05);
      rumbleSrcs = null;
    },
    // 瓦礫の崩れる音。hits: このフレームの命中（collapseHitInfo の { id, size, near, pan }）。毎フレーム呼んでよい
    // （空でも、ためた命中を間隔が空いたら鳴らす）。頻度の上限（collapse.js）を超えた分は、いちばん大きい一つにまとめる
    collapse(hits) {
      if (!ready() || !collapseBufs.length) return;
      const pick = collapseGate.take(hits, now());
      if (!pick) return;
      const v = collapseVoice(pick.hit, pick.merged);
      const t = now();
      const src = ctx.createBufferSource(); src.buffer = collapseBuf(v.variant);
      src.playbackRate.value = v.rate;
      const g = ctx.createGain(); g.gain.value = v.gain;
      const pan = ctx.createStereoPanner(); pan.pan.value = v.pan;
      src.connect(g); g.connect(pan); pan.connect(debrisBus);
      src.start(t); src.stop(t + v.dur + 0.02);
    },
    // S8: 電車の走行音・継ぎ目の音と、高速の風切り（transitSound.js の transitMix）。毎フレーム呼ぶ。null で消していく。
    // 世界の音（master）を通るので、演出の無音・宇宙のこもりにも従う
    transit(mix, dt = 0) {
      if (!ready()) return;
      const t = now();
      if (!transitNodes) {
        if (!mix) return;
        const mk = (buf, type, f, q) => {
          const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
          const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
          const g = ctx.createGain(); g.gain.value = 0;
          const pan = ctx.createStereoPanner();
          src.connect(flt); flt.connect(g); g.connect(pan); pan.connect(master);
          src.start(t, Math.random());
          return { src, flt, g, pan };
        };
        const train = mk(brownBuf, 'lowpass', 150, 0.7);
        const hiss = mk(noiseBuf, 'bandpass', 1900, 0.55);
        // 車の流れのうねり（ゆっくり強弱）
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
        const lg = ctx.createGain(); lg.gain.value = 0;
        lfo.connect(lg); lg.connect(hiss.g.gain); lfo.start(t);
        const clatter = ctx.createGain(); clatter.gain.value = 1; clatter.connect(train.pan);
        transitNodes = { train, hiss, lfoGain: lg, clatter, clatterLevel: 0 };
      }
      const n = transitNodes;
      const m = mix ?? { train: { gain: 0, clatter: 0, pan: 0, rate: 0 }, hiss: { gain: 0, pan: 0 } };
      n.train.g.gain.setTargetAtTime(m.train.gain, t, 0.25);
      n.train.pan.pan.setTargetAtTime(m.train.pan, t, 0.15);
      n.hiss.g.gain.setTargetAtTime(m.hiss.gain, t, 0.3);
      n.lfoGain.gain.setTargetAtTime(m.hiss.gain * 0.35, t, 0.3);
      n.hiss.pan.pan.setTargetAtTime(m.hiss.pan, t, 0.2);
      // 継ぎ目のガタン・ゴトン（台車の前と後ろ）。速さに合わせて刻む
      if (m.train.clatter > 1e-4 && m.train.rate > 0 && dt > 0) {
        clatterPhase += dt * m.train.rate;
        if (clatterPhase >= 1) {
          clatterPhase %= 1;
          for (const [when, k] of [[0, 1], [0.11, 0.8]]) noiseBurst({ dur: 0.07, freq: 1100, gain: m.train.clatter * k, attack: 0.003, when, q: 1.4, dest: n.clatter });
        }
      }
    },
    // 瓦礫の音の道の状態（リプレイの始まりで 'replay'、遊びに戻ったら 'open'）
    debrisMode(mode) {
      if (!ready()) return;
      if (mode === 'replay') collapseGate.reset(); // リプレイは同じ崩落を最初から（演出の終わりにためた命中・上限の数を持ち越さない）
      setDebris(mode);
    },
    // 無音のあとの、低い地鳴り（長くゆっくり来て、ゆっくり引く）
    deepRumble() {
      if (!ready()) return;
      const t = now();
      out.frequency.cancelScheduledValues(t);
      out.frequency.setValueAtTime(400, t);
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 70; lp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.9, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      src.connect(lp); lp.connect(g); g.connect(cine);
      src.start(t); src.stop(t + 6.1);
      thump({ f0: 36, f1: 24, dur: 5, gain: 0.5, dest: cine, attack: 1.0 });
      // 地鳴りが引いたら、こもりと世界の音量を元に戻す（このあとの音がこもったまま・無音のままにならない）
      const back = t + 6.2;
      out.frequency.setValueAtTime(400, back);
      out.frequency.exponentialRampToValueAtTime(20000, back + 0.3);
      master.gain.cancelScheduledValues(back);
      master.gain.setValueAtTime(0, back);
      master.gain.linearRampToValueAtTime(0.8, back + 0.3);
    },
    // ---- 時間切れの結末（ブラックホール）----
    // 低い唸り: rise 秒かけて、うなる低音（正弦波と鋸歯の重なり）が上がりながら強まり、吸い込む風の音が細く高くなる。
    // 演出の道（cine）から鳴らす。droneCut でぴたりと止める（何もない空間の無音）
    blackholeDrone(rise = 7) {
      if (!ready()) return;
      this.droneCut();
      const t = now(), end = t + rise;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 1.5);
      g.gain.linearRampToValueAtTime(0.85, end);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
      lp.frequency.setValueAtTime(90, t); lp.frequency.exponentialRampToValueAtTime(900, end);
      lp.connect(g);
      const srcs = [];
      const osc = (type, f0, f1, gain, dest) => {
        const o = ctx.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, end);
        const og = ctx.createGain(); og.gain.value = gain;
        o.connect(og); og.connect(dest); o.start(t); o.stop(end + 3);
        srcs.push(o);
      };
      osc('sine', 29, 52, 0.9, g);
      osc('sawtooth', 29.4, 52.9, 0.35, lp);
      osc('sine', 43.5, 78, 0.25, g); // 五度上の薄い倍音
      // 吸い込む風: 帯域のノイズが細く高くなる
      const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
      bp.frequency.setValueAtTime(180, t); bp.frequency.exponentialRampToValueAtTime(1600, end);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.5, end);
      n.connect(bp); bp.connect(ng); ng.connect(g);
      n.start(t); n.stop(end + 3);
      srcs.push(n);
      g.connect(cine);
      drone = { g, srcs };
    },
    droneCut() {
      if (!drone || !ready()) { drone = null; return; }
      const t = now();
      drone.g.gain.cancelScheduledValues(t);
      drone.g.gain.setValueAtTime(drone.g.gain.value, t);
      drone.g.gain.linearRampToValueAtTime(0.0001, t + 0.05);
      for (const s of drone.srcs) s.stop(t + 0.1);
      drone = null;
    },
    // 爆発の音（boomRecipe の層を組み立てる）。size 0〜1: 大きいほど長く・低く・反射音が遅れて届く。
    // opts.hold / opts.open: 最後の一発だけ（演出の時刻表の「弾ける」から追われる間ずっと鳴り続け、時間が戻る間に開く）
    boom(size, opts = {}) {
      if (!ready()) return;
      const wait = boomDelay(silenceEnd, now());
      if (!Number.isFinite(wait)) return; // 演出の無音の間は鳴らさない
      const r = boomRecipe(size, opts);
      const t = now() + wait;
      const bus = ctx.createGain(); bus.gain.value = r.level; bus.connect(boomBus);
      // 反射音へ送る道（衝撃・中域・うなりの一部）。遠くのビルから遅れて、暗く小さく、左右から返ってくる
      const send = ctx.createGain(); send.gain.value = 1;
      for (const tap of r.taps) {
        const d = ctx.createDelay(2); d.delayTime.value = tap.delay;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = tap.cutoff; lp.Q.value = 0.6;
        const g = ctx.createGain(); g.gain.value = tap.gain;
        const pan = ctx.createStereoPanner(); pan.pan.value = tap.pan;
        send.connect(d); d.connect(lp); lp.connect(g); g.connect(pan); pan.connect(bus);
      }
      const noise = (buf, end, loop = false) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = loop;
        src.start(t, Math.random() * (loop ? buf.duration ?? 1 : 0.5)); src.stop(t + end + 0.05);
        return src;
      };
      // 1. 最初の衝撃: 広帯域のノイズの破裂と、急に下がる低い一打。軽く歪ませて（倍音で小さなスピーカーでも重く）
      const shaper = ctx.createWaveShaper(); shaper.curve = driveCurve(r.punch.drive); shaper.connect(bus); shaper.connect(send);
      const c = r.crack, crackSrc = noise(noiseBuf, c.dur);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = c.hp; hp.Q.value = 0.5;
      const cg = ctx.createGain(); env(cg.gain, t, c.attack, c.gain, c.dur);
      // 重い一発の一打は強く歪ませるが、最初の破裂は前と同じ曲線のまま（立ち上がりの音色はそのまま、頭がリミッターをすり抜けない）
      let crackShaper = shaper;
      if (driveCurve(r.punch.drive) !== punchCurve) { // （shaper.curve は読むと写しが返るので、曲線そのものを比べる）
        crackShaper = ctx.createWaveShaper(); crackShaper.curve = punchCurve; crackShaper.connect(bus); crackShaper.connect(send);
      }
      crackSrc.connect(hp); hp.connect(cg); cg.connect(crackShaper);
      const p = r.punch, o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(p.f0, t); o.frequency.exponentialRampToValueAtTime(p.f1, t + p.dur * 0.6);
      const pg = ctx.createGain(); env(pg.gain, t, p.attack, p.gain, p.dur);
      o.connect(pg); pg.connect(shaper); o.start(t); o.stop(t + p.dur + 0.05);
      // 圧のふくらみ（最後の一発だけ）: うなりと胴の後ろの gain が at〜end の間だけふくらむ
      const sw = r.swell;
      let swG = null;
      if (sw) {
        swG = ctx.createGain();
        swG.gain.setValueAtTime(1, t + sw.at);
        swG.gain.linearRampToValueAtTime(sw.gain, t + sw.peak);
        swG.gain.linearRampToValueAtTime(1, t + sw.end);
        swG.connect(bus);
      }
      // 1b. 胴（最後の一発だけ）: 80〜180 Hz の下がる正弦波と帯域ノイズを、一打と同じ強い歪みに通す
      if (r.body) {
        const y = r.body, bO = ctx.createOscillator(); bO.type = 'sine';
        bO.frequency.setValueAtTime(y.f0, t); bO.frequency.exponentialRampToValueAtTime(y.f1, t + y.dur * 0.7);
        const bG = ctx.createGain(); env(bG.gain, t, y.attack, y.gain, y.dur);
        const nz = y.noise, bSrc = noise(noiseBuf, nz.dur);
        const bbp = ctx.createBiquadFilter(); bbp.type = 'bandpass'; bbp.frequency.value = nz.freq; bbp.Q.value = nz.q;
        const bN = ctx.createGain(); env(bN.gain, t, nz.attack, nz.gain, nz.dur);
        const bShape = ctx.createWaveShaper(); bShape.curve = driveCurve(p.drive);
        bO.connect(bG); bG.connect(bShape); bSrc.connect(bbp); bbp.connect(bN); bN.connect(bShape);
        bShape.connect(swG ?? bus);
        bO.start(t); bO.stop(t + y.dur + 0.05);
      }
      // 2. うなり: 明るい轟音から暗い尾へ（最後の一発は、時間が戻る間にこもった音から開き、追われる間は鳴り続ける）
      const w = r.roar, roarSrc = noise(noiseBuf, w.dur, true);
      const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.Q.value = 0.7;
      if (w.open > 0) {
        rlp.frequency.setValueAtTime(w.f0 * 0.18, t);
        rlp.frequency.exponentialRampToValueAtTime(w.f0, t + w.open);
      } else rlp.frequency.setValueAtTime(w.f0, t);
      rlp.frequency.exponentialRampToValueAtTime(w.f1, t + Math.max(w.open + 0.1, w.dur * 0.7));
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t);
      rg.gain.linearRampToValueAtTime(w.gain, t + w.attack);
      rg.gain.exponentialRampToValueAtTime(w.gain * w.drop, t + w.knee);
      if (w.hold > w.knee) rg.gain.exponentialRampToValueAtTime(w.gain * w.drop * 0.6, t + w.hold);
      if (w.tail > 0) rg.gain.exponentialRampToValueAtTime(w.gain * w.drop * 0.45, t + Math.max(w.hold, w.knee) + w.tail);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + w.dur);
      const rs = ctx.createGain(); rs.gain.value = 0.5;
      roarSrc.connect(rlp); rlp.connect(rg); rg.connect(swG ?? bus); rg.connect(rs); rs.connect(send);
      // 3. 空気を裂く中域: 帯域のノイズが下がりながら消える
      const a = r.air, airSrc = noise(noiseBuf, a.dur);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = a.q;
      bp.frequency.setValueAtTime(a.freq, t); bp.frequency.exponentialRampToValueAtTime(a.freq * 0.45, t + a.dur);
      const ag = ctx.createGain(); env(ag.gain, t, a.attack, a.gain, a.dur);
      airSrc.connect(bp); bp.connect(ag); ag.connect(bus); ag.connect(send);
      // 4. 地響き: 超低域のノイズ（ブラウン）がゆっくり来てゆっくり引き、揺れる。軽く歪ませて、倍音でスマホでも聞こえる
      const b = r.sub, subSrc = noise(brownBuf, b.dur, true);
      const slp = ctx.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = b.cutoff; slp.Q.value = 0.9;
      if (sw) { // 圧のふくらみの間、地響きの low-pass を開いて、低い帯域の圧を通す
        slp.frequency.setValueAtTime(b.cutoff, t + sw.at);
        slp.frequency.exponentialRampToValueAtTime(sw.lp, t + sw.peak);
        slp.frequency.exponentialRampToValueAtTime(b.cutoff, t + sw.end);
      }
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(b.gain, t + b.attack);
      if (b.hold > b.attack) sg.gain.exponentialRampToValueAtTime(b.gain * 0.7, t + b.hold);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + b.dur);
      const wob = ctx.createGain(); wob.gain.value = 1;
      const lfo = ctx.createOscillator(); lfo.frequency.value = b.wobble.rate;
      const lg = ctx.createGain(); lg.gain.value = b.wobble.depth;
      lfo.connect(lg); lg.connect(wob.gain); lfo.start(t); lfo.stop(t + b.dur + 0.05);
      const ss = ctx.createWaveShaper(); ss.curve = subCurve;
      subSrc.connect(slp); slp.connect(sg); sg.connect(wob); wob.connect(ss); ss.connect(bus);
      // 4b. 腹に響く層（最後の一発だけ）: ゆっくり下がる低い正弦波を、地響きと同じ揺れと歪みに通す
      if (r.deep) {
        const q = r.deep, dO = ctx.createOscillator(); dO.type = 'sine';
        dO.frequency.setValueAtTime(q.f0, t); dO.frequency.exponentialRampToValueAtTime(q.f1, t + q.dur * 0.8);
        const dG = ctx.createGain(); env(dG.gain, t, q.attack, q.gain, q.dur);
        const dHp = ctx.createBiquadFilter(); dHp.type = 'highpass'; dHp.frequency.value = q.hp; dHp.Q.value = 0.7;
        dO.connect(dG); dG.connect(dHp); dHp.connect(wob); dO.start(t); dO.stop(t + q.dur + 0.05);
      }
      // 5. 破片のぱらぱら: 一つのノイズの音量を粒ごとに跳ね上げ、帯域を粒ごとに変える
      const dg = r.debris.grains;
      if (dg.length) {
        const last = dg[dg.length - 1], dEnd = last.t + last.len;
        const dSrc = noise(noiseBuf, dEnd, true);
        const dbp = ctx.createBiquadFilter(); dbp.type = 'bandpass'; dbp.Q.value = 2.2;
        const dgg = ctx.createGain(); dgg.gain.setValueAtTime(0.0001, t);
        for (const gr of dg) {
          dbp.frequency.setValueAtTime(gr.f, t + gr.t);
          dgg.gain.setValueAtTime(0.0001, t + gr.t);
          dgg.gain.linearRampToValueAtTime(gr.g, t + gr.t + 0.0015);
          dgg.gain.exponentialRampToValueAtTime(0.0001, t + gr.t + gr.len);
        }
        dSrc.connect(dbp); dbp.connect(dgg); dgg.connect(bus);
      }
    },
  };
}
