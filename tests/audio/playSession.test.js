// 遊んでいる 60 秒（長押し・払う・掴まれる・軍勢が多い）の音の通し稽古。
// 効果音（audio.js）と BGM（bgm.js）を一つの身代わりの AudioContext でつなぎ、main.js の updateAudio と同じ順で
// 毎フレーム呼ぶ。メインスレッドが止まる一瞬（中くらいの Android でのシェーダーの作り直し・画質の段の切り替え・GC）も挟む。
// 時刻ごとに、AudioContext の状態・各バスの gain・BGM の状態と、BGM の音の始まりを記録して、途切れていないことを確かめる。
import { test, expect, afterEach } from 'vitest';
import { createAudio } from '../../src/audio/audio.js';
import { createBgm, LOOKAHEAD } from '../../src/audio/bgm.js';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// AudioParam の身代わり: 予定（set / 直線 / 指数 / setTarget）を記録し、時刻 t の値を返す
function param(v0) {
  let ev = [];
  const p = {
    value: v0,
    setValueAtTime(v, t) { ev.push({ k: 'set', t, v }); return p; },
    linearRampToValueAtTime(v, t) { ev.push({ k: 'lin', t, v }); return p; },
    exponentialRampToValueAtTime(v, t) { ev.push({ k: 'exp', t, v }); return p; },
    setTargetAtTime(v, t, tc) { ev.push({ k: 'target', t, v, tc }); return p; },
    cancelScheduledValues(t) { ev = ev.filter((e) => e.t < t); return p; },
    at(t) {
      let v = p.value, tv = 0, target = null;
      for (const e of [...ev].sort((a, b) => a.t - b.t)) {
        if (e.t > t) {
          if (target) break;
          if (e.k === 'lin') return v + (e.v - v) * (t - tv) / (e.t - tv);
          if (e.k === 'exp') return v * (e.v / v) ** ((t - tv) / (e.t - tv));
          break;
        }
        if (target) { v = target.v + (v - target.v) * Math.exp(-(e.t - tv) / target.tc); target = null; }
        if (e.k === 'target') target = e; else v = e.v;
        tv = e.t;
      }
      if (target) v = target.v + (v - target.v) * Math.exp(-(t - tv) / target.tc);
      return v;
    },
  };
  return p;
}
function fakeCtx() {
  const ctx = {
    state: 'running', currentTime: 0, sampleRate: 8000, destination: { name: 'destination' },
    gains: [], filters: [], sources: [], compressors: [],
  };
  const node = (extra) => ({ connect() {}, disconnect() {}, ...extra });
  Object.assign(ctx, {
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
    createGain() { const g = node({ gain: param(1) }); ctx.gains.push(g); return g; },
    createBiquadFilter() { const f = node({ type: '', frequency: param(350), Q: param(1) }); ctx.filters.push(f); return f; },
    createDynamicsCompressor() {
      const c = node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) });
      ctx.compressors.push(c); return c;
    },
    createDelay() { return node({ delayTime: param(0) }); },
    createStereoPanner() { return node({ pan: param(0) }); },
    createWaveShaper() { return node({ curve: null, oversample: 'none' }); },
    createOscillator() { return node({ type: '', frequency: param(440), start() {}, stop() {} }); },
    createBuffer(ch, n, sr) { const d = new Float32Array(n); return { duration: n / sr, sampleRate: sr, getChannelData: () => d }; },
    createBufferSource() {
      const s = node({ buffer: null, loop: false, playbackRate: param(1), startT: null, stopT: Infinity, scheduledAt: null,
        start(t = 0) { s.startT = t; s.scheduledAt = ctx.currentTime; }, stop(t = 0) { s.stopT = t; } });
      ctx.sources.push(s);
      return s;
    },
  });
  return ctx;
}

afterEach(() => { delete globalThis.window; });

const FPS = 30;
const PUFF_K = Math.sqrt(CONFIG.puff.radius / CONFIG.radius.max);
// 4 秒ごと: 2.5 秒長押し（そのあいだに 2 回払う）→ 離す（足りずに放たない）。力は一回りごとに増える（掴まれると減る）。
// 掴まれる・軍勢が増えることは、音の呼び出しを変えない（ゲームは音の合図を出さない。下の別のテストで確かめる）
function scenario(t) {
  const c = t % 4, cycle = Math.floor(t / 4);
  const holding = c < 2.5;
  const power = Math.min(1, 0.05 * cycle + (cycle % 3 === 2 ? -0.03 : 0)); // 3 回に 1 回は掴まれて少し減る
  const puffs = [1.2, 2.4].map((p) => c - p).filter((d) => d >= 0 && d < 1);
  return { holding, power: Math.max(0, power), puffs };
}

