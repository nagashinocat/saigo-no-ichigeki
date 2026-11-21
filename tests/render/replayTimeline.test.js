import { test, expect } from 'vitest';
import { createReplayTimeline, REPLAY } from '../../src/render/replayTimeline.js';
import { radiusFor } from '../../src/game/charge.js';
import { blastDuration, frontAt, phaseTimes } from '../../src/game/blast.js';
import { CONFIG } from '../../src/config.js';

const RADII = [radiusFor(CONFIG.power.minRelease), radiusFor(50), CONFIG.radius.max];
const streetDistFor = (r) => Math.min(170, Math.max(40, 0.4 * r));
const lines = () => RADII.map((radius) => createReplayTimeline({ radius, streetDist: streetDistFor(radius) }));

test('爆発の時計はリプレイの間ずっと単調に進み、カットの境目でつながる（跳ばない）', () => {
  for (const tl of lines()) {
    expect(tl.cuts.map((c) => c.name)).toEqual(['street', 'side', 'top', 'hero']);
    let prev = -1;
    for (let t = 0; t <= tl.end + 0.5; t += REPLAY.tick) {
      const b = tl.blastAt(t);
      expect(b).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = b;
    }
    for (const c of tl.cuts.slice(1)) expect(Math.abs(tl.blastAt(c.t0 + 1e-6) - tl.blastAt(c.t0 - 1e-6))).toBeLessThan(0.002);
  }
});

test('pacing（持ち主 22:18）: 見せ方の時間の進みは、爆発が始まってから弾けるまで減らずに増え（スロー）、弾けたあと終わりまで 1 のまま（止まったような間がない）', () => {
  for (const tl of lines()) {
    const { creep } = phaseTimes(tl.radius);
    expect(tl.blastAt(tl.intro)).toBe(0);
    expect(tl.blastAt(tl.burst)).toBeCloseTo(creep, 9);
    expect(tl.timeScale(tl.intro + 0.01)).toBeLessThan(0.25);
    expect(tl.burst).toBeLessThan(tl.cut('street').t1); // 弾けるのは street の中
    const dt = REPLAY.tick / 4;
    let prev = 0, minAfter = Infinity;
    for (let t = tl.intro + dt; t < tl.end - dt; t += dt) {
      const r = tl.timeScale(t);
      expect(r, `t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(prev - 1e-9);
      if (t > tl.burst) minAfter = Math.min(minAfter, r);
      if (Math.abs(t - tl.burst) > dt) expect((tl.blastAt(t + dt) - tl.blastAt(t)) / dt).toBeCloseTo((r + tl.timeScale(t + dt)) / 2, 2);
      prev = r;
    }
    expect(minAfter).toBe(1);
  }
});

test('street: スローでふくらみ、弾けた光の壁はカメラの数 m 手前まで来て（呑まれて白）、そこで終わる', () => {
  for (const tl of lines()) {
    const d = streetDistFor(tl.radius);
    const c = tl.cut('street');
    const fEnd = tl.frontAt(c.t1 - 1e-6);
    expect(fEnd).toBeLessThan(d);
    expect(fEnd).toBeGreaterThan(Math.min(d - 6, tl.radius * 0.8 - 1));
    expect(tl.frontAt(c.t0)).toBe(0);
    expect(c.dur).toBeGreaterThan(1.7);
  }
});

test('side は前線が半径の大半まで、top は届ききって球が消えていくところ、hero はその先。どのカットも 1 秒以上、全体は 7〜12 秒', () => {
  for (const tl of lines()) {
    const total = blastDuration(tl.radius);
    expect(tl.frontAt(tl.cut('side').t1 - 1e-6)).toBeGreaterThan(0.8 * tl.radius);
    expect(tl.blastAt(tl.cut('top').t1 - 1e-6)).toBeGreaterThan(total);
    expect(tl.blastAt(tl.end)).toBeGreaterThan(total + CONFIG.blast.fadeSec);
    for (const c of tl.cuts) expect(c.dur, c.name).toBeGreaterThan(1);
    expect(tl.end).toBeGreaterThan(7);
    expect(tl.end).toBeLessThan(12);
    expect(tl.cutAt(0.1).name).toBe('intro');
    expect(tl.cutAt(tl.end + 0.1).name).toBe('done');
    expect(tl.bStart).toBe(0);
    expect(frontAt(tl.blastAt(tl.intro + 0.3), tl.radius)).toBeLessThan(0.1 * tl.radius);
  }
});
