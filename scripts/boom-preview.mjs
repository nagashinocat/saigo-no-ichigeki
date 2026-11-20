// 爆発の音を耳で確かめるための WAV を書き出す。ゲームと同じ src/audio/audio.js を、本物の Chrome の OfflineAudioContext で
// 鳴らす（リミッター・こもり・演出の無音もゲームと同じ道を通る）。
// 使い方: node scripts/boom-preview.mjs <出力先のフォルダ> [名前の頭（既定 boom）] [audio.js のパス（既定 src/audio/audio.js）]
//   <頭>-puff.wav   3.5 秒: 払う（小爆発）を一発（1 秒の時点。リミッターの初めの状態が落ち着いてから）
//   <頭>-final.wav  最後の一発（力満タン）の音の段取りを演出の時刻表どおりに: 無音 → 心臓の鼓動 3 回 → 弾ける（爆発）
//                   → 追われる間 → 宇宙でこもって消える → 無音 → 低い地鳴り
// 出口の最大値・1 に触れた標本の数・リミッターの最大の圧縮量（dB）も出す。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { encodeWav } from '../src/audio/bgmOffline.js';
import { createTimeline, FINALE } from '../src/render/finaleTimeline.js';
import { CONFIG } from '../src/config.js';
import { finaleBoomOpts } from '../src/audio/audio.js';

const dir = process.argv[2];
const prefix = process.argv[3] ?? 'boom';
const modPath = resolve(process.argv[4] ?? 'src/audio/audio.js');
if (!dir) { console.error('usage: node scripts/boom-preview.mjs <out-dir> [prefix] [audio.js]'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const SR = 48000;

// 力満タンの一発（最善の操作で満タンが最後の数秒）。狙うビルまでの距離はふつうの値
const radius = CONFIG.radius.max;
const tl = createTimeline({ radius, hitDist: 40 });
const size = Math.sqrt(radius / CONFIG.radius.max);
const T0 = 1.0; // 放つ瞬間
const finalCues = [
  [T0, 'silence'],
  ...tl.beats.map((b, i) => [T0 + b, 'heart', i]),
  [T0 + tl.snap, 'snap'],
  [T0 + tl.chaseEnd, 'space'],
  [T0 + tl.rumble, 'rumble'],
];
const scenes = [
  { name: 'puff', dur: 3.5, cues: [[1.0, 'boom', Math.sqrt(CONFIG.puff.radius / CONFIG.radius.max)]] },
  { name: 'final', dur: T0 + tl.rumble + 7, cues: finalCues, size, ...finaleBoomOpts(tl, FINALE.burstRamp) },
];

const server = await createServer({ server: { port: 0, fs: { strict: false } }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/src/config.js`);
  for (const sc of scenes) {
    const r = await page.evaluate(async ({ sc, mod, SR }) => {
      const { createAudio } = await import(mod + '?' + Math.random());
      const n = Math.ceil(sc.dur * SR);
      const ctx = new OfflineAudioContext(2, n, SR);
      Object.defineProperty(ctx, 'state', { get: () => 'running' });
      let lim = null;
      const mk = ctx.createDynamicsCompressor.bind(ctx);
      ctx.createDynamicsCompressor = () => (lim = mk());
      window.AudioContext = function () { return ctx; };
      const audio = createAudio(); audio.unlock();
      const run = (name, arg) => {
        if (name === 'boom') audio.boom(arg);
        else if (name === 'silence') audio.silence();
        else if (name === 'heart') audio.heartbeat(arg);
        else if (name === 'snap') { audio.unsilence(); audio.boom(sc.size, { hold: sc.hold, open: sc.open }); } // main.js と同じ
        else if (name === 'space') audio.muffle(1.4);
        else if (name === 'rumble') audio.deepRumble();
      };
      const q = 128 / SR, at = (t) => Math.round(t / q) * q;
      for (const [t, name, arg] of sc.cues) ctx.suspend(at(t)).then(() => { run(name, arg); ctx.resume(); });
      // リミッターの圧縮量を 20 ms ごとに読む（最初の合図から。それより前はリミッターの初めの状態が残る。同じ時刻の suspend は一つだけ）
      const cueT = new Set(sc.cues.map(([t]) => at(t)));
      let red = 0, redAt = 0;
      for (let t = sc.cues[0][0] + 0.02; t < sc.dur - 0.05; t += 0.02) {
        const tt = at(t);
        if (cueT.has(tt)) continue;
        ctx.suspend(tt).then(() => { if (lim.reduction < red) { red = lim.reduction; redAt = tt; } ctx.resume(); });
      }
      const buf = await ctx.startRendering();
      return { left: Array.from(buf.getChannelData(0)), right: Array.from(buf.getChannelData(1)), red, redAt };
    }, { sc, mod: '/@fs' + modPath, SR });
    const left = Float32Array.from(r.left), right = Float32Array.from(r.right);
    const name = `${prefix}-${sc.name}.wav`;
    writeFileSync(join(dir, name), encodeWav({ left, right, sr: SR }));
    let p = 0, clip = 0;
    for (let i = 0; i < left.length; i++) {
      const v = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      p = Math.max(p, v); if (v >= 0.999) clip++;
    }
    // 100 ms ごとの RMS（dBFS）の目安
    const env = [];
    for (let i = 0; i < left.length; i += SR / 10) {
      let s = 0; const m = Math.min(left.length, i + SR / 10);
      for (let j = i; j < m; j++) s += (left[j] ** 2 + right[j] ** 2) / 2;
      env.push(Math.round(10 * Math.log10(s / (m - i) + 1e-12)));
    }
    console.log(`${name}: ${sc.dur.toFixed(2)} s, peak ${p.toFixed(3)} (${(20 * Math.log10(p)).toFixed(1)} dBFS), samples >= 0.999: ${clip}, limiter max reduction ${r.red.toFixed(1)} dB at ${r.redAt.toFixed(2)} s`);
    console.log(`  rms/100ms dBFS: ${env.join(' ')}`);
  }
  if (scenes[1]) console.log(`final cues (s): ${finalCues.map(([t, n]) => `${n}@${t.toFixed(2)}`).join(' ')}`);
} finally {
  await browser.close();
  await server.close();
}
