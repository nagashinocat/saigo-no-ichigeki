import { test, expect } from 'vitest';
import { createBgm, LOOKAHEAD } from '../../src/audio/bgm.js';

// 身代わりの AudioContext: 予約された再生（start / stop の時刻）と、AudioParam の予定を記録する
function fakeParam(v0) {
  const ev = [];
  return {
    value: v0, ev,
    setValueAtTime(v, t) { ev.push({ k: 'set', t, v }); },
    linearRampToValueAtTime(v, t) { ev.push({ k: 'lin', t, v }); },
    exponentialRampToValueAtTime(v, t) { ev.push({ k: 'exp', t, v }); },
    setTargetAtTime(v, t) { ev.push({ k: 'target', t, v }); },
    cancelScheduledValues(t) { for (let i = ev.length - 1; i >= 0; i--) if (ev[i].t >= t) ev.splice(i, 1); },
    // 時刻 t の値（直線の傾きだけ見る簡単な版）
    at(t) {
      let v = v0, tv = -Infinity;
      for (const e of [...ev].sort((a, b) => a.t - b.t)) {
        if (e.t <= t) { v = e.v; tv = e.t; continue; }
        if (e.k === 'lin' || e.k === 'exp') return v + (e.v - v) * (t - tv) / (e.t - tv);
        break;
      }
      return v;
    },
  };
}
function fakeCtx() {
  const node = () => ({ connected: true, connect() {}, disconnect() { this.connected = false; } });
  const ctx = {
    state: 'running', currentTime: 5, sampleRate: 8000, sources: [], gains: [],
    createGain() { const g = { ...node(), gain: fakeParam(1) }; ctx.gains.push(g); return g; },
    createBiquadFilter() { return { ...node(), type: '', frequency: fakeParam(350), Q: fakeParam(1) }; },
    createDelay() { return { ...node(), delayTime: fakeParam(0) }; },
    createStereoPanner() { return { ...node(), pan: fakeParam(0) }; },
    createBuffer(ch, n, sr) { const d = new Float32Array(n); return { duration: n / sr, getChannelData: () => d }; },
    createBufferSource() {
      const s = { ...node(), buffer: null, playbackRate: fakeParam(1), startT: null, stopT: Infinity,
        start(t) { s.startT = t; }, stop(t = 0) { s.stopT = t; } }; // 何度呼んでも最後の一回だけが効く（仕様どおり）
      ctx.sources.push(s);
      return s;
    },
  };
  return ctx;
}
const setup = () => {
  const ctx = fakeCtx();
  const bgm = createBgm(() => ({ ctx, dest: {} }));
  return { ctx, bgm };
};
// 実際に鳴る（始まる時刻が止める時刻より前の）再生
const sounding = (ctx, from, to) => ctx.sources.filter((s) => s.startT >= from && s.startT < to && s.stopT > s.startT);
const tick = (ctx, bgm, until, cond, dt = 1 / 30) => { while (ctx.currentTime < until) { ctx.currentTime += dt; bgm.update(cond); } };
const C = { elapsed: 20, power: 0.2, holding: true };

test('鳴らせるようになるまでは始まらない。始まると先読みの分だけ予約する', () => {
  const { ctx, bgm } = setup();
  ctx.state = 'suspended';
  bgm.start();
  expect(bgm.state).toBe('off');
  ctx.state = 'running';
  bgm.start();
  expect(bgm.state).toBe('play');
  bgm.update(C);
  expect(ctx.sources.length).toBeGreaterThan(0);
  // どの音も、今より前でも、先読み + 1 拍より先でもない
  for (const s of ctx.sources) { expect(s.startT).toBeGreaterThanOrEqual(5); expect(s.startT).toBeLessThan(5 + LOOKAHEAD + 1); }
  tick(ctx, bgm, 15, C);
  expect(sounding(ctx, 14, 15).length).toBeGreaterThan(3);
});

test('最後の一発: ぴたりと止める（予約していた先の音はすべて取り消し、音量は数ミリ秒で 0）', () => {
  const { ctx, bgm } = setup();
  bgm.start();
  tick(ctx, bgm, 9, C);
  const t = ctx.currentTime;
  bgm.stop();
  expect(bgm.state).toBe('stopped');
  expect(sounding(ctx, t + 0.012, Infinity)).toEqual([]);
  for (const s of ctx.sources) expect(s.stopT).toBeLessThanOrEqual(t + 0.012);
  const out = ctx.gains.find((g) => g.gain.ev.some((e) => e.k === 'lin' && e.v === 0 && e.t <= t + 0.01));
  expect(out).toBeTruthy();
  // 止めたあとは何も予約しない（start も二度は始まらない）
  const n = ctx.sources.length;
  bgm.start();
  tick(ctx, bgm, 12, C);
  expect(ctx.sources.length).toBe(n);
});

test('タブが隠れたら予約を止め、戻ったら続きから（隠れていた間の音はまとめて鳴らさない）', () => {
  const { ctx, bgm } = setup();
  bgm.start();
  tick(ctx, bgm, 8, C);
  bgm.pause();
  expect(bgm.paused).toBe(true);
  const n = ctx.sources.length;
  tick(ctx, bgm, 20, C);
  expect(ctx.sources.length).toBe(n);
  bgm.resume();
  bgm.update(C);
  // 戻った直後に予約された音は、今より 50 ms 以上前のものを含まない
  for (const s of ctx.sources.slice(n)) expect(s.startT).toBeGreaterThanOrEqual(ctx.currentTime);
  expect(ctx.sources.length - n).toBeLessThan(40);
  tick(ctx, bgm, 24, C);
  expect(sounding(ctx, 22, 24).length).toBeGreaterThan(3);
});

