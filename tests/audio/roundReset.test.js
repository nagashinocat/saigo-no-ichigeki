import { test, expect, afterEach } from 'vitest';
import { createAudio } from '../../src/audio/audio.js';
import { createBgm } from '../../src/audio/bgm.js';
import { createTimeline } from '../../src/render/finaleTimeline.js';
import { CONFIG } from '../../src/config.js';

// 持ち主 2026-11-23 08:41: リトライはページを読み直さず、その場で遊び直す（AudioContext はそのまま: 音の許可が残るので TAP が要らない）。
// そのとき、前の一回の音（貯めの唸り・吸われる音・演出の無音とこもり・地響き・無音のあとの地鳴り・ブラックホールの唸り・爆発の音・BGM の引き伸ばしと
// 静かな変奏）を止め、予約した先の音も取り消して、読み直したページと同じ姿から鳴らす（audio.resetRound・bgm.reset）
// 身代わりの AudioContext（appSwitch.test.js と同じ。外した道 cuts・作った filters・止めた時刻 stopT も記録する）
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
  const ctx = { state: 'running', currentTime: 5, sampleRate: 8000, destination: { name: 'destination' }, gains: [], sources: [], oscs: [], links: [], suspends: 0, filters: [], cuts: [] };
  const node = (extra) => ({ connect(to) { ctx.links.push([this, to]); return to; }, disconnect() { this.cut = true; ctx.cuts.push(this); }, ...extra });
  Object.assign(ctx, {
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.suspends++; ctx.state = 'suspended'; return Promise.resolve(); },
    createGain() { const g = node({ gain: param(1) }); ctx.gains.push(g); return g; },
    createBiquadFilter() { const f = node({ type: '', frequency: param(350), Q: param(1) }); ctx.filters.push(f); return f; },
    createDynamicsCompressor() { return node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }); },
    createDelay() { return node({ delayTime: param(0) }); },
    createStereoPanner() { return node({ pan: param(0) }); },
    createWaveShaper() { return node({ curve: null, oversample: 'none' }); },
    createOscillator() { const o = node({ type: '', frequency: param(440), stopT: Infinity, start() {}, stop(t = 0) { o.stopT = t; } }); ctx.oscs.push(o); return o; },
    createBuffer(ch, n, sr) { const d = new Float32Array(n); return { duration: n / sr, sampleRate: sr, getChannelData: () => d }; },
    createBufferSource() { const s = node({ buffer: null, loop: false, playbackRate: param(1), startT: null, stopT: Infinity, start(t = 0) { s.startT = t; }, stop(t = 0) { s.stopT = t; } }); ctx.sources.push(s); return s; },
  });
  return ctx;
}
afterEach(() => { delete globalThis.window; });
function rig() {
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio({ nav: {}, later: () => {} });
  audio.unlock();
  // build の最初の gain が master（世界の音）、次が cine（演出の音）。最初の filter が out（こもり）
  return { ctx, audio, master: ctx.gains[0], cine: ctx.gains[1], out: ctx.filters[0] };
}
const tl = () => createTimeline({ radius: CONFIG.radius.max, riderDist: CONFIG.radius.max * 0.46, camDist: CONFIG.radius.max * 0.46 + 14 });

test('resetRound: 演出の無音・宇宙のこもり・無音のあとの地鳴りの予約（6 秒後に世界の音を戻す）を取り消し、世界の音とこもりをすぐ元へ', () => {
  const { ctx, audio, master, out } = rig();
  expect(master.gain.value).toBe(0.8);
  audio.silence();
  audio.muffle(1.4);
  audio.deepRumble();
  const t = ctx.currentTime;
  expect(master.gain.at(t + 6.25)).toBeLessThan(0.5); // 直す前: 地鳴りが引くまで世界の音は 0 で、そのあと戻す予約
  expect(out.frequency.at(t + 0.01)).toBeLessThan(1000);
  audio.resetRound();
  for (const dt of [0.01, 1, 6.25, 7]) expect(master.gain.at(t + dt)).toBeCloseTo(0.8, 5);
  for (const dt of [0.01, 6.25]) expect(out.frequency.at(t + dt)).toBe(20000);
});

