import { test, expect } from 'vitest';
import { createClipRecorder, createClipSession, CLIP_NOTE } from '../../src/share/clip.js';

// R4 fix1（見直し I-1・I-2・M3・M6・M7）: 録画の段取りは、どこで失敗しても必ず元へ戻す。二度押しで二つ録らない。

// ---- 身代わり: 2D の canvas・MediaStream・MediaRecorder・requestAnimationFrame・時計 ----
function fakeEnv({ bytes = 4096, recError = false } = {}) {
  const env = { t: 0, rafs: [], streams: [], recs: [] };
  const g2d = new Proxy({ measureText: (s) => ({ width: String(s).length * 10 }) }, {
    get(o, k) { return k in o ? o[k] : () => ({ addColorStop() {} }); },
    set(o, k, v) { o[k] = v; return true; },
  });
  const track = (kind) => ({ kind, stopped: false, stop() { this.stopped = true; } });
  env.doc = {
    createElement() {
      return {
        width: 0, height: 0, getContext: () => g2d,
        captureStream() { const s = { tracks: [track('video')], getTracks() { return this.tracks; }, addTrack(t) { this.tracks.push(t); } }; env.streams.push(s); return s; },
      };
    },
  };
  env.MR = class {
    static isTypeSupported() { return true; }
    constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; env.recs.push(this); }
    start() { this.state = 'recording'; if (recError) queueMicrotask(() => this.onerror?.({ error: new Error('encoder') })); }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      queueMicrotask(() => { if (bytes > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) }); this.onstop?.(); });
    }
  };
  env.raf = (f) => env.rafs.push(f);
  env.now = () => env.t;
  env.later = (f) => setTimeout(f, 0);
  // 画面のフレームを n 回（33 ms ずつ）進める
  env.pump = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      await new Promise((r) => setTimeout(r, 0));
      env.t += 33;
      const fs = env.rafs.splice(0);
      for (const f of fs) f(env.t);
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  return env;
}
const PLAN = { total: 0.5, segments: [{ name: 'close', src: 'replay', from: 0, to: 0.5, t0: 0, t1: 0.5 }], cues: [{ t: 0, name: 'erupt' }], flashes: [] };
function fakeHost(over = {}) {
  const h = {
    log: [], canvas: {}, audio: { tracks: [{ kind: 'audio', stopped: false, stop() { this.stopped = true; } }], getAudioTracks() { return this.tracks; }, getTracks() { return this.tracks; } },
    begin() { h.log.push('begin'); h.clipping = true; return PLAN; },
    frame() { h.log.push('frame'); },
    cue(n) { h.log.push('cue:' + n); },
    audioStream() { return h.audio; },
    shouldStop: () => false,
    end() { h.log.push('end'); h.clipping = false; },
    ...over,
  };
  return h;
}
const OV = { title: '最後の一撃', rank: 'B', headline: '撃退成功', amountLabel: '被害額', amount: '¥1兆', badge: null, stars: 0 };
const rec = (env, host) => createClipRecorder(host, { doc: env.doc, MR: env.MR, now: env.now, raf: env.raf, later: env.later });
async function run(env, r, n = 40) {
  let out = null;
  const p = r.record({ kind: 'blast', size: { w: 360, h: 640 }, overlay: OV }).then((x) => { out = x; });
  for (let i = 0; i < n && !out; i++) await env.pump();
  await p;
  return out;
}

test('ふつうに録れる: begin → 合図 → 描く → end。Blob が返り、後始末（流れの track を止める・canvas を 0×0）', async () => {
  const env = fakeEnv(), host = fakeHost(), r = rec(env, host);
  const out = await run(env, r);
  expect(out.blob.size).toBe(4096);
  expect(host.log[0]).toBe('begin');
  expect(host.log).toContain('cue:erupt');
  expect(host.log.at(-1)).toBe('end');
  expect(host.clipping).toBe(false);
  expect(r.busy).toBe(false);
  expect(env.streams[0].tracks.every((t) => t.stopped)).toBe(true);
});

