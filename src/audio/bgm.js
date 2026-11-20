// BGM を Web Audio で鳴らす（譜面は bgmScore.js、楽器の音は bgmVoices.js）。
// 楽器の音は最初に一度だけ AudioBuffer に作り、一音ごとに再生ノード 1 つと音量 1 つで鳴らす（音程は再生の速さ）。
// 先読みのスケジューラ: 毎フレーム update を呼ぶと、LOOKAHEAD 秒先までに始まる拍の音を、正確な時刻に予約する。
// 状態: off → play（遊んでいる 60 秒）→ stopped（最後の一発を放った瞬間にぴたりと止める）→ quiet（リプレイ・結果画面）
//       play / quiet → stretch（ブラックホール: 音程が下がりながら引き伸ばされ、渦のように消える）→ stopped / quiet
import { renderVoice, VOICES } from './bgmVoices.js';
import { createSequencer, stretchWarp } from './bgmScore.js';

// 音の出口のつくり（オフラインの書き出しも同じ値を使う）。効果音より一段下の音量
export const BGM_BUS = {
  gain: 0.26,
  echoSec: 0.27, echoFeedback: 0.26, echoWet: 0.18, echoCutoff: 2600,
};
export const LOOKAHEAD = 0.3;
const START_DELAY = 0.06;
const STOP_RAMP = 0.006; // ぴたりと止める（プツッと鳴らない最短）
const LATE = 0.05; // これより遅れた音は鳴らさない（タブが隠れていた間の分をまとめて鳴らさない）
const R_MIN = 0.12; // 引き伸ばしの終わりの再生の速さ
// 楽器の音はこの標本化周波数で作る（AudioContext の周波数が違っても、再生のときに合わせてくれる）。
// AudioContext ができる前（最初のタップの前）から、1 フレームに 1 つずつ作っておける（prepare）
const VOICE_SR = 48000;

