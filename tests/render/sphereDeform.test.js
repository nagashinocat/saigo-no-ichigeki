import { test, expect } from 'vitest';
import { deformPoint, craterDepth, crushPoint, packFronts, MAX_FRONTS, createFrontTracker, CRUSH_SQUASH, SPHERE_DEFORM_GLSL, groundHeight, CRATER_LIP, CRATER_FLOOR_GLSL, blastR, groundHeightAt } from '../../src/render/sphereDeform.js';

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
  expect(craterDepth(60, [100])).toBeCloseTo(80, 9);
  expect(craterDepth(100, [100])).toBe(0);
  expect(craterDepth(150, [100])).toBe(0);
  expect(craterDepth(30, [])).toBe(0);
  expect(craterDepth(30, [50, 0, 40])).toBeCloseTo(40, 9); // 50 の球: sqrt(2500-900)=40, 40 の球: sqrt(1600-900)≈26.5
  expect(craterDepth(45, [50, 40])).toBeCloseTo(Math.sqrt(2500 - 2025), 9);
  expect(craterDepth(-60, [100])).toBeCloseTo(80, 9); // 距離なので符号は見ない
});

test('主人公は浮いている: 真下（原点）も球の深さまで下がる。柱や塔はない', () => {
  for (const F of [10, 100, 440]) {
    for (const r of [0, 1, 2.5, 3.99, 4, 5, -3.5]) {
      expect(craterDepth(r, [F])).toBeCloseTo(Math.sqrt(F * F - r * r), 9);
      expect(groundHeight(r, [F])).toBeCloseTo(-Math.sqrt(F * F - r * r), 9);
    }
    expect(craterDepth(0, [F])).toBe(F);
  }
  expect(craterDepth(0, [])).toBe(0);
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
  // 柱・塔の式はない（球のお椀だけ）
  expect(SPHERE_DEFORM_GLSL).not.toMatch(/a < \d|best = min/);
  // 地面の高さ: 最大の球の内側は穴、外は縁の盛り上がり
  expect(SPHERE_DEFORM_GLSL).toContain('if (abs(r) < F) return -craterDepth(r);');
});

test('groundHeight: 地面の高さ。穴の中は craterDepth だけ下がり、縁の外は盛り上がって遠くで 0 に戻る（地面のシェーダーと同じ式）', () => {
  expect(groundHeight(50, [])).toBe(0);
  expect(groundHeight(30, [100, 40])).toBeCloseTo(-craterDepth(30, [100, 40]), 9);
  expect(groundHeight(0, [100])).toBe(-100); // 主人公の真下も球の深さ
  expect(groundHeight(60, [100])).toBeCloseTo(-80, 9);
  const F = 100, L = CRATER_LIP.height * F + 0.5, W = CRATER_LIP.width * F + 3;
  expect(groundHeight(F + W, [F])).toBeCloseTo(L, 9); // 縁の外の一番高いところ
  expect(groundHeight(F + 1, [F])).toBeGreaterThan(0);
  expect(groundHeight(F + 40 * W, [F])).toBeLessThan(0.01);
  expect(SPHERE_DEFORM_GLSL).toContain('float groundHeight(float r)');
});

