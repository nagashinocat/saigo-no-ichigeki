// S8 fix1/fix2: 街を見回る軍勢の光の点（src/render/patrolGlow.js）
import { test, expect } from 'vitest';
import { createPatrolGlow, patrolGlowVisible, PATROL_GLOW } from '../../src/render/patrolGlow.js';

const pat = (id, x, z, state = 'roam') => ({ id, x, z, state, patrol: true });

test('fix2: 上空のゲームの画面では描かない。演出・リプレイ・宇宙・結末・撮影用のカメラでは描く', () => {
  expect(patrolGlowVisible({ overhead: true })).toBe(false);
  expect(patrolGlowVisible({ overhead: false })).toBe(true);
  // ゲームが終わったあと（結末の画面）は、上空のカメラでも生き残った光を見せる
  expect(patrolGlowVisible({ overhead: true, over: true })).toBe(true);
  const g = createPatrolGlow(4);
  g.update([pat(1, 300, 0)], { visible: patrolGlowVisible({ overhead: true }) });
  expect(g.points.visible).toBe(false);
  g.update([pat(1, 300, 0)], { visible: patrolGlowVisible({ overhead: false }) });
  expect(g.points.visible).toBe(true);
  // 何も渡さなければ描く（前と同じ）
  g.update([pat(1, 300, 0)]);
  expect(g.points.visible).toBe(true);
});

test('見回る者だけを、上限 count まで、地面の少し上に置く。探す者は描かない', () => {
  const g = createPatrolGlow(3);
  const list = [pat(1, 100, 5), { id: 2, x: 9, z: 9, state: 'approach' }, pat(3, -200, 40), pat(4, 0, 500), pat(5, 1, 1)];
  g.update(list, { pixelRatio: 2 });
  expect(g.count()).toBe(3);
  const p = g.points.geometry.getAttribute('position').array;
  expect([...p.slice(0, 9)]).toEqual([100, 3.2, 5, -200, 3.2, 40, 0, 3.2, 500].map((v) => expect.closeTo(v, 5)));
  expect([...g.points.geometry.getAttribute('aDead').array]).toEqual([-1, -1, -1]);
  expect(g.points.material.uniforms.uPR.value).toBe(2);
  // 深さを見ない（ビル越しに透ける）・1 回の描画
  expect(g.points.material.depthTest).toBe(false);
  expect(g.points.frustumCulled).toBe(false);
});

test('飲まれた者は、この層の時計で flash 秒だけ火花になり、そのあと消える。reset で覚えた時刻を忘れる', () => {
  const g = createPatrolGlow(4);
  const a = pat(1, 300, 0), b = pat(2, 400, 0);
  g.update([a, b], { dt: 0 });
  a.state = 'dead';
  g.update([a, b], { dt: 0.1 });
  const dead = () => [...g.points.geometry.getAttribute('aDead').array.slice(0, g.count())];
  expect(g.count()).toBe(2);
  expect(dead()).toEqual([0, -1]);
  g.update([a, b], { dt: 0.3 });
  expect(dead()[0]).toBeCloseTo(0.3, 6);
  g.update([a, b], { dt: PATROL_GLOW.flash });
  expect(g.count()).toBe(1); // 火花は終わった
  expect(dead()).toEqual([-1]);
  g.reset();
  g.update([a, b], { dt: 0.05 });
  expect(dead()).toEqual([0, -1]); // リプレイ: もう一度飲まれた瞬間から
});