export function createBgm(getOutput) {
  let state = 'off';
  let paused = false;
  let ctx = null, input = null, lp = null, outGain = null;
  let buffers = null;
  const panners = new Map();
  let seq = null;
  let live = []; // { src, g, t, end, rate }
  let pendingQuiet = null; // 引き伸ばしが終わってから始める静かな変奏 { at, fadeIn }
  const rendered = new Map(); // 楽器の名前 → Float32Array
  const voiceData = (name) => { if (!rendered.has(name)) rendered.set(name, renderVoice(name, VOICE_SR)); return rendered.get(name); };

  function ensure() {
    if (ctx) return true;
    const o = getOutput();
    if (!o) return false;
    ctx = o.ctx;
    buffers = {};
    for (const name of VOICES) {
      const data = voiceData(name);
      const b = ctx.createBuffer(1, data.length, VOICE_SR);
      b.getChannelData(0).set(data);
      buffers[name] = b;
    }
    input = ctx.createGain();
    lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.6;
    outGain = ctx.createGain(); outGain.gain.value = 0;
    const bus = ctx.createGain(); bus.gain.value = BGM_BUS.gain;
    // 小さなこだま（木の音が少し響く場所の感じ）: 遅れ → 曇らせて → 戻す
    const delay = ctx.createDelay(1); delay.delayTime.value = BGM_BUS.echoSec;
    const fb = ctx.createGain(); fb.gain.value = BGM_BUS.echoFeedback;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = BGM_BUS.echoCutoff;
    const wet = ctx.createGain(); wet.gain.value = BGM_BUS.echoWet;
    input.connect(lp);
    input.connect(delay); delay.connect(dlp); dlp.connect(fb); fb.connect(delay); dlp.connect(wet); wet.connect(lp);
    lp.connect(outGain); outGain.connect(bus); bus.connect(o.dest);
    return true;
  }

  const now = () => ctx.currentTime;
  const running = () => !!ctx && ctx.state === 'running';

  function pannerFor(pan) {
    if (!ctx.createStereoPanner) return input;
    const key = Math.round(pan * 20) / 20;
    let p = panners.get(key);
    if (!p) { p = ctx.createStereoPanner(); p.pan.value = key; p.connect(input); panners.set(key, p); }
    return p;
  }

  function play(e, t) {
    const buf = buffers[e.voice];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = e.rate;
    const g = ctx.createGain(); g.gain.value = e.gain;
    src.connect(g); g.connect(pannerFor(e.pan));
    src.start(t);
    const end = t + buf.duration / e.rate;
    src.stop(end + 0.02);
    live.push({ src, g, t, end, rate: e.rate });
  }

  // 時刻 t 以後に始まる予約を取り消す
  function cancelFrom(t) {
    live = live.filter((n) => {
      if (n.t < t - 1e-6) return true;
      try { n.src.stop(); } catch { /* 予約済みでも止められる */ }
      n.g.disconnect?.();
      return false;
    });
  }

  function fadeOutGain(t, sec) {
    const p = outGain.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(0, t + sec);
  }

  function beginQuiet(at, fadeIn) {
    cancelFrom(at);
    seq = createSequencer({ start: at, mode: 'quiet' });
    state = 'quiet';
    pendingQuiet = null;
    const p = outGain.gain;
    p.cancelScheduledValues(at);
    p.setValueAtTime(0, at);
    p.linearRampToValueAtTime(1, at + fadeIn);
    lp.frequency.cancelScheduledValues(at);
    lp.frequency.setValueAtTime(20000, at);
  }

  return {
    get state() { return state; },
    get paused() { return paused; },
    get scheduled() { return live.length; },
    // 最初のタップの前に、楽器の音を 1 つずつ作っておく（1 回の呼び出しで 1 つ。全部できたら true）。
    // 遊びが始まった瞬間にまとめて作ると、中くらいの Android では長押しの始まりが一瞬止まる
    prepare() {
      const name = VOICES.find((v) => !rendered.has(v));
      if (name) voiceData(name);
      return rendered.size === VOICES.length;
    },
    // 遊びが始まった（音を鳴らせるようになってから呼ぶ）。一度だけ始まる
    start() {
      if (state !== 'off' || !ensure() || !running()) return;
      const t = now() + START_DELAY;
      seq = createSequencer({ start: t });
      state = 'play';
      const p = outGain.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(1, t);
    },
    // 毎フレーム: { elapsed, power（0〜1）, holding }
    update(cond) {
      if (!seq || paused || !running()) return;
      const t = now();
      live = live.filter((n) => n.end > t);
      if (pendingQuiet && (seq.done || t >= pendingQuiet.at - LOOKAHEAD)) beginQuiet(Math.max(pendingQuiet.at, t + START_DELAY), pendingQuiet.fadeIn);
      for (const e of seq.advance(t + LOOKAHEAD, () => cond)) {
        if (e.t < t - LATE) continue;
        play(e, Math.max(e.t, t));
      }
      if (seq.done && state === 'stretch' && !pendingQuiet) { state = 'stopped'; seq = null; }
    },
    // 最後の一発を放った瞬間: ぴたりと止める
    stop() {
      pendingQuiet = null;
      if (!ctx) { state = state === 'off' ? 'off' : 'stopped'; seq = null; return; }
      const t = now();
      fadeOutGain(t, STOP_RAMP);
      for (const n of live) { try { n.src.stop(t + STOP_RAMP + 0.004); } catch { /* 済み */ } }
      live = [];
      seq = null;
      state = 'stopped';
    },
    // リプレイと結果画面: 同じ旋律をゆっくり静かに（fadeIn 秒でふくらむ）。delay 秒後に始める。すでに静かなら何もしない
    quiet({ delay = 0, fadeIn = 3 } = {}) {
      if (state === 'quiet' || !ensure()) return;
      const at = now() + Math.max(START_DELAY, delay);
      if (state === 'stretch') { pendingQuiet = { at, fadeIn }; return; }
      if (state === 'play') this.stop();
      beginQuiet(at, fadeIn);
    },
    // ブラックホール: いまの音から、音程が下がりながら sec 秒で引き伸ばされ、渦のように左右を回って消える
    stretchOut(sec = 3) {
      if ((state !== 'play' && state !== 'quiet') || !seq) return;
      const t = now();
      cancelFrom(t);
      seq.stretch(t, sec);
      state = 'stretch';
      const w = stretchWarp(sec, R_MIN);
      // 鳴っている音も、同じように音程が下がる
      for (const n of live) {
        n.src.playbackRate.cancelScheduledValues?.(t);
        n.src.playbackRate.setValueAtTime(n.rate, t);
        n.src.playbackRate.exponentialRampToValueAtTime(n.rate * R_MIN, t + sec);
      }
      const f = lp.frequency;
      f.cancelScheduledValues(t);
      f.setValueAtTime(w.cutoff(0), t);
      f.exponentialRampToValueAtTime(w.cutoff(sec), t + sec);
      // 音量は一音ごとに下がる。最後に、鳴り残った尾を消す
      const p = outGain.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.setValueAtTime(p.value, t + sec * 0.85);
      p.linearRampToValueAtTime(0, t + sec * 1.05);
    },
    // タブが隠れた / 戻った（AudioContext も止まるので、予約した音は時刻ごと止まる）
    pause() { paused = true; },
    resume() { paused = false; },
  };
}
