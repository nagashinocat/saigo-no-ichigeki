// 使い方: node scripts/snap.mjs <url> <out.png> [--wait ms] [--press ms] [--size WxH]
//   [--step] [--idle s] [--at s,s,...] [--from release|blast] [--perf frames] [--cpu rate]
//   [--fire amount] [--hand level[,steady]] [--hand-release amount] [--keep-holding] [--puff n]
// ヘッドレスの Chrome（ソフトウェア WebGL）でページを開き、待ってから（必要なら長押しして）撮影する。
// --step: 実時間ではなく window.__debug.step で決まった dt ずつ進める（ヘッドレスは遅いので、爆発の瞬間を正確に撮る）。
//   --idle 秒だけ待って器を満たし、--press ミリ秒貯めて離し、--at の各時刻（--from の時点からの秒）で撮る。
//   out の {t} は時刻に置き換わる（例 shots/t9-max-{t}.png）。
// --perf N: 離した後の N フレームを毎フレーム進めて描き、1フレームの JS の時間（ms）の平均・p95・最大と、GPU を待った時間を出す。
// --cpu R: CDP の Emulation.setCPUThrottlingRate で CPU を R 倍遅くする。
// --hand L[,S]: 手の画面の入力を、貯めた力 L・光の安定 S に固定する（--step と使う）。
// --hand-release A: 手の画面だけに、量 A の一発を放つ瞬間を起こす（A が小爆発の量以下なら小爆発）。--at はその時点からの秒。
// --skip S: リプレイを、--at の時刻 S で飛ばす（画面のタップと同じ）。
// --keep-holding: --press の後も離さない（最後の一発を放たない）。--puff N: そのあと小爆発を N 回（0.25 秒おき）押す。--at はその時点からの秒。
// --timeout: そのあと残り時間を 0 にする（次の一歩で時間切れ → ブラックホールの結末）。--at はその時点からの秒。
// --eval JS: 撮る前（--at の最初の一歩の前）にページで JS を走らせる（例: 上空カメラを寄せて近くから確かめる）。
// 力は長押しの間だけ貯まる（CONFIG.power.chargePerSec）。--press が短すぎると離しても放たれない。
import { chromium } from 'playwright';
import { CONFIG } from '../src/config.js';

function parseArgs(argv) {
  const pos = [], opt = { wait: 1500, press: 0, size: '1280x720', idle: 0, at: '', from: 'release', perf: 0, cpu: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--step') opt.step = true;
    else if (a === '--keep-holding') opt.keepHolding = true;
    else if (a === '--timeout') opt.timeout = true;
    else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  const [w, h] = String(opt.size).split('x').map(Number);
  if (pos.length < 2 || !(w > 0) || !(h > 0)) {
    console.error('usage: node scripts/snap.mjs <url> <out.png> [--wait ms] [--press ms] [--size WxH] [--step] [--idle s] [--at s,s] [--from release|blast] [--perf frames] [--cpu rate]');
    process.exit(2);
  }
  const at = String(opt.at).split(',').filter(Boolean).map(Number);
  return { url: pos[0], out: pos[1], wait: Number(opt.wait), press: Number(opt.press), width: w, height: h,
    skip: opt.skip !== undefined ? Number(opt.skip) : null,
    evalJs: opt.eval ?? null,
    step: !!opt.step, timeout: !!opt.timeout, fire: Number(opt.fire ?? 0), keepHolding: !!opt.keepHolding, puff: Number(opt.puff ?? 0), idle: Number(opt.idle), at, from: opt.from, perf: Number(opt.perf), cpu: Number(opt.cpu),
    hand: opt.hand ? String(opt.hand).split(',').map(Number) : null, handRelease: opt['hand-release'] !== undefined ? Number(opt['hand-release']) : null };
}

const args = parseArgs(process.argv.slice(2));
const { url, out, wait, press, width, height } = args;
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const avg = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const at = (q) => +s[Math.min(s.length - 1, Math.floor(s.length * q))]?.toFixed(2);
  return { avg: +avg.toFixed(2), p50: at(0.5), p95: at(0.95), max: at(1), n: xs.length };
};

