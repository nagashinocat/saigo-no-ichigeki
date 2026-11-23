import { test, expect } from 'vitest';
import { FINALE, SPACE_BEATS, createTimeline } from '../../src/render/finaleTimeline.js';
import { SPACE_LOOK } from '../../src/render/cinematic.js';
import { createSwell, SWELL } from '../../src/render/pacing.js';
import { CONFIG } from '../../src/config.js';
import { radiusFor } from '../../src/game/charge.js';
import { frontAt, phaseTimes, blastDuration } from '../../src/game/blast.js';

const AMOUNTS = [CONFIG.power.minRelease, 60, CONFIG.power.max];
const RADII = AMOUNTS.map((a) => radiusFor(a));
// R0b（持ち主 22:15）: 遠くの軍勢の後ろから。乗り手は半径の 0.46 の所、カメラはその 14 m 後ろ
const beatFor = (radius, k = 0.46) => createTimeline({ radius, riderDist: radius * k, firstDist: radius * k - 30, camDist: radius * k + 14 });
const lines = () => RADII.map((r) => beatFor(r));
// R0b の前（ガラスの一拍）の全体の長さ（乗り手 34 m、カメラ 37.7 m のときの end。秒）。新しい長さはこれ + 0.5 秒まで
const PREV_END = { [CONFIG.power.minRelease]: 11.150, 60: 11.803, [CONFIG.power.max]: 12.475 };

test('pacing（持ち主 22:18）: スローの進みは始まりから弾けるまで減らずに増え、弾けた瞬間に 1 へ跳ね、そのあと 1 のまま。爆発の時計はつながっている', () => {
  for (const radius of RADII) {
    const { creep } = phaseTimes(radius);
    const s = createSwell(creep);
    expect(s.sec).toBeGreaterThanOrEqual(SWELL.slowMin - 1e-9);
    expect(s.endRate).toBeLessThan(1);
    expect(s.startRate).toBeLessThan(0.25); // 始まりははっきりスロー
    expect(s.clock(s.sec)).toBeCloseTo(creep, 9);
    let prevR = 0, prevB = 0;
    for (let x = 0; x <= s.sec + 2; x += 1 / 240) {
      const r = s.rate(x), b = s.clock(x);
      expect(r).toBeGreaterThanOrEqual(prevR - 1e-12);
      expect(b).toBeGreaterThanOrEqual(prevB - 1e-12);
      if (x > 1 / 240 && Math.abs(x - s.sec) > 1 / 240) expect((b - prevB) * 240).toBeCloseTo((r + prevR) / 2, 2);
      prevR = r; prevB = b;
      expect(s.inverse(b)).toBeCloseTo(x, 6);
    }
    expect(s.rate(s.sec + 0.01)).toBe(1);
  }
});

test('段の順番: 手 → 白 → スローでふくらむ（swell）→ 弾けて光の壁が乗り手とカメラを飲む（race）→ 追う → 宇宙 → 押しつぶれる → 無音 → 地鳴り', () => {
  for (const tl of lines()) {
    const order = [tl.hands, tl.white, tl.burst, tl.engulf, tl.camHit, tl.snap, tl.chaseEnd, tl.domeEnd, tl.flatten, tl.lineEnd, tl.rumble, tl.end];
    for (let i = 1; i < order.length; i++) expect(order[i], `i=${i}`).toBeGreaterThan(order[i - 1]);
    expect(tl.erupt).toBe(tl.white);
    expect(tl.resume).toBe(tl.burst); // 爆発の音は弾けた瞬間に開く
    expect(tl.stage(0.1)).toBe('hands');
    expect(tl.stage(0.4)).toBe('white');
    expect(tl.stage(tl.white + 0.01)).toBe('swell');
    expect(tl.stage(tl.burst + 0.01)).toBe('race');
    expect(tl.stage(tl.snap + 0.01)).toBe('chase');
    expect(tl.stage(tl.end + 0.1)).toBe('done');
    // R1i: 宇宙からあとの秒は宇宙の段のもの（最大は FINALE のまま。tests/render/spaceTier.test.js）
    const B = { ...FINALE, ...SPACE_BEATS[tl.tier] };
    expect(tl.flatten - tl.chaseEnd).toBeGreaterThanOrEqual(B.spaceMin - 1e-9);
    expect(tl.domeEnd - tl.chaseEnd).toBeGreaterThanOrEqual(B.domeMin - 1e-9);
    expect(tl.flatten - tl.domeEnd).toBeGreaterThanOrEqual(B.spaceHold - 1e-9);
  }
});

