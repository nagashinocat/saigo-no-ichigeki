// 爆発の音を耳で確かめるための WAV を書き出す。ゲームと同じ src/audio/audio.js を、本物の Chrome の OfflineAudioContext で
// 鳴らす（リミッター・こもり・演出の無音もゲームと同じ道を通る。鳴らすところは scripts/boomRender.mjs）。
// 使い方: node scripts/boom-preview.mjs <出力先のフォルダ> [名前の頭（既定 boom）] [audio.js のパス（既定 src/audio/audio.js）]
//   <頭>-puff.wav    3.5 秒: 払う（小爆発）を一発（1 秒の時点。リミッターの初めの状態が落ち着いてから）
//   <頭>-final.wav   最後の一発（力満タン）の音の段取りを演出の時刻表どおりに: 無音 → 心臓の鼓動 3 回 → 時間が戻る（爆発・地響き）
//                    → 追われる間（瓦礫の崩れる音が前線に合わせて重なる）→ 宇宙でこもる → 無音 → 低い地鳴り
//   <頭>-boom.wav    最後の一発の爆発の音だけ（地響き・瓦礫なし。前と比べる用）
//   <頭>-debris.wav  7 秒: 瓦礫の崩れる音だけ（小さい・遠い → 大きい・近い、左右に散る、最後は一度にたくさん）
//   <頭>-stress.wav  最大の場面: 最後の一発 + 地響き + 瓦礫を毎フレーム多数 + 最高潮の BGM の大きさの音を BGM の道へ
// 地響き（finaleRumble）や瓦礫（collapse）の無い audio.js（前の版）では、その部分は鳴らない（前と比べられる）。
// 出口の最大値・4 倍に補間した最大値（true peak の目安）・1 に触れた標本の数・リミッターの最大の圧縮量（dB）、
// 帯域ごと・時間ごとの力（dB）と、低い一打の基音・うなりの長さの目安も出す。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeWav } from '../src/audio/bgmOffline.js';
import { finaleScenes, renderScenes, truePeak, filt } from './boomRender.mjs';

const dir = process.argv[2];
const prefix = process.argv[3] ?? 'boom';
const modPath = process.argv[4] ?? 'src/audio/audio.js';
if (!dir) { console.error('usage: node scripts/boom-preview.mjs <out-dir> [prefix] [audio.js]'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const SR = 48000;

const db = (e) => (10 * Math.log10(e + 1e-12)).toFixed(1);
// 帯域（2 段ずつの high-pass / low-pass）
const band = (x, lo, hi) => { let y = x; if (lo) y = filt(filt(y, 'hp', lo), 'hp', lo); if (hi) y = filt(filt(y, 'lp', hi), 'lp', hi); return y; };
const WINDOWS = [[0, 0.3], [0.3, 1.5], [1.5, 4], [4, 7], [0, 8]];
const BANDS = [['<60', 0, 60], ['60-120', 60, 120], ['120-250', 120, 250], ['100-300', 100, 300], ['>200', 200, 0]];
function metrics(mono, at) {
  const i0 = Math.round(at * SR), seg = (x, a, b) => x.subarray(i0 + Math.round(a * SR), Math.min(x.length, i0 + Math.round(b * SR)));
  const energy = (x) => { let s = 0; for (const v of x) s += v * v; return s / SR; };
  const table = {};
  for (const [name, lo, hi] of BANDS) {
    const y = band(mono, lo, hi);
    table[name] = WINDOWS.map(([a, b]) => energy(seg(y, a, b)));
  }
  // 低い一打の基音: 0.01〜0.5 秒の、15〜150 Hz でいちばん力のある周波数（Goertzel を 1 Hz ごと）
  const z = seg(mono, 0.01, 0.5);
  let f0 = 0, best = -1;
  for (let f = 15; f <= 150; f++) {
    const k = 2 * Math.cos(2 * Math.PI * f / SR);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < z.length; i++) { const s0 = z[i] + k * s1 - s2; s2 = s1; s1 = s0; }
    const pw = s1 * s1 + s2 * s2 - k * s1 * s2;
    if (pw > best) { best = pw; f0 = f; }
  }
  // うなりの長さ: 120 Hz より上の 100 ms ごとの RMS が -50 dBFS 以上だった最後の時刻
  const hi120 = filt(mono, 'hp', 120), sub80 = filt(mono, 'lp', 80);
  let last = 0;
  for (let t = 0; t < 12; t += 0.1) if (energy(seg(hi120, t, t + 0.1)) / 0.1 > 1e-5) last = t + 0.1;
  // 地響きの長さ: 80 Hz 以下の力が最大から 30 dB 下がるまで
  const envS = [];
  for (let t = 0; t < 14; t += 0.1) envS.push(energy(seg(sub80, t, t + 0.1)));
  const ms = Math.max(...envS); let lastS = 0;
  envS.forEach((e, k) => { if (e > ms / 1000) lastS = (k + 1) * 0.1; });
  return { table, f0, roarLen: last, subLen: lastS };
}

const { scenes, finalCues, finalFrames } = finaleScenes();
const rendered = await renderScenes(scenes, { modPath, SR });
const results = {};
for (const { name: scName, sc, left, right, red, redAt } of rendered) {
  const name = `${prefix}-${scName}.wav`;
  writeFileSync(join(dir, name), encodeWav({ left, right, sr: SR }));
  let p = 0, clip = 0;
  for (let i = 0; i < left.length; i++) {
    const v = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    p = Math.max(p, v); if (v >= 0.999) clip++;
  }
  const tp = Math.max(truePeak(left), truePeak(right));
  const env = [];
  for (let i = 0; i < left.length; i += SR / 10) {
    let s = 0; const m = Math.min(left.length, i + SR / 10);
    for (let j = i; j < m; j++) s += (left[j] ** 2 + right[j] ** 2) / 2;
    env.push(Math.round(10 * Math.log10(s / (m - i) + 1e-12)));
  }
  console.log(`${name}: ${sc.dur.toFixed(2)} s, peak ${p.toFixed(3)} (${(20 * Math.log10(p)).toFixed(2)} dBFS), true-peak~ ${tp.toFixed(3)} (${(20 * Math.log10(tp)).toFixed(2)} dBTP), samples >= 0.999: ${clip}, limiter max reduction ${red.toFixed(1)} dB at ${redAt.toFixed(2)} s`);
  console.log(`  rms/100ms dBFS: ${env.join(' ')}`);
  if (sc.metricsAt != null) {
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
    const m = metrics(mono, sc.metricsAt);
    console.log(`  band energy dB from ${sc.metricsAt.toFixed(2)} s, windows ${WINDOWS.map(([a, b]) => `${a}-${b}s`).join(' | ')}`);
    for (const [k, v] of Object.entries(m.table)) console.log(`    ${k.padEnd(8)} ${v.map(db).join(' | ')}`);
    console.log(`  punch dominant ${m.f0.toFixed(0)} Hz (15–150 Hz, 0.01–0.5 s), roar (>120 Hz) above -50 dBFS RMS until ${m.roarLen.toFixed(1)} s, sub (<80 Hz) for ${m.subLen.toFixed(1)} s`);
    results[scName] = m;
  }
}
writeFileSync(`/tmp/${prefix}-metrics.json`, JSON.stringify(results));
console.log(`final cues (s): ${finalCues.map(([t, n]) => `${n}@${t.toFixed(2)}`).join(' ')}; debris frames with hits: ${finalFrames.filter(([, h]) => h.length).length}, hits: ${finalFrames.reduce((a, [, h]) => a + h.length, 0)}`);
