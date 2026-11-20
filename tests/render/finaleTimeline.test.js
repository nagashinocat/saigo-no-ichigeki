import { test, expect } from 'vitest';
import { FINALE, createTimeline, perceivedTime, timeScaleAt } from '../../src/render/finaleTimeline.js';
import { CONFIG } from '../../src/config.js';
import { radiusFor } from '../../src/game/charge.js';
import { frontAt, phaseTimes, blastDuration } from '../../src/game/blast.js';

const RADII = [radiusFor(CONFIG.power.minRelease), radiusFor(60), radiusFor(CONFIG.power.max)];
const lines = () => RADII.map((radius) => createTimeline({ radius, hitDist: 18 }));

test('段の順番と長さ: 全体は 10〜12.8 秒（前の 12.8 秒より長くしない）、止まった一拍は 2.5 秒以上、宇宙のカットは 2.3 秒以上', () => {
  for (const tl of lines()) {
    const order = [tl.hands, tl.white, tl.contact, tl.beatEnd, tl.snap, tl.chaseEnd, tl.domeEnd, tl.flatten, tl.lineEnd, tl.rumble, tl.end];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(tl.end).toBeGreaterThanOrEqual(10);
    expect(tl.end).toBeLessThanOrEqual(12.8);
    expect(tl.beatEnd - tl.contact).toBeGreaterThanOrEqual(2.5);
    expect(tl.flatten - tl.chaseEnd).toBeGreaterThanOrEqual(2.3 - 1e-9);
    // 宇宙の半球は 1.4 秒以上かけてふくらみ、ふくらみきってから押しつぶされるまで spaceHold 秒見せる
    expect(tl.domeEnd - tl.chaseEnd).toBeGreaterThanOrEqual(FINALE.domeMin - 1e-9);
    expect(tl.flatten - tl.domeEnd).toBeGreaterThanOrEqual(FINALE.spaceHold - 1e-9);
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
    // 宇宙へ切り替わるのは、前線が半径の spaceFront に来たとき（小さな一発は追われる最短の秒のあと）
    if (tl.chaseEnd - tl.snap > FINALE.chaseMin + 1e-6) expect(tl.front(tl.chaseEnd) / tl.radius).toBeCloseTo(FINALE.spaceFront, 3);
    else expect(tl.front(tl.chaseEnd) / tl.radius).toBeGreaterThanOrEqual(FINALE.spaceFront);
    // 前線は宇宙の半球がふくらみきる時刻（domeEnd）までに半径に届いて止まる（ゲームの一発は押しつぶされる前に終わる）
    expect(tl.blastClock(tl.frontDone)).toBeCloseTo(blastDuration(tl.radius), 6);
    expect(frontAt(tl.blastClock(tl.frontDone - 0.05), tl.radius)).toBeLessThan(tl.radius);
    expect(tl.domeEnd).toBeGreaterThanOrEqual(tl.frontDone - 1e-9);
    expect(tl.blastClock(tl.flatten)).toBeGreaterThanOrEqual(blastDuration(tl.radius));
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

test('見せ場: 最大の一発は、弾けたあと光の壁がゆっくり（150 m/s 以下で）街を飲み進むのが、追う間に 1.2 秒以上・宇宙の半球で 1 秒以上見え、前より長く広がる', () => {
  const tl = createTimeline({ radius: radiusFor(CONFIG.power.max), hitDist: 30 });
  const dt = 1 / 120, speed = (t) => (tl.front(t + dt) - tl.front(t)) / dt;
  let slowChase = 0, peak = 0;
  for (let t = tl.snap; t < tl.chaseEnd; t += dt) {
    const v = speed(t);
    peak = Math.max(peak, v);
    if (v > 20 && v < 150) slowChase += dt;
  }
  expect(slowChase).toBeGreaterThanOrEqual(1.2);
  // 弾けた直後はそれより一気に速い（弾ける期のはじめが最速）
  expect(peak).toBeGreaterThan(250);
  expect(speed(tl.snap + 0.01)).toBeGreaterThan(speed(tl.snap + 1.0) * 1.6);
  // 宇宙へ切り替わっても前線はまだ進んでいて、半球がふくらみきる時刻に止まる
  expect(tl.frontDone - tl.chaseEnd).toBeGreaterThanOrEqual(1);
  expect(speed(tl.chaseEnd)).toBeGreaterThan(20);
  // 弾けてから止まるまで: 前（1.75 秒）の 1.8 倍以上
  expect(tl.frontDone - tl.snap).toBeGreaterThanOrEqual(1.75 * 1.8);
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
