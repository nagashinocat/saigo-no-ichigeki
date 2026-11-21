// 使い方: node scripts/perf-city.mjs <url> [--tiers high,mid,low] [--frames 40] [--seed 7]
// 街の重さを段ごとに測る（ヘッドレスの Chrome、ソフトウェア WebGL。実機の代わりの目安）。
//  game:   上空の画面（遊び始めて 3 秒）の 1 フレームの描画の回数・三角形（renderer.info、フレーム全体）と、
//          frames フレームを毎フレーム進めて描いたときの GPU を待った時間（速い方から 70% の平均）と JS の時間
//  swap:   最大の一発を放った直後の数フレーム（粗い → 細かいビルへの差し替えを含む）の、1 フレームずつの時間
//  finale: 演出の肩越し（1.9 秒）・見せる期（4.6 秒）・大量に壊れていく間（5.6 秒〜）の描画の回数・三角形とフレームの時間
//  replay: リプレイの通りのカット（13.2 秒）
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = { tiers: 'high,mid,low', frames: '40', seed: '7' };
const pos = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i]; else pos.push(argv[i]); }
const base = pos[0] ?? 'http://localhost:5173/';
const FR = Number(opt.frames);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const fast = (xs, q = 0.7) => { const s = [...xs].sort((a, b) => a - b); const n = Math.max(1, Math.floor(s.length * q)); return +(s.slice(0, n).reduce((a, b) => a + b, 0) / n).toFixed(1); };

async function run(tier) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  const u = new URL(base); u.searchParams.set('debug', ''); u.searchParams.set('seed', opt.seed); u.searchParams.set('tier', tier);
  await page.goto(u.toString(), { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__debug.pause();
    window.__renderer.info.autoReset = false;
    window.__info = () => { const r = window.__renderer; r.info.reset(); window.__debug.draw(); return { calls: r.info.render.calls, tris: r.info.render.triangles }; };
    window.__timed = (n) => { const t = window.__debug.timeFrames(n); return t; };
  });
  const out = { tier };
  await page.evaluate(() => { document.getElementById('start').hidden = true; window.__game.pressStart(); window.__game.pressEnd(); window.__debug.step(3); });
  out.game = await page.evaluate(() => window.__info());
  const g = await page.evaluate((n) => window.__timed(n), FR);
  out.game.gpu = fast(g.gpu); out.game.js = fast(g.js);
  // 最大の一発: 放った直後のフレームを 1 つずつ（差し替えのフレームを探す）
  await page.evaluate(() => { const gm = window.__game; gm.power.drain(1e9); gm.power.add(100); gm.pressStart(); gm.pressEnd(); });
  const sw = await page.evaluate(() => window.__timed(12));
  out.swap = { js: sw.js.map((v) => +v.toFixed(1)), gpu: sw.gpu.map((v) => +v.toFixed(1)) };
  const at = async (t0, t1) => { await page.evaluate((d) => window.__debug.step(d), t1 - t0); };
  let t = 12 / 60;
  out.finale = {};
  for (const [name, tt] of [['shoulder', 1.9], ['show', 4.6], ['mass', 5.6]]) {
    await at(t, tt); t = tt;
    const info = await page.evaluate(() => window.__info());
    const fr = await page.evaluate(() => window.__timed(8));
    t += 8 / 60;
    out.finale[name] = { ...info, gpu: fast(fr.gpu), js: fast(fr.js), jsMax: +Math.max(...fr.js).toFixed(1) };
  }
  // リプレイの通りのカットまで
  await at(t, 13.2); t = 13.2;
  const rp = await page.evaluate(() => ({ active: window.__replay.active, cut: window.__replay.cut }));
  const info = await page.evaluate(() => window.__info());
  const fr = await page.evaluate(() => window.__timed(8));
  out.replay = { ...rp, ...info, gpu: fast(fr.gpu), js: fast(fr.js) };
  out.counts = await page.evaluate(() => ({ buildings: window.__game.city.buildings.length, dress: window.__cityView.dressCounts }));
  await page.close();
  return out;
}

try {
  for (const tier of opt.tiers.split(',')) console.log(JSON.stringify(await run(tier)));
} finally { await browser.close(); }
