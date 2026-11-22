// Web Audio で合成する音。素材ファイルは使わない。
import { COLLAPSE, createCollapseGate, collapseVoice, renderCollapseVariant } from './collapse.js';
import { comboRecipe, bossRecipe, drainVoice, DRAIN_CUE, timeTickRecipe, hideRecipe } from './cues.js';
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
    // 重い一発の地響きの尾は 1.4 倍（持ち主が 13:06 に良いと言った音のまま。S8 fix1 で 1.8 倍にしたのを fix2 で戻した）
    dur: (0.45 + 4.6 * s ** 1.3) * (1 + 0.4 * hv) + h, hold: h, cutoff: 115 - 60 * s,
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

// 最後の一発の爆発の音の取り決め（演出の時刻表 tl から）。R0b（持ち主 22:15・22:18）: 爆発の音は弾けた瞬間（burst。
// 時刻表の resume）に開く。遠くの爆発なので、うなりはこもった音から、光の壁が軍勢を飲む（engulf）までかけて開き
// （open。0.15〜1.2 秒）、宇宙へ切り替わる（chaseEnd）まで鳴り続ける（hold）。heavy: 最後の一発はいちばん重い音（boomRecipe）
export function finaleBoomOpts(tl) {
  const at = tl.burst ?? tl.resume ?? tl.snap;
  const open = Math.min(1.2, Math.max(0.15, (tl.engulf ?? at + 0.5) - at));
  return { hold: Math.max(0, tl.chaseEnd - at), open, heavy: 1 };
}