// 60 秒を通す。hitches: [[時刻, 秒]] のあいだはメインスレッドが止まっている（フレームが来ない。音の時計だけ進む）
function playSession({ hitches = [] } = {}) {
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio();
  audio.unlock();
  const master = ctx.gains[0], out = ctx.filters[0], bgmBus = audio.bgmOutput.dest;
  const bgm = createBgm(() => audio.bgmOutput);
  while (!bgm.prepare());
  const n0 = ctx.gains.length;
  const samples = [];
  let bgmOut = null, boomed = new Set();
  const T0 = 0.5; // 最初のタップ
  let el = 0;
  while (el < 60) {
    const h = hitches.find(([at]) => Math.abs(el - at) < 0.5 / FPS);
    if (h) { el += h[1]; hitches = hitches.filter((x) => x !== h); }
    ctx.currentTime = T0 + el;
    const now = ctx.currentTime;
    const s = scenario(el);
    // main.js の updateAudio と同じ順
    audio.chargeHum(s.holding ? Math.max(0.05, s.power) : 0);
    if (bgm.state === 'off') bgm.start();
    if (!bgmOut) bgmOut = ctx.gains[n0 + 1];
    bgm.update({ elapsed: el, power: s.power, holding: s.holding });
    // 払う: 前線がじわじわ広がる間は低い脈動、弾けた瞬間に爆発の音（一発に一度）
    const creeping = s.puffs.some((d) => d < 0.25);
    for (const d of s.puffs) {
      const id = Math.round((el - d) * 1000);
      if (d >= 0.25 && !boomed.has(id)) { boomed.add(id); audio.boom(PUFF_K); }
    }
    audio.rumble(creeping ? PUFF_K : 0);
    audio.collapse([]); // main.js と同じ（命中のないフレーム）
    samples.push({ t: now, state: ctx.state, bgm: bgm.state, master: master.gain.at(now), out: out.frequency.at(now), bgmBus: bgmBus.gain.at(now), bgmOut: bgmOut.gain.at(now) });
    el += 1 / FPS;
  }
  // BGM の音（楽器の音は 48 kHz で作ってある）のうち、実際に鳴るもの
  const onsets = ctx.sources.filter((x) => x.buffer?.sampleRate === 48000 && x.startT !== null && x.stopT > x.startT + 1e-4)
    .map((x) => ({ t: x.startT - T0, late: x.scheduledAt - x.startT }));
  return { samples, onsets, booms: boomed.size };
}

const countIn = (onsets, a, b) => onsets.filter((o) => o.t >= a && o.t < b).length;

test('遊んでいる 60 秒: AudioContext は鳴ったまま、世界の音・こもり・BGM の出口の gain は一度も下がらず、BGM はずっと play', () => {
  const { samples, onsets, booms } = playSession();
  expect(samples.length).toBeGreaterThan(60 * FPS - 5);
  expect(booms).toBeGreaterThan(20); // 払うの爆発の音が鳴っている
  // 最初のフレームの BGM の出口は、始まる時刻（START_DELAY 後）まで 0 のまま。そのあとから見る
  for (const s of samples.slice(3)) {
    expect(s.state).toBe('running');
    expect(s.bgm).toBe('play');
    expect(s.master).toBeCloseTo(0.8, 6); // 演出の無音（silence / muffle）は漏れていない
    expect(s.out).toBeCloseTo(20000, 3); // こもり（low-pass）もかかっていない
    expect(s.bgmBus).toBeCloseTo(1, 6);
    expect(s.bgmOut).toBeCloseTo(1, 6); // BGM は止められていない（stop / stretchOut / quiet の出口の 0 はない）
  }
  // BGM の音は 60 秒のどの 1.5 秒にも鳴っている
  for (let a = 0.5; a < 58.5; a += 0.5) expect(countIn(onsets, a, a + 1.5)).toBeGreaterThan(0);
});

test('メインスレッドが一瞬止まっても（0.45〜0.9 秒）、BGM の音は抜け落ちない（止まる前に先まで予約してある）', () => {
  const ref = playSession();
  const hitches = [[21.0, 0.6], [33.1, 0.9], [47.0, 0.45]];
  const hit = playSession({ hitches });
  for (const [at, len] of hitches) {
    const want = countIn(ref.onsets, at, at + len + 0.1);
    const got = countIn(hit.onsets, at, at + len + 0.1);
    expect(want).toBeGreaterThan(3);
    // 止まっていた間に鳴るはずだった音が、ほぼすべて鳴る
    expect(got).toBeGreaterThanOrEqual(Math.floor(want * 0.9));
  }
  // 止まっていた分を、あとからまとめて鳴らしてもいない（遅れて予約した音は 50 ms 以内）
  for (const o of hit.onsets) expect(o.late).toBeLessThanOrEqual(0.05 + 1e-9);
  // 止まっている間も、音の出口の gain と AudioContext の状態は変わらない
  for (const s of hit.samples.slice(3)) { expect(s.state).toBe('running'); expect(s.bgmOut).toBeCloseTo(1, 6); expect(s.master).toBeCloseTo(0.8, 6); }
});