test('全体の長さは前（ガラスの一拍）+ 0.5 秒まで。短くしすぎない（9 秒以上）', () => {
  AMOUNTS.forEach((a, i) => {
    for (const k of [0.36, 0.46, 0.56]) {
      const tl = beatFor(RADII[i], k);
      expect(tl.end, `amount ${a} k ${k}`).toBeLessThanOrEqual(PREV_END[a] + 0.5 + 1e-9);
      // R1i: 9 秒以上は最大の段。中・小は宇宙からあとを段の分だけ短くする（持ち主 10:29「しょうもないやつ」）が、宇宙へ切り替わるまでは同じ
      const B = { ...FINALE, ...SPACE_BEATS[tl.tier] };
      const cut = (FINALE.domeMin - B.domeMin) + (FINALE.flattenSec - B.flattenSec) + (FINALE.thinSec - B.thinSec) + (FINALE.silenceSec - B.silenceSec) + (FINALE.rumbleHold - B.rumbleHold);
      expect(tl.end).toBeGreaterThanOrEqual(9 - cut - 1e-9);
      if (tl.tier === 'max') expect(tl.end).toBeGreaterThanOrEqual(9);
    }
  });
});

test('スローの間（白が晴れてから弾けるまで）は、じわじわ期をちょうど見せる: 白が晴れた瞬間に爆発が始まり、弾ける瞬間にじわじわ期が終わる', () => {
  for (const tl of lines()) {
    const { creep } = phaseTimes(tl.radius);
    expect(tl.blastClock(tl.white)).toBeCloseTo(0, 9);
    expect(tl.blastClock(tl.burst)).toBeCloseTo(creep, 9);
    expect(tl.burst - tl.white).toBeGreaterThanOrEqual(SWELL.slowMin - 1e-9);
    // 弾けてからは現実の速さで、乗り手とカメラが飲まれる（乗り手はじわじわ期の光の外にいる）
    expect(tl.front(tl.burst)).toBeLessThan(tl.firstDist);
    expect(tl.front(tl.engulf)).toBeCloseTo(tl.riderDist, 3);
    expect(tl.front(tl.camHit)).toBeCloseTo(tl.camDist, 3);
    expect(tl.front(tl.snap)).toBeGreaterThan(tl.camDist);
    expect(tl.snap - tl.camHit).toBeGreaterThanOrEqual(FINALE.snapLag - 1e-9);
    // 弾けてから飲まれるまで、光の壁が街を走るのが見える（0.25 秒以上）。一気に（2 秒以内）
    expect(tl.engulf - tl.burst).toBeGreaterThan(0.25);
    expect(tl.snap - tl.burst).toBeLessThan(2);
  }
});

