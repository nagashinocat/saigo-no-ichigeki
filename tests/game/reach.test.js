import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { radiusFor } from '../../src/game/charge.js';
import { reachRadius, unreachedCount, nearCount, reachNow, NEAR_DIST } from '../../src/game/reach.js';
import { riderDist } from '../../src/game/centre.js';
import { CONFIG } from '../../src/config.js';

// R2（spec §15 届く範囲の輪）: 輪の半径は今の力の radiusFor。「届かない軍勢 あと N 体」は、今の主人公の所で放ったときに
// 前線の外に残る、生きている軍勢（見回る者・大物を含む）の数。勝ち負け（S9）と同じ距離で数える（HUD が結果とずれない）
const DT = 1 / 30;

test('R2: 輪の半径は今の力で放ったときの半径（radiusFor）と同じ。放った一発の半径とも同じ', () => {
  for (const p of [0, 12, 50, 97.5, 99, 100]) expect(reachRadius(p)).toBe(radiusFor(p));
  const g = createGame({ seed: 3 });
  g.pressStart();
  for (let i = 0; i < 300; i++) g.update(DT);
  g.power.take(); g.power.add(63.7);
  const r = reachRadius(g.power.value);
  let shot = null;
  g.on('shot', (s) => { shot = s; });
  g.pressEnd();
  expect(shot.radius).toBe(r);
});

test('R2: 届かない数は、生きている者のうち爆心から半径より遠い者（死んだ者は数えず、見回る者は数える）。距離は主人公から', () => {
  const list = [
    { id: 1, state: 'search', x: 10, z: 0 },
    { id: 2, state: 'search', x: 200, z: 0, patrol: true },
    { id: 3, state: 'dead', x: 900, z: 0 },
    { id: 4, state: 'grab', x: 0, z: 101 },
    { id: 5, state: 'search', dist: 150 }, // 位置のまだ無い者は主人公からの dist
  ];
  expect(unreachedCount(list, { x: 0, z: 0 }, 100)).toBe(3);
  expect(unreachedCount(list, { x: 0, z: 0 }, 200)).toBe(0);
  // 主人公が右へ 100 m 動くと、右の見回る者は近く、上の者は遠くなる
  expect(unreachedCount(list, { x: 100, z: 0 }, 100)).toBe(2); // id 4（√(100²+101²)）と id 5（150）
  // ちょうど半径の者は倒れる（前線は終わりに半径ちょうどまで届く）
  expect(unreachedCount([{ id: 1, state: 'search', x: 0, z: 100 }], { x: 0, z: 0 }, 100)).toBe(0);
});

test('R2: 距離は勝ち負けの前線と同じ（riderDist: 位置があれば爆心から、無ければ dist）', () => {
  expect(riderDist({ x: 3, z: 4 }, { x: 0, z: 0 })).toBe(5);
  expect(riderDist({ x: 3, z: 4, dist: 99 }, { x: 3, z: 0 })).toBe(4);
  expect(riderDist({ dist: 42 }, { x: 10, z: 10 })).toBe(42);
  expect(riderDist({ x: 3, z: 4, dist: 7 }, null)).toBe(7);
});

test('R2: すぐそばの軍勢（NEAR_DIST = 15 m の内、生きている者）', () => {
  expect(NEAR_DIST).toBe(15);
  const list = [
    { state: 'grab', x: 1, z: 0 }, { state: 'cling', x: 0, z: 15 }, { state: 'search', x: 15.01, z: 0 },
    { state: 'dead', x: 2, z: 0 }, { state: 'chase', x: 50, z: 50 },
  ];
  expect(nearCount(list, { x: 0, z: 0 })).toBe(2);
  expect(nearCount(list, { x: 15, z: 0 })).toBe(2); // (15.01, 0) は 0.01 m、(1, 0) は 14 m。(0, 15) は 21 m で外
});

// HUD の「あと N 体」が 0 なら、その瞬間に放てば必ず撃退成功。1 以上なら必ず失敗し、生き残りはちょうど N 体
test('R2: reachNow の N は、その瞬間に放った一発の生き残りの数とちょうど同じ（HUD は結果とずれない）', () => {
  let zero = 0, some = 0;
  for (let seed = 1; seed <= 6; seed++) {
    for (const [sec, amount] of [[8, 40], [30, 97], [30, 98.6], [45, 99.5], [52, 100]]) {
      const g = createGame({ seed });
      g.pressStart();
      for (let t = 0; t < sec; t += DT) { if (g.grabbing > 1) g.puff(); g.update(DT); }
      g.power.take(); g.power.add(amount);
      // 主人公を中心から離した所にも置く（爆心は今の主人公）
      if (seed % 2 === 0) { g.hero.x = 60; g.hero.z = -40; }
      const now = reachNow(g);
      expect(now.radius).toBe(radiusFor(g.power.value));
      g.pressEnd();
      g.settle();
      expect(g.outcome.survivors.length, `seed ${seed} t ${sec} amount ${amount}`).toBe(now.left);
      expect(g.outcome.clear).toBe(now.left === 0);
      if (now.left === 0) zero++; else some++;
    }
  }
  expect(zero).toBeGreaterThan(0);
  expect(some).toBeGreaterThan(0);
}, 30000);

test('R2: reachNow はゲームの今の主人公と力から（力を変えれば輪も N も変わる）', () => {
  const g = createGame({ seed: 5 });
  g.pressStart();
  for (let i = 0; i < 600; i++) g.update(DT);
  g.power.take(); g.power.add(20);
  const a = reachNow(g);
  g.power.add(CONFIG.power.max);
  const b = reachNow(g);
  expect(b.radius).toBeGreaterThan(a.radius);
  expect(b.left).toBeLessThanOrEqual(a.left);
  expect(b.left).toBe(0); // 中心のそばの満タンは必ず全員に届く
  expect(a.left).toBeGreaterThan(0);
});