// 最後の一発の地響き（持ち主の要望 09:59）。R0b（持ち主 22:15・22:18、音は画面に従う 13:06）: 白が晴れて地平で爆発が始まる
// （erupt）と遠い地鳴りが地の底から湧き、スローでふくらむ間にだんだん近づき（burst までに 0.3）、弾けて光の壁が迫り軍勢を飲む
// （engulf）と轟きになり、カメラが飲まれて追うカットへ切り替わった（snap）直後に最大、見せる期（追われる間）ずっとうなり、
// 宇宙（chaseEnd）でこもって弱まり、縦一線の光が消える（lineEnd）ときに消える。そのあとの無音 → 地鳴り（deepRumble）へつなぐ。
// 演出の秒ごとの大きさ g（0〜1）と、低域の通し幅 f（Hz。宇宙でこもる）の折れ線
export const RUMBLE = { gain: 0.42, slow: { rate: 0.85, depth: 0.32 }, shake: { rate: 6.5, depth: 0.12 }, grit: 0.16 };
// 瓦礫の崩れる音の道の大きさ（ふつう・リプレイ・宇宙でこもったとき）。重くした最後の一発と地響きの上でリミッターの余裕を残す
export const DEBRIS_LEVEL = { open: 0.8, replay: 0.6, muffled: 0.35 };
export function rumbleKeys(tl) {
  const snap = tl.snap;
  const r0 = Math.min(tl.erupt ?? tl.resume ?? tl.beatEnd, snap - 0.3);
  const burst = Math.min(Math.max(tl.burst ?? tl.resume ?? r0, r0 + 0.1), snap - 0.2);
  const engulf = Math.min(Math.max(tl.engulf ?? (burst + snap) / 2, burst + 0.05), snap - 0.05);
  const ce = Math.max(tl.chaseEnd, snap + 0.6);
  const lineEnd = Math.max(tl.lineEnd, ce + 0.6), flat = Math.min(Math.max(tl.flatten, ce + 0.45), lineEnd - 0.1);
  return [
    { t: r0, g: 0, f: 60 },
    { t: burst, g: 0.3, f: 90 },
    { t: engulf, g: 0.7, f: 140 },
    { t: snap, g: 0.85, f: 150 },
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

// 無音の WAV（8 bit・モノラル・8 kHz、samples 個）の data URI。iOS の消音スイッチ対策で <audio> に鳴らす
export function silentWavDataUri(samples = 400) {
  const rate = 8000, n = 44 + samples, b = new Uint8Array(n), v = new DataView(b.buffer);
  const str = (o, x) => { for (let i = 0; i < x.length; i++) b[o + i] = x.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, n - 8, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, samples, true);
  b.fill(128, 44);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return 'data:audio/wav;base64,' + btoa(bin);
}

// iPhone・iPad（iPadOS はデスクトップの UA で、タッチの点が複数）
export function isIOSLike(nav) {
  if (!nav) return false;
  return /iPad|iPhone|iPod/.test(nav.userAgent ?? '') || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

// nav・makeMedia: テストで差し替える（ふだんは navigator と new Audio）
// R1f（持ち主 18:14「画面切り替えしたら一瞬ピープ音がなった」）: 切り替えたとき・戻ったときの大きさの動き（秒）。
// 隠れる: 一番上（top）を fadeOut 秒で 0 へ → 少し待って（suspendAfter ms）AudioContext を止める。戻る: top を 0 のまま鳴らし直し、hold 秒おいて fadeIn 秒で上げる
export const SWITCH_FADE = { fadeOut: 0.03, suspendAfter: 45, hold: 0.05, fadeIn: 0.15 };
// R1f: メニューの音量（BGM・効果音）の既定と範囲（0〜1。ui/menu.js が端末に覚える）
export const clampVol = (v, d = 1) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

export function createAudio({ nav = globalThis.navigator, makeMedia = (src) => new Audio(src), later = (f, ms) => setTimeout(f, ms) } = {}) {
  let silenceEnd = 0;
  // iOS の消音スイッチ（ベルの切り替え）: Web Audio だけでは「周囲の音」のセッションで、消音にすると鳴らない。
  // 最初の操作で、音のセッションを「再生」にする（Safari 17 以降は audioSession、それより前は無音の <audio> を鳴らし続ける）。
  // audioSession は iOS / iPadOS だけ（macOS の Safari にもあるが、playback にすると他のタブ・アプリの音を止める）。
  // session: 'none'（まだ）→ 'trying'（<audio> の play() の返事待ち）→ 'done'。play() を断られたら 'none' に戻し、
  // 鳴るまで次の操作でやり直す（AudioContext が鳴らせるようになった後も。introGesture は sessionPending の間 unlock を呼ぶ）
  let session = 'none', silentEl = null;
  function primeSession() {
    if (session !== 'none') return;
    if (!isIOSLike(nav)) { session = 'done'; return; }
    try {
      if (nav?.audioSession) { nav.audioSession.type = 'playback'; session = 'done'; return; }
    } catch { /* 続けて <audio> を試す */ }
    try {
      const el = silentEl ?? makeMedia(silentWavDataUri());
      if (!silentEl) {
        silentEl = el;
        el.loop = true;
        el.setAttribute?.('playsinline', '');
        el.setAttribute?.('aria-hidden', 'true');
      }
      session = 'trying';
      Promise.resolve(el.play?.()).then(() => { session = 'done'; }, () => { session = 'none'; }); // 断られたら次の操作でもう一度
    } catch { session = 'done'; /* <audio> が使えない: あきらめる */ }
  }
  let ctx = null, master = null, hum = null, rumbleNode = null, noiseBuf = null, brownBuf = null;
  // 最後の一発の演出: 世界の音（master）と演出の音（cine: 心臓の鼓動・地鳴り）は、どちらも out のこもりを通る
  let cine = null, out = null;
  // BGM の出口（bgm.js が鳴らす）。最後の一発の演出の無音・こもり・地鳴り（master と out を動かす）とは別の道で、
  // master・out を通さずリミッターへ直接つなぐ: 地鳴りが master を 0 に保つ間にも、リプレイの静かな変奏を鳴らせるように。
  // BGM は放った瞬間に自分で止まるので、演出の無音を邪魔しない
  let bgmBus = null;
  let introAn = null; // 調べる用の analyser（introAnalyser）
  let introBus = null; // S6: 導入の音の出口（master・out を通さずリミッターへ。導入の音は introSfx.js が組む）
  let boomBus = null; // 爆発の音のまとめ（天井の曲線を通って master へ）
  let drone = null; // 時間切れの結末の低い唸り（鳴っている間だけ）
  let hidden = false; // タブが隠れている間（suspend から resume まで）
  // R1f: 一番上の大きさ（リミッター → top → スピーカー。切り替えのときにまとめて 0 へ落とす）と、効果音の大きさ（世界の音・演出の音・瓦礫の音の出口）。
  // vol: メニューの音量（鳴らす前に決めてもよい。build で入れる）
  let top = null, sfxBus = null;
  let limiter = null; // R4: すべての音がまとまる所（録画の写し tap はここから）
  // fix1（見直し Minor 6）: メニューの一時停止で黙らせる門（世界の音 out・瓦礫 → worldGate → sfxBus、BGM → bgmGate → bgmBus）。
  // 音量の試し音は門の後ろ（sfxBus / bgmBus）で鳴る
  let worldGate = null, bgmGate = null, muted = false;
  const vol = { bgm: 1, sfx: 1 };
  // 瓦礫の崩れる音の道: 音のもと（起動時に数種類だけ書き出して使い回す）→ 一つごとの大きさ・左右 → debrisBus → debrisLp →
  // リミッター。master を通さない（地鳴りが master を 0 に保つ間に始まるリプレイでも鳴らせるように）。
  // 演出の無音の間は黙り、宇宙ではこもる（debrisMode）
  let debrisBus = null, debrisLp = null, collapseBufs = [];
  const collapseGate = createCollapseGate();
  let rumbleSrcs = null; // 最後の一発の地響き（鳴っている間だけ）
  let transitNodes = null; // S8: 電車と高速の音（最初に鳴らすときに作る）
  let drainNodes = null; // R1b: 吸われる音（最初に掴まれたときに作る）
  let clatterPhase = 0;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    limiter = ctx.createDynamicsCompressor();
    for (const k of Object.keys(LIMITER)) limiter[k].value = LIMITER[k];
    out = ctx.createBiquadFilter();
    out.type = 'lowpass'; out.frequency.value = 20000; out.Q.value = 0.5;
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
    bgmBus.gain.value = vol.bgm;
    bgmBus.connect(limiter);
    introBus = ctx.createGain();
    introBus.gain.value = 1;
    introBus.connect(limiter);
    boomBus = ctx.createGain();
    boomBus.gain.value = 1 / BOOM_CLIP.range;
    const clip = ctx.createWaveShaper(); clip.curve = boomClipCurve(); clip.oversample = '2x';
    boomBus.connect(clip); clip.connect(master);
    debrisLp = ctx.createBiquadFilter();
    debrisLp.type = 'lowpass'; debrisLp.frequency.value = 20000; debrisLp.Q.value = 0.5;
    debrisBus = ctx.createGain(); debrisBus.gain.value = DEBRIS_LEVEL.open;
    debrisBus.connect(debrisLp);
    // R1f: 効果音の大きさ（世界の音・演出の音の出口 out と、瓦礫の音の出口）→ リミッター → 一番上の大きさ（切り替えで 0 へ落とす）→ スピーカー。
    // 作るのは最後（前からの gain の並びを変えない）
    sfxBus = ctx.createGain();
    sfxBus.gain.value = vol.sfx;
    sfxBus.connect(limiter);
    worldGate = ctx.createGain();
    worldGate.gain.value = muted ? 0 : 1;
    worldGate.connect(sfxBus);
    out.connect(worldGate);
    debrisLp.connect(worldGate);
    bgmGate = ctx.createGain();
    bgmGate.gain.value = muted ? 0 : 1;
    bgmGate.connect(bgmBus);
    top = ctx.createGain();
    top.gain.value = hidden ? 0 : 1;
    limiter.connect(top);
    top.connect(ctx.destination);
    // 音のもとは最初のタップで一度に作らず、一つずつ間をあけて書き出す（中くらいの Android で、タップの瞬間に引っかからない）。
    // 鳴らす時までにできていなければ、そのとき作る
    // 24 kHz で作る（崩れる音の上の方は 12 kHz までで足りる。書き出しの手間が半分。再生のときに出口の速さへ直される）。
    // ブラウザの手が空いたとき（requestIdleCallback。無ければ少し間をあけた setTimeout）に一つずつ
    collapseBufs = new Array(COLLAPSE.variants + COLLAPSE.settleVariants).fill(null);
    let next = 0;
    const later = (f) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 2000 })
      : typeof setTimeout === 'function' ? setTimeout(f, 50) : null);
    const idle = () => { if (next < collapseBufs.length) { collapseBuf(next++); later(idle); } };
    later(idle);
  }
  function collapseBuf(v) {
    if (!collapseBufs[v]) {
      const sr = Math.min(ctx.sampleRate, COLLAPSE.sampleRate);
      const data = renderCollapseVariant(sr, v);
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

  // 左右の位置へ（pan -1〜1）。dest は省けば master
  function panner(pan, dest = master) {
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0));
    p.connect(dest);
    return p;
  }

  // R1f: 鳴りっぱなしの声（貯めの唸り・吸われる音）を t までに 0 へ（次のフレームの chargeHum / drain が決め直す）
  function quietVoices(t) {
    if (hum) { hum.gain.gain.cancelScheduledValues(now()); hum.gain.gain.setValueAtTime(hum.gain.gain.value, now()); hum.gain.gain.linearRampToValueAtTime(0, t); }
    if (drainNodes) for (const g of [drainNodes.hg.gain, drainNodes.wg.gain]) { g.cancelScheduledValues(now()); g.linearRampToValueAtTime(0, t); }
  }
  // R1f: 鳴らし直し、鳴り始めてから一番上を上げる（隠れたままなら何もしない）
  function wake() {
    const up = () => {
      if (hidden || !top) return;
      const t = now(), g = top.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      g.setValueAtTime(0, t + SWITCH_FADE.hold);
      g.linearRampToValueAtTime(1, t + SWITCH_FADE.hold + SWITCH_FADE.fadeIn);
    };
    if (ctx.state !== 'running' && ctx.state !== 'closed') Promise.resolve(ctx.resume()).then(up, () => {});
    else up();
  }

  return {
    // R1: 払うの腕前（×k）の音。pan: 画面の左右（cues.screenPan）。k が増えるたびに一段ずつ上がる
    combo(k, pan = 0) {
      if (!ready()) return;
      const r = comboRecipe(k), t0 = now(), bus = panner(pan);
      for (const tn of r.tones) {
        const t = t0 + (tn.when ?? 0);
        const o = ctx.createOscillator(); o.type = tn.type; o.frequency.setValueAtTime(tn.f, t);
        const g = ctx.createGain(); env(g.gain, t, tn.attack, tn.gain, tn.dur);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + tn.dur + 0.05);
      }
      noiseBurst({ ...r.sparkle, dest: bus });
    },
    // R1f: 物陰へ跳ぶ音（kind 'jump' 踏み切りのシュッ / 'land' 着地のトン）。pan: 画面の左右
    hideCue(kind, pan = 0) {
      if (!ready()) return;
      const r = hideRecipe(kind), bus = panner(pan);
      if (r.whoosh) for (const w of r.whoosh) noiseBurst({ ...w, dest: bus });
      if (r.thud) { thump({ ...r.thud, dest: bus }); noiseBurst({ ...r.grit, dest: bus }); }
    },
    // R1c: 残り n 秒（10〜1）の刻みの音。世界の音（master）を通る（演出・導入の無音に従う。main.js は遊んでいる間だけ呼ぶ）
    timeTick(n) {
      if (!ready()) return;
      const r = timeTickRecipe(n), t0 = now();
      for (const tn of r.tones) {
        const t = t0 + (tn.when ?? 0);
        const o = ctx.createOscillator(); o.type = tn.type; o.frequency.setValueAtTime(tn.f, t);
        const g = ctx.createGain(); env(g.gain, t, tn.attack, tn.gain, tn.dur);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + tn.dur + 0.05);
      }
      noiseBurst({ ...r.sparkle, attack: 0.001 });
    },
    // R1: 大物が来た知らせの音（遠い警笛の二度のうなりと、探照灯の点く音）。pan: 大物の画面の左右、near: 近さ 0〜1
    bossArrive(pan = 0, near = 0.5) {
      if (!ready()) return;
      const r = bossRecipe({ near }), t0 = now(), bus = panner(pan);
      for (const h of r.horns) {
        const t = t0 + h.when;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(h.lp[0], t);
        lp.frequency.exponentialRampToValueAtTime(h.lp[1], t + h.attack + 0.2);
        lp.frequency.exponentialRampToValueAtTime(h.lp[0], t + h.dur);
        const g = ctx.createGain(); env(g.gain, t, h.attack, h.gain, h.dur);
        lp.connect(g); g.connect(bus);
        for (const f of h.f) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t);
          o.frequency.linearRampToValueAtTime(f * 0.97, t + h.dur);
          o.connect(lp); o.start(t); o.stop(t + h.dur + 0.05);
        }
      }
      noiseBurst({ dur: r.clank.dur, freq: r.clank.freq, gain: r.clank.gain, q: r.clank.q, when: r.clank.when, attack: 0.002, dest: bus });
      thump({ ...r.thud, dest: bus });
    },
    // 最初のユーザー操作で呼ぶ（ブラウザの自動再生の制限）
    // 操作と見なされない入力（タッチの pointerdown）で呼んでも害はない（resume は待ったままか断られる）。鳴らせるまで操作のたびに呼ぶ。
    // 戻り値: running になったら true の約束（断られたら false。reject は残さない）
    unlock() {
      primeSession();
      if (!ctx) build();
      if (!ctx) return Promise.resolve(false);
      if (ctx.state === 'running' || ctx.state === 'closed') return Promise.resolve(ctx.state === 'running');
      let p;
      try { p = ctx.resume(); } catch { return Promise.resolve(false); }
      return Promise.resolve(p).then(() => ctx.state === 'running', () => false);
    },
    get running() { return !!ctx && ctx.state === 'running'; },
    // iOS の音のセッション（無音の <audio>）がまだ鳴っていない: 操作のたびに unlock を呼んでほしい
    get sessionPending() { return session !== 'done'; },
    // BGM の出口（unlock の前は null）
    get bgmOutput() { return ctx && bgmGate ? { ctx, dest: bgmGate } : null; },
    // 導入の音の出口（unlock の前は null）
    get introOutput() { return ctx && introBus ? { ctx, dest: introBus } : null; },
    // 調べる用（?debug の __debug.introPeak）: 導入の音の出口を聞く analyser（はじめて呼んだときにつなぐ。unlock の前は null）
    introAnalyser() {
      if (!ctx || !introBus) return null;
      if (!introAn) { introAn = ctx.createAnalyser(); introAn.fftSize = 2048; introBus.connect(introAn); }
      return introAn;
    },
    // タブが隠れた / 戻った（R1f: メニューの一時停止も同じ）。止める処理（suspend）は少しあとで終わるので、終わったときにもう戻っていたら鳴らし直す
    // （すぐ戻ると、戻した時点ではまだ running のままで、そのあと止まりっぱなしになる）。戻ったら suspended でなくても（iOS の interrupted など）鳴らし直す。
    // R1f（持ち主 18:14「画面切り替えしたら一瞬ピープ音」）: 隠れたら、一番上を SWITCH_FADE.fadeOut 秒で 0 へ落とし、鳴りっぱなしの声（貯めの唸り・吸われる音）を
    // 0 にしてから止める（requestAnimationFrame が止まるので、唸りの大きさは最後の貯めの大きさのまま残り、戻ったときに一瞬鳴っていた）。
    // 戻るときは一番上を 0 のまま鳴らし直し、鳴り始めてから hold 秒おいて fadeIn 秒で上げる
    suspend() {
      hidden = true;
      try { silentEl?.pause?.(); } catch { /* 済み */ }
      if (!ctx || !top) return;
      const t = now(), g = top.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
      g.linearRampToValueAtTime(0, t + SWITCH_FADE.fadeOut);
      quietVoices(t + SWITCH_FADE.fadeOut);
      if (ctx.state !== 'running') return;
      later(() => {
        if (!hidden || ctx.state !== 'running') return;
        Promise.resolve(ctx.suspend()).then(() => { if (!hidden && ctx.state !== 'running') wake(); }, () => {});
      }, SWITCH_FADE.suspendAfter);
    },
    resume() {
      hidden = false;
      if (silentEl && session === 'done') Promise.resolve(silentEl.play?.()).catch(() => { session = 'none'; });
      if (!ctx || !top) return;
      const t = now();
      top.gain.cancelScheduledValues(t);
      top.gain.setValueAtTime(0, t);
      wake();
    },
    // R1f: メニューの音量（0〜1）。BGM の出口と効果音の出口の大きさ。鳴らす前に呼んでもよい（鳴らし始めるときに入れる）
    setVolumes({ bgm = vol.bgm, sfx = vol.sfx } = {}) {
      vol.bgm = clampVol(bgm, vol.bgm); vol.sfx = clampVol(sfx, vol.sfx);
      if (!ctx) return;
      const t = now();
      for (const [n, v] of [[bgmBus, vol.bgm], [sfxBus, vol.sfx]]) { if (!n) continue; n.gain.cancelScheduledValues(t); n.gain.setTargetAtTime(v, t, 0.03); }
    },
    get volumes() { return { ...vol }; },
    // R4（縦動画、share/clip.js）: 録画の音の写し。すべての音（世界の音・演出の音・瓦礫・BGM）がまとまるリミッターの出口
    // （一番上の大きさ top の手前）を MediaStreamDestination へもつなぐ。スピーカーへの道と大きさは変えない。release で外す。
    // 鳴らせるようになる前・MediaStreamDestination の無いブラウザは null
    tap() {
      if (!ctx || !limiter || typeof ctx.createMediaStreamDestination !== 'function') return null;
      const dest = ctx.createMediaStreamDestination();
      limiter.connect(dest);
      let on = true;
      return {
        stream: dest.stream,
        release() { if (!on) return; on = false; try { limiter.disconnect(dest); } catch { /* 済み */ } },
      };
    },
    get sfxBus() { return sfxBus; },
    get bgmBus() { return bgmBus; },
    get worldGate() { return worldGate; },
    get bgmGate() { return bgmGate; },
    // fix1（見直し Minor 6）: メニューの一時停止。AudioContext は止めず、世界の音と BGM の門を SWITCH_FADE.fadeOut 秒で 0 へ（on）/ 戻す（off）
    mute(on) {
      muted = !!on;
      if (!ctx || !worldGate) return;
      const t = now();
      for (const g of [worldGate.gain, bgmGate.gain]) {
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
        g.linearRampToValueAtTime(muted ? 0 : 1, t + (muted ? SWITCH_FADE.fadeOut : SWITCH_FADE.fadeIn));
      }
      if (muted) quietVoices(t + SWITCH_FADE.fadeOut);
    },
    // fix1: 音量の試し音（kind 'sfx' 効果音の道 / 'bgm' BGM の道。門の後ろなので黙らせている間も聞こえる）
    preview(kind) {
      if (!ready()) return;
      const bus = kind === 'bgm' ? bgmBus : sfxBus;
      const t = now();
      const notes = kind === 'bgm' ? [[523.25, 0], [659.25, 0.09], [783.99, 0.18]] : [[1320, 0], [1980, 0.05]];
      for (const [f, w] of notes) {
        const o = ctx.createOscillator(); o.type = kind === 'bgm' ? 'triangle' : 'square';
        o.frequency.setValueAtTime(f, t + w);
        const g = ctx.createGain(); env(g.gain, t + w, 0.005, kind === 'bgm' ? 0.12 : 0.05, kind === 'bgm' ? 0.25 : 0.07);
        o.connect(g); g.connect(bus); o.start(t + w); o.stop(t + w + 0.35);
      }
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
    // 最後の一発の地響き（rumbleKeys）。白が晴れて爆発が始まる瞬間（演出の erupt。cue 'erupt'）に呼ぶと、時刻表どおりに最後まで予定する。
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
      // 遠いほどこもる（遠くの崩落は高い粒が抜けて低い地鳴りに）
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = v.lp; lp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = v.gain;
      const pan = ctx.createStereoPanner(); pan.pan.value = v.pan;
      src.connect(lp); lp.connect(g); g.connect(pan); pan.connect(debrisBus);
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
    // R1b（持ち主 08:24「吸われてる音」）: 掴まれて吸われている間ずっと鳴る音（cues.js の drainVoice）。毎フレーム呼ぶ。
    // s: drainFx の状態（sound: 強さ 0〜1、phase: 画面の縁の脈打ちの位相、pan: 掴んでいる者の画面の左右）。null か sound 0 で、
    // その場で止まる（はがれた瞬間に消える）。世界の音（master）を通るので、演出の無音・宇宙のこもりにも従う
    drain(s) {
      if (!ready()) return;
      const k = s?.sound ?? 0, t = now();
      if (!drainNodes) {
        if (!(k > 0)) return;
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = DRAIN_CUE.hiss.hi; bp.Q.value = DRAIN_CUE.hiss.q;
        const hg = ctx.createGain(); hg.gain.value = 0;
        const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = DRAIN_CUE.whine.f;
        // うねり: 唸りの高さを細かく揺らす（cent）
        const lfo = ctx.createOscillator(); lfo.frequency.value = DRAIN_CUE.warble.rate;
        const lg = ctx.createGain(); lg.gain.value = 1200 * Math.log2(1 + DRAIN_CUE.warble.depth);
        lfo.connect(lg); lg.connect(osc.detune);
        const wg = ctx.createGain(); wg.gain.value = 0;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = DRAIN_CUE.lp.open; lp.Q.value = 0.5;
        const pan = ctx.createStereoPanner();
        src.connect(bp); bp.connect(hg); hg.connect(lp);
        osc.connect(wg); wg.connect(lp);
        lp.connect(pan); pan.connect(master);
        src.start(t, Math.random()); osc.start(t); lfo.start(t);
        drainNodes = { bp, hg, osc, wg, lp, pan };
      }
      const n = drainNodes;
      if (!(k > 0)) {
        // はがれた: その場で止める（15 ms で消える。ぷつっと鳴らない）
        n.hg.gain.cancelScheduledValues(t); n.wg.gain.cancelScheduledValues(t);
        n.hg.gain.setTargetAtTime(0, t, 0.015); n.wg.gain.setTargetAtTime(0, t, 0.015);
        return;
      }
      const v = drainVoice(k, s.phase ?? 0);
      const tc = 0.025;
      n.bp.frequency.setTargetAtTime(v.hiss.f, t, tc);
      n.hg.gain.setTargetAtTime(v.hiss.gain, t, tc);
      n.osc.frequency.setTargetAtTime(v.whine.f, t, tc);
      n.wg.gain.setTargetAtTime(v.whine.gain, t, tc);
      n.lp.frequency.setTargetAtTime(v.lp, t, 0.1);
      n.pan.pan.setTargetAtTime(Math.max(-0.95, Math.min(0.95, s.pan ?? 0)), t, 0.05);
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
