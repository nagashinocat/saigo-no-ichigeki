import { test, expect } from 'vitest';
import { deformPoint, craterDepth, crushPoint, packFronts, MAX_FRONTS, createFrontTracker, CRUSH_SQUASH, SPHERE_DEFORM_GLSL, groundHeight, CRATER_LIP } from '../../src/render/sphereDeform.js';

const len = (p) => Math.hypot(p[0], p[1], p[2]);

test('球の外の点は動かない', () => {
  const pts = [[120, 0, 0], [80, 60, -30], [0, 200, 0], [-150, 5, 140]];
  for (const p of pts) {
    expect(deformPoint(p, [100])).toEqual(p);
    expect(deformPoint(p, [50, 100, 20])).toEqual(p);
  }
  // 球がない・半径0
  expect(deformPoint([1, 2, 3], [])).toEqual([1, 2, 3]);
  expect(deformPoint([1, 2, 3], [0])).toEqual([1, 2, 3]);
  // ちょうど表面上の点も動かない
  const q = deformPoint([60, 80, 0], [100]);
  expect(q[0]).toBeCloseTo(60, 9); expect(q[1]).toBeCloseTo(80, 9); expect(q[2]).toBeCloseTo(0, 9);
});

test('球の内側の点は中心からの向きを保ったまま表面（距離 = front）へ押し出される', () => {
  const p = [30, 40, 0]; // |p| = 50
  const q = deformPoint(p, [100]);
  expect(len(q)).toBeCloseTo(100, 9);
  expect(q[0] / len(q)).toBeCloseTo(0.6, 9);
  expect(q[1] / len(q)).toBeCloseTo(0.8, 9);
  expect(q[2]).toBeCloseTo(0, 9);
  // 複数の球に入っているときは、いちばん大きな球の表面へ
  const r = deformPoint([10, 0, -20], [40, 150, 90]);
  expect(len(r)).toBeCloseTo(150, 9);
  expect(r[0] / r[2]).toBeCloseTo(-0.5, 9);
  // 小さい球の外・大きい球の内側でも、大きい球の表面へ
  expect(len(deformPoint([0, 60, 0], [40, 80]))).toBeCloseTo(80, 9);
  // 中心ちょうどの点は真上の表面へ
  expect(deformPoint([0, 0, 0], [70])).toEqual([0, 70, 0]);
  // 入力を書き換えない
  const orig = [3, 4, 0];
  deformPoint(orig, [10]);
  expect(orig).toEqual([3, 4, 0]);
});

test('craterDepth: r < front で sqrt(front²-r²)、r ≥ front で 0、複数の球は深いほう', () => {
  expect(craterDepth(0, [100])).toBeCloseTo(100, 9);
  expect(craterDepth(60, [100])).toBeCloseTo(80, 9);
  expect(craterDepth(100, [100])).toBe(0);
  expect(craterDepth(150, [100])).toBe(0);
  expect(craterDepth(30, [])).toBe(0);
  expect(craterDepth(30, [50, 0, 40])).toBeCloseTo(40, 9); // 50 の球: sqrt(2500-900)=40, 40 の球: sqrt(1600-900)≈26.5
  expect(craterDepth(45, [50, 40])).toBeCloseTo(Math.sqrt(2500 - 2025), 9);
  expect(craterDepth(-60, [100])).toBeCloseTo(80, 9); // 距離なので符号は見ない
});

test('crushPoint: k=0 は deformPoint と同じ。k が進むほど低くつぶれ、地面より下にも球の外にも出ない', () => {
  const fronts = [120];
  const p = [100, 60, 20];
  expect(crushPoint(p, fronts, 0)).toEqual(deformPoint(p, fronts));
  let prevY = Infinity;
  for (const k of [0, 0.25, 0.5, 0.75, 1]) {
    const q = crushPoint(p, fronts, k);
    expect(q[1]).toBeLessThanOrEqual(prevY + 1e-9);
    expect(q[1]).toBeGreaterThanOrEqual(0);
    expect(len(q)).toBeGreaterThanOrEqual(120 - 1e-9);
    prevY = q[1];
  }
  expect(crushPoint(p, fronts, 1)[1]).toBeLessThan(deformPoint(p, fronts)[1] * 0.6);
  // 根元（y=0）の点は球の外ならそのまま
  expect(crushPoint([200, 0, 0], fronts, 1)).toEqual([200, 0, 0]);
});

