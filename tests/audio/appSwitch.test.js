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
  expect(audio.bgmBus.gain.at(ctx.currentTime + 1)).toBeCloseTo(0.4, 3);
  expect(audio.sfxBus.gain.at(ctx.currentTime + 1)).toBeCloseTo(0.25, 3);
  audio.setVolumes({ bgm: 2, sfx: -1 }); // 0〜1 に収める
  expect(audio.volumes).toEqual({ bgm: 1, sfx: 0 });
});

// fix1（見直し Minor 6）: メニューの一時停止は AudioContext を止めず、世界の音と BGM の出口を約 30 ms で黙らせる。音量の試し音は黙らせた後ろ
// （音量の道: 効果音は sfxBus、BGM は bgmBus）で鳴る
test('R1f fix1: mute で世界の音と BGM は 0 へ（AudioContext は止めない）。試し音はその道の音量を通って聞こえる', () => {
  const { ctx, audio, top } = rig();
  const t0 = ctx.currentTime;
  audio.mute(true);
  expect(ctx.suspends).toBe(0);
  expect(ctx.state).toBe('running');
  expect(audio.worldGate.gain.at(t0 + 0.035)).toBeLessThan(1e-4);
  expect(audio.bgmGate.gain.at(t0 + 0.035)).toBeLessThan(1e-4);
  expect(top().gain.at(t0 + 0.035)).toBeGreaterThan(0.9);
  // 世界の音の出口 out → worldGate → sfxBus、BGM の出口 → bgmGate → bgmBus
  expect(ctx.links.some(([a, to]) => a === audio.worldGate && to === audio.sfxBus)).toBe(true);
  expect(audio.bgmOutput.dest).toBe(audio.bgmGate);
  expect(ctx.links.some(([a, to]) => a === audio.bgmGate && to === audio.bgmBus)).toBe(true);
  for (const k of ['sfx', 'bgm']) {
    const n = ctx.links.length;
    audio.preview(k);
    const fresh = ctx.links.slice(n);
    expect(fresh.some(([, to]) => to === (k === 'sfx' ? audio.sfxBus : audio.bgmBus)), k).toBe(true);
  }
  audio.mute(false);
  expect(audio.worldGate.gain.at(ctx.currentTime + 0.5)).toBeGreaterThan(0.95);
  expect(audio.bgmGate.gain.at(ctx.currentTime + 0.5)).toBeGreaterThan(0.95);
});

// fix2（再見直し Important 1）: 演出・リプレイ・ブラックホールの間にメニューを開くと、AudioContext を止める（予約した地響き・唸り・BGM の引き伸ばしの
// 時計も止まる）。遊んでいる間は止めずに門で黙らせる（音量の試し音が聞こえる: M6）
import { createPause } from '../../src/ui/pause.js';
test('R1f fix2: 演出の間のメニューの一時停止は時計を止め、戻ったあとの音の時刻のずれは絵の時刻と同じ（止める前の 30 ms の落としの分だけ）', async () => {
  const { ctx, audio, flush } = rig();
  let cine = true, picture = 0;
  const game = { setHidden() {} };
  const pause = createPause({ game, controls: null, audio, bgm: null, cinematic: () => cine });
  // 時計: 動いている間だけ AudioContext の時刻が進む（本物と同じ）。絵は一時停止していない間だけ進む
  const tick = (sec) => { for (let i = 0; i < Math.round(sec * 100); i++) { if (ctx.state === 'running') ctx.currentTime += 0.01; if (!pause.paused) picture += 0.01; } };
  const a0 = ctx.currentTime, p0 = picture;
  tick(1);
  pause.set('menu', true);
  tick(0.05); flush(); await tick0(); // 落としてから止める
  expect(ctx.state).toBe('suspended');
  tick(3); // メニューを開いたまま 3 秒
  pause.set('menu', false); await tick0(); flush(); await tick0();
  expect(ctx.state).toBe('running');
  tick(1);
  const audioT = ctx.currentTime - a0, picT = picture - p0;
  expect(picT).toBeCloseTo(2, 6);
  expect(Math.abs(audioT - picT)).toBeLessThanOrEqual(0.05 + 1e-9);
  // 遊んでいる間のメニューは止めない（門で黙らせる。時計は進むが、遊びの音は先へ予約していない）
  cine = false;
  pause.set('menu', true);
  tick(0.5); flush(); await tick0();
  expect(ctx.state).toBe('running');
  expect(audio.worldGate.gain.at(ctx.currentTime)).toBeLessThan(1e-4);
  pause.set('menu', false);
});
const tick0 = () => new Promise((r) => setTimeout(r, 0));
