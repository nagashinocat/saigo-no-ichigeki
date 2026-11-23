// 使い方: npm run build && node scripts/retry-probe.mjs [出力フォルダ] [--only 名前,名前]
// 持ち主 2026-11-23 08:41（「リトライ押したら暗い画面に操作説明が出てる」「ゲーム画面に戻ったらTAPの文字がかなりデカく出てるのは仕様？」）の確かめ。
// 実機の artifact と同じく、作ったゲーム（dist）を別のオリジンの iframe の中で開く（sandbox="allow-scripts" と "allow-scripts allow-same-origin"、
// sessionStorage が投げる場合も）。縦画面のタッチの端末（390×844）。
//   normal   … ふつうの読み込みは今までどおり（TAP → 導入 → 題字 → TAP START → 遊び方の説明）。JS が動く前にも説明は出ない
//   menu     … 遊んでいる途中にメニューのリトライ: 読み直さない・導入/題字/説明/TAP なし・音は running のまま・最初の押下が溜め
//   result   … 最後の一発 → 演出 → リプレイ → 結果の「もう一度」: 同じ
//   midfinale… 最後の一発の演出の途中・リプレイの途中にメニューのリトライ: 同じ（止めた AudioContext も戻る）
//   blackhole… 時間切れ（ブラックホール）→ 結果の「もう一度」: 同じ
//   determinism … 同じ種の読み直したページと、その場のリトライのあとの一回が同じ（決まった刻みで同じ操作）
//   memory   … 5 回のリトライ（毎回、最後の一発から結果まで）で renderer.info の GPU の数が増えない
//   fallback … その場のリトライが投げたとき（?debug の failRestart）の控えの読み直し: 説明・大きな TAP は出ず、小さな一行
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const outDir = argv.find((a) => !a.startsWith('--')) ?? path.join(root, 'shots');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(argv[onlyIdx + 1].split(',')) : null;
fs.mkdirSync(outDir, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
function serve(dir, port, extra = {}) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      fs.readFile(p, (e, d) => {
        if (e) { rsp.writeHead(404); return rsp.end(); }
        rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...extra });
        rsp.end(d);
      });
    }).listen(port, '127.0.0.1', () => res(s));
  });
}
// iframe の親（別のオリジン: localhost と 127.0.0.1 は別のサイト）
const hostDir = fs.mkdtempSync('/tmp/retry-host-');
fs.writeFileSync(path.join(hostDir, 'host.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#222}iframe{border:0;width:100%;height:100%;display:block}</style></head>
<body><iframe id="f" allow="autoplay"></iframe><script>
const q = new URLSearchParams(location.search), f = document.getElementById('f');
if (q.get('sandbox') !== 'none') f.setAttribute('sandbox', q.get('sandbox'));
f.src = q.get('src');</script></body></html>`);
const GAME_PORT = 4611, HOST_PORT = 4612;
const servers = [await serve(path.join(root, 'dist'), GAME_PORT), await serve(hostDir, HOST_PORT)];
const GAME = `http://127.0.0.1:${GAME_PORT}/index.html`;
const hostUrl = (sandbox, query) => `http://localhost:${HOST_PORT}/host.html?sandbox=${encodeURIComponent(sandbox)}&src=${encodeURIComponent(`${GAME}?${query}`)}`;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'],
});
const results = [];
let failed = false;
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function openPage({ sandbox = 'allow-scripts allow-same-origin', query = 'debug&intro=full&seed=4242', throwStorage = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  if (throwStorage) {
    // 実機の artifact の iframe で sessionStorage が投げる場合（すべての frame で）
    await ctx.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('The document is sandboxed', 'SecurityError'); } }); });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(hostUrl(sandbox, query), { waitUntil: 'commit' });
  const frame = await gameFrame(page);
  return { ctx, page, frame, errors };
}
async function gameFrame(page, { timeout = 120000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const f = page.frames().find((x) => x.url().startsWith(`http://127.0.0.1:${GAME_PORT}`));
    if (f) { try { if (await f.evaluate(() => !!window.__debug && !!window.__game)) return f; } catch { /* 読み込み中 */ } }
    await page.waitForTimeout(50);
  }
  throw new Error('game frame not ready');
}
const state = (f) => f.evaluate(() => {
  const st = document.getElementById('start'), gate = document.getElementById('intro-gate'), ov = document.querySelector('#intro-start');
  const gs = gate ? getComputedStyle(gate) : null, span = gate?.firstElementChild;
  let ss; try { sessionStorage.getItem('x'); ss = 'ok'; } catch (e) { ss = 'throws:' + e.name; }
  return {
    marker: window.__marker ?? null, mode: __debug.introFlow.mode, flow: __debug.introFlow.state, phase: __game.phase,
    howto: !st.hidden && getComputedStyle(st).display !== 'none',
    gateOn: gs ? gs.display !== 'none' : false, gateText: span?.textContent ?? null, gateFont: span ? parseFloat(getComputedStyle(span).fontSize) : null,
    gateBg: gs?.backgroundColor ?? null, titleBtn: ov ? getComputedStyle(ov).opacity : null,
    ctx: window.__audio?.bgmOutput?.ctx.state ?? 'none', bgm: window.__bgmState?.() ?? null,
    timer: __game.timer.remaining, charging: __game.charge.active, result: !document.getElementById('result').hidden,
    hud: getComputedStyle(document.getElementById('hud')).visibility, menu: !document.getElementById('menu').hidden,
    hash: location.hash, ss,
  };
});
const shot = (page, name) => page.screenshot({ path: path.join(outDir, name) });
// 画面の真ん中を押して離す（タッチ）
async function tap(page, x = 195, y = 430) { await page.touchscreen.tap(x, y); }
// 押したまま（タッチ）: CDP で touchStart。離すのは touchEnd
const cdps = new WeakMap();
async function touch(page, type, x = 195, y = 430) {
  if (!cdps.has(page)) cdps.set(page, await page.context().newCDPSession(page));
  await cdps.get(page).send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 7 }] });
}
// ふつうの読み込みから遊ぶ画面へ: TAP → 導入（タップで飛ばす）→ 題字の終わり → TAP START（ここでタッチの操作が音を鳴らせるようにする）
async function playThroughIntro(page, f) {
  await tap(page); await page.waitForTimeout(800);
  await tap(page); await page.waitForTimeout(300);
  await f.evaluate(() => __debug.introSeek(__debug.introFlow.timeline.total));
  const b = await f.$('#intro-start');
  const box = await b.boundingBox();
  await tap(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
}
async function pressRetryInMenu(page, f) {
  const btn = await f.$('#menuBtn');
  const b1 = await btn.boundingBox();
  await tap(page, b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.waitForTimeout(250);
  const r = await f.$('#menu [data-act="retry"]');
  const b2 = await r.boundingBox();
  await tap(page, b2.x + b2.width / 2, b2.y + b2.height / 2);
}
async function pressResultRetry(page, f) {
  const r = await f.$('#result button.primary');
  const b = await r.boundingBox();
  await tap(page, b.x + b.width / 2, b.y + b.height / 2);
}
// 力 amount で放ち、演出 → リプレイ（飛ばす）→ 結果まで決まった刻みで進める
async function fireToResult(f, amount = 92) {
  const fired = await f.evaluate((a) => { __debug.pause(); const g = __game; let shot = false; g.on('shot', () => { shot = true; }); g.pressStart(); g.power.drain(1e9); g.power.add(a); g.pressEnd(); return shot && g.phase === 'cinematic'; }, amount);
  if (!fired) throw new Error('fireToResult: 放てなかった');
  for (let i = 0; i < 400; i++) {
    const s = await f.evaluate(() => { const r = __debug.step(0.5); if (window.__replay.active && !window.__replay.finished && window.__replay.time > 1) window.__replay.skip(); return { res: !document.getElementById('result').hidden, phase: __game.phase }; });
    if (s.res) break;
  }
  await f.evaluate(() => __debug.resume());
}
async function timeoutToResult(f) {
  await f.evaluate(() => { __debug.pause(); __game.pressStart(); __game.timer.update(1e9); });
  for (let i = 0; i < 200; i++) {
    const s = await f.evaluate(() => { __debug.step(0.5); return !document.getElementById('result').hidden; });
    if (s) break;
  }
  await f.evaluate(() => __debug.resume());
}
// リトライのあと: 遊ぶ画面（導入・題字・説明・TAP なし）、音は running、ゲームは最初から、そして最初のタッチの押下が溜め
async function expectPlayable(tag, page, f, { marker = true } = {}) {
  await page.waitForTimeout(150);
  const s = await state(f);
  if (marker) check(`${tag}: ページを読み直さない（同じ document）`, s.marker === 'before-retry', `marker=${s.marker}`);
  check(`${tag}: 導入・題字・TAP の画面に戻らない`, s.flow === 'game' && !s.gateOn, `flow=${s.flow} gateOn=${s.gateOn}`);
  check(`${tag}: 遊び方の説明を出さない`, !s.howto);
  check(`${tag}: 結果・メニューは閉じ、HUD が出る`, !s.result && !s.menu && s.hud === 'visible', `result=${s.result} menu=${s.menu} hud=${s.hud}`);
  check(`${tag}: 新しい一回（ready・残り 60 秒）`, s.phase === 'ready' && s.timer === 60, `phase=${s.phase} timer=${s.timer}`);
  check(`${tag}: AudioContext は running のまま（TAP が要らない）`, s.ctx === 'running', `ctx=${s.ctx}`);
  await touch(page, 'touchStart');
  await page.waitForTimeout(400);
  const p = await state(f);
  check(`${tag}: 最初のタッチの押下がそのまま溜め`, p.charging && p.phase === 'playing', `charging=${p.charging} phase=${p.phase}`);
  check(`${tag}: 溜めの間も音は running・BGM が鳴る`, p.ctx === 'running' && p.bgm === 'play', `ctx=${p.ctx} bgm=${p.bgm}`);
  await f.evaluate(() => __game.power.drain(1e9)); // 離しても放たない（足りない）
  await touch(page, 'touchEnd');
  await page.waitForTimeout(200);
  return s;
}

const variants = [
  { name: 'iframe-same-origin', sandbox: 'allow-scripts allow-same-origin', throwStorage: false },
  { name: 'iframe-same-origin-throwing-storage', sandbox: 'allow-scripts allow-same-origin', throwStorage: true },
  { name: 'iframe-opaque-origin', sandbox: 'allow-scripts', throwStorage: false },
];
const want = (n) => !only || only.has(n);

// ---- normal: ふつうの読み込み ----
if (want('normal')) {
  const { ctx, page, frame: f, errors } = await openPage({});
  const s0 = await state(f);
  check('normal: 最初は TAP の画面（導入から）', s0.mode === 'full' && s0.flow === 'gate' && s0.gateOn, `mode=${s0.mode} flow=${s0.flow}`);
  check('normal: TAP の画面で説明は出ない', !s0.howto);
  await playThroughIntro(page, f);
  const s1 = await state(f);
  check('normal: TAP START のあとは今までどおり遊び方の説明が出る', s1.flow === 'game' && s1.howto, `flow=${s1.flow} howto=${s1.howto}`);
  await shot(page, 'retry-fix-normal-after-tapstart.png');
  check('normal: ページのエラーなし', errors.length === 0, errors.join(' | '));
  await ctx.close();
  // JS が動く前（端末の読み込みの遅さ: ゲームの JS を 3 秒遅らせる）の画面: 前は暗い地に説明だけが出ていた
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p2 = await c2.newPage();
  await p2.route(/assets\/index-.*\.js$/, async (r) => { await new Promise((res) => setTimeout(res, 3000)); await r.continue(); });
  await p2.goto(`${GAME}?intro=full`, { waitUntil: 'commit' });
  await p2.waitForTimeout(1200);
  const pre = await p2.evaluate(() => ({ rs: document.readyState, howto: !document.getElementById('start').hidden }));
  check('normal: JS が動く前の暗い画面に説明は出ない', !pre.howto, JSON.stringify(pre));
  await p2.screenshot({ path: path.join(outDir, 'retry-fix-before-js.png') });
  await c2.close();
}

for (const v of variants) {
  // ---- menu: 遊んでいる途中のメニューのリトライ ----
  if (want('menu')) {
    const { ctx, page, frame: f, errors } = await openPage(v);
    await playThroughIntro(page, f);
    await touch(page, 'touchStart'); await page.waitForTimeout(1500); await touch(page, 'touchEnd'); // 少し遊ぶ（溜めて離す: 足りず放たない）
    await page.waitForTimeout(300);
    await f.evaluate(() => { window.__marker = 'before-retry'; });
    await pressRetryInMenu(page, f);
    await page.waitForTimeout(120);
    await shot(page, `retry-fix-menu-${v.name}.png`);
    await expectPlayable(`menu/${v.name}`, page, f);
    check(`menu/${v.name}: ページのエラーなし`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // ---- result: 最後の一発 → 結果 → もう一度 ----
  if (want('result')) {
    const { ctx, page, frame: f, errors } = await openPage(v);
    await playThroughIntro(page, f);
    await fireToResult(f);
    const r = await state(f);
    const how = await f.evaluate(() => ({ reason: __game.outcome ? 'released' : 'blackhole', rank: __game.outcome?.rank ?? null }));
    check(`result/${v.name}: 最後の一発の結果画面まで進んだ`, r.result && how.reason === 'released', JSON.stringify({ phase: r.phase, ...how }));
    await f.evaluate(() => { window.__marker = 'before-retry'; });
    await pressResultRetry(page, f);
    await page.waitForTimeout(120);
    await shot(page, `retry-fix-result-${v.name}.png`);
    await expectPlayable(`result/${v.name}`, page, f);
    // 街は壊れる前の姿（ビルが立っている。粗い箱）
    const city = await f.evaluate(() => ({ detail: __cityView.detail, centre: __cityView.blastCentre, debris: __destruction.pool.count ?? null }));
    check(`result/${v.name}: 街は起動したときの姿（粗い箱・爆心なし）`, city.detail === 'coarse' && city.centre === null, JSON.stringify(city));
    check(`result/${v.name}: ページのエラーなし`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ---- midfinale: 最後の一発の演出の途中・リプレイの途中にメニューのリトライ（演出中のメニューは AudioContext を止める: 戻るか） ----
if (want('midfinale')) {
  for (const at of ['cinematic', 'replay']) {
    const { ctx, page, frame: f, errors } = await openPage(variants[0]);
    await playThroughIntro(page, f);
    await f.evaluate(() => { __debug.pause(); const g = __game; g.pressStart(); g.power.drain(1e9); g.power.add(92); g.pressEnd(); });
    for (let i = 0; i < 200; i++) {
      const ok = await f.evaluate((at) => { __debug.step(0.25); return at === 'cinematic' ? window.__cinematic.active && window.__cinematic.time > 4 : window.__replay.active && window.__replay.time > 2; }, at);
      if (ok) break;
    }
    await f.evaluate(() => { __debug.resume(); window.__marker = 'before-retry'; });
    await page.waitForTimeout(200);
    await pressRetryInMenu(page, f);
    await page.waitForTimeout(300);
    await shot(page, `retry-fix-menu-during-${at}.png`);
    await expectPlayable(`midfinale/${at}`, page, f);
    const v = await f.evaluate(() => ({ cine: window.__cinematic.active, replay: window.__replay.active, tag: document.getElementById('replay').hidden }));
    check(`midfinale/${at}: 演出・リプレイは止まり、リプレイの札も消える`, !v.cine && !v.replay && v.tag, JSON.stringify(v));
    check(`midfinale/${at}: ページのエラーなし`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ---- blackhole: 時間切れ → もう一度 ----
if (want('blackhole')) {
  const { ctx, page, frame: f, errors } = await openPage(variants[1]);
  await playThroughIntro(page, f);
  await timeoutToResult(f);
  const r = await state(f);
  check('blackhole: 結果画面まで進んだ', r.result);
  await f.evaluate(() => { window.__marker = 'before-retry'; });
  await pressResultRetry(page, f);
  await page.waitForTimeout(120);
  await shot(page, 'retry-fix-result-blackhole.png');
  await expectPlayable('blackhole', page, f);
  const bh = await f.evaluate(() => ({ active: __blackhole.active }));
  check('blackhole: ブラックホールの演出は止まる', !bh.active);
  check('blackhole: ページのエラーなし', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- determinism: 読み直したページ vs その場のリトライ ----
async function scripted(f) {
  return f.evaluate(() => {
    __debug.pause();
    const g = __game, out = [];
    const sig = () => ({ t: g.timer.remaining, phase: g.phase, hero: [g.hero.x, g.hero.z], power: g.power.value, alive: g.aliveCount, puffs: g.puffsLeft,
      enemies: g.enemies.list.map((e) => `${e.id}:${e.kind ?? ''}:${e.state}:${e.x.toFixed(5)}:${e.z.toFixed(5)}`).join('|') });
    window.__controls.down(1, 195, 430, performance.now() / 1000); // 溜め（指の押下と同じ道）
    for (let i = 0; i < 24; i++) {
      __debug.step(0.5);
      if (i === 6 || i === 14) g.puff();
      out.push(sig());
    }
    g.pressStart(); g.power.drain(1e9); g.power.add(90); g.pressEnd(); // 決まった力で放つ
    if (g.phase !== 'cinematic') throw new Error('scripted: 放てなかった');
    for (let i = 0; i < 120 && g.phase !== 'over'; i++) __debug.step(0.5);
    const o = g.outcome;
    out.push({ phase: g.phase, score: g.score.total, clear: o?.clear, rank: o?.rank, survivors: o?.survivors.map((s) => s.id).join(','), titles: JSON.stringify(g.runStats) });
    return out;
  });
}
// 街の見た目の状態（すべての置き場所の行列・つぶれ・高架）の指紋。snap 省略で今の姿、'pristine' で起動したときの写し。
// retry: 同じ一歩の中で（描く前に）その場のリトライをしてから今の姿を測る（高架の車と電車は毎フレーム動くので）
const cityHash = (f, { which = 'now', retry = false } = {}) => f.evaluate(({ which, retry }) => {
  if (retry) __debug.retry();
  const s = which === 'pristine' ? window.__pristineCity : __cityView.snapshot();
  let h = 2166136261;
  for (const { array } of [...s.mats, ...s.attrs]) for (let i = 0; i < array.length; i++) { h ^= Math.round(array[i] * 1e4); h = Math.imul(h, 16777619) >>> 0; }
  return { hash: h >>> 0, transit: JSON.stringify(s.transit), detail: __cityView.detail };
}, { which, retry });
if (want('determinism')) {
  const q = 'debug&seed=31337';
  const a = await openPage({ ...variants[0], query: q });
  const cityFresh = await cityHash(a.frame, { which: 'pristine' }); // 読み直したページの、起動したときの街
  const fresh1 = await scripted(a.frame);
  await a.ctx.close();
  const b = await openPage({ ...variants[0], query: q });
  // 一回目は別の一発（街を壊す）→ その場のリトライ → 同じ操作。もう一回は時間切れ（ブラックホール）→ その場のリトライ → 同じ操作
  await fireToResult(b.frame, 92);
  const cityBroken = await cityHash(b.frame);
  const cityRetried = await cityHash(b.frame, { retry: true });
  check('determinism: リトライのあとの街は、読み直したページの起動したときの街と同じ姿（行列・つぶれ・高架の車と電車）',
    cityRetried.hash === cityFresh.hash && cityRetried.transit === cityFresh.transit && cityRetried.detail === 'coarse' && cityBroken.hash !== cityFresh.hash,
    `fresh=${cityFresh.hash} broken=${cityBroken.hash} retried=${cityRetried.hash}`);
  const after1 = await scripted(b.frame);
  await b.frame.evaluate(() => __debug.retry());
  await timeoutToResult(b.frame);
  await b.frame.evaluate(() => __debug.retry());
  const after2 = await scripted(b.frame);
  const same1 = JSON.stringify(after1) === JSON.stringify(fresh1), same2 = JSON.stringify(after2) === JSON.stringify(fresh1);
  check('determinism: その場のリトライのあとの一回 = 読み直したページの一回（同じ種・同じ操作）', same1 && same2, `checkpoints=${fresh1.length} final=${JSON.stringify(fresh1.at(-1)).slice(0, 160)}`);
  if (!same1) { const k = fresh1.findIndex((x, i) => JSON.stringify(x) !== JSON.stringify(after1[i])); console.log('first diff at', k, JSON.stringify(fresh1[k]).slice(0, 300), JSON.stringify(after1[k]).slice(0, 300)); }
  fs.writeFileSync(path.join(outDir, 'retry-fix-determinism.json'), JSON.stringify({ fresh: fresh1.at(-1), afterRetry1: after1.at(-1), afterRetry2: after2.at(-1), checkpoints: fresh1.length }, null, 2));
  await b.ctx.close();
}

// ---- memory: 5 回のリトライで GPU の数が増えない ----
if (want('memory')) {
  const { ctx, frame: f, errors } = await openPage({ ...variants[0], query: 'debug&seed=4242' });
  const info = () => f.evaluate(() => { const r = window.__renderer; return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null }; });
  const rows = [{ at: 'load', ...(await info()) }];
  for (let k = 1; k <= 6; k++) {
    await fireToResult(f, k % 2 ? 92 : 60);
    rows.push({ at: `result ${k}`, ...(await info()) });
    await f.evaluate(() => __debug.retry());
    await f.evaluate(() => { __debug.step(0.5); });
    rows.push({ at: `after retry ${k}`, ...(await info()) });
  }
  console.table(rows);
  // 一回目の一発で初めて作るもの（演出・リプレイの描き先・材質）は増えてよい。2 回目以降のリトライのあとは同じ数
  const after = rows.filter((r) => r.at.startsWith('after retry'));
  const base = after[1];
  const flat = after.slice(1).every((r) => r.geometries === base.geometries && r.textures === base.textures && r.programs === base.programs);
  check('memory: リトライ 2〜6 回目のあとで renderer.info（形・画像・シェーダー）の数が増えない', flat, JSON.stringify(after.map((r) => [r.geometries, r.textures, r.programs])));
  fs.writeFileSync(path.join(outDir, 'retry-fix-memory.json'), JSON.stringify(rows, null, 2));
  check('memory: ページのエラーなし', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- fallback: その場のリトライが投げたときの控えの読み直し ----
if (want('fallback')) {
  for (const v of [variants[1], variants[2], variants[0]]) {
    const { ctx, page, frame: f } = await openPage(v);
    await playThroughIntro(page, f);
    await f.evaluate(() => { __debug.failRestart = true; window.__marker = 'before-retry'; });
    await pressRetryInMenu(page, f);
    const t0 = Date.now(), seen = [];
    // 読み直している間（JS が動く前）と、動いたあとの画面を見続ける
    let f2 = null;
    for (let i = 0; i < 200 && !f2; i++) {
      const g = page.frames().find((x) => x.url().startsWith(`http://127.0.0.1:${GAME_PORT}`));
      try {
        const s = await g.evaluate(() => ({ dbg: !!window.__debug, marker: window.__marker ?? null, howto: !!document.getElementById('start') && !document.getElementById('start').hidden }));
        seen.push(s);
        if (s.dbg && s.marker === null) f2 = g;
      } catch { /* 読み直しの途中 */ }
      await page.waitForTimeout(40);
    }
    check(`fallback/${v.name}: 読み直しの途中にも説明を出さない`, seen.every((s) => !s.howto), `samples=${seen.length}`);
    await page.waitForTimeout(400);
    const s = await state(f2);
    await shot(page, `retry-fix-fallback-${v.name}.png`);
    check(`fallback/${v.name}: 読み直したページはリトライ（導入・題字・説明なし）`, s.mode === 'retry' && !s.howto && s.flow === 'tap', `mode=${s.mode} flow=${s.flow} howto=${s.howto} ss=${s.ss} hash=${s.hash}`);
    check(`fallback/${v.name}: #retry は読んだら消える`, s.hash === '');
    check(`fallback/${v.name}: タッチの案内は小さな一行（「タップでスタート」・20 px 以下・暗い幕なし）`, s.gateOn && s.gateText === 'タップでスタート' && s.gateFont <= 20 && /rgba\(0, 0, 0, 0\)|transparent/.test(s.gateBg), `text=${s.gateText} font=${s.gateFont} bg=${s.gateBg}`);
    await tap(page);
    await page.waitForTimeout(300);
    const s2 = await state(f2);
    check(`fallback/${v.name}: 一行を離したら遊べ、音が鳴らせる`, s2.flow === 'game' && !s2.gateOn && s2.ctx === 'running', `flow=${s2.flow} ctx=${s2.ctx}`);
    await ctx.close();
    console.log(`  (${Date.now() - t0} ms)`);
  }
}

fs.writeFileSync(path.join(outDir, 'retry-fix-probe.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
await browser.close();
for (const s of servers) s.close();
process.exit(failed ? 1 : 0);
