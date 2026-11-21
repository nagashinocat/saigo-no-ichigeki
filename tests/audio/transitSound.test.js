import { test, expect } from 'vitest';
import { transitMix, distGain, TRANSIT_SOUND } from '../../src/audio/transitSound.js';

// S8: 電車と高速の音は画面の出来事（一番近い車両・高速の一番近い点）の距離と左右から決まり、BGM の下でかすか
const toCam = (p) => ({ x: p.x, z: p.z }); // カメラが原点で -z を向いているとする

test('近いほど大きく、遠い（far より先）と鳴らない。どれも上限（max）以下', () => {
  const near = transitMix({ train: { x: 0, z: -30, dist: 30, speed: 21 }, highway: { x: 0, z: -25, dist: 25 } }, toCam);
  const far = transitMix({ train: { x: 0, z: -400, dist: 400, speed: 21 }, highway: { x: 0, z: -400, dist: 400 } }, toCam);
  const gone = transitMix({ train: { x: 0, z: -900, dist: 900, speed: 21 }, highway: { x: 0, z: -900, dist: 900 } }, toCam);
  expect(near.train.gain).toBeGreaterThan(far.train.gain);
  expect(near.hiss.gain).toBeGreaterThan(far.hiss.gain);
  expect(far.train.gain).toBeGreaterThan(0);
  expect(gone.train.gain).toBe(0);
  expect(gone.hiss.gain).toBe(0);
  expect(near.train.gain).toBeLessThanOrEqual(TRANSIT_SOUND.train.max);
  expect(near.train.clatter).toBeLessThanOrEqual(TRANSIT_SOUND.clatter.max);
  expect(near.hiss.gain).toBeLessThanOrEqual(TRANSIT_SOUND.hiss.max);
  expect(distGain(10, 25, 700)).toBe(1);
});

test('左右はカメラから見た向き（右にあれば右）。継ぎ目の音は速さ / 継ぎ目の間隔で刻む。音源がなければ鳴らさない', () => {
  const r = transitMix({ train: { x: 80, z: -20, dist: 82, speed: 20 }, highway: { x: -60, z: -10, dist: 61 } }, toCam);
  expect(r.train.pan).toBeGreaterThan(0.5);
  expect(r.hiss.pan).toBeLessThan(-0.5);
  expect(r.train.rate).toBeCloseTo(20 / TRANSIT_SOUND.clatter.joint);
  const none = transitMix({ train: null, highway: null }, toCam);
  expect(none.train.gain + none.train.clatter + none.hiss.gain).toBe(0);
  expect(transitMix(null, toCam).hiss.gain).toBe(0);
});
