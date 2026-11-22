import { test, expect } from 'vitest';
import { planHideMotion, hideMotionAt } from '../../src/game/hideMotion.js';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// R1f（持ち主 18:14「派手でかっこいいアクションをつけて移動させよう」）: 物陰へ跳ぶ動き（しゃがむ → 跳ぶ・壁を蹴る → 着地）。
// 隠れる時刻（dashSec）と物陰の選び方は前のまま（釣り合いを変えない）
const A = CONFIG.hideAction, R = CONFIG.hero.radius, DT = 1 / 30;
const inside = (bs, x, z, pad) => bs.some((b) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad);

test('R1f: 跳ぶ動きは全部で 0.35〜0.5 秒、物陰に着くのは dashSec（前のまま 0.3 秒）', () => {
  expect(CONFIG.hide.dashSec).toBeCloseTo(0.3, 6);
  const total = CONFIG.hide.dashSec + A.landSec;
  expect(total).toBeGreaterThanOrEqual(0.35);
  expect(total).toBeLessThanOrEqual(0.5);
});

test('R1f: 段は しゃがむ → 跳ぶ（→ 壁を蹴る → 跳ぶ）→ 着地 → 終わり の順。dashSec で物陰に着き、そのあとは動かない。高さは跳ぶ間だけ', () => {
  const plan = planHideMotion({ x: 0, z: 0 }, { x: 12, z: 0 }, [], CONFIG);
  expect(plan.kick).toBeNull();
  const seen = [];
  let maxY = 0;
  for (let t = 0; t <= plan.total + 0.05; t += 0.005) {
    const m = hideMotionAt(plan, t);
    if (seen.at(-1) !== m.phase) seen.push(m.phase);
    maxY = Math.max(maxY, m.y);
    if (m.phase === 'crouch' || m.phase === 'land' || m.phase === 'done') expect(m.y).toBe(0);
    if (t >= plan.sec) { expect(m.x).toBeCloseTo(12, 9); expect(m.z).toBeCloseTo(0, 9); }
  }
  expect(seen).toEqual(['crouch', 'leap', 'land', 'done']);
  expect(maxY).toBeGreaterThan(1.5);
  // 道すじは進むだけ（戻らない）
  let prev = -1;
  for (let t = 0; t < plan.sec; t += 0.01) { const s = hideMotionAt(plan, t).s; expect(s).toBeGreaterThanOrEqual(prev); prev = s; }
});

test('R1f: 道すじのそばにビルの面があれば壁を蹴る（kick の段）。蹴る点も道すじもビルの足元に入らない。ビルが遠ければ蹴らない', () => {
  const wall = { x: 6, z: 4.6, w: 10, d: 4 }; // 道すじ（z = 0）の 2.6 m 横に面（z = 2.6）
  const plan = planHideMotion({ x: 0, z: 0 }, { x: 12, z: 0 }, [wall], CONFIG);
  expect(plan.kick).not.toBeNull();
  expect(plan.kick.z).toBeCloseTo(2.6 - R - 0.2, 6);
  const seen = [];
  for (let t = 0; t <= plan.total + 0.05; t += 0.004) {
    const m = hideMotionAt(plan, t);
    if (seen.at(-1) !== m.phase) seen.push(m.phase);
    expect(inside([wall], m.x, m.z, R - 1e-6)).toBe(false);
  }
  expect(seen).toEqual(['crouch', 'leap', 'kick', 'leap', 'land', 'done']);
  const far = planHideMotion({ x: 0, z: 0 }, { x: 12, z: 0 }, [{ x: 6, z: 9, w: 10, d: 4 }], CONFIG);
  expect(far.kick).toBeNull();
});

test('R1f: ゲームの隠れるは跳ぶ動きの道すじで物陰へ着く（dashSec で着き、hero.action は着地のしゃがみが終わるまで残る）', () => {
  const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 }, kinds: {} } };
  let done = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = createGame({ seed, cfg: quiet });
    g.begin(); g.pressStart();
    for (let i = 0; i < 10; i++) g.update(DT);
    if (![[1, 0], [0, 1], [-1, 0], [0, -1]].some((d) => g.hide(d[0], d[1]))) continue;
    const plan = g.hero.action.plan, bs = g.city.buildings;
    expect(plan.to).toEqual({ x: g.hero.hideSpot.x, z: g.hero.hideSpot.z });
    let t = 0;
    const phases = [];
    while (g.hero.action && t < 1) {
      g.update(DT); t += DT;
      if (g.hero.action) {
        const m = hideMotionAt(plan, g.hero.action.t);
        if (phases.at(-1) !== m.phase) phases.push(m.phase);
        if (g.hero.action.t <= plan.sec) { expect(g.hero.x).toBeCloseTo(m.x, 6); expect(g.hero.z).toBeCloseTo(m.z, 6); }
      }
      expect(inside(bs, g.hero.x, g.hero.z, R - 0.05)).toBe(false);
    }
    expect(Math.hypot(g.hero.x - plan.to.x, g.hero.z - plan.to.z)).toBeLessThan(1e-6);
    expect(g.hero.hidden).toBe(true);
    expect(t).toBeGreaterThanOrEqual(plan.total - DT);
    expect(phases[0]).toBe('crouch');
    expect(phases).toContain('land');
    done++;
  }
  expect(done).toBeGreaterThanOrEqual(3);
});
