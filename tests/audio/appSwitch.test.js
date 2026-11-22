import { test, expect, afterEach } from 'vitest';
import { createAudio } from '../../src/audio/audio.js';
import { createBgm } from '../../src/audio/bgm.js';

// R1f（持ち主 18:14「画面切り替えしたら一瞬ピープ音がなった」）。原因（task-R1f-report.md）: 貯めの唸り（55〜205 Hz の正弦波 2 つ）は鳴りっぱなしで、
// 大きさは毎フレーム chargeHum が決める。タブ・アプリを切り替えると requestAnimationFrame が止まり、唸りの大きさは最後の貯めの大きさのまま
// AudioContext が止まる（suspend は少しあとで効く）。戻ると、止まる前の大きさのまま鳴り出し、次のフレームで 0 へ落ちる（時定数 0.08 秒）まで
// 一瞬「ブーン／ピー」と鳴った。吸われる音（drain）も同じ。直したあと: 隠れたら、まず一番上の大きさ（top）を約 30 ms で 0 へ落とし、唸りを
// 0 にしてから止める。戻るときは top を 0 のまま鳴らし直し、鳴り始めてから上げる。止まっていた間の予約の音は束になって鳴らない
// （AudioContext の時計が止まるので予約の時刻ごと止まる。BGM は遅れた拍を捨てる）
function param(v0) {
  let ev = [];
  const p = {
    value: v0,
    setValueAtTime(v, t) { ev.push({ k: 'set', t, v }); return p; },
    linearRampToValueAtTime(v, t) { ev.push({ k: 'lin', t, v }); return p; },
    exponentialRampToValueAtTime(v, t) { ev.push({ k: 'exp', t, v }); return p; },
    setTargetAtTime(v, t, tc) { ev.push({ k: 'target', t, v, tc }); return p; },
    cancelScheduledValues(t) { ev = ev.filter((e) => e.t < t); return p; },
    cancelAndHoldAtTime(t) { const v = p.at(t); ev = ev.filter((e) => e.t < t); ev.push({ k: 'set', t, v }); return p; },
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
  const ctx = { state: 'running', currentTime: 5, sampleRate: 8000, destination: { name: 'destination' }, gains: [], sources: [], oscs: [], links: [], suspends: 0 };
  const node = (extra) => ({ connect(to) { ctx.links.push([this, to]); return to; }, disconnect() {}, ...extra });
  Object.assign(ctx, {
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.suspends++; ctx.state = 'suspended'; return Promise.resolve(); },
    createGain() { const g = node({ gain: param(1) }); ctx.gains.push(g); return g; },
    createBiquadFilter() { return node({ type: '', frequency: param(350), Q: param(1) }); },
    createDynamicsCompressor() { return node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }); },
    createDelay() { return node({ delayTime: param(0) }); },
    createStereoPanner() { return node({ pan: param(0) }); },
    createWaveShaper() { return node({ curve: null, oversample: 'none' }); },
    createOscillator() { const o = node({ type: '', frequency: param(440), start() {}, stop() {} }); ctx.oscs.push(o); return o; },
    createBuffer(ch, n, sr) { const d = new Float32Array(n); return { duration: n / sr, sampleRate: sr, getChannelData: () => d }; },
    createBufferSource() { const s = node({ buffer: null, loop: false, playbackRate: param(1), startT: null, start(t = 0) { s.startT = t; }, stop() {} }); ctx.sources.push(s); return s; },
  });
  return ctx;
}
afterEach(() => { delete globalThis.window; });
function rig() {
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const timers = [];
  const audio = createAudio({ nav: {}, later: (f, ms) => timers.push({ f, ms }) });
  audio.unlock();
  const flush = () => { while (timers.length) timers.shift().f(); };
  // スピーカーの直前（destination へつながる）の大きさ
  const top = () => ctx.links.find(([, to]) => to === ctx.destination)?.[0];
  return { ctx, audio, flush, top, timers };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('R1f: 隠れたら一番上の大きさを約 30 ms で 0 へ落とし、唸りも 0 にしてから AudioContext を止める', async () => {
  const { ctx, audio, flush, top } = rig();
  expect(top()).toBeTruthy();
  expect(top().gain).toBeTruthy(); // 一番上は大きさ（gain）
  audio.chargeHum(0.8);
  const hum = ctx.links.find(([a]) => a === ctx.oscs[0])[1]; // 貯めの唸りの大きさ（最初の正弦波の行き先）
  expect(hum.gain.at(ctx.currentTime + 1)).toBeGreaterThan(0.1);
  expect(hum).toBeTruthy();
  const t0 = ctx.currentTime;
  audio.suspend();
  expect(top().gain.at(t0)).toBeGreaterThan(0.5); // すぐには切らない（プツッとしない）
  expect(top().gain.at(t0 + 0.035)).toBeLessThan(1e-4); // 約 30 ms で 0
  expect(hum.gain.at(t0 + 0.035)).toBeLessThan(1e-4);
  expect(ctx.suspends).toBe(0); // 落とし終わってから止める
  flush();
  await tick();
  expect(ctx.suspends).toBe(1);
  expect(ctx.state).toBe('suspended');
});

test('R1f: 戻るときは、鳴らし直した瞬間（時計の止まった所）の大きさは 0。鳴り始めてから上がる。唸りは前の大きさに戻らない', async () => {
  const { ctx, audio, flush, top } = rig();
  audio.chargeHum(0.8);
  audio.suspend(); flush(); await tick();
  ctx.currentTime += 0.04; // 落とすあいだに進んだ分だけ（止まったあとは進まない）
  const tr = ctx.currentTime;
  audio.resume();
  expect(top().gain.at(tr)).toBeLessThan(1e-6);
  for (const g of ctx.gains) if (g !== top()) { /* 唸りなど */ }
  const humNow = Math.max(...ctx.gains.filter((g) => g !== top()).map((g) => (g.gain.at(tr) < 0.5 ? g.gain.at(tr) : 0)));
  expect(humNow).toBeLessThan(1e-3);
  await tick(); flush(); await tick();
  expect(ctx.state).toBe('running');
  expect(top().gain.at(tr + 0.01)).toBeLessThan(0.05); // まだ上げきらない
  expect(top().gain.at(tr + 0.5)).toBeGreaterThan(0.95);
});

test('R1f: 隠れたまますぐ戻っても（止まる前に戻る）、止まりっぱなし・0 のままにならない', async () => {
  const { ctx, audio, flush, top } = rig();
  audio.suspend();
  audio.resume();
  flush(); await tick(); flush(); await tick();
  expect(ctx.state).toBe('running');
  expect(top().gain.at(ctx.currentTime + 0.5)).toBeGreaterThan(0.95);
});

test('R1f: 止まっていた間の BGM の拍は、戻ったときに束になって鳴らない（遅れた拍は捨てる）', async () => {
  const { ctx, audio, flush } = rig();
  const bgm = createBgm(() => audio.bgmOutput);
  bgm.start();
  for (let i = 0; i < 30; i++) { ctx.currentTime += 1 / 30; bgm.update({ elapsed: i / 30, power: 0.3, holding: true }); }
  const before = ctx.sources.length;
  bgm.pause(); audio.suspend(); flush(); await tick();
  // 止まっている間に実時間が 20 秒たっても、AudioContext の時計は進まない。戻った最初のフレーム
  audio.resume(); bgm.resume(); await tick(); flush();
  bgm.update({ elapsed: 1, power: 0.3, holding: true });
  const fresh = ctx.sources.slice(before).filter((s) => s.startT != null);
  for (const s of fresh) expect(s.startT).toBeGreaterThanOrEqual(ctx.currentTime - 1e-6);
  expect(fresh.length).toBeLessThanOrEqual(12); // ふだんの 1 フレーム分の先読みほど
});

test('R1f: BGM と効果音の大きさを、鳴らす前でも後でも変えられ、それぞれの道の大きさに効く', () => {
  const { ctx, audio } = rig();
  audio.setVolumes({ bgm: 0.4, sfx: 0.25 });
  expect(audio.volumes).toEqual({ bgm: 0.4, sfx: 0.25 });
  const out = audio.bgmOutput;
  expect(out.dest.gain.at(ctx.currentTime + 1)).toBeCloseTo(0.4, 3);
  expect(audio.sfxBus.gain.at(ctx.currentTime + 1)).toBeCloseTo(0.25, 3);
  audio.setVolumes({ bgm: 2, sfx: -1 }); // 0〜1 に収める
  expect(audio.volumes).toEqual({ bgm: 1, sfx: 0 });
});
