import { test, expect } from 'vitest';
import { comboRecipe, bossRecipe, recipePeak, screenPan, COMBO_CUE } from '../../src/audio/cues.js';

// R1: 払うの腕前（×k）と大物の知らせの音。画面に従い（左右は画面の出来事の場所から）、リミッターの天井より十分下
test('払うの腕前の音: k が一つ増えるたびに高くなり（×3 から）、9 段で止まる。二音目は上の 5 度', () => {
  const f = (k) => comboRecipe(k).tones[0].f;
  expect(f(3)).toBeCloseTo(COMBO_CUE.base, 6);
  for (let k = 3; k < 11; k++) expect(f(k + 1)).toBeGreaterThan(f(k));
  expect(f(20)).toBe(f(11));
  expect(f(2)).toBe(f(3));
  const r = comboRecipe(5);
  expect(r.tones[1].f / r.tones[0].f).toBeCloseTo(1.5, 6);
});

test('大物の知らせの音: 二度うなる低い警笛（不協和の二音）と探照灯の点く音。近いほど大きい', () => {
  const r = bossRecipe({ near: 0.2 }), n = bossRecipe({ near: 1 });
  expect(r.horns).toHaveLength(2);
  expect(r.horns[1].when).toBeGreaterThan(r.horns[0].when);
  const [a, b] = r.horns[0].f;
  expect(Math.abs(12 * Math.log2(b / a))).toBeGreaterThan(0.5); // 短 2 度ほど離れた二音
  expect(Math.abs(12 * Math.log2(b / a))).toBeLessThan(1.5);
  expect(n.horns[0].gain).toBeGreaterThan(r.horns[0].gain);
  expect(n.clank.gain).toBeGreaterThan(r.clank.gain);
});

test('どちらの音も、同時に鳴る声の大きさの合計がリミッターの天井（1）より十分下', () => {
  for (let k = 3; k < 15; k++) expect(recipePeak(comboRecipe(k))).toBeLessThan(0.5);
  expect(recipePeak(bossRecipe({ near: 1 }))).toBeLessThan(0.8);
});

test('左右は画面の出来事の場所から: カメラの右は正、左は負、正面は 0、端でも ±0.95 まで', () => {
  expect(screenPan(0, -50)).toBeCloseTo(0, 6);
  expect(screenPan(30, -30)).toBeGreaterThan(0.5);
  expect(screenPan(-30, -30)).toBeLessThan(-0.5);
  expect(screenPan(1000, -1)).toBeLessThanOrEqual(0.95);
  expect(screenPan(-1000, -1)).toBeGreaterThanOrEqual(-0.95);
});

test('鳴らす道: 払うの腕前と大物の音は、左右の panner から世界の音（master）を通ってリミッターへ', async () => {
  const { createAudio } = await import('../../src/audio/audio.js');
  const links = [];
  const node = () => ({ connect(to) { links.push([this, to]); return to; }, start() {}, stop() {} });
  const param = (v) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const panners = [], gains = [], comps = [];
  const ctx = {
    state: 'running', currentTime: 1, sampleRate: 8000, destination: {},
    resume() {}, suspend() {},
    createBiquadFilter() { return { ...node(), type: '', frequency: param(350), Q: param(1) }; },
    createGain() { const g = { ...node(), gain: param(1) }; gains.push(g); return g; },
    createOscillator() { return { ...node(), type: '', frequency: param(440) }; },
    createBufferSource() { return { ...node(), buffer: null, loop: false }; },
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d }; },
    createDelay() { return { ...node(), delayTime: param(0) }; },
    createStereoPanner() { const p = { ...node(), pan: param(0) }; panners.push(p); return p; },
    createWaveShaper() { return { ...node(), curve: null }; },
    createDynamicsCompressor() { const c = { ...node(), threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0) }; comps.push(c); return c; },
  };
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  try {
    const audio = createAudio();
    audio.unlock();
    const master = gains[0], lim = comps[0];
    const reaches = (n, target, seen = new Set()) => n === target || (!seen.has(n) && (seen.add(n), links.some(([a, to]) => a === n && reaches(to, target, seen))));
    for (const [play, pan] of [[() => audio.combo(4, 0.4), 0.4], [() => audio.bossArrive(-0.7, 0.8), -0.7]]) {
      const before = panners.length;
      play();
      const p = panners[before];
      expect(p).toBeTruthy();
      expect(p.pan.value).toBeCloseTo(pan, 6);
      expect(links.some(([a, to]) => a === p && to === master)).toBe(true);
      expect(reaches(master, lim)).toBe(true);
    }
  } finally {
    delete globalThis.window;
  }
});

