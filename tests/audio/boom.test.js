// 爆発の音（H2）: 合成のまま、実際の爆発に近い層に分ける。
// 最初の衝撃（短く鋭い広帯域）・低いうなり・地響き（超低域の揺れ、ゆっくり減衰）・空気を裂く中域・遅れて届く反射音・破片のぱらぱら。
// 大きさで長さ・低さ・遅れが変わる。最後の一発は演出の時刻表の「弾ける」から追われる間（hold）ずっと鳴り続ける。
import { test, expect, afterEach } from 'vitest';
import { boomRecipe, createAudio } from '../../src/audio/audio.js';
import { CONFIG } from '../../src/config.js';

const PUFF = Math.sqrt(CONFIG.puff.radius / CONFIG.radius.max);
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const end = (r) => Math.max(r.crack.dur, r.punch.dur, r.roar.dur, r.air.dur, r.sub.dur,
  ...r.taps.map((x) => x.delay + r.roar.dur * 0.5), r.debris.grains.length ? Math.max(...r.debris.grains.map((g) => g.t + g.len)) : 0);

test('最初の衝撃は短く鋭い広帯域（数十 ms、高い周波数まで通す）で、すぐに立ち上がる', () => {
  for (const s of [PUFF, 0.6, 1]) {
    const r = boomRecipe(s, { rng: seeded() });
    expect(r.crack.dur).toBeLessThanOrEqual(0.09);
    expect(r.crack.attack).toBeLessThanOrEqual(0.002);
    expect(r.crack.hp).toBeLessThan(1500); // ハイパスは低めで、上は切らない（広帯域）
    expect(r.punch.attack).toBeLessThanOrEqual(0.005);
  }
});

test('大きいほど長く・低く・反射音が遅れて届く', () => {
  const sizes = [PUFF, 0.5, 1];
  const rs = sizes.map((s) => boomRecipe(s, { rng: seeded() }));
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1], b = rs[i];
    expect(b.sub.dur).toBeGreaterThan(a.sub.dur);
    expect(b.roar.dur).toBeGreaterThan(a.roar.dur);
    expect(b.punch.f0).toBeLessThan(a.punch.f0);
    expect(b.punch.f1).toBeLessThan(a.punch.f1);
    expect(b.sub.cutoff).toBeLessThan(a.sub.cutoff);
    expect(b.roar.f0).toBeLessThan(a.roar.f0); // 遠く大きいほど暗い
    expect(b.taps[0].delay).toBeGreaterThan(a.taps[0].delay);
    expect(b.taps.length).toBeGreaterThanOrEqual(a.taps.length);
    expect(b.debris.grains.length).toBeGreaterThan(a.debris.grains.length);
    expect(end(b)).toBeGreaterThan(end(a));
  }
});

test('払う（小爆発）は短く近い: 1.5 秒以内に終わり、反射音は 0.15 秒以内に届く。最大の一発は 5 秒以上の地響き', () => {
  const p = boomRecipe(PUFF, { rng: seeded() });
  expect(end(p)).toBeLessThan(1.5);
  expect(p.taps[0].delay).toBeLessThan(0.15);
  const big = boomRecipe(1, { rng: seeded() });
  expect(big.sub.dur).toBeGreaterThanOrEqual(5);
  expect(big.taps[big.taps.length - 1].delay).toBeGreaterThan(0.5);
});

test('地響きは超低域（カットオフ 120 Hz 以下）でゆっくり減衰し、揺れる（LFO）', () => {
  for (const s of [PUFF, 1]) {
    const r = boomRecipe(s, { rng: seeded() });
    expect(r.sub.cutoff).toBeLessThanOrEqual(120);
    expect(r.sub.dur).toBeGreaterThan(r.crack.dur * 10);
    expect(r.sub.wobble.rate).toBeGreaterThan(2);
    expect(r.sub.wobble.depth).toBeGreaterThan(0);
  }
});

