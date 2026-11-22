// R1b（持ち主 08:24「吸われてる時をもっと分かりやすくしたい 吸われてる音と画面点滅入れた方がいいかな」）:
// 吸われている間の知らせ（画面の縁の点滅・力の数字の点滅・吸われる音の大きさと左右）の状態
import { test, expect } from 'vitest';
import { createDrainFx, drainIntensity, drainPan, DRAIN_FX } from '../../src/ui/drainFx.js';
import { CONFIG } from '../../src/config.js';

const DT = 1 / 60;
const run = (fx, sec, input) => { let s; for (let t = 0; t < sec - 1e-9; t += DT) s = fx.update(DT, input); return s; };

test('強さは吸う力の合計で増える: 吸う者（×2.5）や大物（×4）が掴むと、ふつうの者 1 人より強い。0 から 1 の間', () => {
  const K = CONFIG.enemy.kinds;
  expect(drainIntensity(0)).toBe(0);
  const one = drainIntensity(1), drainer = drainIntensity(K.drainer.drainMul), boss = drainIntensity(K.boss.drainMul);
  expect(drainer).toBeGreaterThan(one);
  expect(boss).toBeGreaterThan(drainer);
  expect(drainIntensity(6)).toBeGreaterThan(drainIntensity(3));
  expect(drainIntensity(100)).toBeLessThanOrEqual(1);
  expect(one).toBeGreaterThan(0.2); // ふつうの者 1 人でもはっきり分かる
});

test('点滅は光に敏感な人にもやさしく: どの強さでも 1 秒に 3 回以下、縁だけの濃さも中くらいまで', () => {
  for (const load of [1, 2.5, 6, 12, 40]) {
    const fx = createDrainFx();
    let peaks = 0, prev = 0, rising = false, maxA = 0;
    for (let t = 0; t < 10; t += DT) {
      const s = fx.update(DT, { load, drained: 0 });
      if (s.pulse > prev) rising = true;
      else if (rising && s.pulse < prev) { peaks++; rising = false; }
      prev = s.pulse;
      maxA = Math.max(maxA, s.vignette);
      expect(s.rate).toBeLessThanOrEqual(3);
    }
    expect(peaks, `load ${load}`).toBeLessThanOrEqual(30);
    expect(peaks).toBeGreaterThanOrEqual(10); // ちゃんと脈打つ（1 秒に 1 回以上）
    expect(maxA).toBeLessThanOrEqual(DRAIN_FX.vignetteMax + 1e-9);
    expect(DRAIN_FX.vignetteMax).toBeLessThanOrEqual(0.85);
    // 脈打ちの濃さの振れ幅（谷から山）は中くらいまで（R1b fix1 で縁を濃くしても 0.45 以下）
    expect(DRAIN_FX.vignetteMax * (1 - DRAIN_FX.base)).toBeLessThanOrEqual(0.45);
  }
});

test('脈打ちは急に変わらない（なめらかな山。ストロボではない）', () => {
  const fx = createDrainFx();
  let prev = null;
  for (let t = 0; t < 4; t += DT) {
    const s = fx.update(DT, { load: 6, drained: 0 });
    if (prev !== null) expect(Math.abs(s.vignette - prev)).toBeLessThan(0.08);
    prev = s.vignette;
  }
});

test('強く吸われるほど縁が濃く、脈打ちが少し速い', () => {
  const a = createDrainFx(), b = createDrainFx();
  let ma = 0, mb = 0;
  for (let t = 0; t < 3; t += DT) {
    ma = Math.max(ma, a.update(DT, { load: 1, drained: 0 }).vignette);
    mb = Math.max(mb, b.update(DT, { load: 4, drained: 0 }).vignette);
  }
  expect(mb).toBeGreaterThan(ma * 1.3);
  expect(b.update(DT, { load: 4, drained: 0 }).rate).toBeGreaterThan(a.update(DT, { load: 1, drained: 0 }).rate);
});

test('掴まれた瞬間にすぐ知らせ、払ってはがれたら音はその場で止まり、縁の点滅も素早く消える', () => {
  const fx = createDrainFx();
  const first = fx.update(DT, { load: 1, drained: 0 });
  expect(first.active).toBe(true);
  expect(first.sound).toBeGreaterThan(0);
  const s1 = run(fx, 0.15, { load: 1, drained: 0 });
  expect(s1.vignette).toBeGreaterThan(0.08);
  const off = fx.update(DT, { load: 0, drained: 0 });
  expect(off.active).toBe(false);
  expect(off.sound).toBe(0);
  const s2 = run(fx, 0.3, { load: 0, drained: 0 });
  expect(s2.vignette).toBeLessThan(0.01);
});

test('吸われた量（−N）は掴まれている間に積み上がり、はがれたら少し見せてから消える。次に掴まれたら 0 から', () => {
  const fx = createDrainFx();
  for (let i = 0; i < 60; i++) fx.update(DT, { load: 2, drained: 0.05 });
  const s = fx.update(DT, { load: 2, drained: 0.05 });
  expect(s.lost).toBeCloseTo(61 * 0.05, 6);
  const after = fx.update(DT, { load: 0, drained: 0 });
  expect(after.lost).toBeCloseTo(s.lost, 6);
  expect(after.lostShow).toBeGreaterThan(0);
  const later = run(fx, DRAIN_FX.lostKeep + 0.5, { load: 0, drained: 0 });
  expect(later.lostShow).toBe(0);
  const again = fx.update(DT, { load: 1, drained: 0.02 });
  expect(again.lost).toBeCloseTo(0.02, 6);
});

test('左右は掴んでいる者の画面の位置から、吸う力の重みで', () => {
  expect(drainPan([])).toBe(0);
  expect(drainPan([{ pan: 0.5, w: 1 }])).toBeCloseTo(0.5, 6);
  // 大物（×4）が右、ふつうの者が左: 右へ寄る
  expect(drainPan([{ pan: 0.6, w: 4 }, { pan: -0.6, w: 1 }])).toBeGreaterThan(0.3);
  expect(Math.abs(drainPan([{ pan: 2, w: 1 }]))).toBeLessThanOrEqual(0.95);
  const fx = createDrainFx();
  const s = fx.update(DT, { load: 5, drained: 0, grabbers: [{ pan: 0.6, w: 4 }, { pan: -0.6, w: 1 }] });
  expect(s.pan).toBeGreaterThan(0.3);
});

test('reset で何もない状態へ（結果の画面・リトライ）', () => {
  const fx = createDrainFx();
  run(fx, 0.5, { load: 3, drained: 0.1 });
  fx.reset();
  const s = fx.update(DT, { load: 0, drained: 0 });
  expect(s).toMatchObject({ active: false, sound: 0, lost: 0, lostShow: 0 });
  expect(s.vignette).toBe(0);
});