test('リプレイと結果画面: 止めたあとから静かな変奏がふくらみ、二度呼んでも重ならない', () => {
  const { ctx, bgm } = setup();
  bgm.start();
  tick(ctx, bgm, 8, C);
  bgm.stop();
  ctx.currentTime = 20;
  bgm.quiet();
  bgm.quiet();
  expect(bgm.state).toBe('quiet');
  const n = ctx.sources.length;
  tick(ctx, bgm, 30, C);
  const q = ctx.sources.slice(n);
  expect(q.length).toBeGreaterThan(10);
  // 同じ時刻に同じ音が二重に予約されていない
  const keys = q.map((s) => `${s.startT.toFixed(4)}:${s.playbackRate.value.toFixed(4)}:${s.buffer.duration}`);
  expect(new Set(keys).size).toBe(keys.length);
  // 音量は 0 から上がる
  const out = ctx.gains.find((g) => g.gain.ev.some((e) => e.k === 'lin' && e.v === 1));
  expect(out.gain.at(20.05)).toBeLessThan(0.1);
  expect(out.gain.at(25)).toBeCloseTo(1);
});

test('ブラックホール: 鳴っている音も音程が下がり、出口が暗くなり、sec 秒で消える。そのあとは静かな変奏へ', () => {
  const { ctx, bgm } = setup();
  bgm.start();
  tick(ctx, bgm, 12, { elapsed: 59, power: 0.5, holding: true });
  const t = ctx.currentTime;
  const ringing = ctx.sources.filter((s) => s.startT <= t && s.stopT > t + 0.05);
  bgm.stretchOut(3);
  expect(bgm.state).toBe('stretch');
  expect(ringing.length).toBeGreaterThan(0);
  for (const s of ringing) expect(s.playbackRate.ev.some((e) => e.k === 'exp' && e.t > t + 2.9 && e.v < s.playbackRate.value * 0.2)).toBe(true);
  // 引き伸ばしの音は sec 秒の内に始まり、間隔は開いていく
  const n = ctx.sources.length;
  bgm.quiet({ delay: 4.5 });
  tick(ctx, bgm, t + 4, {});
  const st = ctx.sources.slice(n).map((s) => s.startT).filter((x) => x < t + 4);
  expect(st.length).toBeGreaterThan(2);
  expect(Math.max(...st)).toBeLessThan(t + 3);
  tick(ctx, bgm, t + 10, {});
  expect(bgm.state).toBe('quiet');
  expect(sounding(ctx, t + 4.5, t + 10).length).toBeGreaterThan(3);
  expect(sounding(ctx, t + 3.2, t + 4.4)).toEqual([]);
});

test('楽器の音は、AudioContext ができる前から 1 つずつ作っておける', () => {
  const bgm = createBgm(() => null);
  let n = 0;
  while (!bgm.prepare()) n++;
  // 10 の楽器、1 回に 1 つずつ（多くても 10 回目で全部）。S6 fix1 から楽器の音は BGM と導入の音楽で共有の覚え
  // （bgmVoices.cachedVoice）なので、前のテストで作ってあれば早く済む
  expect(n).toBeLessThanOrEqual(9);
  expect(bgm.prepare()).toBe(true);
});

test('自然に鳴り終えた音は、終わったときにつなぎを外す（ノードが残り続けない）', () => {
  const { ctx, bgm } = setup();
  bgm.start();
  tick(ctx, bgm, 7, C);
  const s = ctx.sources[0];
  expect(typeof s.onended).toBe('function');
  s.onended();
  expect(s.connected).toBe(false);
});

test('ブラックホール: 鳴っている音の止める時刻は、引き伸ばした長さに合わせて延びる（途中でプツッと切らない）。尾は消えたところで止める', () => {
  const { ctx, bgm } = setup();
  bgm.start();
  tick(ctx, bgm, 12, { elapsed: 59, power: 0.5, holding: true });
  const t = ctx.currentTime;
  const ringing = ctx.sources.filter((s) => s.startT <= t && s.stopT > t + 0.05);
  const before = ringing.map((s) => s.stopT);
  bgm.stretchOut(3);
  for (let i = 0; i < ringing.length; i++) {
    // 引き伸ばしで読む速さが落ちるので、止める時刻は前より後（ただし音量が 0 になったすぐあとまで）
    expect(ringing[i].stopT).toBeGreaterThanOrEqual(Math.min(before[i], t + 3 * 1.05));
    expect(ringing[i].stopT).toBeLessThanOrEqual(t + 3 * 1.05 + 0.1);
  }
  expect(ringing.some((s, i) => s.stopT > before[i] + 0.05)).toBe(true);
  // 引き伸ばしの間に予約した音（長いドローンも）は、音量が 0 になったすぐあとで止まる
  tick(ctx, bgm, t + 4, {});
  for (const s of ctx.sources.filter((x) => x.startT >= t)) expect(s.stopT).toBeLessThanOrEqual(t + 3 * 1.05 + 0.1);
});
