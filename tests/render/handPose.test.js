import { test, expect } from 'vitest';
import { poseFor, HAND_JOINTS, JOIN_POSE, PUSH_POSE } from '../../src/render/handPose.js';

const DEG = Math.PI / 180;
// 手首は「前腕に対する手の曲げ」: rx が負で手の甲の側へ反らす。指の関節とは別の範囲
const inRange = (name, [rx, ry, rz]) => name === 'wrist'
  ? rx >= -70 * DEG && rx <= 30 * DEG && Math.abs(ry) <= 30 * DEG && Math.abs(rz) <= 30 * DEG
  : rx >= 0 && rx <= 100 * DEG && Math.abs(ry) <= 30 * DEG && Math.abs(rz) <= 30 * DEG;

const flex = (pose, name) => pose[name][0];

test('level 0 は力の抜けた鉤爪、1 は指先がさらに深く鉤のように曲がり、指が外へ張ってこわばる', () => {
  const open = poseFor(0, 0), tense = poseFor(1, 0);
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    // 付け根は力が抜けていてもほとんどまっすぐ
    expect(flex(open, `${f}-finger-phalanx-proximal`)).toBeGreaterThanOrEqual(0);
    expect(flex(open, `${f}-finger-phalanx-proximal`)).toBeLessThan(15 * DEG);
    // こもるほど第一関節が深く曲がる（鉤爪）
    expect(flex(tense, `${f}-finger-phalanx-distal`)).toBeGreaterThan(flex(open, `${f}-finger-phalanx-distal`) + 20 * DEG);
  }
  // 力がこもるほど指は外へ張る（人差し指と小指の開きが広がる）
  const spread = (p) => p['index-finger-phalanx-proximal'][1] - p['pinky-finger-phalanx-proximal'][1];
  expect(spread(tense)).toBeGreaterThan(spread(open));
  // 途中の level はその間
  const mid = poseFor(0.5, 0);
  expect(flex(mid, 'index-finger-phalanx-distal')).toBeGreaterThan(flex(open, 'index-finger-phalanx-distal'));
  expect(flex(mid, 'index-finger-phalanx-distal')).toBeLessThan(flex(tense, 'index-finger-phalanx-distal'));
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

test('握り合わせ（JOIN_POSE）は付け根から深く指を組み、親指は鉤に巻き上げずに内へ寄せる。払う（PUSH_POSE）は指をまっすぐ伸ばす。角度は自然な範囲', () => {
  const tense = poseFor(1, 0);
  void tense;
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    // 握り合わせ（持ち主 19:09）: 指は付け根から深く曲げて相手の手の甲へ巻きつける（構えより付け根を大きく曲げる）
    expect(flex(JOIN_POSE, `${f}-finger-phalanx-proximal`), f).toBeGreaterThan(Math.max(70 * DEG, flex(tense, `${f}-finger-phalanx-proximal`) + 30 * DEG));
    for (const part of ['proximal', 'intermediate', 'distal']) expect(flex(PUSH_POSE, `${f}-finger-phalanx-${part}`), f).toBeLessThan(10 * DEG);
  }
  // 親指は球の下で内へ寄せるが、先を上へ巻き上げない（巻き上げると球を下から囲むハートの下の弧になる）
  expect(flex(JOIN_POSE, 'thumb-phalanx-proximal')).toBeGreaterThan(20 * DEG);
  expect(flex(JOIN_POSE, 'thumb-phalanx-proximal') + flex(JOIN_POSE, 'thumb-phalanx-distal')).toBeLessThan(70 * DEG);
  // 払うは手首を構えより大きく反らす（手のひらで突く）
  expect(PUSH_POSE.wrist[0]).toBeLessThan(poseFor(0, 0).wrist[0]);
  for (const pose of [JOIN_POSE, PUSH_POSE]) for (const name of HAND_JOINTS) expect(inRange(name, pose[name]), name).toBe(true);
});

test('球を包む構え（持ち主のスケッチ）: 手首を反らし、指は第一関節から鉤に曲げ、親指は手のひらの側へ大きく開く', () => {
  for (const l of [0, 0.5, 1]) {
    const p = poseFor(l, 0.2);
    // 手首は手の甲の側へ 25〜60° 反らす（前腕が球の左右の下・外から低く入る）
    expect(p.wrist[0], `${l} wrist`).toBeLessThan(-25 * DEG);
    expect(p.wrist[0], `${l} wrist`).toBeGreaterThan(-60 * DEG);
    // 手首は震えない（手全体のぶれは手の画面が受け持つ）
    expect(poseFor(1, 0.1).wrist).toEqual(poseFor(1, 0.7).wrist);
    // 鷲掴みの指（持ち主 15:24）: 指は付け根と第二関節ではあまり曲げず、第一関節（DIP）から先を鉤に曲げる。
    // 4 本の指とも、第一関節の曲げが付け根（MCP）と第二関節（PIP）の曲げより大きく、35° 以上
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      const dip = flex(p, `${f}-finger-phalanx-distal`);
      expect(dip, `${l} ${f}`).toBeGreaterThan(flex(p, `${f}-finger-phalanx-proximal`));
      expect(dip, `${l} ${f}`).toBeGreaterThan(flex(p, `${f}-finger-phalanx-intermediate`));
      expect(dip, `${l} ${f}`).toBeGreaterThan(35 * DEG);
    }
    // 親指は手のひらの側へ開く（休みの形でもう半分以上開いていて、構えでさらに ry を正へ）。指から離れて球の下へ回る
    expect(p['thumb-metacarpal'][1], `${l} thumb`).toBeGreaterThan(5 * DEG);
    expect(p['thumb-phalanx-proximal'][1], `${l} thumb`).toBeGreaterThan(5 * DEG);
  }
  // 閉じた手も手首は構えのまま反らしておく（前腕が跳ばない）
  expect(JOIN_POSE.wrist[0]).toBeCloseTo(poseFor(0, 0).wrist[0], 6);
});
