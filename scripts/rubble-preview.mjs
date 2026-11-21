// R0b（持ち主 23:01「爆破のリプレイの後に鳴るチリチリした音を、瓦礫が崩れる音としてしっかり鳴らしたい」）: リプレイの後半〜
// 引きの絵の瓦礫の崩れる音を、ゲームと同じ src/audio/audio.js で本物の Chrome の OfflineAudioContext に鳴らして WAV に書き出す。
// 使い方: node scripts/rubble-preview.mjs <出力先のフォルダ> [名前の頭（既定 rubble）] [audio.js のパス（既定 src/audio/audio.js）]
//   <頭>-replay.wav  10 秒: リプレイの瓦礫の音の道（debrisMode 'replay'）で、
//     0〜3 秒  side: 前線と並んで走るカメラ（前線から 40〜120 m）の前で、本物の街（種 7）のビルがリプレイの時刻表どおりに崩れる
//     3〜6 秒  top: 真上（1000 m 上）から見下ろす。遠い崩落（前のチリチリの元）
//     6〜10 秒 hero・引きの絵: 落ちて止まる大きな破片（カメラから 15〜150 m）が毎秒 6 つほど（destruction の lastSettled → settleHit）
// 出口の最大値（peak）・true peak の目安・リミッターの最大の圧縮量と、帯域の力（150〜600 Hz の胴と 2 kHz より上の粒）を出す。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeWav } from '../src/audio/bgmOffline.js';
import { renderScenes, truePeak, filt } from './boomRender.mjs';
import { collapseHitInfo } from '../src/audio/collapse.js';
import { createReplayTimeline } from '../src/render/replayTimeline.js';
import { generateCity } from '../src/world/cityGen.js';
import { createRng } from '../src/rng.js';
import { CONFIG } from '../src/config.js';

const dir = process.argv[2];
const prefix = process.argv[3] ?? 'rubble';
const modPath = process.argv[4] ?? 'src/audio/audio.js';
if (!dir) { console.error('usage: node scripts/rubble-preview.mjs <out-dir> [prefix] [audio.js]'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const SR = 48000, FPS = 30, T0 = 0.5;

const radius = CONFIG.radius.max;
const tl = createReplayTimeline({ radius, streetDist: 170 });
const side = tl.cut('side'), top = tl.cut('top');
const city = generateCity(7);
const items = city.buildings.filter((b) => b.dist <= radius).map((b) => ({ ...b, key: 'b' + b.id }));
const seen = new Set();
const frames = [];
const rng = createRng(11);
// side（3 秒）と top（3 秒）: リプレイの時刻表の前線に飲まれたビル
for (let i = 0; i < 6 * FPS; i++) {
  const u = i / (6 * FPS);
  const rt = u < 0.5 ? side.t0 + side.dur * (u / 0.5) : top.t0 + top.dur * ((u - 0.5) / 0.5);
  const f = tl.frontAt(rt);
  const hits = [];
  for (const b of items) {
    if (seen.has(b.key) || b.dist > f) continue;
    seen.add(b.key);
    // side: カメラは前線の少し外を一緒に走る / top: 真上 1000 m
    const dist = u < 0.5 ? 40 + 80 * rng() : Math.hypot(1000, b.dist);
    const camX = (rng() * 2 - 1) * dist * 0.6;
    hits.push(collapseHitInfo({ id: b.key, w: b.w, d: b.d, h: b.h }, { camX, camZ: -Math.sqrt(Math.max(1, dist * dist - camX * camX)), dist }));
  }
  frames.push([T0 + i / FPS, hits]);
}
// hero・引きの絵（4 秒）: 落ちて止まる大きな破片
for (let i = 0; i < 4 * FPS; i++) {
  const hits = [];
  if (rng() < 6 / FPS) {
    const dist = 15 + 135 * rng() ** 1.5, size = 1.2 + 4 * rng();
    const camX = (rng() * 2 - 1) * dist * 0.7;
    const x = Math.round(rng() * 4000), z = Math.round(rng() * 4000);
    hits.push(collapseHitInfo({ id: `s${x}_${z}`, w: size, d: size * 0.8, h: size * 0.5 }, { camX, camZ: -Math.sqrt(Math.max(1, dist * dist - camX * camX)), dist }));
  }
  frames.push([T0 + 6 + i / FPS, hits]);
}
const sc = { name: 'replay', dur: T0 + 10 + 1.5, cues: [[0.05, 'debrisMode', 'replay']], frames };
const [r] = await renderScenes([sc], { modPath, SR });
const name = `${prefix}-${sc.name}.wav`;
writeFileSync(join(dir, name), encodeWav({ left: r.left, right: r.right, sr: SR }));
let p = 0;
for (let i = 0; i < r.left.length; i++) p = Math.max(p, Math.abs(r.left[i]), Math.abs(r.right[i]));
const tp = Math.max(truePeak(r.left), truePeak(r.right));
const mono = r.left.map((v, i) => (v + r.right[i]) / 2);
const E = (x, a, b) => { let s = 0; for (let i = Math.round(a * SR); i < Math.min(x.length, Math.round(b * SR)); i++) s += x[i] * x[i]; return s / SR; };
const band = (x, lo, hi) => { let y = x; if (lo) y = filt(filt(y, 'hp', lo), 'hp', lo); if (hi) y = filt(filt(y, 'lp', hi), 'lp', hi); return y; };
const mid = band(mono, 150, 600), hi = band(mono, 2000, 0);
const db = (e) => (10 * Math.log10(e + 1e-12)).toFixed(1);
console.log(`${join(dir, name)}: ${sc.dur.toFixed(2)} s, peak ${p.toFixed(3)} (${(20 * Math.log10(p)).toFixed(2)} dBFS), true-peak~ ${tp.toFixed(3)} (${(20 * Math.log10(tp)).toFixed(2)} dBTP), limiter max reduction ${r.red.toFixed(1)} dB at ${r.redAt.toFixed(2)} s`);
for (const [label, a, b] of [['side 0-3s', T0, T0 + 3], ['top 3-6s', T0 + 3, T0 + 6], ['settle 6-10s', T0 + 6, T0 + 10]]) {
  console.log(`  ${label.padEnd(13)} 150-600 Hz ${db(E(mid, a, b))} dB, >2 kHz ${db(E(hi, a, b))} dB, body - grit ${(10 * Math.log10(E(mid, a, b) / Math.max(1e-12, E(hi, a, b)))).toFixed(1)} dB`);
}
console.log(`hits: ${frames.reduce((a, [, h]) => a + h.length, 0)}`);
