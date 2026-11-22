// R4（spec §15 爆発の短い縦動画）の確かめ: ヘッドレスの Chrome（ソフトウェア WebGL）で一発を放って結果画面まで進め、
// 結果画面の「動画で共有」と同じ道（__debug.clip）で縦動画を本当に録り、ファイルに書き出す。
// 使い方: node scripts/r4-clip.mjs <url> <out.(mp4|webm) の拡張子なしの名前> [--size WxH] [--blackhole] [--fire amount] [--shots prefix]
//   url は ?debug を付けて開く（seed・tier・cliph は url に書く）。--blackhole: 放たずに時間切れ（ブラックホールの結末）。
//   --shots: 結果画面・録画中の知らせ・できたあとの画面を prefix-*.png に撮る
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { CONFIG } from '../src/config.js';

const argv = process.argv.slice(2);
const pos = [], opt = { size: '390x844' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--blackhole') opt.blackhole = true;
  else if (a === '--cancel') opt.cancel = true;
  else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
  else pos.push(a);
}
const [url, outBase] = pos;
const [width, height] = opt.size.split('x').map(Number);
const fire = Number(opt.fire ?? CONFIG.power.max);
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (m) => { if (m.type() === 'error') { console.error('[console.error]', m.text()); if (/Shader Error|WebGL|THREE/.test(m.text())) failed = true; } });
  page.on('pageerror', (e) => { failed = true; console.error('[pageerror]', e.message); });
  const u = new URL(url); u.searchParams.set('debug', '');
  await page.goto(u.toString(), { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  // 音を鳴らせるように（画面を一度タップ。溜めずに離すので撃たない）
  await page.mouse.click(width / 2, height / 2);
  await page.waitForTimeout(300);
  const step = (sec) => page.evaluate((s) => window.__debug.step(s), sec);
  await page.evaluate(() => window.__debug.pause());
  if (opt.blackhole) {
    await page.evaluate(() => { const g = window.__game; document.getElementById('start').hidden = true; if (g.phase === 'ready') { g.pressStart(); g.pressEnd(); } g.timer.update(1e9); });
  } else {
    await page.evaluate((a) => { const g = window.__game; document.getElementById('start').hidden = true; g.pressStart(); g.power.drain(1e9); g.power.add(a); g.pressEnd(); }, fire);
  }
  const t0 = Date.now();
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !document.getElementById('result').hidden)) break;
    await step(0.5);
  }
  const info = await page.evaluate(() => ({ phase: window.__game.phase, outcome: window.__game.outcome ? { clear: window.__game.outcome.clear, rank: window.__game.outcome.rank } : null, tier: window.__tier, supported: window.__debug.clipSupported, clipBtn: !document.querySelector('#result .result-btn.clip')?.hidden, ctx: window.__debug.introClock.ctx }));
  console.log('result', JSON.stringify(info), 'steps took', ((Date.now() - t0) / 1000).toFixed(1), 's');
  if (opt.shots) await page.screenshot({ path: `${opt.shots}-result.png` });
  // 録画（実時間。録画は自分の requestAnimationFrame で描く）
  await page.evaluate(() => { window.__clipP = window.__debug.clip(); });
  if (opt.shots) { await page.waitForTimeout(3500); await page.screenshot({ path: `${opt.shots}-recording.png` }); }
  // --cancel: 録画の途中で Esc（やめる）。結果画面と後ろの最後の絵へ戻ること
  if (opt.cancel) { await page.waitForTimeout(opt.shots ? 0 : 2500); await page.keyboard.press('Escape'); }
  const r = await page.evaluate(() => window.__clipP);
  console.log('clip', JSON.stringify({ ...r, segments: r.segments?.map((s) => `${s.name}[${s.src} ${s.from.toFixed(2)}-${s.to.toFixed(2)} @${s.t0.toFixed(2)}-${s.t1.toFixed(2)}]`) }));
  if (!r.ok) { if (!(opt.cancel && r.why === 'cancelled')) failed = true; } else {
    const b64 = await page.evaluate(() => window.__debug.clipData());
    const ext = r.type.includes('mp4') ? 'mp4' : 'webm';
    const file = `${outBase}.${ext}`;
    writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log('wrote', file, Buffer.from(b64, 'base64').length, 'bytes');
  }
  if (opt.shots) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${opt.shots}-done.png` });
    // 閉じて、結果画面へ戻る（後ろの最後の絵が戻る）
    if (!opt.cancel) await page.evaluate(() => [...document.querySelectorAll('#clip button')].find((b) => b.textContent === '閉じる')?.click());
    await step(2.0);
    await page.screenshot({ path: `${opt.shots}-after.png` });
    const st = await page.evaluate(() => ({ result: !document.getElementById('result').hidden, inert: document.getElementById('result').inert, replay: window.__replay.phase, finished: window.__replay.finished, bh: window.__blackhole.stage, canvas: [document.getElementById('game').width, document.getElementById('game').height] }));
    console.log('after', JSON.stringify(st));
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