test('I-1: 途中のフレーム（rAF の中）で描く側が投げたら、録画は失敗で終わり、必ず元へ戻る（ゲームはまた動く）。次の録画もできる', async () => {
  const env = fakeEnv();
  let n = 0;
  const host = fakeHost({ frame() { n++; host.log.push('frame'); if (n === 3) throw new Error('context lost'); } });
  const r = rec(env, host);
  const out = await run(env, r);
  expect(out.error?.message).toBe('context lost');
  expect(host.log.filter((x) => x === 'end')).toHaveLength(1);
  expect(host.clipping).toBe(false);
  expect(r.busy).toBe(false);
  expect(env.recs[0].state).toBe('inactive');
  expect(env.streams[0].tracks.every((t) => t.stopped)).toBe(true);
  expect(host.audio.tracks[0].stopped).toBe(true);
  // また録れる
  const host2 = fakeHost();
  const out2 = await run(env, rec(env, host2));
  expect(out2.blob).toBeTruthy();
});

test('I-1: 合図（音）が投げても同じ。begin が投げても end を呼んで戻す', async () => {
  const env = fakeEnv();
  const host = fakeHost({ cue() { throw new Error('audio'); } });
  const r = rec(env, host);
  expect((await run(env, r)).error?.message).toBe('audio');
  expect(host.clipping).toBe(false);
  expect(r.busy).toBe(false);
  const host2 = fakeHost({ begin() { host2.clipping = true; throw new Error('prep'); } });
  const r2 = rec(env, host2);
  expect((await run(env, r2)).error?.message).toBe('prep');
  expect(host2.log).toEqual(['end']);
  expect(host2.clipping).toBe(false);
  expect(r2.busy).toBe(false);
});

test('I-1: やめる（cancel）は、次のフレームが来なくても待っている録画をすぐ終わらせて戻す', async () => {
  const env = fakeEnv(), host = fakeHost(), r = rec(env, host);
  let out = null;
  const p = r.record({ kind: 'blast', size: { w: 360, h: 640 }, overlay: OV }).then((x) => { out = x; });
  await env.pump(3); // 録っている途中
  expect(r.busy).toBe(true);
  env.raf = () => {}; // これ以上フレームが来ない（固まった）
  env.rafs.length = 0;
  r.cancel();
  await p;
  expect(out).toEqual({ cancelled: true });
  expect(host.clipping).toBe(false);
  expect(r.busy).toBe(false);
});

test('I-1: end（元へ戻す）が投げても、録画の旗は下ろす', async () => {
  const env = fakeEnv(), host = fakeHost({ end() { host.log.push('end'); throw new Error('restore'); } }), r = rec(env, host);
  const out = await run(env, r);
  expect(out.error?.message).toBe('restore');
  expect(r.busy).toBe(false);
});

test('M7: 中身のない動画（0 バイト・ほとんど空）は失敗。MediaRecorder のエラーも失敗', async () => {
  for (const bytes of [0, 100]) {
    const env = fakeEnv({ bytes }), host = fakeHost(), r = rec(env, host);
    const out = await run(env, r);
    expect(out.blob).toBeUndefined();
    expect(out.error).toBe('empty');
    expect(host.clipping).toBe(false);
  }
  const env = fakeEnv({ recError: true }), host = fakeHost(), r = rec(env, host);
  const out = await run(env, r);
  expect(out.error).toBeTruthy();
  expect(host.clipping).toBe(false);
  expect(r.busy).toBe(false);
  expect(CLIP_NOTE.empty).toMatch(/動画/);
});

// ---- 結果画面の「動画で共有」の段取り（createClipSession）----
function fakeSession({ record, debug = false, prepare } = {}) {
  const log = [];
  let resolveRec = null;
  const recorder = {
    busy: false,
    cancel() { log.push('cancel'); resolveRec?.({ cancelled: true }); },
    record: record ?? (() => { log.push('record'); recorder.busy = true; return new Promise((r) => { resolveRec = (x) => { recorder.busy = false; r(x); }; }); }),
  };
  const panel = { start() { log.push('panel.start'); }, progress() {}, preview() {}, done(o) { log.push('panel.done'); panel.o = o; }, say(m) { log.push('say:' + m); }, close() { log.push('panel.close'); }, setBusy(on) { log.push('panel.busy:' + on); } };
  const result = { setBusy(on) { log.push('result.busy:' + on); }, notify(m) { log.push('notify:' + m); } };
  const s = createClipSession({
    recorder, panel, result, debug,
    canClip: () => true,
    prepare: prepare ?? (async () => { log.push('prepare'); await new Promise((r) => setTimeout(r, 5)); return { kind: 'blast', size: { w: 360, h: 640 }, overlay: OV }; }),
    share: () => ({ file: { name: 'a.mp4' }, text: 'T', label: '共有する' }),
    deliver: async () => { log.push('deliver'); await new Promise((r) => setTimeout(r, 5)); return 'downloaded'; },
  });
  return { s, log, panel, finish: (x) => resolveRec(x) };
}