test('先読みを延ばしても、長押しへの BGM の反応は速いまま（押してから次の拍の頭で一段上がる）', () => {
  // 押した瞬間より後に始まる拍は、押したことを知って作り直される
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio();
  audio.unlock();
  const bgm = createBgm(() => audio.bgmOutput);
  ctx.currentTime = 1;
  bgm.start();
  const run = (until, holding) => { while (ctx.currentTime < until) { bgm.update({ elapsed: 20, power: 0.2, holding }); ctx.currentTime += 1 / FPS; } };
  run(9, false);
  const pressAt = ctx.currentTime;
  run(12, true);
  // 層 1 → 2（長押し）で加わる木の打楽器（wood: 0.16 秒の楽器の音）は、押す前には鳴らず、
  // 押してから 0.3 秒（前の先読みの長さ）+ 1 拍以内に鳴りはじめる（先読みを延ばしても反応は遅くならない）
  const alive = (s) => s.stopT > s.startT + 1e-4;
  const isWood = (s) => s.buffer?.sampleRate === 48000 && Math.abs(s.buffer.duration - 0.16) < 0.005;
  const woods = ctx.sources.filter((s) => isWood(s) && alive(s)).map((s) => s.startT);
  expect(woods.length).toBeGreaterThan(0);
  expect(Math.min(...woods)).toBeGreaterThanOrEqual(pressAt);
  expect(Math.min(...woods) - pressAt).toBeLessThan(0.3 + 60 / 84 + 0.05);
});

test('払う・掴まれる・時間がたって軍勢が増える間、ゲームは最後の一発の合図（shot / cinematicStart / over）を出さない', () => {
  // M2: 払うは 3 回までになったが、ここは払うたびに合図が出ないことを何度も確かめたいので、回数の制限を外す
  // Pass 2: 払ったあとの守り（guardSec）があると掴まれる場面が来ないので、ここは守りなし（確かめたいのは音の合図）
  const game = createGame({ seed: 7, cfg: { ...CONFIG, puff: { ...CONFIG.puff, uses: Infinity, guardSec: 0 } } });
  const seen = [];
  for (const ev of ['shot', 'cinematicStart', 'cinematicEnd', 'over', 'puff', 'fizzle']) game.on(ev, () => seen.push(ev));
  game.pressStart();
  let maxEnemies = 0, grabbedFrames = 0;
  for (let i = 0; i < 58 * FPS; i++) {
    const t = i / FPS, c = t % 4;
    if (c === 0) game.pressStart();
    // M2: 貯める速さが 1.9/秒になり、足りずに払えないことがあるので、払う分の力を足してから払う
    if (Math.abs(c - 1.2) < 0.5 / FPS || Math.abs(c - 2.4) < 0.5 / FPS) { game.power.add(CONFIG.puff.cost); game.puff(); }
    // 足りずに離す（放たない）: 力を最小より少なくしてから離す
    if (Math.abs(c - 2.5) < 0.5 / FPS) { game.power.drain(Math.max(0, game.power.value - CONFIG.power.minRelease / 2)); game.pressEnd(); }
    game.update(1 / FPS);
    maxEnemies = Math.max(maxEnemies, game.enemies.list.length);
    if (game.grabbing > 0) grabbedFrames++;
  }
  expect(game.phase).toBe('playing');
  expect(seen.filter((e) => e === 'puff').length).toBeGreaterThan(5);
  expect(maxEnemies).toBeGreaterThan(5);
  expect(seen.some((e) => ['shot', 'cinematicStart', 'cinematicEnd', 'over'].includes(e))).toBe(false);
  // 掴まれる場面も通っている（掴まれても音の合図は出ない）
  expect(grabbedFrames).toBeGreaterThan(0);
});

test('タブを隠してすぐ戻しても（止める処理がまだ終わっていなくても）、iOS の interrupted からでも、戻ったら鳴る', async () => {
  const ctx = fakeCtx();
  // 本物と同じく、suspend / resume の結果（state）は少しあとで変わる
  ctx.suspend = () => Promise.resolve().then(() => { ctx.state = 'suspended'; });
  ctx.resume = () => Promise.resolve().then(() => { ctx.state = 'running'; });
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio();
  audio.unlock();
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  // 隠れた → すぐ戻った（main.js の visibilitychange と同じ順）
  audio.suspend();
  audio.resume();
  await flush();
  expect(ctx.state).toBe('running');
  // 隠れたままなら止まっている（R1f: 一番上の大きさを約 30 ms で落としてから止める。SWITCH_FADE.suspendAfter ms の待ち）
  audio.suspend();
  await new Promise((r) => setTimeout(r, 80));
  await flush();
  expect(ctx.state).toBe('suspended');
  audio.resume();
  await flush();
  expect(ctx.state).toBe('running');
  // iOS: 電話や他のアプリの音で interrupted になったあと、戻ってきたら鳴らし直す（次のタップを待たない）
  ctx.state = 'interrupted';
  audio.resume();
  await flush();
  expect(ctx.state).toBe('running');
});