test('空気を裂く中域のノイズ（帯域 500〜2500 Hz）と、反射音は遠いほど暗く小さい', () => {
  const r = boomRecipe(1, { rng: seeded() });
  expect(r.air.freq).toBeGreaterThanOrEqual(500);
  expect(r.air.freq).toBeLessThanOrEqual(2500);
  for (let i = 1; i < r.taps.length; i++) {
    expect(r.taps[i].delay).toBeGreaterThan(r.taps[i - 1].delay);
    expect(r.taps[i].gain).toBeLessThan(r.taps[i - 1].gain);
    expect(r.taps[i].cutoff).toBeLessThanOrEqual(r.taps[i - 1].cutoff);
  }
  // 左右に散らばる
  expect(r.taps.some((x) => x.pan < 0) && r.taps.some((x) => x.pan > 0)).toBe(true);
});

test('破片のぱらぱら: 衝撃のあとに始まり、粒は重ならず（一つの gain の予定で鳴らせる）、だんだん疎らになる', () => {
  const r = boomRecipe(1, { rng: seeded(7) });
  const g = r.debris.grains;
  expect(g.length).toBeGreaterThan(20);
  expect(g[0].t).toBeGreaterThan(r.crack.dur);
  for (let i = 1; i < g.length; i++) expect(g[i].t).toBeGreaterThan(g[i - 1].t + g[i - 1].len);
  const half = (g[0].t + g[g.length - 1].t) / 2;
  expect(g.filter((x) => x.t < half).length).toBeGreaterThan(g.filter((x) => x.t >= half).length);
});

test('最後の一発: hold の間うなりと地響きが鳴り続け、open の間に音がこもった状態から開く（時間が戻る速さに合わせる）', () => {
  const plain = boomRecipe(0.9, { rng: seeded() });
  const fin = boomRecipe(0.9, { rng: seeded(), hold: 2.4, open: 0.75 });
  expect(fin.roar.dur).toBeGreaterThanOrEqual(plain.roar.dur + 2.4 - 1e-9);
  expect(fin.roar.hold).toBeCloseTo(2.4);
  expect(fin.sub.dur).toBeGreaterThanOrEqual(plain.sub.dur + 2.4 - 1e-9);
  expect(fin.roar.open).toBeCloseTo(0.75);
  expect(fin.debris.grains[fin.debris.grains.length - 1].t).toBeGreaterThan(plain.debris.grains[plain.debris.grains.length - 1].t);
});

// ---- 音の部品（身代わりの AudioContext）----
function fakeParam(v0) {
  const ev = [];
  return {
    value: v0, ev,
    setValueAtTime(v, t) { ev.push({ t, v }); }, linearRampToValueAtTime(v, t) { ev.push({ t, v }); },
    exponentialRampToValueAtTime(v, t) { ev.push({ t, v }); }, setTargetAtTime(v, t) { ev.push({ t, v }); },
    cancelScheduledValues() {},
  };
}
function fakeCtx() {
  const links = [], nodes = [];
  const node = (extra) => { const n = { connect(to) { links.push([n, to]); return to; }, start() {}, stop(t) { n.stopT = t; }, ...extra }; nodes.push(n); return n; };
  const ctx = {
    state: 'running', currentTime: 10, sampleRate: 8000, destination: { name: 'dest' }, links, nodes,
    resume() {}, suspend() {},
    createBiquadFilter: () => node({ kind: 'filter', type: '', frequency: fakeParam(350), Q: fakeParam(1) }),
    createGain: () => node({ kind: 'gain', gain: fakeParam(1) }),
    createOscillator: () => node({ kind: 'osc', type: '', frequency: fakeParam(440) }),
    createBufferSource: () => node({ kind: 'src', buffer: null, loop: false, playbackRate: fakeParam(1) }),
    createBuffer(ch, n) { const d = new Float32Array(n); return { length: n, getChannelData: () => d }; },
    createDelay: () => node({ kind: 'delay', delayTime: fakeParam(0) }),
    createStereoPanner: () => node({ kind: 'pan', pan: fakeParam(0) }),
    createWaveShaper: () => node({ kind: 'shaper', curve: null, oversample: 'none' }),
    createDynamicsCompressor: () => node({ kind: 'comp', threshold: fakeParam(-24), knee: fakeParam(30), ratio: fakeParam(12), attack: fakeParam(0.003), release: fakeParam(0.25) }),
  };
  return ctx;
}
afterEach(() => { delete globalThis.window; });

