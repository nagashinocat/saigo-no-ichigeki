// BGM を耳で確かめるための WAV を書き出す（ゲームと同じ譜面・同じ楽器の音・同じ出口のつくりをオフラインで混ぜる）。
// 使い方: node scripts/bgm-preview.mjs <出力先のフォルダ> [名前の頭（既定 bgm3）]
//   <頭>-preview-1-start.wav     20 秒: 始まり（層 0: 底のドローン、低い太鼓とゆったりしたマリンバ）
//   <頭>-preview-2-build.wav     20 秒: 中ごろ（層 1: 高い太鼓とシェイカー、旋律が全部、ときどき不規則なアクセントと不協和な重音）
//   <頭>-preview-3-climax.wav    20 秒: 残り 10 秒の最高潮で長押し中（層 4: 毎小節フィル、太鼓のロールと金属的に擦れる音）
//   <頭>-preview-4-replay.wav    10 秒: リプレイ・結果画面の静かな変奏（3 秒でふくらむ）
//   <頭>-preview-5-full-run.wav  62 秒: ずっと長押しして 58 秒で放つ一回の遊び（放った瞬間に止まる）
//   <頭>-preview-6-blackhole.wav 14 秒: 最高潮 → 時間切れで引き伸ばされて消える → 無音 → 静かな変奏
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSequencer, stretchWarp } from '../src/audio/bgmScore.js';
import { mixOffline, encodeWav } from '../src/audio/bgmOffline.js';
import { FADE_HOLD, FADE_END } from '../src/audio/bgm.js';

const dir = process.argv[2];
const prefix = process.argv[3] ?? 'bgm3';
if (!dir) { console.error('usage: node scripts/bgm-preview.mjs <out-dir> [prefix]'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const SR = 44100;

function save(name, mix) {
  name = name.replace(/^bgm2-/, `${prefix}-`);
  writeFileSync(join(dir, name), encodeWav(mix));
  let p = 0, s = 0;
  for (let i = 0; i < mix.left.length; i++) { p = Math.max(p, Math.abs(mix.left[i]), Math.abs(mix.right[i])); s += mix.left[i] ** 2 + mix.right[i] ** 2; }
  console.log(`${name}: ${(mix.left.length / SR).toFixed(1)} s, peak ${p.toFixed(3)}, rms ${Math.sqrt(s / 2 / mix.left.length).toFixed(4)}`);
}
// 同じ条件で pre 秒進めてから（テンポがそこまで上がった状態）、dur 秒を書き出す
function steady(cond, dur, pre = 40) {
  const seq = createSequencer({ start: 0 });
  seq.advance(pre, () => cond);
  const ev = seq.advance(pre + dur, () => cond).filter((e) => e.t >= pre).map((e) => ({ ...e, t: e.t - pre + 0.1 }));
  return { seq, mix: mixOffline(ev, { sr: SR, duration: dur + 0.6 }) };
}

for (const [name, cond] of [
  ['bgm2-preview-1-start.wav', { elapsed: 5, power: 0, holding: false }],
  ['bgm2-preview-2-build.wav', { elapsed: 25, power: 0.3, holding: false }],
  ['bgm2-preview-3-climax.wav', { elapsed: 55, power: 0.8, holding: true }],
]) {
  const { seq, mix } = steady(cond, 20);
  save(name, mix);
  console.log(`  tempo ${seq.tempo.toFixed(1)} (dotted-quarter bpm), bar ${seq.bar}`);
}

{
  const q = createSequencer({ start: 0.1, mode: 'quiet' });
  const ev = q.advance(10, () => ({}));
  save('bgm2-preview-4-replay.wav', mixOffline(ev, { sr: SR, duration: 10.5, gainAt: (t) => Math.min(1, t / 3) }));
}

{
  // ずっと長押し、力は 3/100 ずつ貯まり、小爆発で少し使う（だいたいの形）。58 秒で放つ
  const seq = createSequencer({ start: 0.1 });
  const release = 58.1;
  const ev = seq.advance(release, (t) => ({ elapsed: t - 0.1, power: Math.min(1, 0.022 * t), holding: true })).filter((e) => e.t < release);
  save('bgm2-preview-5-full-run.wav', mixOffline(ev, { sr: SR, duration: 62, gainAt: (t) => (t < release ? 1 : 0) }));
}

{
  const seq = createSequencer({ start: 0 });
  const c = { elapsed: 55, power: 0.8, holding: true };
  seq.advance(40, () => c);
  const T = 46, sec = 3.5, quietAt = T + sec + 1.5;
  const before = seq.advance(T, () => c).filter((e) => e.t >= 40 && e.t < T);
  seq.stretch(T, sec);
  const stretched = seq.advance(T + 10, () => c);
  const q = createSequencer({ start: quietAt, mode: 'quiet' });
  const quiet = q.advance(quietAt + 4, () => ({}));
  const ev = [...before, ...stretched, ...quiet].map((e) => ({ ...e, t: e.t - 40 }));
  const t0 = T - 40, tq = quietAt - 40;
  // 引き伸ばしはゲームと同じ（鳴っている音の音程も下がる・出口の low-pass と音量）。そのあとは静かな変奏が 3 秒でふくらむ
  const w = stretchWarp(sec);
  save('bgm2-preview-6-blackhole.wav', mixOffline(ev, {
    sr: SR, duration: tq + 4.5, warp: { at: t0, sec },
    cutoff: (t) => (t < t0 ? 20000 : t < tq ? w.cutoff(t - t0) : 20000),
    gainAt: (t) => (t < t0 + sec * FADE_HOLD ? 1 : t < t0 + sec * FADE_END ? 1 - (t - t0 - sec * FADE_HOLD) / (sec * (FADE_END - FADE_HOLD)) : t < tq ? 0 : Math.min(1, (t - tq) / 3)),
  }));
}
