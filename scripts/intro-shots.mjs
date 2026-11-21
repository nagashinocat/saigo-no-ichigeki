// 導入（S6）の撮影: 1 回ページを開き、__debug.introSeek(t) で決まった時刻の絵を撮る。
// 使い方: node scripts/intro-shots.mjs <url> <outDir> name=t [name=t ...] [--size WxH] [--gate name] [--start name] [--perf]
//   name=t: 導入の秒 t の絵を <outDir>/<name>.png に（例 s6-1-bikes=1.0）
//   --gate name: 最初の読み込みの「TAP」の画面を撮る
//   --start name: 最後に TAP START を押し、ゲームが始まって 1 秒の絵を撮る
//   --perf: 導入の 3D の拍の 1 フレームの JS の時間（ms）を測る
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = { size: '390x844' }, pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--perf') opt.perf = true;
  else if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
  else pos.push(argv[i]);
}
const [url, outDir, ...shots] = pos;
const [width, height] = opt.size.split('x').map(Number);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (m) => { if (m.type() === 'error') { console.error('[console.error]', m.text()); if (/Shader Error|WebGL|THREE/.test(m.text())) failed = true; } });
  page.on('pageerror', (e) => { failed = true; console.error('[pageerror]', e.message); });
  const u = new URL(url);
  u.searchParams.set('debug', '');
  if (!u.searchParams.has('intro')) u.searchParams.set('intro', '');
  await page.goto(u.toString(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && document.fonts.check('900 40px "SaigoMincho"'), null, { timeout: 30000 }).catch(() => console.log('font not confirmed'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__debug.pause());
  if (opt.gate) { await page.screenshot({ path: `${outDir}/${opt.gate}.png` }); console.log('saved gate'); }
  for (const s of shots) {
    const [name, t] = s.split('=');
    const r = await page.evaluate((tt) => window.__debug.introSeek(Number(tt)), t);
    await page.waitForTimeout(60);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('saved', name, JSON.stringify(r));
  }
  if (opt.perf) {
    const res = await page.evaluate(() => {
      const out = {};
      for (const [name, a, b] of [['bikes', 0.2, 2.1], ['light', 2.3 + 1.3, 5.2], ['hide', 6.7, 8.7], ['hands', 8.9, 11.2], ['title', 11.8, 13.5]]) {
        const ms = [];
        const gl = window.__renderer.getContext(), px = new Uint8Array(4);
        for (let t = a; t < b; t += 1 / 30) {
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const t0 = performance.now();
          window.__debug.introSeek(t);
          ms.push(performance.now() - t0);
        }
        ms.sort((x, y) => x - y);
        out[name] = { avg: +(ms.reduce((x, y) => x + y, 0) / ms.length).toFixed(2), p95: +ms[Math.floor(ms.length * 0.95)].toFixed(2), n: ms.length };
      }
      const info = window.__renderer.info.render;
      return { out, calls: info.calls, tris: info.triangles };
    });
    console.log('intro frame JS ms', JSON.stringify(res));
  }
  if (opt.start) {
    await page.evaluate(() => { window.__debug.introSeek(99); });
    await page.evaluate(() => window.__debug.resume());
    await page.click('#intro-start');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__debug.pause());
    const r = await page.evaluate(() => { window.__debug.step(1.0); return { phase: window.__game.phase, remaining: +window.__game.timer.remaining.toFixed(2), bgm: window.__bgm.state }; });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/${opt.start}.png` });
    console.log('saved start', JSON.stringify(r));
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
