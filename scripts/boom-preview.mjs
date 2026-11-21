// 爆発の音を耳で確かめるための WAV を書き出す。ゲームと同じ src/audio/audio.js を、本物の Chrome の OfflineAudioContext で
// 鳴らす（リミッター・こもり・演出の無音もゲームと同じ道を通る）。
// 使い方: node scripts/boom-preview.mjs <出力先のフォルダ> [名前の頭（既定 boom）] [audio.js のパス（既定 src/audio/audio.js）]
//   <頭>-puff.wav    3.5 秒: 払う（小爆発）を一発（1 秒の時点。リミッターの初めの状態が落ち着いてから）
//   <頭>-final.wav   最後の一発（力満タン）の音の段取りを演出の時刻表どおりに: 無音 → 心臓の鼓動 3 回 → 時間が戻る（爆発・地響き）
//                    → 追われる間（瓦礫の崩れる音が前線に合わせて重なる）→ 宇宙でこもる → 無音 → 低い地鳴り
//   <頭>-boom.wav    最後の一発の爆発の音だけ（地響き・瓦礫なし。前と比べる用）
//   <頭>-debris.wav  6 秒: 瓦礫の崩れる音だけ（小さい・遠い → 大きい・近い、左右に散る、最後は一度にたくさん）
//   <頭>-stress.wav  最大の場面: 最後の一発 + 地響き + 瓦礫を毎フレーム多数 + 最高潮の BGM の大きさの音を BGM の道へ
// 地響き（finaleRumble）や瓦礫（collapse）の無い audio.js（前の版）では、その部分は鳴らない（前と比べられる）。
// 出口の最大値・4 倍に補間した最大値（true peak の目安）・1 に触れた標本の数・リミッターの最大の圧縮量（dB）、
// 帯域ごとの力（dB）と、低い一打の基音・うなりの長さの目安も出す。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { encodeWav } from '../src/audio/bgmOffline.js';
import { createTimeline, FINALE } from '../src/render/finaleTimeline.js';
import { CONFIG } from '../src/config.js';
import { finaleBoomOpts } from '../src/audio/audio.js';
import { collapseHitInfo } from '../src/audio/collapse.js';
import { generateCity } from '../src/world/cityGen.js';
import { createRng } from '../src/rng.js';

