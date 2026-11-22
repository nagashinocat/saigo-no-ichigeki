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
