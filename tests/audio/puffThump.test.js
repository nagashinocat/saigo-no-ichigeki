import { test, expect, afterEach } from 'vitest';
import { createAudio, PUFF_THUMP } from '../../src/audio/audio.js';
import { fakeCtx } from './fakeAudioCtx.js';

// 持ち主 2026-11-24「払うを強く」: 払った瞬間の衝撃波に、重い低音の一打（puffThump）。世界の音（master）を通る（演出の無音に従う）。
// 弾いた数が多いほど少し強い。いちばん低い周波数は 60 Hz 以下、長さは 0.4 秒以上（守りの弾く音 guardCue より低く長い）
afterEach(() => { delete globalThis.window; });
function rig() {
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio({ nav: {}, later: () => {} });
  audio.unlock();
  return { ctx, audio, master: ctx.gains[0] };
}
// master までたどれるか
const reaches = (ctx, from, to) => { const seen = new Set(); const go = (n) => { if (n === to) return true; if (seen.has(n)) return false; seen.add(n); return ctx.links.filter(([a]) => a === n).some(([, b]) => go(b)); }; return go(from); };

test('2026-11-24: puffThump は低く重い一打（60 Hz 以下まで下がる正弦波 + 低いざらつき）を master へ。弾いた数が多いほど強い', () => {
  expect(PUFF_THUMP.f1).toBeLessThanOrEqual(60);
  expect(PUFF_THUMP.dur).toBeGreaterThanOrEqual(0.4);
  const { ctx, audio, master } = rig();
  const o0 = ctx.oscs.length, s0 = ctx.sources.length;
  audio.puffThump({ hits: 0, pan: 0 });
  const oscs = ctx.oscs.slice(o0), srcs = ctx.sources.slice(s0);
  expect(oscs.length).toBeGreaterThanOrEqual(1);
  expect(srcs.length).toBeGreaterThanOrEqual(1);
  for (const n of oscs) { expect(reaches(ctx, n, master)).toBe(true); expect(n.stopT).toBeGreaterThan(n.startT + PUFF_THUMP.dur - 0.01); }
  for (const n of srcs) { expect(reaches(ctx, n, master)).toBe(true); expect(n.stopT).toBeGreaterThan(n.startT + PUFF_THUMP.noise.dur - 0.01); }
  const peak = (k0) => Math.max(...ctx.gains.slice(k0).map((g) => Math.max(...[0.01, 0.05, 0.1].map((dt) => g.gain.at(ctx.currentTime + dt)))));
  const g0 = ctx.gains.length; audio.puffThump({ hits: 0 }); const weak = peak(g0);
  const g1 = ctx.gains.length; audio.puffThump({ hits: 8 }); const strong = peak(g1);
  expect(strong).toBeGreaterThan(weak);
});

test('2026-11-24: 演出の無音の間（silence）でも呼べて、世界の音の門で黙る（鳴らさないのではなく master が 0）', () => {
  const { ctx, audio, master } = rig();
  audio.silence();
  audio.puffThump({ hits: 3 });
  expect(master.gain.at(ctx.currentTime + 0.1)).toBe(0);
});
