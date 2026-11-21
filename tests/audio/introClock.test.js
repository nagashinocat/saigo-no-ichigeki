import { test, expect } from 'vitest';
import { createIntroClock, nextBeatAt, INTRO_CLOCK } from '../../src/audio/introClock.js';

// 身代わりの出口: state と currentTime を手で動かす。schedule の呼び出しを記録する
function rig({ state = 'suspended', output = true } = {}) {
  const ctx = { state, currentTime: 0 };
  const dest = {};
  const calls = [];
  const cuts = [];
  const schedule = (c, d, t0, opts) => {
    const rec = { t0, from: opts.from, now: c.currentTime, state: c.state, cut: false };
    calls.push(rec);
    return { cut() { rec.cut = true; cuts.push(rec); } };
  };
  const grid = { start: -0.3, beatSec: 60 / 116 };
  const clock = createIntroClock({ getOutput: () => (output ? { ctx, dest } : null), schedule, grid });
  return { ctx, calls, cuts, clock, grid };
}

test('導入の 0 秒は、音の時計が running になってから決める（それまでは絵を 0 秒で待たせ、音も組まない）', () => {
  const { ctx, calls, clock } = rig();
  clock.begin(1000);
  expect(clock.mode).toBe('wait');
  expect(calls).toHaveLength(0);
  expect(clock.tick(1016, 0)).toBe('hold');
  expect(clock.tick(1200, 0)).toBe('hold');
  expect(calls).toHaveLength(0); // running でない時計に 0 秒を置かない
  ctx.state = 'running'; ctx.currentTime = 0.05; // resume が効いた
  const t = clock.tick(1250, 0);
  expect(calls).toHaveLength(1);
  expect(calls[0].state).toBe('running');
  expect(calls[0].t0).toBeCloseTo(0.05 + INTRO_CLOCK.lead, 9);
  expect(calls[0].from).toBe(0);
  expect(clock.mode).toBe('audio');
  expect(t).toBeCloseTo(-INTRO_CLOCK.lead, 9); // 0 秒より前（syncTo は戻さない）
  ctx.currentTime = 1.05;
  expect(clock.tick(2250, 0)).toBeCloseTo(1.0 - INTRO_CLOCK.lead, 9);
});

test('はじめから running なら、最初の tick で 0 秒を決める', () => {
  const { ctx, calls, clock } = rig({ state: 'running' });
  ctx.currentTime = 3;
  clock.begin(0);
  clock.tick(16, 0);
  expect(calls).toHaveLength(1);
  expect(calls[0].t0).toBeCloseTo(3 + INTRO_CLOCK.lead, 9);
});

test('いつまでも running にならない（ブラウザが許さない）: 少し待ったら絵は dt で進む（音は組まない）', () => {
  const { calls, clock } = rig();
  clock.begin(0);
  expect(clock.tick(INTRO_CLOCK.waitMs - 1, 0)).toBe('hold');
  expect(clock.tick(INTRO_CLOCK.waitMs + 1, 0)).toBe('dt');
  expect(clock.mode).toBe('dt');
  expect(clock.tick(5000, 2)).toBe('dt');
  expect(calls).toHaveLength(0);
});

test('待つ時間は実時間で数える（TAP の直後の準備で長くなった最初のフレームの dt では打ち切らない）', () => {
  const { ctx, calls, clock } = rig();
  clock.begin(5000); // 準備が終わった時刻
  expect(clock.tick(5016, 0)).toBe('hold');
  ctx.state = 'running';
  clock.tick(5100, 0);
  expect(calls).toHaveLength(1);
});

test('dt で進んだあとに鳴らせるようになった（あとの操作で resume）: 絵の今の時刻に合わせ、次の拍から組む（過去の時刻の音を組まない）', () => {
  const { ctx, calls, clock, grid } = rig();
  clock.begin(0);
  clock.tick(1000, 0); // dt へ
  expect(clock.mode).toBe('dt');
  for (const T of [0.0, 1.234, 2.5, 4.71]) {
    const r = rig();
    r.clock.begin(0); r.clock.tick(1000, 0);
    r.ctx.state = 'running'; r.ctx.currentTime = 7.25;
    const t = r.clock.tick(2000, T);
    expect(t).toBeCloseTo(T, 9); // 絵は止まらず、そのまま続く
    expect(r.calls).toHaveLength(1);
    const c = r.calls[0];
    expect(c.t0).toBeCloseTo(7.25 - T, 9);
    // 次の拍の頭から: 今より先（余裕つき）、拍の格子の上、一拍より遠くない
    expect(c.from).toBeGreaterThanOrEqual(T + INTRO_CLOCK.joinMargin - 1e-9);
    expect(c.from - T).toBeLessThanOrEqual(INTRO_CLOCK.joinMargin + grid.beatSec + 1e-9);
    const k = (c.from - grid.start) / grid.beatSec;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    expect(c.t0 + c.from).toBeGreaterThan(r.ctx.currentTime); // 最初の音は未来の時刻
  }
  void ctx; void calls;
});

test('鳴っている途中で止まった（iOS の interrupted など）: 組んだ音を切って dt へ、戻ったら次の拍から組み直す', () => {
  const { ctx, calls, cuts, clock } = rig({ state: 'running' });
  clock.begin(0);
  clock.tick(16, 0);
  ctx.currentTime = 2;
  clock.tick(1000, 0);
  ctx.state = 'interrupted';
  expect(clock.tick(1100, 1.9)).toBe('dt');
  expect(cuts).toHaveLength(1);
  ctx.state = 'running'; ctx.currentTime = 9;
  clock.tick(1500, 2.4);
  expect(calls).toHaveLength(2);
  expect(calls[1].from).toBeGreaterThan(2.4);
});

test('cut（飛ばした・始めた）: 組んだ音を切り、そのあとは何も組まない', () => {
  const { ctx, calls, cuts, clock } = rig({ state: 'running' });
  clock.begin(0);
  clock.tick(16, 0);
  clock.cut();
  expect(cuts).toHaveLength(1);
  ctx.currentTime = 5;
  clock.tick(2000, 3);
  expect(calls).toHaveLength(1);
});

test('音の出口がない（Web Audio がない）・begin していない（リトライの短い題字）: dt', () => {
  const a = rig({ output: false });
  a.clock.begin(0);
  expect(a.clock.tick(16, 0)).toBe('dt');
  const b = rig({ state: 'running' });
  expect(b.clock.tick(16, 0)).toBe('dt');
  expect(b.calls).toHaveLength(0);
});

test('nextBeatAt: 拍の格子の上で、t + margin 以上の最初の拍', () => {
  const g = { start: -0.3, beatSec: 0.5 };
  expect(nextBeatAt(0, g, 0)).toBeCloseTo(0.2, 9);
  expect(nextBeatAt(0.2, g, 0)).toBeCloseTo(0.2, 9);
  expect(nextBeatAt(0.21, g, 0)).toBeCloseTo(0.7, 9);
  expect(nextBeatAt(0.15, g, 0.06)).toBeCloseTo(0.7, 9);
});
