import { test, expect } from 'vitest';
import { poseFor, HAND_JOINTS, JOIN_POSE } from '../../src/render/handPose.js';

const DEG = Math.PI / 180;
// 手首は「前腕に対する手の曲げ」: rx が負で手の甲の側へ反らす。指の関節とは別の範囲
const inRange = (name, [rx, ry, rz]) => name === 'wrist'
  ? rx >= -70 * DEG && rx <= 30 * DEG && Math.abs(ry) <= 30 * DEG && Math.abs(rz) <= 30 * DEG
  : rx >= 0 && rx <= 100 * DEG && Math.abs(ry) <= 30 * DEG && Math.abs(rz) <= 30 * DEG;

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
      for (const name of HAND_JOINTS) expect(inRange(name, p[name]), `${l.toFixed(2)} ${name}`).toBe(true);
    }
  }
  // 範囲の外の level でもこわれない
  for (const l of [-1, 2, NaN]) for (const name of HAND_JOINTS) expect(poseFor(l, 0)[name].every(Number.isFinite)).toBe(true);
});

test('閉じた手（JOIN_POSE）は構えより指を深く丸め（輪を閉じる）、角度は自然な範囲に収まる', () => {
  const open = poseFor(0, 0);
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    const curl = (p) => flex(p, `${f}-finger-phalanx-proximal`) + flex(p, `${f}-finger-phalanx-intermediate`);
    expect(curl(JOIN_POSE), f).toBeGreaterThan(curl(open) + 20 * DEG);
  }
  for (const name of HAND_JOINTS) expect(inRange(name, JOIN_POSE[name]), name).toBe(true);
});

test('球を包む構え（持ち主のスケッチ）: 手首を反らし、指は軽い鉤爪に丸め、親指は手のひらの側へ大きく開く', () => {
  for (const l of [0, 0.5, 1]) {
    const p = poseFor(l, 0.2);
    // 手首は手の甲の側へ 25〜60° 反らす（前腕が球の左右の下・外から低く入る）
    expect(p.wrist[0], `${l} wrist`).toBeLessThan(-25 * DEG);
    expect(p.wrist[0], `${l} wrist`).toBeGreaterThan(-60 * DEG);
    // 手首は震えない（手全体のぶれは手の画面が受け持つ）
    expect(poseFor(1, 0.1).wrist).toEqual(poseFor(1, 0.7).wrist);
    // 指は力が抜けていても丸い（球の上へかぶさる）: 付け根と第二関節の曲げの合計が 35° 以上
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      expect(flex(p, `${f}-finger-phalanx-proximal`) + flex(p, `${f}-finger-phalanx-intermediate`), `${l} ${f}`).toBeGreaterThan(35 * DEG);
    }
    // 親指は手のひらの側へ開く（休みの形でもう半分以上開いていて、構えでさらに ry を正へ）。指から離れて球の下へ回る
    expect(p['thumb-metacarpal'][1], `${l} thumb`).toBeGreaterThan(5 * DEG);
    expect(p['thumb-phalanx-proximal'][1], `${l} thumb`).toBeGreaterThan(5 * DEG);
  }
  // 閉じた手も手首は構えのまま反らしておく（前腕が跳ばない）
  expect(JOIN_POSE.wrist[0]).toBeCloseTo(poseFor(0, 0).wrist[0], 6);
});
