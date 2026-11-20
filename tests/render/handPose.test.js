import { test, expect } from 'vitest';
import { poseFor, HAND_JOINTS } from '../../src/render/handPose.js';

const DEG = Math.PI / 180;
const flex = (pose, name) => pose[name][0];

test('level 0 は軽く開いた手、1 は指が強く曲がりこわばる', () => {
  const open = poseFor(0, 0), tense = poseFor(1, 0);
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    const j = `${f}-finger-phalanx-proximal`;
    expect(flex(open, j)).toBeGreaterThan(0);          // 開いていても少し丸い（力が抜けた手）
    expect(flex(open, j)).toBeLessThan(25 * DEG);
    expect(flex(tense, j)).toBeGreaterThan(flex(open, j) + 20 * DEG);
    // 中ほどの関節も強く曲がる（鉤爪のようにこわばる）
    const m = `${f}-finger-phalanx-intermediate`;
    expect(flex(tense, m)).toBeGreaterThan(flex(open, m) + 30 * DEG);
  }
  // 力がこもるほど指は外へ張る（人差し指と小指の開きが広がる）
  const spread = (p) => p['index-finger-phalanx-proximal'][1] - p['pinky-finger-phalanx-proximal'][1];
  expect(spread(tense)).toBeGreaterThan(spread(open));
  // 途中の level はその間
  const mid = poseFor(0.5, 0);
  expect(flex(mid, 'index-finger-phalanx-proximal')).toBeGreaterThan(flex(open, 'index-finger-phalanx-proximal'));
  expect(flex(mid, 'index-finger-phalanx-proximal')).toBeLessThan(flex(tense, 'index-finger-phalanx-proximal'));
});

test('level 0.8 以上で震えの振れ幅が出て、t で変化する', () => {
  const ts = Array.from({ length: 40 }, (_, i) => i * 0.037);
  const range = (level) => {
    let lo = Infinity, hi = -Infinity;
    for (const t of ts) {
      const v = flex(poseFor(level, t), 'index-finger-phalanx-proximal');
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    return hi - lo;
  };
  // 0.8 未満は静か（t で変わらない）
  expect(range(0)).toBe(0);
  expect(range(0.5)).toBe(0);
  // 0.8 以上で震え、level が高いほど大きい
  expect(range(0.8)).toBeGreaterThan(0.3 * DEG);
  expect(range(1)).toBeGreaterThan(range(0.8));
  expect(range(1)).toBeGreaterThan(2 * DEG);
  // 指ごとに震えがそろわない
  const a = poseFor(1, 0.3), b = poseFor(1, 0.3);
  expect(a).toEqual(b); // 同じ t なら同じ形（決まった値）
  expect(flex(a, 'index-finger-phalanx-proximal') - flex(poseFor(1, 0), 'index-finger-phalanx-proximal'))
    .not.toBeCloseTo(flex(a, 'ring-finger-phalanx-proximal') - flex(poseFor(1, 0), 'ring-finger-phalanx-proximal'), 4);
});

test('どの level でも関節の角度は自然な範囲（曲げ 0〜100°）に収まる', () => {
  for (let l = 0; l <= 1.0001; l += 0.05) {
    for (let t = 0; t < 3; t += 0.013) {
      const p = poseFor(l, t);
      for (const name of HAND_JOINTS) {
        const [rx, ry, rz] = p[name];
        expect(rx).toBeGreaterThanOrEqual(0);
        expect(rx).toBeLessThanOrEqual(100 * DEG);
        expect(Math.abs(ry)).toBeLessThanOrEqual(30 * DEG);
        expect(Math.abs(rz)).toBeLessThanOrEqual(30 * DEG);
      }
    }
  }
  // 範囲の外の level でもこわれない
  for (const l of [-1, 2, NaN]) for (const name of HAND_JOINTS) expect(poseFor(l, 0)[name].every(Number.isFinite)).toBe(true);
});
