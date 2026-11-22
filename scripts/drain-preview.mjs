// R1b（持ち主 08:24「吸われてる音」）: 吸われる音を耳で確かめる WAV を書き出す。ゲームと同じ src/audio/audio.js の drain を、
// 本物の Chrome の OfflineAudioContext で、ゲームと同じく毎フレーム（60 fps）drainFx の状態で鳴らす（リミッターも同じ道）。
// 使い方: node scripts/drain-preview.mjs [出力先のフォルダ（既定 /home/claude/machi-hakai-bgm）] [名前の頭（既定 r1b-drain）]
//   <頭>-one.wav     ふつうの者 1 人に 3 秒掴まれ、払ってはがれる（その場で止まる）
//   <頭>-build.wav   1 人 → 6 人へ増え（左から右へ回り込む）、7 秒で払ってはがれる
//   <頭>-kinds.wav   ふつうの者 1 人 → 吸う者（×2.5）が加わる → 大物（×4、右）が加わる → はがれる
//   <頭>-stress.wav  6 人と大物に吸われながら、払うの爆発と、最高潮の BGM の大きさの音が重なる（リミッターの余裕を見る。
//                    吸われる音なしの同じ重なり stress-nodrain の値も出す。こちらは書き出さない）
// 出口の最大値・4 倍に補間した最大値（true peak の目安）と、はがれた 50 ms あと〜300 ms の最大値（その場で止まるか）を出す
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { encodeWav } from '../src/audio/bgmOffline.js';
import { truePeak, CHROME } from './boomRender.mjs';

const dir = process.argv[2] ?? '/home/claude/machi-hakai-bgm';
const prefix = process.argv[3] ?? 'r1b-drain';
mkdirSync(dir, { recursive: true });
const SR = 48000;

// 場面: dur 秒、load(t) と pan(t)（掴んでいる者の吸う力の合計と、画面の左右）、cues: [[t, 'boom' | 'bgmLoud']]
const scenes = [
  { name: 'one', dur: 5, at: [[0.5, 1, 0], [3.5, 0, 0]] },
  { name: 'build', dur: 8.5, at: [[0.5, 1, -0.6], [1.5, 2, -0.4], [2.5, 3, -0.1], [3.5, 4, 0.2], [4.5, 5, 0.4], [5.5, 6, 0.5], [7.0, 0, 0.5]] },
  { name: 'kinds', dur: 8.5, at: [[0.5, 1, -0.3], [2.5, 3.5, -0.1], [4.5, 7.5, 0.45], [7.0, 0, 0.45]] },
  { name: 'stress', dur: 7, at: [[0.5, 10, 0.3], [6.0, 0, 0.3]], cues: [[0.4, 'bgmLoud'], [2.0, 'boom'], [3.2, 'boom'], [4.4, 'boom']] },
  // 比べる用（書き出さない）: 同じ重なりで吸われる音なし
  { name: 'stress-nodrain', dur: 7, at: [[0.5, 0, 0]], cues: [[0.4, 'bgmLoud'], [2.0, 'boom'], [3.2, 'boom'], [4.4, 'boom']], noWrite: true },
];

const server = await createServer({ server: { port: 0, fs: { strict: false } }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/src/config.js`);
  const mods = { audio: '/@fs' + resolve('src/audio/audio.js'), fx: '/@fs' + resolve('src/ui/drainFx.js'), cfg: '/@fs' + resolve('src/config.js') };
  for (const sc of scenes) {
    const r = await page.evaluate(async ({ sc, mods, SR }) => {
      const imp = new Function('u', 'return import(u)');
      const { createAudio } = await imp(mods.audio);
      const { createDrainFx } = await imp(mods.fx);
      const { CONFIG } = await imp(mods.cfg);
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
      const fx = createDrainFx();
      const loadAt = (t) => { let v = { load: 0, pan: 0 }; for (const [a, load, pan] of sc.at) if (t >= a) v = { load, pan }; return v; };
      const q = 128 / SR, at = (t) => Math.round(t / q) * q;
      const byT = new Map();
      const add = (t, f) => { const k = at(t); if (!byT.has(k)) byT.set(k, []); byT.get(k).push(f); };
      const FPS = 60;
      for (let i = 0; i * (1 / FPS) < sc.dur - 0.05; i++) {
        const t = i / FPS;
        add(t, () => { const { load, pan } = loadAt(t); audio.drain(fx.update(1 / FPS, { load, drained: 0, grabbers: load > 0 ? [{ pan, w: 1 }] : [] })); });
      }
      for (const [t, name] of sc.cues ?? []) add(t, () => {
        if (name === 'boom') audio.boom(Math.sqrt(CONFIG.puff.radius / CONFIG.radius.max));
        else if (name === 'bgmLoud') {
          const o = audio.bgmOutput; if (!o) return;
          const g = ctx.createGain(); g.gain.value = 0.45; g.connect(o.dest);
          for (const f of [55, 110, 220]) { const x = ctx.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; const xg = ctx.createGain(); xg.gain.value = 0.33; x.connect(xg); xg.connect(g); x.start(); }
        }
      });
      let red = 0;
      for (const [k, fs] of byT) ctx.suspend(k).then(() => { for (const f of fs) f(); if (k > 0.3 && lim && lim.reduction < red) red = lim.reduction; ctx.resume(); });
      const buf = await ctx.startRendering();
      return { left: Array.from(buf.getChannelData(0)), right: Array.from(buf.getChannelData(1)), red };
    }, { sc, mods, SR });
    const L = Float32Array.from(r.left), R = Float32Array.from(r.right);
    let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const tp = Math.max(truePeak(L), truePeak(R));
    // はがれた瞬間（最後の load 0）から 50 ms あとの大きさ（その場で止まるか）
    const off = sc.at[sc.at.length - 1][0];
    let tail = 0; for (let i = Math.round((off + 0.05) * SR); i < Math.min(L.length, Math.round((off + 0.3) * SR)); i++) tail = Math.max(tail, Math.abs(L[i]), Math.abs(R[i]));
    const file = join(dir, `${prefix}-${sc.name}.wav`);
    if (!sc.noWrite) writeFileSync(file, encodeWav({ left: L, right: R, sr: SR }));
    const db = (x) => (20 * Math.log10(Math.max(1e-9, x))).toFixed(1);
    console.log(file, JSON.stringify({ peak: +peak.toFixed(3), peakDb: db(peak), truePeakDb: db(tp), afterClear50ms: sc.cues ? null : db(tail) }));
  }
} finally {
  await browser.close();
  await server.close();
}
