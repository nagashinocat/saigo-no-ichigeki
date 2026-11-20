import { test, expect } from 'vitest';
import { createRng } from '../../src/rng.js';
import { createDebrisPool } from '../../src/world/debris.js';
import { createNearPhysics } from '../../src/world/nearPhysics.js';
import { createRubble } from '../../src/world/rubble.js';
import { createDestruction } from '../../src/world/destruction.js';
import { TIERS } from '../../src/render/quality.js';

// リプレイ: 最後の一発の直前へ戻すための「やり直し」。戻したあと同じ入力を与えると、同じ結果になる

test('rng.reseed: 同じ関数のまま最初の並びからやり直す', () => {
  const r = createRng(42);
  const a = [r(), r(), r()];
  r();
  r.reseed();
  expect([r(), r(), r()]).toEqual(a);
  r.reseed(7);
  expect(r()).toBe(createRng(7)());
});

test('debris pool の clear: 空になり、上限いっぱいまでまた使える', () => {
  const rng = createRng(1);
  const pool = createDebrisPool(8, rng);
  for (let i = 0; i < 12; i++) pool.spawn({ pos: [i, 5, 0], vel: [0, 0, 0], size: 1 });
  pool.setCrater(30);
  pool.clear();
  expect(pool.count).toBe(0);
  expect(pool.crater).toBe(0);
  expect(pool.update(1 / 60, [])).toEqual([]); // 置き換えた破片の粉も残らない
  for (let i = 0; i < 8; i++) pool.spawn({ pos: [i, 5, 0], vel: [0, 0, 0], size: 1 });
  expect(pool.count).toBe(8);
});

test('rubble の clear: 全部消え、描く側には消えた slot を一度知らせる', () => {
  const rb = createRubble(6);
  for (let i = 0; i < 4; i++) rb.add({ pos: [i * 10, 0.5, 0], rot: [0, 0, 0], dims: [1, 1, 1], size: 1, color: [1, 1, 1] }, []);
  rb.takeChanges();
  rb.clear();
  expect(rb.count).toBe(0);
  const ch = rb.takeChanges();
  expect([...ch.slots].sort()).toEqual([0, 1, 2, 3]);
  for (let s = 0; s < 4; s++) expect(rb.isLive(s)).toBe(false);
  rb.add({ pos: [0, 0.5, 0], rot: [0, 0, 0], dims: [1, 1, 1], size: 1, color: [1, 1, 1] }, []);
  expect(rb.isLive(0)).toBe(true);
});

test('nearPhysics の clear: 物体がなくなり、同じものを足して進めると同じ動きになる', () => {
  const rng = createRng(3);
  const np = createNearPhysics(4, rng);
  const box = { min: [0, 4, 0], max: [2, 6, 2] };
  const run = () => {
    rng.reseed();
    np.add(box, [3, 2, 0]);
    for (let i = 0; i < 40; i++) np.step(1 / 60 + (i % 3) * 0.004);
    const p = np.bodies[0].position;
    return [p.x, p.y, p.z];
  };
  const a = run();
  np.clear();
  expect(np.bodies.length).toBe(0);
  expect(run()).toEqual(a);
});

function fakeCity() {
  return {
    getBuildingColor: () => [0.8, 0.7, 0.6], hideBuilding() {}, crushBuilding() {},
    getPropVisual: () => ({ x: 50, z: 0, color: [0.5, 0.5, 0.5] }), hideProp() {},
  };
}
const snapPool = (d) => {
  const { data, active, count } = d.pool;
  const out = [];
  for (let i = 0; i < count; i++) { const s = active[i]; out.push([data.px[s], data.py[s], data.pz[s], data.vx[s]]); }
  return { out, rubble: d.rubble.count, near: d.near.bodies.map((b) => [b.position.x, b.position.y]) };
};

test('destruction.reset: 何もない状態と乱数へ戻り、同じ命中と進め方で同じ破片になる', () => {
  const d = createDestruction({ cityView: fakeCity(), getTier: () => TIERS.mid, seed: 9 });
  d.setPhysicsFocus([100, 0, 0]);
  const play = () => {
    const fronts = [];
    for (let i = 0; i < 90; i++) {
      if (i === 2) d.onHit({ hit: { id: 'b3', kind: 'push' }, target: { id: 3, x: 100, z: 0, w: 12, d: 12, h: 40, dist: 100 } });
      if (i === 5) d.onHit({ hit: { id: 'p2', kind: 'push' }, target: { id: 2, x: 50, z: 0, dist: 50 } });
      fronts[0] = Math.min(120, i * 2);
      d.update(1 / 60, fronts);
    }
    return snapPool(d);
  };
  const first = play();
  expect(first.out.length).toBeGreaterThan(10);
  d.reset();
  expect(d.pool.count).toBe(0);
  expect(d.rubble.count).toBe(0);
  expect(d.near.bodies.length).toBe(0);
  expect(play()).toEqual(first);
});
