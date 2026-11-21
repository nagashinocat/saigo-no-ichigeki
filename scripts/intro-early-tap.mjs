// 最初の読み込みで、すぐに TAP したときの導入（S6）を確かめる。
// 使い方: node scripts/intro-early-tap.mjs <url> <outDir> <prefix> [--size WxH] [--at s,s,...] [--watch sec] [--cpu rate] [--delay ms]
//   --delay ms: TAP の前にこれだけ待つ（TAP の画面で組み立てと前もって描くのが終わってからの TAP を確かめる。TAP の画面も <prefix>-gate.png に撮る）
//   ページを開いて __debug が出たらすぐ TAP（画面のタップ）。そのあと --watch 秒、実時間で導入を流し、毎フレーム
//   （導入の秒・拍・乗り手の専用の体 focusMesh があるか・フレームの間隔）を記録して、まとめを出す。
//   最後に止めて、--at の各時刻（導入の秒）の絵を <outDir>/<prefix>-<t>.png に撮る（乗り手の体が出ているかも出す）
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = { size: '390x844', at: '0.3,1.0,1.5', watch: '3', cpu: '1', delay: '0' }, pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
  else pos.push(argv[i]);
}
const [url, outDir, prefix] = pos;
const [width, height] = opt.size.split('x').map(Number);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  if (Number(opt.cpu) > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(opt.cpu) });
  }
  page.on('console', (m) => { if (m.type() === 'error') { console.error('[console.error]', m.text()); if (/Shader Error|WebGL|THREE/.test(m.text())) failed = true; } });
  page.on('pageerror', (e) => { failed = true; console.error('[pageerror]', e.message); });
  const u = new URL(url);
  u.searchParams.set('debug', '');
  if (!u.searchParams.has('intro')) u.searchParams.set('intro', 'full');
  await page.goto(u.toString(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__enemyView, null, { timeout: 30000 });
  // 毎フレームの記録（TAP の前から）
  await page.evaluate(() => {
    const log = window.__tapLog = [];
    let last = performance.now();
    const f = (now) => {
      const fl = window.__debug.introFlow;
      log.push({ now, gap: now - last, state: fl.state, t: fl.time, beat: window.__intro.beat, focus: !!window.__enemyView.focusMesh, focusVis: !!window.__enemyView.focusMesh?.visible, heroBody: window.__enemyView.heroBody?.geometry.attributes.position.count });
      last = now;
      if (fl.state !== 'game') requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  if (Number(opt.delay) > 0) {
    await page.waitForTimeout(Number(opt.delay));
    await page.screenshot({ path: `${outDir}/${prefix}-gate.png` });
    console.log('gate', JSON.stringify(await page.evaluate(() => ({ state: window.__debug.introFlow.state, focusMesh: !!window.__enemyView.focusMesh }))));
  }
  const tapAt = await page.evaluate(() => performance.now());
  await page.mouse.click(width / 2, height / 2); // すぐに TAP
  await page.waitForTimeout(Number(opt.watch) * 1000);
  await page.evaluate(() => window.__debug.pause());
  const sum = await page.evaluate((t0) => {
    const log = window.__tapLog.filter((e) => e.now >= t0);
    const intro = log.filter((e) => e.state === 'intro');
    const firstIntro = intro[0];
    const bikes = intro.filter((e) => e.beat === 'bikes');
    const noFocus = bikes.filter((e) => !e.focus);
    const gaps = intro.slice(1).map((e) => e.gap);
    const sorted = [...gaps].sort((a, b) => a - b);
    return {
      frames: intro.length,
      tapToFirstIntroFrameMs: firstIntro ? +(firstIntro.now - t0).toFixed(1) : null,
      firstIntroFrameGapMs: firstIntro ? +firstIntro.gap.toFixed(1) : null,
      bikeFrames: bikes.length, bikeFramesWithoutRiderBody: noFocus.length,
      noRiderBodyUntilIntroSec: noFocus.length ? +noFocus[noFocus.length - 1].t.toFixed(2) : null,
      gapMs: sorted.length ? { p50: +sorted[Math.floor(sorted.length / 2)].toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), max: +sorted[sorted.length - 1].toFixed(1) } : null,
      heroBodyVerts: log.at(-1)?.heroBody,
      reachedIntroSec: +(intro.at(-1)?.t ?? 0).toFixed(2),
      // 長いフレーム（100 ms より長い間隔）: [TAP からの ms, 間隔 ms, 状態, 導入の秒]
      long: log.filter((e) => e.gap > 100).map((e) => [+(e.now - t0).toFixed(0), +e.gap.toFixed(0), e.state, +e.t.toFixed(2)]),
    };
  }, tapAt);
  console.log('early TAP', JSON.stringify(sum));
  for (const t of opt.at.split(',').filter(Boolean).map(Number)) {
    const r = await page.evaluate((tt) => window.__debug.introSeek(tt), t);
    const fm = await page.evaluate(() => ({ focusMesh: !!window.__enemyView.focusMesh, visible: !!window.__enemyView.focusMesh?.visible, focus: window.__enemyView.focus?.id ?? null }));
    await page.waitForTimeout(60);
    const file = `${outDir}/${prefix}-${t}.png`;
    await page.screenshot({ path: file });
    console.log('saved', file, JSON.stringify(r), JSON.stringify(fm));
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