test('resetRound: 演出の道（心臓の鼓動・地響き・地鳴り・唸り）と爆発の音の道は外して作り直す。ループの地響きと唸りは止める', () => {
  const { ctx, audio, cine, out } = rig();
  const s0 = ctx.sources.length, o0 = ctx.oscs.length; // ここまでは起動のときの鳴りっぱなしの音（唸りと脈動。大きさ 0 で待つ）
  audio.finaleRumble(tl());
  audio.blackholeDrone(7);
  audio.deepRumble();
  const loops = ctx.sources.filter((s) => s.loop);
  expect(loops.length).toBeGreaterThan(0);
  const t = ctx.currentTime;
  audio.resetRound();
  expect(cine.cut).toBe(true);
  const fresh = ctx.gains.find((g) => g !== cine && ctx.links.some(([a, b]) => a === g && b === out) && g.gain.value === 0.9);
  expect(fresh).toBeTruthy(); // 新しい演出の道が out へ
  // 地響き・唸りのループの音は止まる（ずっと回り続けない）。無音のあとの地鳴りは自分の止める時刻（約 6 秒）まで、道が外れて聞こえない
  for (const s of ctx.sources.slice(s0).filter((x) => x.startT != null)) expect(s.stopT).toBeLessThanOrEqual(t + 6.2);
  for (const o of ctx.oscs.slice(o0)) expect(o.stopT).toBeLessThanOrEqual(t + 6.2);
});

test('resetRound: 無音の間に押したリトライでも、新しい一回の爆発の音（払う）はすぐ鳴る（無音の終わりを待たない）', () => {
  const { ctx, audio } = rig();
  audio.silence();
  const n0 = ctx.sources.length;
  audio.boom(0.3);
  expect(ctx.sources.length).toBe(n0); // 無音の間は鳴らさない（前のまま）
  audio.resetRound();
  const n1 = ctx.sources.length;
  audio.boom(0.3);
  const made = ctx.sources.slice(n1).filter((s) => s.startT != null);
  expect(made.length).toBeGreaterThan(0);
  for (const s of made) expect(s.startT).toBeLessThan(ctx.currentTime + 0.5);
});

test('resetRound: 貯めの唸りと吸われる音は 0 へ。AudioContext が止まっている間（演出中のメニュー）でも効く。止めも閉じもしない', () => {
  const { ctx, audio } = rig();
  audio.chargeHum(0.9);
  audio.drain({ sound: 1 });
  const hum = ctx.links.find(([a]) => a === ctx.oscs[0])[1];
  expect(hum.gain.at(ctx.currentTime + 1)).toBeGreaterThan(0.1);
  ctx.state = 'suspended';
  audio.resetRound();
  expect(hum.gain.at(ctx.currentTime + 0.1)).toBeLessThan(1e-4);
  expect(ctx.suspends).toBe(0);
  expect(ctx.state).toBe('suspended'); // 戻すのは一時停止の側（resume）
});

test('bgm.reset: 引き伸ばし（ブラックホール）や静かな変奏のあとでも、予約した拍を止めて off へ。次の start で最初の BGM がふつうの音色で鳴る', () => {
  const { ctx, audio } = rig();
  const bgm = createBgm(() => audio.bgmOutput);
  const f0 = ctx.filters.length, s0 = ctx.sources.length;
  bgm.start();
  const lp = ctx.filters[f0]; // BGM の出口のこもり
  const run = (sec) => { for (let i = 0; i < sec * 30; i++) { ctx.currentTime += 1 / 30; bgm.update({ elapsed: 10, power: 0.4, holding: true }); } };
  run(2);
  bgm.stretchOut(3);
  run(1);
  expect(['stretch', 'stopped']).toContain(bgm.state); // 引き伸ばしの途中か、消えきったあと（どちらも start では鳴らない）
  const before = ctx.sources.length;
  const t = ctx.currentTime;
  bgm.reset();
  expect(bgm.state).toBe('off');
  expect(bgm.scheduled).toBe(0);
  for (const s of ctx.sources.slice(s0, before)) if (s.startT != null) expect(s.stopT).toBeLessThanOrEqual(t + 0.05);
  run(1);
  expect(ctx.sources.length).toBe(before); // off の間は鳴らさない
  bgm.start();
  expect(bgm.state).toBe('play');
  run(1);
  expect(lp.frequency.at(ctx.currentTime)).toBe(20000); // 引き伸ばしのこもりは残らない
  const fresh = ctx.sources.slice(before).filter((s) => s.startT != null);
  expect(fresh.length).toBeGreaterThan(0);
  for (const s of fresh) expect(s.playbackRate.at(ctx.currentTime + 2)).toBe(s.playbackRate.value); // 音程も引き伸ばしのまま下がらない
  // 静かな変奏（結果画面）からも同じ
  bgm.quiet();
  run(1);
  bgm.reset();
  expect(bgm.state).toBe('off');
  bgm.start();
  expect(bgm.state).toBe('play');
});
