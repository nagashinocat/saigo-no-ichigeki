import { test, expect } from 'vitest';
import { guardRingLook, GUARD_RING } from '../../src/render/guardRing.js';
import { guardRecipe } from '../../src/audio/cues.js';

// Fix round 1（見直し Important 5「払うの守りが遊ぶ人に見えない」）: 守りの間は主人公のまわりに薄い輪（ゆらめく盾）を出し、弾いた瞬間は脈打つ。
// 守りが切れたら消える。弾いた音は、柔らかい短い「キン」（高い 2 つの音と、ごく短い風）
test('Fix round 1: 守りの輪は守りの間だけ見え、残りが減るほど薄く、弾いた直後は太く明るい', () => {
  const off = guardRingLook({ left: 0, total: 2, sinceHit: Infinity, t: 0 });
  expect(off.visible).toBe(false);
  const a = guardRingLook({ left: 1.8, total: 2, sinceHit: Infinity, t: 0 });
  const b = guardRingLook({ left: 0.3, total: 2, sinceHit: Infinity, t: 0 });
  expect(a.visible && b.visible).toBe(true);
  expect(a.alpha).toBeGreaterThan(b.alpha);
  expect(b.alpha).toBeGreaterThan(0.05); // 切れる直前でも見える
  const hit = guardRingLook({ left: 1, total: 2, sinceHit: 0.02, t: 0 });
  const calm = guardRingLook({ left: 1, total: 2, sinceHit: Infinity, t: 0 });
  expect(hit.alpha).toBeGreaterThan(calm.alpha);
  expect(hit.radius).toBeGreaterThan(calm.radius);
  // ゆらめき（時刻で少し動く）
  const t1 = guardRingLook({ left: 1, total: 2, sinceHit: Infinity, t: 0.1 }).alpha, t2 = guardRingLook({ left: 1, total: 2, sinceHit: Infinity, t: 0.3 }).alpha;
  expect(Math.abs(t1 - t2)).toBeGreaterThan(1e-3);
  expect(calm.radius).toBeCloseTo(GUARD_RING.radius, 6);
});

test('Fix round 1: 弾く音は柔らかい（短く小さい）', () => {
  const r = guardRecipe();
  expect(r.tones.length).toBeGreaterThanOrEqual(1);
  const peak = r.tones.reduce((s, x) => s + x.gain, 0) + r.air.gain;
  expect(peak).toBeLessThan(0.3);
  for (const x of r.tones) expect(x.dur).toBeLessThanOrEqual(0.3);
});