test('packFronts: シェーダーの uFronts へ最大4つ。大きい順に詰め、残りは0、数を返す', () => {
  const out = new Float32Array(MAX_FRONTS);
  expect(MAX_FRONTS).toBe(4);
  expect(packFronts([10, 300, 0, 50], out)).toBe(3);
  expect([...out]).toEqual([300, 50, 10, 0]);
  expect(packFronts([1, 2, 3, 4, 5, 6], out)).toBe(4);
  expect([...out]).toEqual([6, 5, 4, 3]);
  expect(packFronts([], out)).toBe(0);
  expect([...out]).toEqual([0, 0, 0, 0]);
});

test('createFrontTracker: えぐれは届いた最大の半径で残り、終わった一発は最後の半径（shot.radius）まで届いたものとする', () => {
  const tr = createFrontTracker();
  expect(tr.update([])).toEqual([]);
  expect(tr.crater).toBe(0);
  const b = (id, front, radius) => ({ id, front, shot: { radius } });
  expect(tr.update([b(1, 40, 200)])).toEqual([40, 40]);
  expect(tr.update([b(1, 120, 200), b(2, 10, 50)])).toEqual([120, 120, 10]);
  // 一発目が終わって一覧から消えた（最後のフレームの front は 200 未満のまま見えていない）
  expect(tr.update([b(2, 30, 50)])).toEqual([200, 30]);
  expect(tr.crater).toBe(200);
  expect(tr.update([])).toEqual([200]);
  expect(tr.crater).toBe(200);
  // 小さい一発ではえぐれは小さくならない
  tr.update([b(3, 50, 60)]);
  tr.update([]);
  expect(tr.crater).toBe(200);
});

test('GLSL の式は JS と同じ定数を使う（押しつぶしの割合・smoothstep・球の数）', () => {
  // JS の crushPoint が使う割合から、シェーダーの式を組み立てて、そのまま含まれていることを確かめる
  const t = 0.4, js = crushPoint([0, 10, 0], [], t)[1];
  expect(js).toBeCloseTo(10 * (1 - CRUSH_SQUASH * t * t * (3 - 2 * t)), 9);
  expect(SPHERE_DEFORM_GLSL).toContain(`p.y *= 1.0 - ${CRUSH_SQUASH.toFixed(4)} * t * t * (3.0 - 2.0 * t);`);
  expect(SPHERE_DEFORM_GLSL).toContain(`uniform float uFronts[${MAX_FRONTS}];`);
  expect(SPHERE_DEFORM_GLSL).toContain('if (d < uFronts[i]) F = max(F, uFronts[i]);');
  expect(SPHERE_DEFORM_GLSL).toContain('if (abs(r) < f) best = max(best, sqrt(f * f - r * r));');
  expect(SPHERE_DEFORM_GLSL).toContain('return p * (F / d);');
});

test('groundHeight: 地面の高さ。穴の中は craterDepth だけ下がり、縁の外は盛り上がって遠くで 0 に戻る（地面のシェーダーと同じ式）', () => {
  expect(groundHeight(50, [])).toBe(0);
  expect(groundHeight(30, [100, 40])).toBeCloseTo(-craterDepth(30, [100, 40]), 9);
  expect(groundHeight(0, [100])).toBeCloseTo(-100, 9);
  const F = 100, L = CRATER_LIP.height * F + 0.5, W = CRATER_LIP.width * F + 3;
  expect(groundHeight(F + W, [F])).toBeCloseTo(L, 9); // 縁の外の一番高いところ
  expect(groundHeight(F + 1, [F])).toBeGreaterThan(0);
  expect(groundHeight(F + 40 * W, [F])).toBeLessThan(0.01);
  expect(SPHERE_DEFORM_GLSL).toContain('float groundHeight(float r)');
});