// GLSL の craterDepth / groundHeight をそのまま JS に直して動かし、JS の式と同じ値になることを確かめる
function glslGround(fronts) {
  const out = new Float32Array(MAX_FRONTS);
  const count = packFronts(fronts, out);
  const pick = (name) => {
    const start = SPHERE_DEFORM_GLSL.indexOf(`float ${name}(float r) {`);
    let depth = 0, i = SPHERE_DEFORM_GLSL.indexOf('{', start);
    for (; i < SPHERE_DEFORM_GLSL.length; i++) {
      if (SPHERE_DEFORM_GLSL[i] === '{') depth++;
      if (SPHERE_DEFORM_GLSL[i] === '}' && --depth === 0) break;
    }
    return SPHERE_DEFORM_GLSL.slice(start, i + 1);
  };
  const src = [pick('craterDepth'), pick('groundHeight')].join('\n')
    .replace(/float (\w+)\(float r\)/g, 'function $1(r)')
    .replace(/\b(float|int) /g, 'let ')
    .replace(/(?<!\.)\b(abs|sqrt|max|min|exp)\(/g, 'Math.$1(');
  return new Function('uFronts', 'uFrontCount', `${src}\nreturn { craterDepth, groundHeight };`)(Array.from(out), count);
}

test('地面のシェーダーの式（GLSL）を動かすと、JS の craterDepth / groundHeight と同じ値になる（真下・穴・縁）', () => {
  for (const fronts of [[100], [440, 60], [12], [200, 200, 30, 5]]) {
    const g = glslGround(fronts);
    const F = Math.max(...fronts);
    for (const r of [0, 2, 3.999, 4, 5.5, 30, 60, 120, F * 0.5, F - 0.01, F, F + 2, F * 1.2, F * 3]) {
      const tol = 1e-3 * Math.max(1, F); // uFronts は Float32
      expect(g.craterDepth(r)).toBeCloseTo(craterDepth(r, fronts), 1);
      expect(Math.abs(g.groundHeight(r) - groundHeight(r, fronts))).toBeLessThan(tol);
    }
  }
  expect(glslGround([]).groundHeight(10)).toBe(0);
});

test('土煙の粒の床（CRATER_FLOOR_GLSL）を動かすと、穴の中は groundHeight と同じ（真下・斜面・穴の底）、穴の外は 0', () => {
  const src = CRATER_FLOOR_GLSL
    .replace(/float (\w+)\(float r, float F\)/, 'function $1(r, F)')
    .replace(/\bfloat /g, 'let ')
    .replace(/(?<!\.)\b(abs|sqrt)\(/g, 'Math.$1(');
  const craterFloor = new Function(`${src}\nreturn craterFloor;`)();
  for (const F of [60, 440]) {
    for (const r of [0, 3, 4, 10, 40, F * 0.7, F - 0.5]) expect(craterFloor(r, F)).toBeCloseTo(groundHeight(r, [F]), 6);
    expect(craterFloor(F + 10, F)).toBe(0);
  }
});

// M1（spec §16）: 爆心は放った瞬間の主人公の位置。球・穴の式は中心 c（[x, z]）を受ける（JS とシェーダーの uBlastC）
test('M1: 中心 c の球: 押し出しは c からの向きを保ち、c から front の距離へ。原点の球を c だけずらしたものと同じ', () => {
  const c = [137.5, -62.25];
  for (const p of [[30, 40, 0], [10, 3, -20], [0, 0, 0], [-60, 12, 75]]) {
    const w = [p[0] + c[0], p[1], p[2] + c[1]];
    for (const fronts of [[100], [40, 150, 90], [5]]) {
      const a = deformPoint(w, fronts, c), b = deformPoint(p, fronts);
      expect(a[0]).toBeCloseTo(b[0] + c[0], 9); expect(a[1]).toBeCloseTo(b[1], 9); expect(a[2]).toBeCloseTo(b[2] + c[1], 9);
      const k = crushPoint(w, fronts, 0.6, c), kb = crushPoint(p, fronts, 0.6);
      expect(k[0]).toBeCloseTo(kb[0] + c[0], 9); expect(k[1]).toBeCloseTo(kb[1], 9); expect(k[2]).toBeCloseTo(kb[2] + c[1], 9);
    }
  }
  // 原点のそばの点は、中心から遠ければ動かない
  expect(deformPoint([1, 2, 3], [100], c)).toEqual([1, 2, 3]);
  expect(blastR(c[0] + 3, c[1] + 4, c)).toBeCloseTo(5, 12);
  expect(blastR(3, 4)).toBe(5);
  expect(groundHeightAt(c[0], c[1], [100], c)).toBe(-100);
  expect(groundHeightAt(0, 0, [100], c)).toBeCloseTo(groundHeight(Math.hypot(...c), [100]), 12);
});

test('M1: シェーダーの球と穴も中心 uBlastC のまわり（押し出し・穴の深さ・地面の高さ）', () => {
  expect(SPHERE_DEFORM_GLSL).toContain('uniform vec2 uBlastC;');
  expect(SPHERE_DEFORM_GLSL).toContain('vec3 c = vec3(uBlastC.x, 0.0, uBlastC.y);');
  expect(SPHERE_DEFORM_GLSL).toContain('vec3 q = p - c;');
  expect(SPHERE_DEFORM_GLSL).toContain('return c + sdDeformLocal(q);');
  expect(SPHERE_DEFORM_GLSL).toContain('float blastR(vec2 xz) { return length(xz - uBlastC); }');
});

// GLSL の blastR / craterDepthAt / groundHeightAt を JS に直して動かす（vec2 は [x, z]）
function glslGroundAt(fronts, c) {
  const out = new Float32Array(MAX_FRONTS);
  const count = packFronts(fronts, out);
  const pick = (head) => {
    const start = SPHERE_DEFORM_GLSL.indexOf(head);
    expect(start, head).toBeGreaterThanOrEqual(0);
    let depth = 0, i = SPHERE_DEFORM_GLSL.indexOf('{', start);
    for (; i < SPHERE_DEFORM_GLSL.length; i++) {
      if (SPHERE_DEFORM_GLSL[i] === '{') depth++;
      if (SPHERE_DEFORM_GLSL[i] === '}' && --depth === 0) break;
    }
    return SPHERE_DEFORM_GLSL.slice(start, i + 1);
  };
  const src = [pick('float craterDepth(float r) {'), pick('float groundHeight(float r) {'), pick('float blastR(vec2 xz)'), pick('float craterDepthAt(vec2 xz)'), pick('float groundHeightAt(vec2 xz)')].join('\n')
    .replace(/float (\w+)\(float r\)/g, 'function $1(r)')
    .replace(/float (\w+)\(vec2 xz\)/g, 'function $1(xz)')
    .replace('length(xz - uBlastC)', 'Math.hypot(xz[0] - uBlastC[0], xz[1] - uBlastC[1])')
    .replace(/\b(float|int) /g, 'let ')
    .replace(/(?<!\.)\b(abs|sqrt|max|min|exp)\(/g, 'Math.$1(');
  return new Function('uFronts', 'uFrontCount', 'uBlastC', `${src}\nreturn { craterDepthAt, groundHeightAt };`)(Array.from(out), count, Float32Array.from(c));
}

test('M1: 中心から外れた穴の式（GLSL の craterDepthAt / groundHeightAt）を動かすと、JS と同じ値（中心・穴・縁・原点のそば）', () => {
  for (const c of [[0, 0], [212.5, -88], [-301, 140.75]]) {
    for (const fronts of [[100], [440, 60], [12]]) {
      const g = glslGroundAt(fronts, c);
      const F = Math.max(...fronts), tol = 2e-3 * Math.max(1, F) + 1e-3;
      for (const [dx, dz] of [[0, 0], [3, 4], [F * 0.5, 0], [0, -(F - 0.01)], [F * 0.7, F * 0.7], [F + 2, 0], [-F * 1.2, 10], [-c[0], -c[1]]]) {
        const x = c[0] + dx, z = c[1] + dz;
        expect(Math.abs(g.groundHeightAt([x, z]) - groundHeightAt(x, z, fronts, c))).toBeLessThan(tol);
        expect(Math.abs(g.craterDepthAt([x, z]) - craterDepth(blastR(x, z, c), fronts))).toBeLessThan(tol);
      }
    }
  }
});
