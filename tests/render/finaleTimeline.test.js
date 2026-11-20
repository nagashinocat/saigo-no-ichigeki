import { test, expect } from 'vitest';
import { FINALE, createTimeline, perceivedTime, timeScaleAt } from '../../src/render/finaleTimeline.js';
import { CONFIG } from '../../src/config.js';
import { radiusFor } from '../../src/game/charge.js';
import { frontAt, phaseTimes, blastDuration } from '../../src/game/blast.js';

const RADII = [radiusFor(CONFIG.power.minRelease), radiusFor(60), radiusFor(CONFIG.power.max)];
const lines = () => RADII.map((radius) => createTimeline({ radius, hitDist: 18 }));

test('段の順番と長さ: 全体は 10〜14 秒、止まった一拍は 2.5 秒以上、宇宙のカットは 3 秒以上', () => {
  for (const tl of lines()) {
    const order = [tl.hands, tl.white, tl.contact, tl.beatEnd, tl.snap, tl.chaseEnd, tl.flatten, tl.lineEnd, tl.rumble, tl.end];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(tl.end).toBeGreaterThanOrEqual(10);
    expect(tl.end).toBeLessThanOrEqual(14);
    expect(tl.beatEnd - tl.contact).toBeGreaterThanOrEqual(2.5);
    expect(tl.flatten - tl.chaseEnd).toBeGreaterThanOrEqual(3);
    expect(tl.stage(0.1)).toBe('hands');
    expect(tl.stage(0.4)).toBe('white');
    expect(tl.stage(2)).toBe('beat');
    expect(tl.stage(tl.end + 0.1)).toBe('done');
    for (const b of tl.beats) expect(tl.stage(b)).toBe('beat');
  }
});

test('ゲームの時計: 白の間に前線がビルの手前まで進み、contact で前線がビルに届き、一拍の間は crawl m しか進まない', () => {
  for (const tl of lines()) {
    expect(tl.gameClock(0)).toBeCloseTo(0, 9);
    expect(tl.gameClock(tl.hands)).toBeCloseTo(0, 9);
    expect(tl.blastClock(tl.white)).toBeCloseTo(tl.b0, 9);
    expect(tl.front(tl.white)).toBeCloseTo(18 * FINALE.approachFrac, 3);
    expect(tl.front(tl.contact)).toBeCloseTo(18, 3);
    expect(tl.front(tl.beatEnd) - tl.front(tl.contact)).toBeCloseTo(FINALE.crawl, 1);
    // 時間が戻った瞬間には、じわじわ期を過ぎている（弾ける）
    expect(tl.blastClock(tl.snap)).toBeGreaterThanOrEqual(phaseTimes(tl.radius).creep - 1e-9);
    // 追う間に前線は半径に届く（ゲームの一発は終わる）
    expect(tl.blastClock(tl.chaseEnd)).toBeGreaterThanOrEqual(blastDuration(tl.radius));
    expect(frontAt(tl.blastClock(tl.chaseEnd - FINALE.chaseTail + 1e-6), tl.radius)).toBeCloseTo(tl.radius, 0);
  }
});

test('時間が戻った直後は burstRate の速さから、burstRamp 秒で現実の速さになる', () => {
  for (const tl of lines()) {
    const h = 1e-3;
    const rate = (t) => (tl.blastClock(t + h) - tl.blastClock(t)) / h;
    expect(rate(tl.snap + 0.002)).toBeCloseTo(FINALE.burstRate, 1);
    expect(rate(tl.snap + FINALE.burstRamp + 0.05)).toBeCloseTo(1, 5);
    expect(tl.chaseEnd - tl.snap).toBeLessThan(3.2);
  }
});

test('ゲームの時計は戻らず、gameDt を足し合わせると gameClock になる', () => {
  for (const tl of lines()) {
    let sum = 0, prev = 0;
    for (let t = 1 / 60; t <= tl.end; t += 1 / 60) {
      const d = tl.gameDt(t - 1 / 60, t);
      expect(d).toBeGreaterThanOrEqual(0);
      sum += d;
      const g = tl.gameClock(t);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = g;
    }
    expect(sum).toBeCloseTo(tl.gameClock(Math.floor(tl.end * 60) / 60), 6);
  }
});

test('体感時間: 白が晴れると現実と同じ、contact でほぼ止まり、snap で戻る（連続で、戻らない）', () => {
  expect(timeScaleAt(FINALE.white)).toBe(1);
  expect(timeScaleAt(FINALE.contact + 0.01)).toBe(FINALE.slowRate);
  expect(timeScaleAt(FINALE.beatEnd + 0.01)).toBe(1);
  expect(FINALE.slowRate).toBeLessThan(0.02);
  let prev = -Infinity;
  const dt = 1 / 600;
  for (let t = 0; t < 6; t += dt) {
    const p = perceivedTime(t);
    expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
    // 積分の形が数値の積分と合う
    if (t > FINALE.white + dt) expect(p - prev).toBeCloseTo(timeScaleAt(t) * dt, 4);
    prev = p;
  }
  expect(perceivedTime(FINALE.white)).toBe(0);
  // 一拍のあいだ（2.7 秒）に、体感では 0.05 秒も進まない
  expect(perceivedTime(FINALE.beatEnd) - perceivedTime(FINALE.contact)).toBeLessThan(0.05);
});

test('ビルが遠くても近くても（爆発の半径より先でも）時刻表は壊れない', () => {
  for (const hitDist of [0, 3, 40, 2000]) {
    const tl = createTimeline({ radius: RADII[0], hitDist });
    expect(Number.isFinite(tl.end)).toBe(true);
    expect(tl.bEnd).toBeGreaterThanOrEqual(tl.bHit);
    expect(tl.bHit).toBeGreaterThanOrEqual(tl.b0);
  }
});