// R1b（持ち主 08:24「吸われてる音」）: 吸われる音（ざらついた息の吸い込みと、うねりながら下がる細い唸り）
test('R1b 吸われる音: 脈打ちの一回ごとに下がっていく。強く吸われるほど大きく、低い。0 なら無音。天井より十分下', async () => {
  const { drainVoice, DRAIN_CUE } = await import('../../src/audio/cues.js');
  expect(drainVoice(0, 0.5).hiss.gain).toBe(0);
  expect(drainVoice(0, 0.5).whine.gain).toBe(0);
  // 一回の脈打ちの中で、息の帯と唸りの高さはだんだん下がる
  const a = drainVoice(0.5, 0.05), b = drainVoice(0.5, 0.5), c = drainVoice(0.5, 0.95);
  expect(b.hiss.f).toBeLessThan(a.hiss.f);
  expect(c.hiss.f).toBeLessThan(b.hiss.f);
  expect(c.whine.f).toBeLessThan(a.whine.f);
  // 強いほど大きく、低い
  const lo = drainVoice(0.3, 0.4), hi = drainVoice(0.9, 0.4);
  expect(hi.hiss.gain).toBeGreaterThan(lo.hiss.gain);
  expect(hi.whine.gain).toBeGreaterThan(lo.whine.gain);
  expect(hi.whine.f).toBeLessThan(lo.whine.f);
  // うねり（細かい揺れ）がある
  expect(DRAIN_CUE.warble.rate).toBeGreaterThan(4);
  expect(DRAIN_CUE.warble.depth).toBeGreaterThan(0);
  // 同時に鳴る声の合計はどの位相でも小さい（重い最後の一発や BGM と重なってもリミッターの余裕を食わない）。
  // 息の帯は白いノイズを帯域に通すので、振れ幅は gain の約 1/4（実際の出口は scripts/drain-preview.mjs で測る）
  for (let p = 0; p < 1; p += 0.05) {
    const v = drainVoice(1, p);
    expect(v.hiss.gain * 0.25 + v.whine.gain * (1 + DRAIN_CUE.warble.depth)).toBeLessThan(0.25);
  }
});

test('R1b 吸われる音の道: 左右の panner から世界の音（master）を通ってリミッターへ。はがれたらその場で 0 へ、左右は掴んでいる者の側', async () => {
  const { createAudio } = await import('../../src/audio/audio.js');
  const links = [];
  const node = () => ({ connect(to) { links.push([this, to]); return to; }, start() {}, stop() {} });
  const param = (v) => { const p = { value: v, target: v, tc: null, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(x, t, tc) { p.target = x; p.tc = tc; }, cancelScheduledValues() {} }; return p; };
  const panners = [], gains = [], comps = [];
  const ctx = {
    state: 'running', currentTime: 1, sampleRate: 8000, destination: {},
    resume() {}, suspend() {},
    createBiquadFilter() { return { ...node(), type: '', frequency: param(350), Q: param(1) }; },
    createGain() { const g = { ...node(), gain: param(1) }; gains.push(g); return g; },
    createOscillator() { return { ...node(), type: '', frequency: param(440), detune: param(0) }; },
    createBufferSource() { return { ...node(), buffer: null, loop: false }; },
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d }; },
    createStereoPanner() { const p = { ...node(), pan: param(0) }; panners.push(p); return p; },
    createWaveShaper() { return { ...node(), curve: null }; },
    createDynamicsCompressor() { const c = { ...node(), threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0) }; comps.push(c); return c; },
  };
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  try {
    const audio = createAudio();
    audio.unlock();
    const master = gains[0], lim = comps[0];
    const reaches = (n, target, seen = new Set()) => n === target || (!seen.has(n) && (seen.add(n), links.some(([a, to]) => a === n && reaches(to, target, seen))));
    const before = panners.length, g0 = gains.length;
    audio.drain({ sound: 0, phase: 0, pan: 0 }); // 掴まれていないうちは何も作らない
    expect(panners.length).toBe(before);
    audio.drain({ sound: 0.6, phase: 0.5, pan: 0.5 });
    const p = panners[before];
    expect(p).toBeTruthy();
    expect(p.pan.target).toBeCloseTo(0.5, 6);
    expect(links.some(([a, to]) => a === p && to === master)).toBe(true);
    expect(reaches(master, lim)).toBe(true);
    const voiceGains = gains.slice(g0).filter((g) => reaches(g, p) && g !== p);
    expect(voiceGains.some((g) => g.gain.target > 0)).toBe(true);
    // はがれた: すぐ（時定数 30 ms 未満で）0 へ
    audio.drain({ sound: 0, phase: 0.6, pan: 0.5 });
    for (const g of voiceGains.filter((x) => x.gain.tc !== null && x.gain.tc < 0.03)) expect(g.gain.target).toBe(0);
    expect(voiceGains.filter((g) => g.gain.target === 0 && g.gain.tc < 0.03).length).toBeGreaterThanOrEqual(2);
    audio.drain(null);
    expect(panners.length).toBe(before + 1); // 作り直さない
  } finally {
    delete globalThis.window;
  }
});

