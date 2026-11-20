// 使い方: node scripts/snap.mjs <url> <out.png> [--wait ms] [--press ms] [--size WxH]
// ヘッドレスの Chrome（ソフトウェア WebGL）でページを開き、待ってから（必要なら長押しして）撮影する。
import { chromium } from 'playwright';

function parseArgs(argv) {
  const pos = [], opt = { wait: 1500, press: 0, size: '1280x720' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  const [w, h] = String(opt.size).split('x').map(Number);
  if (pos.length < 2 || !(w > 0) || !(h > 0)) {
    console.error('usage: node scripts/snap.mjs <url> <out.png> [--wait ms] [--press ms] [--size WxH]');
    process.exit(2);
  }
  return { url: pos[0], out: pos[1], wait: Number(opt.wait), press: Number(opt.press), width: w, height: h };
}

const { url, out, wait, press, width, height } = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  // シェーダーや WebGL のエラーは console.error にしか出ないので、それも失敗として扱う
  const FATAL = /Shader Error|WebGL|THREE/;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    console.error('[console.error]', m.text());
    if (FATAL.test(m.text())) failed = true;
  });
  page.on('pageerror', (e) => { failed = true; console.error('[pageerror]', e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
  if (press > 0) {
    const box = await page.locator('canvas').first().boundingBox();
    const x = box ? box.x + box.width / 2 : width / 2, y = box ? box.y + box.height / 2 : height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(press);
    await page.mouse.up();
    await page.waitForTimeout(wait);
  }
  await page.screenshot({ path: out });
  console.log('saved', out);
} finally {
  await browser.close();
}
if (failed) process.exit(1);
