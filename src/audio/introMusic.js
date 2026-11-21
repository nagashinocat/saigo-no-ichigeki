import { createSequencer } from './bgmScore.js';
import { INTRO } from '../render/introTimeline.js';
import { BGM_BUS, VOICE_SR } from './bgm.js';
import { cachedVoice, VOICES } from './bgmVoices.js';

// 導入の音楽（S6 fix1、持ち主 18:02「BGM の一番盛り上がるやつを入れて」、18:07「BGM は力を放つタイミングで止めてね」）:
// ゲームの BGM（bgmScore.js）の最高潮（残り 10 秒の層 3 に長押しの +1 = 層 4: 毎小節のフィル、2 小節に 1 回の太鼓のロールと
// 擦れる音、倍の細かさのシェイカー、オクターブで重なる旋律、厚いドローン）を、決まったテンポで導入の 0 秒から鳴らす。
// 力を放つ瞬間（手の拍で両手が玉を握り込む、INTRO.hands.releaseAt）でぴたりと止める。テンポはその瞬間がちょうど
// bars 小節目の頭（次の 1 拍目）になるように決める（止まる所が拍の頭に落ちる）。止めたあと（白と題字）は無音。
// TAP START でゲームの BGM がいつもどおり始めから鳴る（きれいに始め直す）。
// 同じ並びをライブ（AudioContext）と録画（OfflineAudioContext）で組む（乱数を使わない譜面なので、毎回同じ）
export const INTRO_MUSIC = { clampFrame: 1 / 30, bars: 5, gain: 1.4, cutTail: 0.008, cond: { elapsed: 55, power: 1, holding: true } };

export function introMusicPlan(tl) {
  const hands = tl.beat('hands');
  if (!hands) return null;
  // 力を放つ瞬間（握り込む）。止めるのは、組んだ指が初めて映るコマ（放ってから 30 fps の 1 コマ後）の頭
  const cut = hands.start + INTRO.hands.releaseAt + INTRO_MUSIC.clampFrame;
  const tempo = (INTRO_MUSIC.bars * 4 * 60) / cut; // 付点四分の拍 / 分
  const seq = createSequencer({ start: 0, tempo });
  const events = seq.advance(cut, () => INTRO_MUSIC.cond).filter((e) => e.t < cut - 1e-6);
  return { tempo, cut, events, barSec: (4 * 60) / tempo };
}

// 手の空いた時間に楽器の音を 1 つ作る（全部できたら true）
export function prepareIntroMusic() {
  const name = VOICES.find((v) => !cachedVoiceReady.has(v));
  if (name) { cachedVoice(name, VOICE_SR); cachedVoiceReady.add(name); }
  return cachedVoiceReady.size === VOICES.length;
}
const cachedVoiceReady = new Set();

// ctx に、導入の 0 秒が t0 の音楽を組む（from 秒より前に始まる音は組まない）。dest へつなぐ。cut(sec) で消して止める
export function scheduleIntroMusic(ctx, dest, t0, tl, { from = 0 } = {}) {
  const plan = introMusicPlan(tl);
  if (!plan) return { cut() {}, plan: null };
  const buffers = {};
  for (const name of VOICES) {
    const data = cachedVoice(name, VOICE_SR);
    const b = ctx.createBuffer(1, data.length, VOICE_SR);
    b.getChannelData(0).set(data);
    buffers[name] = b;
  }
  // ゲームの BGM と同じ出口のつくり（小さなこだま）
  const input = ctx.createGain();
  const out = ctx.createGain(); out.gain.value = BGM_BUS.gain * INTRO_MUSIC.gain;
  const delay = ctx.createDelay(1); delay.delayTime.value = BGM_BUS.echoSec;
  const fb = ctx.createGain(); fb.gain.value = BGM_BUS.echoFeedback;
  const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = BGM_BUS.echoCutoff;
  const wet = ctx.createGain(); wet.gain.value = BGM_BUS.echoWet;
  input.connect(out);
  input.connect(delay); delay.connect(dlp); dlp.connect(fb); fb.connect(delay); dlp.connect(wet); wet.connect(out);
  out.connect(dest);
  const panners = new Map();
  const pannerFor = (pan) => {
    const key = Math.round(pan * 20) / 20;
    let p = panners.get(key);
    if (!p) { p = ctx.createStereoPanner(); p.pan.value = key; p.connect(input); panners.set(key, p); }
    return p;
  };
  const sources = [];
  for (const e of plan.events) {
    if (e.t < from - 1e-9) continue;
    const src = ctx.createBufferSource();
    src.buffer = buffers[e.voice];
    src.playbackRate.value = e.rate;
    const g = ctx.createGain(); g.gain.value = e.gain;
    src.connect(g); g.connect(pannerFor(e.pan));
    src.start(t0 + e.t);
    sources.push(src);
  }
  // 力を放つ瞬間に、ぴたりと止める（ごく短い尾でプツッと鳴らさない）。鳴り残る音とこだまも、ここで止める
  const g0 = out.gain.value, cutAt = t0 + plan.cut;
  out.gain.setValueAtTime(g0, cutAt);
  out.gain.linearRampToValueAtTime(0, cutAt + INTRO_MUSIC.cutTail);
  for (const s of sources) s.stop(cutAt + INTRO_MUSIC.cutTail + 0.002);
  let done = false;
  return {
    plan,
    // 飛ばした・ゲームが始まった: sec 秒で消して止める
    cut(sec = 0.25) {
      if (done) return;
      done = true;
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + sec);
      for (const s of sources) { try { s.stop(now + sec + 0.02); } catch { /* 済み */ } }
      setTimeout(() => { try { out.disconnect(); } catch { /* 済み */ } }, (sec + 0.2) * 1000);
    },
  };
}
