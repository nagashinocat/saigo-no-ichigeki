// 導入（S6）の宣伝用の動画を書き出す: ヘッドレスの Chrome で導入を決まった刻みで 1 コマずつ描き（同じ種・同じ時刻なら同じ絵）、
// 導入の音を OfflineAudioContext で書き出して、ffmpeg で H.264 + AAC の MP4 にまとめる。
// 使い方: node scripts/record-intro.mjs [--url http://localhost:5199/] [--out /home/claude/machi-hakai-promo/intro.mp4]
//   [--size 432x768] [--scale 2.5]（→ 1080×1920）[--fps 30] [--seed 7] [--tier high] [--hold 1.5]（TAP START を見せる秒）
//   [--frames dir]（コマの置き場所。省けば出力の隣の intro-frames）[--keep]（コマを消さない）[--from s --to s]（一部だけ）
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const opt = { url: 'http://localhost:5199/', out: '/home/claude/machi-hakai-promo/intro.mp4', size: '432x768', scale: '2.5', fps: '30', seed: '7', tier: 'high', hold: '1.5' };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--keep') opt.keep = true;
  else if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
}
const [vw, vh] = opt.size.split('x').map(Number);
const scale = Number(opt.scale), fps = Number(opt.fps), hold = Number(opt.hold);
const outDir = dirname(opt.out);
const framesDir = opt.frames ?? join(outDir, 'intro-frames');
mkdirSync(outDir, { recursive: true });
if (existsSync(framesDir)) rmSync(framesDir, { recursive: true });
mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
const t0 = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale });
  page.on('console', (m) => { if (m.type() === 'error') { console.error('[console.error]', m.text()); if (/Shader Error|WebGL|THREE/.test(m.text())) failed = true; } });
  page.on('pageerror', (e) => { failed = true; console.error('[pageerror]', e.message); });
  const u = new URL(opt.url);
  for (const [k, v] of Object.entries({ seed: opt.seed, tier: opt.tier, debug: '', intro: '', pr: String(scale) })) u.searchParams.set(k, v);
  await page.goto(u.toString(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && document.fonts.check('900 40px "SaigoMincho"'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__debug.pause());
  const total = await page.evaluate(() => window.__debug.introFlow.timeline.total);
  const from = Number(opt.from ?? 0), to = Number(opt.to ?? total + hold);
  const n0 = Math.round(from * fps), n1 = Math.round(to * fps);
  // 音（ライブと同じ組み方。リミッターの後の一番大きな値が 1 未満なら割れていない）
  const audio = await page.evaluate(() => window.__debug.introAudio(48000));
  writeFileSync(join(framesDir, 'intro.wav'), Buffer.from(audio.wav, 'base64'));
  console.log('audio', JSON.stringify({ seconds: +audio.seconds.toFixed(2), peak: +audio.peak.toFixed(3), rawPeak: +audio.rawPeak.toFixed(3) }));
  for (let i = n0; i < n1; i++) {
    const t = i / fps;
    await page.evaluate((tt) => {
      window.__debug.introSeek(tt);
      // TAP START の脈打ち（CSS のアニメーション）も同じ時刻に合わせる
      const tl = window.__debug.introFlow.timeline;
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = Math.max(0, (tt - tl.total) * 1000); }
    }, t);
    await page.screenshot({ path: join(framesDir, `f${String(i - n0).padStart(5, '0')}.png`) });
    if ((i - n0) % 30 === 0) console.log(`frame ${i - n0}/${n1 - n0} t=${t.toFixed(2)} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const vsec = (n1 - n0) / fps;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(framesDir, 'f%05d.png'),
    '-ss', String(from), '-t', String(vsec), '-i', join(framesDir, 'intro.wav'),
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p',
    '-vf', `scale=${Math.round(vw * scale / 2) * 2}:${Math.round(vh * scale / 2) * 2}:flags=lanczos`,
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(vsec), opt.out], { stdio: 'inherit' });
  console.log('wrote', opt.out, `${vsec.toFixed(2)}s`, `${((Date.now() - t0) / 1000).toFixed(0)}s elapsed`);
} finally {
  await browser.close();
  if (!opt.keep && !failed) rmSync(framesDir, { recursive: true, force: true });
}
if (failed) process.exit(1);
