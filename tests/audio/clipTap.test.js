import { test, expect, afterEach } from 'vitest';
import { createAudio } from '../../src/audio/audio.js';

// R4（縦動画）: 録画の音は、すべての音がまとまるリミッターの出口（一番上の大きさ top の手前）を MediaStreamDestination へ写して取る。
// 写しをつないでも外しても、スピーカーへの道と大きさは変わらない（プレイヤーが聞く音を変えない）
function param(v) { const p = { value: v, setValueAtTime() { return p; }, linearRampToValueAtTime() { return p; }, exponentialRampToValueAtTime() { return p; }, setTargetAtTime() { return p; }, cancelScheduledValues() { return p; }, cancelAndHoldAtTime() { return p; } }; return p; }
function fakeCtx() {
  const ctx = { state: 'running', currentTime: 1, sampleRate: 8000, destination: { name: 'destination' }, links: [], cuts: [], dests: [] };
  const node = (extra) => { const n = { connect(to) { ctx.links.push([n, to]); return to; }, disconnect(to) { ctx.cuts.push([n, to]); }, ...extra }; return n; };
  Object.assign(ctx, {
    resume() { return Promise.resolve(); },
    createGain() { return node({ gain: param(1) }); },
    createBiquadFilter() { return node({ type: '', frequency: param(350), Q: param(1) }); },
    createDynamicsCompressor() { return node({ kind: 'limiter', threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0) }); },
    createStereoPanner() { return node({ pan: param(0) }); },
    createWaveShaper() { return node({ curve: null }); },
    createOscillator() { return node({ frequency: param(440), start() {}, stop() {} }); },
    createBuffer(ch, n, sr) { const d = new Float32Array(n); return { duration: n / sr, getChannelData: () => d }; },
    createBufferSource() { return node({ buffer: null, playbackRate: param(1), start() {}, stop() {} }); },
    createMediaStreamDestination() { const d = node({ stream: { id: 'clip-audio', getAudioTracks: () => [{ kind: 'audio' }] } }); ctx.dests.push(d); return d; },
  });
  return ctx;
}
afterEach(() => { delete globalThis.window; });

test('tap: リミッターの出口を MediaStreamDestination へ写す。release で外す。スピーカーへの道は変わらない', () => {
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio({ nav: {}, later: () => {} });
  expect(audio.tap()).toBe(null); // 鳴らせるようになる前
  audio.unlock();
  const before = ctx.links.length;
  const toSpeaker = ctx.links.filter(([, to]) => to === ctx.destination);
  const tap = audio.tap();
  expect(tap.stream.id).toBe('clip-audio');
  const added = ctx.links.slice(before);
  expect(added).toHaveLength(1);
  expect(added[0][0].kind).toBe('limiter'); // すべての音（世界の音・演出の音・瓦礫・BGM）がまとまる所
  expect(added[0][1]).toBe(ctx.dests[0]);
  expect(ctx.links.filter(([, to]) => to === ctx.destination)).toEqual(toSpeaker);
  tap.release();
  expect(ctx.cuts).toEqual([[added[0][0], ctx.dests[0]]]);
  tap.release(); // 二度目は何もしない
  expect(ctx.cuts).toHaveLength(1);
});

test('tap: MediaStreamDestination の無いブラウザでは null（音なしで録る）', () => {
  const ctx = fakeCtx();
  delete ctx.createMediaStreamDestination;
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio({ nav: {}, later: () => {} });
  audio.unlock();
  expect(audio.tap()).toBe(null);
});
