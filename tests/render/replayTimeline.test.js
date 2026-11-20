import { test, expect } from 'vitest';
import { createReplayTimeline, createWarp, REPLAY } from '../../src/render/replayTimeline.js';
import { radiusFor } from '../../src/game/charge.js';
import { blastDuration, frontAt } from '../../src/game/blast.js';
import { CONFIG } from '../../src/config.js';

const RADII = [radiusFor(CONFIG.power.minRelease), radiusFor(50), CONFIG.radius.max];
const streetDistFor = (r) => Math.min(170, Math.max(40, 0.4 * r));

test('createWarp: 0 → 1 へ単調に進み、速さの折れ線どおりに進む（遅いところは少ししか進まない）', () => {
  const w = createWarp([[0, 1], [0.5, 1], [0.6, 0.01], [1, 0.01]]);
  expect(w.at(0)).toBe(0);
  expect(w.at(1)).toBeCloseTo(1, 12);
  let prev = -1;
  for (let u = 0; u <= 1; u += 0.01) { const v = w.at(u); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  expect(w.at(1) - w.at(0.6)).toBeLessThan(0.02);
  expect(w.rate(0.25)).toBeGreaterThan(w.rate(0.9) * 50);
});

test('爆発の時計はリプレイの間ずっと単調に進み、カットの境目でつながる（跳ばない）', () => {
  for (const radius of RADII) {
    const tl = createReplayTimeline({ radius, streetDist: streetDistFor(radius) });
    expect(tl.cuts.map((c) => c.name)).toEqual(['street', 'side', 'top', 'hero']);
    let prev = -1;
    for (let t = 0; t <= tl.end + 0.5; t += REPLAY.tick) {
      const b = tl.blastAt(t);
      expect(b).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = b;
    }
    for (const c of tl.cuts.slice(1)) {
      expect(Math.abs(tl.blastAt(c.t0 + 1e-6) - tl.blastAt(c.t0 - 1e-6))).toBeLessThan(0.002);
    }
  }
});

test('street: 光の壁はカメラの数 m 手前まで来て、終わる前にほとんど止まった時間がある', () => {
  for (const radius of RADII) {
    const d = streetDistFor(radius);
    const tl = createReplayTimeline({ radius, streetDist: d });
    const c = tl.cut('street');
    const fEnd = tl.frontAt(c.t1 - 1e-6);
    expect(fEnd).toBeLessThan(d);
    expect(fEnd).toBeGreaterThan(Math.min(d - 6, radius * 0.8 - 1));
    // 始まりは、じわじわ期の光（まだ通りに届いていない）
    expect(tl.frontAt(c.t0)).toBeLessThan(d * 0.4);
    // 壁が目の前に来た後半: 0.4 秒以上、前線は 1 秒あたり 30 m 未満でしか動かない
    let slow = 0;
    for (let t = c.t0 + c.dur * 0.6; t < c.t1; t += REPLAY.tick) if ((tl.frontAt(t + REPLAY.tick) - tl.frontAt(t)) / REPLAY.tick < 30) slow += REPLAY.tick;
    expect(slow).toBeGreaterThan(0.4);
  }
});

test('side は前線が半径の大半まで、top は届ききって球が消えていくところ、hero はその先。全体は 9〜13 秒', () => {
  for (const radius of RADII) {
    const tl = createReplayTimeline({ radius, streetDist: streetDistFor(radius) });
    const total = blastDuration(radius);
    expect(tl.frontAt(tl.cut('side').t1 - 1e-6)).toBeGreaterThan(0.8 * radius);
    expect(tl.blastAt(tl.cut('top').t1 - 1e-6)).toBeGreaterThan(total);
    expect(tl.blastAt(tl.end)).toBeGreaterThan(total + CONFIG.blast.fadeSec);
    expect(tl.end).toBeGreaterThan(9);
    expect(tl.end).toBeLessThan(13);
    expect(tl.cutAt(0.1).name).toBe('intro');
    expect(tl.cutAt(tl.end + 0.1).name).toBe('done');
    expect(tl.bStart).toBeGreaterThan(0);
    expect(frontAt(tl.bStart, radius)).toBeLessThan(0.1 * radius);
  }
});
