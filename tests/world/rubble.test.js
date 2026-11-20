import { test, expect } from 'vitest';
import { createRubble } from '../../src/world/rubble.js';

const piece = (x, over = {}) => ({ pos: [x, -10, 0], rot: [0.1, 0.2, 0.3], dims: [1, 0.5, 0.8], size: 1, color: [0.5, 0.4, 0.3], ...over });

test('置いた瓦礫は、変わった slot だけを一度知らせ、そのあとは何もしなければ変わらない', () => {
  const r = createRubble(10);
  r.add(piece(20));
  r.add(piece(30));
  const ch = r.takeChanges();
  expect([...ch.slots].sort()).toEqual([0, 1]);
  expect(ch.highWater).toBe(2);
  expect(r.count).toBe(2);
  const s = ch.slots[0];
  expect(r.isLive(s)).toBe(true);
  expect([r.data.px[s], r.data.py[s], r.data.pz[s]]).toEqual([20, -10, 0]);
  // 止まった瓦礫は動かない: 次に聞いても変更はない
  expect(r.takeChanges().slots.length).toBe(0);
  expect(r.takeChanges().slots.length).toBe(0);
  expect(r.data.px[s]).toBe(20);
});

test('上限を超えたら古いものから土煙（DustEvent）にして消す。数は上限を超えない', () => {
  const r = createRubble(10);
  r.setLimit(3);
  const dust = [];
  for (let i = 0; i < 7; i++) r.add(piece(100 + i, { size: 1 + i }), dust);
  expect(r.count).toBe(3);
  expect(dust.map((e) => e.pos[0])).toEqual([100, 101, 102, 103]);
  expect(dust.map((e) => e.size)).toEqual([1, 2, 3, 4]);
  // 残っているのは新しい 3 つ
  const live = [];
  for (let s = 0; s < 10; s++) if (r.isLive(s)) live.push(r.data.px[s]);
  expect(live.sort()).toEqual([104, 105, 106]);
  // 使う slot は上限の数まで（InstancedMesh の描く数が増え続けない）
  expect(r.takeChanges().highWater).toBeLessThanOrEqual(3);
  // たくさん足しても上限のまま
  for (let i = 0; i < 1000; i++) r.add(piece(i), dust);
  expect(r.count).toBe(3);
  expect(r.takeChanges().highWater).toBeLessThanOrEqual(3);
});

test('上限を下げると、古いものから土煙にして上限まで減らす。確保した容量より上には上げられない', () => {
  const r = createRubble(5);
  for (let i = 0; i < 5; i++) r.add(piece(i));
  r.takeChanges();
  const dust = r.setLimit(2);
  expect(dust.map((e) => e.pos[0])).toEqual([0, 1, 2]);
  expect(r.count).toBe(2);
  const ch = r.takeChanges();
  expect(ch.highWater).toBe(2); // 残りは前へ詰める
  expect(ch.slots.length).toBeGreaterThanOrEqual(3); // 消えた slot を描き直す
  const kept = [0, 1].map((s) => (r.isLive(s) ? r.data.px[s] : null));
  expect(kept).toEqual([3, 4]);
  r.setLimit(100);
  for (let i = 0; i < 10; i++) r.add(piece(i));
  expect(r.count).toBe(5);
});

test('穴が広がって瓦礫の下の地面がなくなったら、その瓦礫は呑まれて消える（土煙）。届かない瓦礫は残る', () => {
  const r = createRubble(10);
  // 半径 100 の穴の底（球の面）に置いた瓦礫: 中心からの距離はほぼ 100
  r.add(piece(0, { pos: [60, -79.5, 0] }));
  r.add(piece(0, { pos: [0, 0.5, 150] })); // 穴の外の地面
  r.takeChanges();
  expect(r.sweep(100)).toEqual([]);   // 同じ穴なら何もしない
  expect(r.takeChanges().slots.length).toBe(0);
  const dust = r.sweep(130);          // 大きな一発で穴が広がった
  expect(dust).toHaveLength(1);
  expect(dust[0].pos[0]).toBe(60);
  expect(r.count).toBe(1);
  expect(r.takeChanges().slots.length).toBe(1);
  expect(r.sweep(200)).toHaveLength(1);
  expect(r.count).toBe(0);
});

test('輪が一周したあとに上限を下げても、新しいものが正しく残る', () => {
  const r = createRubble(5);
  for (let i = 0; i < 7; i++) r.add(piece(i)); // slot 0,1 は 5,6 に置き換わっている
  r.setLimit(3);
  const live = [];
  for (let s = 0; s < 5; s++) if (r.isLive(s)) live.push([s, r.data.px[s]]);
  expect(live).toEqual([[0, 4], [1, 5], [2, 6]]);
  // 次に置くと一番古い（4）が置き換わる
  const dust = [];
  r.add(piece(7), dust);
  expect(dust.map((e) => e.pos[0])).toEqual([4]);
  expect(r.count).toBe(3);
});