async function stepped(page) {
  const step = (sec) => page.evaluate((s) => window.__debug.step(s), sec);
  await page.evaluate(() => window.__debug.pause());
  if (args.idle > 0) {
    await page.evaluate(() => { document.getElementById('start').hidden = true; window.__game.pressStart(); window.__game.pressEnd(); }); // 始めるだけ（貯めずに離すと撃たない）
    await step(args.idle);
    await page.evaluate(() => document.querySelector('.hud-hint')?.classList.remove('show')); // 始めるだけの「まだ足りない」は消す
  }
  // --fire A: 力を A にして、すぐに離す（軍勢に掴まれて減らないので、演出を決まった大きさで撮れる）
  if (args.fire > 0) {
    await page.evaluate((a) => { const g = window.__game; document.getElementById('start').hidden = true; g.pressStart(); g.power.drain(1e9); g.power.add(a); g.pressEnd(); }, args.fire);
  }
  if (press > 0) {
    await page.evaluate(() => window.__game.pressStart());
    await step(press / 1000);
    if (!args.keepHolding) await page.evaluate(() => window.__game.pressEnd());
  }
  for (let i = 0; i < args.puff; i++) {
    console.log('puff', await page.evaluate(() => window.__game.puff()));
    if (i < args.puff - 1) await step(0.25);
  }
  if (args.timeout) {
    await page.evaluate(() => { const g = window.__game; document.getElementById('start').hidden = true; if (g.phase === 'ready') { g.pressStart(); g.pressEnd(); } g.timer.update(1e9); });
  }
  if (args.from === 'blast') {
    // 大きな一発は演出の時間が終わって球が生まれるまで進める
    for (let i = 0; i < 400; i++) {
      if (await page.evaluate(() => window.__game.blasts.length > 0)) break;
      await step(1 / 60);
    }
  }
  if (args.hand) {
    const [level, steady = 1] = args.hand;
    await page.evaluate((h) => window.__debug.hand(h), { level, steady, active: level > 0 });
    await step(1.0); // 貯めの見た目が追いつくまで
  }
  if (args.handRelease !== null) {
    await page.evaluate((a) => {
      window.__debug.handRelease({ amount: a.amount, isBig: a.amount >= a.big });
      window.__debug.hand({ level: 0, steady: 1, active: false }); // 放ったあとは貯めが 0 に戻る
    }, { amount: args.handRelease, big: CONFIG.puff.cost + 1e-9 });
  }
  const info = await page.evaluate(() => ({ phase: window.__game.phase, blasts: window.__game.blasts.map((b) => ({ r: +b.shot.radius.toFixed(1), front: +b.front.toFixed(1) })), tier: window.__tier }));
  console.log('released', JSON.stringify(info));
  // 演出の撮る場所（fix2: 画面が真っ白になった最初のフレームで決まる。決まったら一度だけ出す）
  let planShown = false;
  const showPlan = async () => {
    if (planShown) return;
    const plan = await page.evaluate(() => { const p = window.__cinematic?.plan; if (!p) return null; const tl = window.__cinematic.timeline; return { rider: p.riderId, open: p.open, soft: p.soft, window: p.window, riders: p.riders?.map((r) => r.id), at: p.rider?.pos.map((v) => +v.toFixed(1)), cam: p.camPos.map((v) => +v.toFixed(1)), hide: p.hide?.length, line: p.riders?.map((r) => { const c = p.camPos, dx = r.pos[0] - c[0], dz = r.pos[2] - c[2], f = [-c[0], -c[2]], fl = Math.hypot(...f); return [+Math.hypot(dx, dz).toFixed(0), +(Math.atan2(dx * -f[1] / fl + dz * f[0] / fl, (dx * f[0] + dz * f[1]) / fl) * 57.3).toFixed(1), +(r.pos[1] - c[1]).toFixed(1)]; }), beat: ['white', 'burst', 'firstEngulf', 'engulf', 'camHit', 'snap', 'chaseEnd', 'end'].map((k) => k + '=' + (+tl[k].toFixed(2))).join(' ') }; });
    if (plan) { console.log('finale plan', JSON.stringify(plan)); planShown = true; }
  };
  await showPlan();
  if (args.perf > 0) {
    const t = await page.evaluate((n) => window.__debug.timeFrames(n), args.perf);
    console.log('frame JS ms (simulate+draw)', JSON.stringify(stats(t.js)));
    console.log('  of which simulate ms', JSON.stringify(stats(t.sim)));
    console.log('  GPU wait before frame ms (software rendering here, not JS)', JSON.stringify(stats(t.gpu)));
    const slow = t.js.map((ms, i) => [i, +ms.toFixed(1)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log('  slowest frames [index, ms]', JSON.stringify(slow));
    return;
  }
  if (args.evalJs) await page.evaluate(args.evalJs);
  let t = 0, skipped = false;
  for (const target of args.at.length ? args.at : [0]) {
    if (args.skip !== null && !skipped && target > args.skip) {
      await step(Math.max(1 / 60, args.skip - t));
      t = args.skip;
      await page.evaluate(() => window.__replay.skip());
      skipped = true;
    }
    const r = await step(Math.max(1 / 60, target - t));
    t = target;
    await showPlan();
    const file = out.replace('{t}', String(target));
    await page.screenshot({ path: file });
    const st = await page.evaluate(() => {
      const rp = window.__replay;
      const replay = rp?.active ? { phase: rp.phase, cut: rp.cut, t: +rp.time.toFixed(2), front: +rp.timeline.frontAt(rp.time).toFixed(1), result: !document.getElementById('result').hidden } : null;
      const bh = window.__blackhole?.active ? { stage: window.__blackhole.stage, t: +window.__blackhole.time.toFixed(2), result: !document.getElementById('result').hidden, hud: document.getElementById('hud').style.visibility !== 'hidden' } : null;
      const ci = window.__cinematic, cc = ci?.active ? ci.camera : null, r0 = ci?.beat?.riders?.[0];
      const cin = cc ? { stage: ci.stage, pos: cc.position.toArray().map((v) => +v.toFixed(1)), fov: +cc.fov.toFixed(1), r0: r0 ? [r0.x, r0.y, r0.z, r0.keep].map((v) => +v.toFixed(1)) : null, ndc: r0 ? new cc.position.constructor(r0.x, r0.y + 0.95, r0.z).project(cc).toArray().map((v) => +v.toFixed(2)) : null, gz: new cc.position.constructor(0, 0, 0).project(cc).toArray().map((v) => +v.toFixed(2)) } : null;
      return { cin, blasts: window.__game.blasts.map((b) => +b.front.toFixed(1)), pull: +window.__views.pullback.toFixed(1), busy: window.__explosionView.busy, replay, blackhole: bh };
    });
    console.log('saved', file, 't=' + target, JSON.stringify(st), 'sim ms/frame', r.simMs.toFixed(2), 'draw ms', r.drawMs.toFixed(1));
  }
}

try {
  const page = await browser.newPage({ viewport: { width, height } });
  if (args.cpu > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: args.cpu });
  }
  // シェーダーや WebGL のエラーは console.error にしか出ないので、それも失敗として扱う
  const FATAL = /Shader Error|WebGL|THREE/;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    console.error('[console.error]', m.text());
    if (FATAL.test(m.text())) failed = true;
  });
  page.on('pageerror', (e) => { failed = true; console.error('[pageerror]', e.message); });
  // 撮影用フック（window.__debug など）は ?debug のときだけ公開されるので、必ず付ける
  const u = new URL(url);
  u.searchParams.set('debug', '');
  await page.goto(u.toString(), { waitUntil: 'load' });
  await page.waitForTimeout(wait);
  if (args.step) {
    await stepped(page);
  } else {
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
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