function setup() {
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio();
  audio.unlock();
  const master = ctx.nodes.filter((n) => n.kind === 'gain')[0];
  return { ctx, audio, master };
}
// つながりをたどって target に届くか（AudioParam へのつなぎ（揺れの LFO）は、その持ち主の部品へ届いたとみなす）
const reaches = (ctx, n, target, seen = new Set()) => {
  if (n === target) return true;
  if (seen.has(n)) return false;
  seen.add(n);
  const owner = (to) => ctx.nodes.find((x) => x === to || Object.values(x).includes(to)) ?? to;
  return ctx.links.some(([a, to]) => a === n && reaches(ctx, owner(to), target, seen));
};

test('boom: すべての層が世界の音（master）へ届き、部品の数は払うで 40 以下・最大でも 60 以下、全部いずれ止まる', () => {
  for (const [s, cap] of [[PUFF, 40], [1, 60]]) {
    const { ctx, audio, master } = setup();
    const n0 = ctx.nodes.length;
    audio.boom(s);
    const mine = ctx.nodes.slice(n0);
    expect(mine.length).toBeLessThanOrEqual(cap);
    const srcs = mine.filter((n) => n.kind === 'src' || n.kind === 'osc');
    expect(srcs.length).toBeGreaterThan(3);
    for (const x of srcs) {
      expect(reaches(ctx, x, master)).toBe(true);
      expect(x.stopT).toBeGreaterThan(10);
      expect(x.stopT).toBeLessThan(10 + 15);
    }
    // 反射音は遅延の部品を通る
    expect(mine.filter((n) => n.kind === 'delay').length).toBeGreaterThanOrEqual(2);
  }
});

test('boom: 演出の無音の間は鳴らさず、無音が明けたら hold / open を受け取って鳴る', () => {
  const { ctx, audio } = setup();
  audio.silence();
  let n0 = ctx.nodes.length;
  audio.boom(1);
  expect(ctx.nodes.length).toBe(n0);
  audio.unsilence();
  n0 = ctx.nodes.length;
  audio.boom(0.9, { hold: 2, open: 0.75 });
  const srcs = ctx.nodes.slice(n0).filter((n) => n.kind === 'src' || n.kind === 'osc');
  expect(Math.max(...srcs.map((x) => x.stopT))).toBeGreaterThan(10 + 2 + 4);
});

test('最後の一発の取り決め: 時刻表の「時間が戻る」（resume）から宇宙へ切り替わるまで鳴り続け、時間が戻る間に開く', async () => {
  const { finaleBoomOpts } = await import('../../src/audio/audio.js');
  const { createTimeline, FINALE } = await import('../../src/render/finaleTimeline.js');
  const tl = createTimeline({ radius: CONFIG.radius.max, hitDist: 40 });
  const o = finaleBoomOpts(tl, FINALE.burstRamp);
  expect(o.hold).toBeCloseTo(tl.chaseEnd - tl.resume);
  expect(o.hold).toBeGreaterThan(1);
  expect(o.open).toBe(FINALE.burstRamp);
  const r = boomRecipe(1, { ...o, rng: seeded() });
  expect(r.roar.dur).toBeGreaterThan(tl.chaseEnd - tl.resume); // 宇宙のこもり（muffle）まで途切れない
});

test('爆発の音のまとめの天井: knee までは素通し、その上はなめらかに ceil を超えない（重なった衝撃がリミッターをすり抜けない）', async () => {
  const { boomClipCurve, BOOM_CLIP } = await import('../../src/audio/audio.js');
  const c = boomClipCurve();
  const at = (x) => c[Math.round(((x / BOOM_CLIP.range) + 1) / 2 * (c.length - 1))];
  for (const x of [0, 0.1, 0.3, 0.55]) expect(at(x)).toBeCloseTo(x, 2);
  expect(at(-0.4)).toBeCloseTo(-0.4, 2);
  for (const x of [0.8, 1.2, 2]) { expect(at(x)).toBeLessThan(BOOM_CLIP.ceil); expect(at(x)).toBeLessThan(x); }
  for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]); // 単調
  expect(Math.max(...c)).toBeLessThanOrEqual(BOOM_CLIP.ceil);
});