test('見せ方の時間の進み（持ち主 22:18）: 爆発が始まってから弾けるまで減らずに増え、弾けたあと（追う・見せる期まで）1 のまま下がらない。止まったような間がない', () => {
  for (const tl of lines()) {
    const dt = 1 / 240;
    let prev = 0, minAfter = Infinity;
    for (let t = tl.white + dt; t < tl.frontDone - dt; t += dt) {
      const r = tl.timeScale(t);
      expect(r, `t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(prev - 1e-9);
      // 数値の微分と一致する
      if (Math.abs(t - tl.burst) > dt) expect((tl.blastClock(t + dt) - tl.blastClock(t)) / dt).toBeCloseTo((r + tl.timeScale(t + dt)) / 2, 2);
      if (t > tl.burst) minAfter = Math.min(minAfter, r);
      prev = r;
    }
    expect(minAfter).toBe(1);
    expect(tl.timeScale(tl.white + 0.01)).toBeLessThan(0.25);
    // 古い「ほとんど止まった一拍」（0.012）のような間はない: スローの間も 0.1 より遅くならない
    expect(tl.timeScale(tl.white + 1e-6)).toBeGreaterThan(0.1);
  }
});

test('見せ場: 最大の一発は、弾けたあと光の壁がゆっくり（150 m/s 以下で）街を飲み進むのが追う間に 1.2 秒以上見え、宇宙へ切り替わってもまだ進んでいる', () => {
  const tl = beatFor(radiusFor(CONFIG.power.max));
  const dt = 1 / 120, speed = (t) => (tl.front(t + dt) - tl.front(t)) / dt;
  let slowChase = 0, peak = 0;
  for (let t = tl.burst; t < tl.chaseEnd; t += dt) {
    const v = speed(t);
    peak = Math.max(peak, v);
    if (t > tl.snap && v > 20 && v < 150) slowChase += dt;
  }
  expect(slowChase).toBeGreaterThanOrEqual(1.2);
  expect(peak).toBeGreaterThan(800); // 弾けた瞬間は一気に
  expect(tl.frontDone - tl.chaseEnd).toBeGreaterThanOrEqual(0.5);
  expect(speed(tl.chaseEnd)).toBeGreaterThan(20);
});

test('ゲームの時計: 白の間に freezeSec を進め、戻らず、gameDt を足し合わせると gameClock。前線は宇宙の半球がふくらみきる時刻までに半径に届く', () => {
  for (const tl of lines()) {
    expect(tl.gameClock(0)).toBeCloseTo(0, 9);
    expect(tl.gameClock(tl.hands)).toBeCloseTo(0, 9);
    expect(tl.gameClock(tl.white)).toBeCloseTo(CONFIG.cinematic.freezeSec, 9);
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
    expect(tl.blastClock(tl.frontDone)).toBeCloseTo(blastDuration(tl.radius), 6);
    expect(frontAt(tl.blastClock(tl.frontDone - 0.05), tl.radius)).toBeLessThan(tl.radius);
    expect(tl.domeEnd).toBeGreaterThanOrEqual(tl.frontDone - 1e-9);
    if (tl.chaseEnd - tl.snap > FINALE.chaseMin + 1e-6) expect(tl.front(tl.chaseEnd) / tl.radius).toBeCloseTo(FINALE.spaceFront, 3);
    else expect(tl.front(tl.chaseEnd) / tl.radius).toBeGreaterThanOrEqual(FINALE.spaceFront - 1e-9);
  }
});

test('乗り手やカメラの距離がおかしくても（近すぎる・半径の外）時刻表は壊れない', () => {
  for (const radius of RADII) {
    for (const [rd, cd] of [[0, 0], [3, 2], [radius * 2, radius * 3], [null, null]]) {
      const tl = createTimeline({ radius, riderDist: rd, camDist: cd });
      expect(Number.isFinite(tl.end)).toBe(true);
      expect(tl.engulf).toBeGreaterThan(tl.burst);
      expect(tl.camHit).toBeGreaterThan(tl.engulf);
      expect(tl.snap).toBeGreaterThan(tl.camHit);
    }
  }
});

test('宇宙の半球はゆっくりふくらむ: domeAt は chaseEnd で 0・domeEnd で 1、戻らず、街の前線の残りより先に進まず、ふくらむ速さは 1 秒あたり 0.8 以下', () => {
  for (const tl of lines()) {
    expect(tl.domeAt(tl.chaseEnd)).toBe(0);
    expect(tl.domeAt(tl.domeEnd)).toBe(1);
    const dt = 1 / 120;
    let prev = 0, maxRate = 0;
    for (let t = tl.chaseEnd + dt; t <= tl.domeEnd + 1e-9; t += dt) {
      const p = tl.domeAt(t);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      maxRate = Math.max(maxRate, (p - prev) / dt);
      if (tl.radius - tl.fCut > 1e-6) expect(p).toBeLessThanOrEqual((tl.front(t) - tl.fCut) / (tl.radius - tl.fCut) + 1e-9);
      prev = p;
    }
    // R1i: 画面の上での速さ（最大の半球の大きさに対して）。中・小は半球が小さい分だけ、割合では速くふくらむ（小は「ぽっ」と）
    expect(maxRate * SPACE_LOOK[tl.tier].dome).toBeLessThanOrEqual(0.8);
  }
});