// R1c（持ち主 11:03「制限時間もわかりやすくしよう」）: 残り 10 秒から 1 秒ごとの短い刻みの音。画面に合わせる（世界の音 master を通るので、
// 演出・導入の無音に従う）。最後の 3 秒は一段高い。短く、天井より十分下
test('R1c 刻みの音: 短い（0.1 秒未満）。最後の 3 秒は高い。天井より十分下', async () => {
  const { timeTickRecipe } = await import('../../src/audio/cues.js');
  for (let n = 1; n <= 10; n++) {
    const r = timeTickRecipe(n);
    for (const t of r.tones) expect(t.dur).toBeLessThan(0.1);
    expect(recipePeak(r)).toBeLessThan(0.35);
  }
  expect(timeTickRecipe(3).tones[0].f).toBeGreaterThan(timeTickRecipe(4).tones[0].f);
  expect(timeTickRecipe(10).tones[0].f).toBe(timeTickRecipe(4).tones[0].f);
});

test('R1c 刻みの音の道: 世界の音（master）を通ってリミッターへ（演出の無音・導入では黙る）。鳴らせないときは何もしない', async () => {
  const { createAudio } = await import('../../src/audio/audio.js');
  const links = [];
  const node = () => ({ connect(to) { links.push([this, to]); return to; }, start() {}, stop() {} });
  const param = (v) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const gains = [], comps = [], oscs = [];
  const ctx = {
    state: 'running', currentTime: 1, sampleRate: 8000, destination: {},
    resume() {}, suspend() {},
    createBiquadFilter() { return { ...node(), type: '', frequency: param(350), Q: param(1) }; },
    createGain() { const g = { ...node(), gain: param(1) }; gains.push(g); return g; },
    createOscillator() { const o = { ...node(), type: '', frequency: param(440) }; oscs.push(o); return o; },
    createBufferSource() { return { ...node(), buffer: null, loop: false }; },
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d }; },
    createDelay() { return { ...node(), delayTime: param(0) }; },
    createStereoPanner() { return { ...node(), pan: param(0) }; },
    createWaveShaper() { return { ...node(), curve: null }; },
    createDynamicsCompressor() { const c = { ...node(), threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0) }; comps.push(c); return c; },
  };
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  try {
    const audio = createAudio();
    audio.timeTick(5); // unlock の前は鳴らせない（例外にならない）
    audio.unlock();
    const master = gains[0], lim = comps[0];
    const reaches = (n, target, seen = new Set()) => n === target || (!seen.has(n) && (seen.add(n), links.some(([a, to]) => a === n && reaches(to, target, seen))));
    const o0 = oscs.length;
    audio.timeTick(5);
    const mine = oscs.slice(o0);
    expect(mine.length).toBeGreaterThan(0);
    for (const o of mine) expect(reaches(o, master)).toBe(true);
    expect(reaches(master, lim)).toBe(true);
    ctx.state = 'suspended';
    const o1 = oscs.length;
    audio.timeTick(4);
    expect(oscs.length).toBe(o1);
  } finally {
    delete globalThis.window;
  }
});
