import { test, expect } from 'vitest';
import { boomDelay, createCrumbleGate, CRUMBLE_GAP_SEC } from '../../src/audio/audio.js';

test('無音の間に弾ける爆発は、無音が明けるまで待つ', () => {
  expect(boomDelay(10.34, 10.05)).toBeCloseTo(0.29);
});
test('無音が明けていれば待たない', () => {
  expect(boomDelay(10, 10.5)).toBe(0);
});

test('崩落の音は約 50 ms に一度だけ鳴り、その間の命中はまとめて次の一回に足す', () => {
  expect(CRUMBLE_GAP_SEC).toBeCloseTo(0.05);
  const gate = createCrumbleGate();
  expect(gate.take(3, 1.0)).toBe(3);
  expect(gate.take(5, 1.016)).toBe(0);
  expect(gate.take(4, 1.033)).toBe(0);
  expect(gate.take(2, 1.05)).toBe(11);
  expect(gate.take(0, 1.2)).toBe(0); // 溜まっていなければ鳴らさない
  expect(gate.take(1, 1.21)).toBe(1);
  // 60 fps で毎フレーム命中しても、1 秒に鳴るのは 20 回ほど
  const g2 = createCrumbleGate();
  let n = 0;
  for (let i = 0; i < 60; i++) if (g2.take(10, i / 60) > 0) n++;
  expect(n).toBeLessThanOrEqual(21);
});

// 最小の身代わりの AudioContext: AudioParam は予定（setValueAtTime / ramp）を記録し、時刻 t の値を返す
function fakeParam(v0) {
  const ev = [];
  return {
    value: v0, ev,
    setValueAtTime(v, t) { ev.push({ t, v }); }, linearRampToValueAtTime(v, t) { ev.push({ t, v }); },
    exponentialRampToValueAtTime(v, t) { ev.push({ t, v }); }, setTargetAtTime(v, t) { ev.push({ t, v }); },
    cancelScheduledValues(t) { for (let i = ev.length - 1; i >= 0; i--) if (ev[i].t >= t) ev.splice(i, 1); },
    // 最後の予定の値（その時刻を過ぎたあとの値）
    final() { return ev.length ? ev.reduce((a, b) => (b.t >= a.t ? b : a)).v : this.value; },
    lastT() { return ev.length ? Math.max(...ev.map((e) => e.t)) : 0; },
  };
}
function fakeCtx() {
  const node = () => ({ connect() {}, start() {}, stop() {} });
  const ctx = {
    state: 'running', currentTime: 10, sampleRate: 8000, destination: {}, filters: [], gains: [],
    resume() {}, suspend() {},
    createBiquadFilter() { const f = { ...node(), type: '', frequency: fakeParam(350), Q: fakeParam(1) }; ctx.filters.push(f); return f; },
    createGain() { const g = { ...node(), gain: fakeParam(1) }; ctx.gains.push(g); return g; },
    createOscillator() { return { ...node(), type: '', frequency: fakeParam(440) }; },
    createBufferSource() { return { ...node(), buffer: null, loop: false }; },
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d }; },
  };
  return ctx;
}

test('最後の一発の音: 地鳴りが終わると、こもり（low-pass）と世界の音量は元に戻る', async () => {
  const { createAudio } = await import('../../src/audio/audio.js');
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  try {
    const audio = createAudio();
    audio.unlock();
    const out = ctx.filters[0], master = ctx.gains[0];
    expect(out.frequency.value).toBe(20000);
    expect(master.gain.value).toBeCloseTo(0.8);
    audio.silence();
    audio.unsilence();
    audio.muffle(1.4);
    ctx.currentTime = 12;
    audio.deepRumble();
    // 地鳴りの最中はこもったまま、終わったら戻る
    expect(out.frequency.final()).toBe(20000);
    expect(out.frequency.lastT()).toBeGreaterThan(12 + 5);
    expect(master.gain.final()).toBeCloseTo(0.8);
    expect(master.gain.lastT()).toBeGreaterThan(12 + 5);
  } finally {
    delete globalThis.window;
  }
});

test('BGM の出口: unlock の前は無く、あとはスピーカーへ直接つながり、演出の無音（master）では黙らない', async () => {
  const { createAudio } = await import('../../src/audio/audio.js');
  const ctx = fakeCtx();
  const links = [];
  const make = ctx.createGain;
  ctx.createGain = () => { const g = make(); g.connect = (to) => links.push([g, to]); return g; };
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  try {
    const audio = createAudio();
    expect(audio.bgmOutput).toBe(null);
    audio.unlock();
    const o = audio.bgmOutput;
    expect(o.ctx).toBe(ctx);
    expect(links.some(([g, to]) => g === o.dest && to === ctx.destination)).toBe(true);
    audio.silence();
    expect(o.dest.gain.final()).toBe(1);
  } finally {
    delete globalThis.window;
  }
});

test('ブラックホールの唸り: 低い音が rise 秒かけて強く・高くなり、droneCut でぴたりと無音になる（演出の道 cine を通る）', async () => {
  const { createAudio } = await import('../../src/audio/audio.js');
  const ctx = fakeCtx();
  const oscs = [], links = [];
  const mkOsc = ctx.createOscillator, mkGain = ctx.createGain;
  ctx.createOscillator = () => { const o = mkOsc(); o.stops = []; o.stop = (t) => o.stops.push(t); oscs.push(o); return o; };
  ctx.createGain = () => { const g = mkGain(); g.connect = (to) => links.push([g, to]); return g; };
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  try {
    const audio = createAudio();
    audio.unlock();
    audio.droneCut(); // 鳴っていなくてもこわれない
    const cine = ctx.gains[1];
    const before = ctx.gains.length, oscBefore = oscs.length;
    audio.blackholeDrone(7);
    const g = ctx.gains[before];
    expect(links.some(([a, to]) => a === g && to === cine)).toBe(true);
    expect(g.gain.final()).toBeGreaterThan(0.5);
    expect(g.gain.lastT()).toBeCloseTo(10 + 7, 5);
    const mine = oscs.slice(oscBefore);
    expect(mine.length).toBeGreaterThan(0);
    for (const o of mine) expect(o.frequency.final()).toBeGreaterThan(o.frequency.ev[0].v); // 音程が上がる
    ctx.currentTime = 16.2;
    audio.droneCut();
    expect(g.gain.final()).toBeLessThanOrEqual(0.0001);
    expect(g.gain.lastT()).toBeLessThan(16.2 + 0.1);
    for (const o of mine) expect(Math.min(...o.stops)).toBeLessThan(16.2 + 0.2);
  } finally {
    delete globalThis.window;
  }
});