const dir = process.argv[2];
const prefix = process.argv[3] ?? 'boom';
const modPath = resolve(process.argv[4] ?? 'src/audio/audio.js');
if (!dir) { console.error('usage: node scripts/boom-preview.mjs <out-dir> [prefix] [audio.js]'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const SR = 48000;
const FPS = 30; // 瓦礫の音はゲームと同じく毎フレーム呼ぶ（中くらいの Android の 30 fps）

// 力満タンの一発（最善の操作で満タンが最後の数秒）。狙うビルまでの距離はふつうの値
const radius = CONFIG.radius.max;
const tl = createTimeline({ radius, hitDist: 40 });
const size = Math.sqrt(radius / CONFIG.radius.max);
const T0 = 1.0; // 放つ瞬間
const finalCues = [
  [T0, 'silence'],
  ...tl.beats.map((b, i) => [T0 + b, 'heart', i]),
  [T0 + tl.resume, 'snap'], // cinematic.js は時間が戻る瞬間（resume）に 'snap' を出す
  [T0 + tl.chaseEnd, 'space'],
  [T0 + tl.rumble, 'rumble'],
];
// 瓦礫: 本物の街（種 1）のビル・小物が、演出の時刻表の前線に飲まれる瞬間。鳴らすのは main.js と同じ段（時間が戻ってから
// 横一線の光が消えるまで）。カメラは前線の少し先を逃げる（近さは前線からの距離の目安、左右は爆心から見た向き）
const city = generateCity(1);
const STAGES = new Set(['snap', 'chase', 'space', 'flatten']);
const items = [...city.buildings.map((b) => ({ ...b, key: 'b' + b.id })), ...city.props.map((p) => ({ ...p, key: 'p' + p.id }))]
  .filter((b) => b.dist <= radius);
const finalFrames = [];
{
  const hitAt = new Map();
  for (let t = 0; t < tl.end; t += 1 / FPS) {
    const f = tl.front(t);
    const hits = [];
    for (const b of items) if (!hitAt.has(b.key) && b.dist <= f) { hitAt.set(b.key, t); hits.push(b); }
    if (!STAGES.has(tl.stage(t))) continue;
    const camR = f + 25, ang = Math.atan2(1, 0.3);
    finalFrames.push([T0 + t, hits.map((b) => {
      const a = Math.atan2(b.z, b.x) - ang;
      const dist = Math.max(8, Math.hypot(b.x - camR * Math.cos(ang), b.z - camR * Math.sin(ang)) * 0.35);
      return collapseHitInfo({ id: b.key, w: b.w, d: b.d, h: b.h }, { camX: Math.sin(a) * dist, camZ: -Math.abs(Math.cos(a)) * dist - 1, dist });
    })]);
  }
}
const debrisFrames = [];
{
  const rng = createRng(5);
  for (let i = 0; i < 6 * FPS; i++) {
    const t = 0.5 + i / FPS, u = i / (6 * FPS);
    const hits = [];
    const n = u > 0.8 ? 12 : rng() < 0.35 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const big = Math.min(1, u + 0.2 * rng());
      hits.push(collapseHitInfo({ id: `b${i * 16 + k}`, w: 4 + 22 * big, d: 4 + 22 * big, h: 6 + 70 * big }, { camX: (rng() * 2 - 1) * 40, camZ: -30, dist: 400 - 380 * big }));
    }
    debrisFrames.push([t, hits]);
  }
}
const stressFrames = finalFrames.map(([t, hits]) => [t, hits.length ? hits : (t > T0 + tl.snap && t < T0 + tl.lineEnd)
  ? Array.from({ length: 6 }, (_, k) => collapseHitInfo({ id: `b${Math.round(t * 1000)}_${k}`, w: 30, d: 30, h: 90 }, { camX: k % 2 ? 10 : -10, camZ: -10, dist: 15 }))
  : []]);
const fin = { size, ...finaleBoomOpts(tl, FINALE.burstRamp) };
const scenes = [
  { name: 'puff', dur: 3.5, cues: [[1.0, 'boom', Math.sqrt(CONFIG.puff.radius / CONFIG.radius.max)]] },
  { name: 'final', dur: T0 + tl.rumble + 7, cues: finalCues, frames: finalFrames, ...fin, metricsAt: T0 + tl.resume },
  { name: 'boom', dur: 14, cues: [[1.0, 'boomOnly']], ...fin, metricsAt: 1.0 },
  { name: 'debris', dur: 7, cues: [[0.5, 'noop']], frames: debrisFrames },
  { name: 'stress', dur: T0 + tl.rumble + 7, cues: [[0.5, 'bgmLoud'], ...finalCues], frames: stressFrames, ...fin, keepBgm: true },
];

const server = await createServer({ server: { port: 0, fs: { strict: false } }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

// 4 倍に補間した最大値（true peak の目安。窓付き sinc）
function truePeak(x) {
  const K = 4, H = 16, w = [];
  for (let p = 1; p < K; p++) {
    const row = [];
    for (let j = -H + 1; j <= H; j++) {
      const d = j - p / K, s = Math.abs(d) < 1e-9 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      row.push(s * (0.5 + 0.5 * Math.cos(Math.PI * d / H)));
    }
    w.push(row);
  }
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    m = Math.max(m, Math.abs(x[i]));
    if (Math.abs(x[i]) < 0.5) continue; // 大きいところの近くだけ補間する
    for (let p = 0; p < K - 1; p++) {
      let v = 0;
      for (let j = -H + 1, k = 0; j <= H; j++, k++) { const q = i + j; if (q >= 0 && q < x.length) v += x[q] * w[p][k]; }
      m = Math.max(m, Math.abs(v));
    }
  }
  return m;
}
// RBJ の low-pass / high-pass（帯域の力を測る）
function filt(x, type, fc) {
  const w0 = 2 * Math.PI * fc / SR, al = Math.sin(w0) / (2 * 0.707), c = Math.cos(w0), a0 = 1 + al;
  const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const a1 = -2 * c / a0, a2 = (1 - al) / a0, b0 = b[0] / a0, b1 = b[1] / a0, b2 = b[2] / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
const db = (e) => (10 * Math.log10(e + 1e-12)).toFixed(1);
function metrics(mono, at) {
  const i0 = Math.round(at * SR), seg = (x, a, b) => x.subarray(i0 + Math.round(a * SR), Math.min(x.length, i0 + Math.round(b * SR)));
  const energy = (x) => { let s = 0; for (const v of x) s += v * v; return s / SR; };
  const lp = (fc) => filt(mono, 'lp', fc);
  const sub40 = lp(40), sub80 = lp(80), lo160 = lp(160), hi120 = filt(mono, 'hp', 120);
  const bands = {
    '<40 Hz': energy(seg(sub40, 0, 8)), '<80 Hz': energy(seg(sub80, 0, 8)), '<160 Hz': energy(seg(lo160, 0, 8)),
    'all': energy(seg(mono, 0, 8)),
  };
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
  const env = [];
  for (let t = 0; t < 12; t += 0.1) env.push(energy(seg(hi120, t, t + 0.1)) / 0.1);
  let last = 0;
  env.forEach((e, k) => { if (e > 1e-5) last = (k + 1) * 0.1; });
  // 地響きの長さ: 80 Hz 以下の力が最大から 30 dB 下がるまで
  const envS = [];
  for (let t = 0; t < 14; t += 0.1) envS.push(energy(seg(sub80, t, t + 0.1)));
  const ms = Math.max(...envS); let lastS = 0;
  envS.forEach((e, k) => { if (e > ms / 1000) lastS = (k + 1) * 0.1; });
  return { bands, f0, roarLen: last, subLen: lastS };
}

const results = {};
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/src/config.js`);
  for (const sc of scenes) {
    const r = await page.evaluate(async ({ sc, mod, SR }) => {
      const { createAudio } = await import(mod + '?' + Math.random());
      // 乱数を決まった並びに（同じ版はいつも同じ WAV。前の版と比べやすく）
      let seed = 12345;
      Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const n = Math.ceil(sc.dur * SR);
      const ctx = new OfflineAudioContext(2, n, SR);
      Object.defineProperty(ctx, 'state', { get: () => 'running' });
      let lim = null;
      const mk = ctx.createDynamicsCompressor.bind(ctx);
      ctx.createDynamicsCompressor = () => (lim = mk());
      window.AudioContext = function () { return ctx; };
      const audio = createAudio(); audio.unlock();
      const tlArg = { resume: sc.resume, beatEnd: sc.resume, snap: sc.snap, chaseEnd: sc.chaseEnd, flatten: sc.flatten, lineEnd: sc.lineEnd };
      const run = (name, arg) => {
        if (name === 'boom') audio.boom(arg);
        else if (name === 'boomOnly') audio.boom(sc.size, { hold: sc.hold, open: sc.open, heavy: sc.heavy });
        else if (name === 'silence') audio.silence();
        else if (name === 'heart') audio.heartbeat(arg);
        else if (name === 'snap') { // main.js と同じ
          audio.unsilence(); audio.boom(sc.size, { hold: sc.hold, open: sc.open, heavy: sc.heavy });
          if (audio.finaleRumble) audio.finaleRumble(tlArg);
        }
        else if (name === 'space') audio.muffle(1.4);
        else if (name === 'rumble') audio.deepRumble();
        else if (name === 'bgmLoud') {
          // 最高潮の BGM の大きさ（mixOffline の最大値 0.5 未満）の、低い太鼓のような音を BGM の道へ鳴らし続ける
          const o = audio.bgmOutput; if (!o) return;
          const g = ctx.createGain(); g.gain.value = 0.45; g.connect(o.dest);
          for (const f of [55, 110, 220]) { const x = ctx.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; const xg = ctx.createGain(); xg.gain.value = 0.33; x.connect(xg); xg.connect(g); x.start(); }
        }
      };
      const q = 128 / SR, at = (t) => Math.round(t / q) * q;
      const byT = new Map();
      const add = (t, f) => { const k = at(t); if (!byT.has(k)) byT.set(k, []); byT.get(k).push(f); };
      for (const [t, name, arg] of sc.cues) add(t, () => run(name, arg));
      if (audio.collapse) for (const [t, hits] of sc.frames ?? []) add(t, () => audio.collapse(hits));
      for (const [k, fs] of byT) ctx.suspend(k).then(() => { for (const f of fs) f(); ctx.resume(); });
      // リミッターの圧縮量を 20 ms ごとに読む（最初の合図から。同じ時刻の suspend は一つだけ）
      let red = 0, redAt = 0;
      for (let t = sc.cues[0][0] + 0.02; t < sc.dur - 0.05; t += 0.02) {
        const tt = at(t);
        if (byT.has(tt)) continue;
        byT.set(tt, []);
        ctx.suspend(tt).then(() => { if (lim.reduction < red) { red = lim.reduction; redAt = tt; } ctx.resume(); });
      }
      const buf = await ctx.startRendering();
      return { left: Array.from(buf.getChannelData(0)), right: Array.from(buf.getChannelData(1)), red, redAt };
    }, { sc: { ...sc, resume: tl.resume, snap: tl.snap, chaseEnd: tl.chaseEnd, flatten: tl.flatten, lineEnd: tl.lineEnd }, mod: '/@fs' + modPath, SR });
    const left = Float32Array.from(r.left), right = Float32Array.from(r.right);
    const name = `${prefix}-${sc.name}.wav`;
    writeFileSync(join(dir, name), encodeWav({ left, right, sr: SR }));
    let p = 0, clip = 0;
    for (let i = 0; i < left.length; i++) {
      const v = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      p = Math.max(p, v); if (v >= 0.999) clip++;
    }
    const tp = Math.max(truePeak(left), truePeak(right));
    // 100 ms ごとの RMS（dBFS）の目安
    const env = [];
    for (let i = 0; i < left.length; i += SR / 10) {
      let s = 0; const m = Math.min(left.length, i + SR / 10);
      for (let j = i; j < m; j++) s += (left[j] ** 2 + right[j] ** 2) / 2;
      env.push(Math.round(10 * Math.log10(s / (m - i) + 1e-12)));
    }
    console.log(`${name}: ${sc.dur.toFixed(2)} s, peak ${p.toFixed(3)} (${(20 * Math.log10(p)).toFixed(2)} dBFS), true-peak~ ${tp.toFixed(3)} (${(20 * Math.log10(tp)).toFixed(2)} dBTP), samples >= 0.999: ${clip}, limiter max reduction ${r.red.toFixed(1)} dB at ${r.redAt.toFixed(2)} s`);
    console.log(`  rms/100ms dBFS: ${env.join(' ')}`);
    if (sc.metricsAt != null) {
      const mono = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
      const m = metrics(mono, sc.metricsAt);
      console.log(`  from ${sc.metricsAt.toFixed(2)} s, 0–8 s energy dB: ${Object.entries(m.bands).map(([k, v]) => `${k} ${db(v)}`).join(', ')}`);
      console.log(`  punch dominant ${m.f0.toFixed(0)} Hz (15–150 Hz, 0.01–0.5 s), roar (>120 Hz) above -50 dBFS RMS until ${m.roarLen.toFixed(1)} s, sub (<80 Hz) for ${m.subLen.toFixed(1)} s`);
      results[sc.name] = m;
    }
  }
  console.log(`final cues (s): ${finalCues.map(([t, n]) => `${n}@${t.toFixed(2)}`).join(' ')}; debris frames with hits: ${finalFrames.filter(([, h]) => h.length).length}, hits: ${finalFrames.reduce((a, [, h]) => a + h.length, 0)}`);
} finally {
  await browser.close();
  await server.close();
}
