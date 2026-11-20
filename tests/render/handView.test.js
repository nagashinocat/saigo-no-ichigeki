import { test, expect } from 'vitest';
import { createHandView } from '../../src/render/handView.js';
import { CONFIG } from '../../src/config.js';

const DT = 1 / 60;
const run = (view, sec, ...args) => { for (let t = 0; t < sec - 1e-9; t += DT) view.update(DT, ...args); };

// 場面の中の位置・大きさ・光の強さ・uniform の数がすべて有限か
function expectFinite(view) {
  const bad = [];
  view.scene.traverse((o) => {
    for (const v of [o.position, o.scale]) if (!v.toArray().every(Number.isFinite)) bad.push(o.type + ' transform');
    if (o.isLight && !Number.isFinite(o.intensity)) bad.push('light intensity');
    for (const [k, u] of Object.entries(o.material?.uniforms ?? {})) {
      const v = u.value;
      const nums = typeof v === 'number' ? [v] : v?.toArray ? v.toArray() : [];
      if (!nums.every(Number.isFinite)) bad.push(k);
    }
  });
  expect(bad).toEqual([]);
}

for (const tier of ['high', 'low']) {
  test(`手のモデルなし（球だけ）の ${tier} でも作れて、update と release が有限の値を保つ`, () => {
    const view = createHandView(null, tier);
    expect(view.scene.isScene).toBe(true);
    expect(view.camera.isPerspectiveCamera).toBe(true);
    for (const [level, active, reserve] of [[0, false, 1], [0.5, true, 0.6], [0.95, true, 0.05], [1, true, 0], [NaN, true, NaN]]) {
      run(view, 0.5, level, active, reserve);
      expectFinite(view);
    }
    view.release({ amount: CONFIG.charge.maxDraw, radius: 400, isBig: true });
    run(view, 3, 0, false, 0.4);
    expectFinite(view);
    view.release(undefined); // 中身のない一発でもこわれない
    run(view, 1, 0, false, 0.4);
    expectFinite(view);
    // 大きさのない画面でもカメラはこわれない
    view.resize(0);
    view.resize(NaN);
    expect(view.camera.projectionMatrix.toArray().every(Number.isFinite)).toBe(true);
  });
}

test('放つと指が一気に開く。大きな一発は演出の間開いたまま、小さな一発はすぐ戻り始める', () => {
  const freeze = CONFIG.cinematic.freezeSec;
  const big = createHandView(null, 'high'), small = createHandView(null, 'high');
  for (const v of [big, small]) run(v, 0.5, 0.9, true, 0.6);
  expect(big.openness).toBe(0);
  big.release({ amount: CONFIG.charge.maxDraw, isBig: true });
  small.release({ amount: 10, isBig: false });
  // 0.1 秒で開き切る
  run(big, 0.1, 0, false, 0.6); run(small, 0.1, 0, false, 0.6);
  expect(big.openness).toBeCloseTo(1, 5);
  expect(small.openness).toBeCloseTo(1, 5);
  // 演出の終わり近くまで: 大きな一発は開いたまま、小さな一発はもう戻っている途中か戻り切った
  run(big, freeze - 0.15, 0, false, 0.6); run(small, freeze - 0.15, 0, false, 0.6);
  expect(big.openness).toBeCloseTo(1, 5);
  expect(small.openness).toBeLessThan(0.05);
  // 演出が終わると大きな一発も戻る
  run(big, 1.5, 0, false, 0.6);
  expect(big.openness).toBeLessThan(0.05);
});
