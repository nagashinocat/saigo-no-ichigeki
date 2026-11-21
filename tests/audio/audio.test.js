import { test, expect } from 'vitest';
import { boomDelay } from '../../src/audio/audio.js';

test('無音の間に弾ける爆発は、無音が明けるまで待つ', () => {
  expect(boomDelay(10.34, 10.05)).toBeCloseTo(0.29);
});
test('無音が明けていれば待たない', () => {
  expect(boomDelay(10, 10.5)).toBe(0);
});

// （前の崩落の音の間引き createCrumbleGate のテストは、S3 の瓦礫の音の頻度の上限のテスト（finaleSfx.test.js）へ置き換えた）

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
    createDelay() { return { ...node(), delayTime: fakeParam(0) }; },
    createStereoPanner() { return { ...node(), pan: fakeParam(0) }; },
    createWaveShaper() { return { ...node(), curve: null }; },
    createDynamicsCompressor() {
      const c = { ...node(), threshold: fakeParam(-24), knee: fakeParam(30), ratio: fakeParam(12), attack: fakeParam(0.003), release: fakeParam(0.25) };
      ctx.compressors.push(c); return c;
    },
  };
  ctx.compressors = [];
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

test('BGM の出口: unlock の前は無く、あとは最後の天井（リミッター）だけを通ってスピーカーへつながり、演出の無音（master）では黙らない', async () => {
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
    expect(links.some(([g, to]) => g === o.dest && to === ctx.compressors[0])).toBe(true);
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

test('最後の天井（リミッター）: 効果音・演出の音・BGM はすべて一つのリミッターを通ってからスピーカーへ（重なっても 1 を超えて割れない）', async () => {
  const { createAudio } = await import('../../src/audio/audio.js');
  const ctx = fakeCtx();
  const links = [];
  const wrap = (make) => () => { const n = make(); n.connect = (to) => { links.push([n, to]); return to; }; return n; };
  ctx.createGain = wrap(ctx.createGain.bind(ctx));
  ctx.createBiquadFilter = wrap(ctx.createBiquadFilter.bind(ctx));
  ctx.createDynamicsCompressor = wrap(ctx.createDynamicsCompressor.bind(ctx));
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  try {
    const audio = createAudio();
    audio.unlock();
    expect(ctx.compressors.length).toBe(1);
    const lim = ctx.compressors[0];
    // スピーカーへつながるのはリミッターだけ
    const toDest = links.filter(([, to]) => to === ctx.destination).map(([n]) => n);
    expect(toDest).toEqual([lim]);
    // リミッターの設定: 天井は 0 dBFS より少し下、強い比、速いアタック
    expect(lim.threshold.value).toBeLessThanOrEqual(-1);
    expect(lim.threshold.value).toBeGreaterThanOrEqual(-6);
    expect(lim.ratio.value).toBeGreaterThanOrEqual(12);
    expect(lim.knee.value).toBeLessThanOrEqual(3);
    expect(lim.attack.value).toBeLessThanOrEqual(0.005);
    // 世界の音（master）・演出の音（cine）は out（こもり）を通ってリミッターへ、BGM の出口はリミッターへ直接
    const out = ctx.filters[0], master = ctx.gains[0], cine = ctx.gains[1];
    const reaches = (n, target, seen = new Set()) => {
      if (n === target) return true;
      if (seen.has(n)) return false;
      seen.add(n);
      return links.some(([a, to]) => a === n && reaches(to, target, seen));
    };
    for (const bus of [master, cine, out, audio.bgmOutput.dest]) expect(reaches(bus, lim)).toBe(true);
    expect(links.some(([a, to]) => a === out && to === lim)).toBe(true);
    expect(links.some(([a, to]) => a === audio.bgmOutput.dest && to === lim)).toBe(true);
  } finally {
    delete globalThis.window;
  }
});