test('I-2: 「動画で共有」の二度押し（同じ瞬間の 2 回）: 録画は一つだけ。結果画面はすぐ（await の前に）押せなくなり、知らせは開いたまま', async () => {
  const { s, log, finish } = fakeSession();
  const a = s.start({ reason: 'released' });
  expect(log.slice(0, 2)).toEqual(['result.busy:true', 'panel.start']); // await より前に（準備より先）
  const b = s.start({ reason: 'released' });
  expect(await b).toBe(null);
  await new Promise((r) => setTimeout(r, 20));
  expect(log.filter((x) => x === 'record')).toHaveLength(1);
  expect(log).not.toContain('panel.close');
  expect(log).not.toContain('result.busy:false');
  expect(log.some((x) => x.startsWith('notify'))).toBe(false);
  finish({ blob: { size: 5000, type: 'video/mp4' }, ext: 'mp4' });
  await a;
  expect(log).toContain('panel.done');
  // 録っている間・できたあとも、もう一つは始まらない
  expect(await s.start({ reason: 'released' })).toBe(null);
});

test('I-2: 準備（書体の読み込み）の間にやめたら、録画は始めずに戻す', async () => {
  const { s, log } = fakeSession();
  const a = s.start({ reason: 'released' });
  s.cancel();
  await a;
  expect(log).not.toContain('record');
  expect(log).toContain('panel.close');
  expect(log.at(-1)).toBe('result.busy:false');
  // また始められる
  const b = s.start({ reason: 'released' });
  expect(log.filter((x) => x === 'panel.start')).toHaveLength(2);
  s.cancel(); await b;
});

test('M7: 失敗・中身のない動画は、知らせを閉じて結果画面へ戻し、一言', async () => {
  const { s, log, finish } = fakeSession();
  const a = s.start({ reason: 'released' });
  await new Promise((r) => setTimeout(r, 20));
  finish({ error: 'empty' });
  await a;
  expect(log).toContain('panel.close');
  expect(log).toContain('result.busy:false');
  expect(log).toContain('notify:' + CLIP_NOTE.empty);
  // やめたときは何も言わない
  const k = fakeSession();
  const b = k.s.start({ reason: 'released' });
  await new Promise((r) => setTimeout(r, 20));
  k.finish({ cancelled: true });
  await b;
  expect(k.log.some((x) => x.startsWith('notify'))).toBe(false);
  expect(k.log).toContain('result.busy:false');
});

test('M3: 「共有する」の二度押しで、共有と保存の両方は走らない（一つ目が終わるまで二つ目は無視）', async () => {
  const { s, log, finish, panel } = fakeSession();
  const a = s.start({ reason: 'released' });
  await new Promise((r) => setTimeout(r, 20));
  finish({ blob: { size: 5000, type: 'video/mp4' }, ext: 'mp4' });
  await a;
  expect(log).toContain('panel.done');
  const o = panel.o;
  const p1 = o.deliver(), p2 = o.deliver();
  await Promise.all([p1, p2]);
  expect(log.filter((x) => x === 'deliver')).toHaveLength(1);
  expect(log).toContain('say:' + CLIP_NOTE.downloaded);
  // 終わったらまた押せる
  await o.deliver();
  expect(log.filter((x) => x === 'deliver')).toHaveLength(2);
});

test('M6: 録った動画を覚えておくのは ?debug のときだけ（数 MB を持ち続けない）', async () => {
  for (const debug of [false, true]) {
    const { s, finish } = fakeSession({ debug });
    const a = s.start({ reason: 'released' });
    await new Promise((r) => setTimeout(r, 20));
    finish({ blob: { size: 5000, type: 'video/mp4' }, ext: 'mp4' });
    await a;
    expect(s.last ? true : false).toBe(debug);
  }
});
