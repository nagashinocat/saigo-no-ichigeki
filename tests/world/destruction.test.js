import { test, expect } from 'vitest';
import { createDestruction } from '../../src/world/destruction.js';
import { TIERS } from '../../src/render/quality.js';

function fakeCity() {
  const log = { hidden: [], crushed: [], propsHidden: [] };
  return {
    log,
    getBuildingColor: () => [0.8, 0.7, 0.6],
    hideBuilding: (id) => log.hidden.push(id),
    crushBuilding: (id, delay) => log.crushed.push({ id, delay }),
    getPropVisual: () => ({ x: 50, z: 0, color: [0.5, 0.5, 0.5] }),
    hideProp: (id) => log.propsHidden.push(id),
  };
}
const building = (over = {}) => ({ id: 3, x: 100, z: 0, w: 12, d: 12, h: 40, dist: 100, ...over });
const make = () => {
  const cityView = fakeCity();
  const d = createDestruction({ cityView, getTier: () => TIERS.mid, seed: 5 });
  return { d, cityView };
};
const run = (d, sec, fronts, dt = 1 / 60) => {
  const dust = [];
  for (let t = 0; t < sec - 1e-9; t += dt) dust.push(...d.update(dt, fronts));
  return dust;
};

test('押されたビルはすぐには消えず、球の線でつぶれた形を 0.3〜0.6 秒見せてから破片になる', () => {
  const { d, cityView } = make();
  for (let i = 0; i < 20; i++) d.onHit({ hit: { id: 'b' + i, kind: 'push' }, target: building({ id: i }) });
  expect(cityView.log.hidden).toEqual([]);
  expect(cityView.log.crushed).toHaveLength(20);
  for (const c of cityView.log.crushed) {
    expect(c.delay).toBeGreaterThanOrEqual(0.3);
    expect(c.delay).toBeLessThanOrEqual(0.6);
  }
  expect(new Set(cityView.log.crushed.map((c) => c.delay.toFixed(3))).size).toBeGreaterThan(5); // ばらつきがある
  run(d, 0.29, [120]);
  expect(cityView.log.hidden).toEqual([]);
  expect(d.pool.count).toBe(0);
  run(d, 0.33, [120]);
  expect(cityView.log.hidden.sort((a, b) => a - b)).toEqual([...Array(20).keys()]);
  expect(d.pool.count).toBeGreaterThan(20 * TIERS.mid.piecesPerBuilding); // 小さい破片を足している
});

test('破片はつぶれた形から出る（球の内側には出ない）、遅い速さで外へ、土煙を多めに出す', () => {
  const { d } = make();
  d.onHit({ hit: { id: 'b3', kind: 'push' }, target: building() });
  const fronts = [130];
  const dust = run(d, 0.62, fronts);
  const { data, active, count } = d.pool;
  expect(count).toBeGreaterThan(0);
  let small = 0;
  for (let i = 0; i < count; i++) {
    const s = active[i];
    // 生まれた位置（ox,oy,oz）は球の表面かその外
    expect(Math.hypot(data.ox[s], data.oy[s], data.oz[s])).toBeGreaterThanOrEqual(130 - 1e-3);
    const h = Math.hypot(data.vx[s], data.vz[s]);
    expect(h).toBeLessThanOrEqual(25 + 1e-6);
    expect(data.vx[s]).toBeGreaterThan(0); // +x 側のビルなので外向きは +x
    if (data.size[s] < 2) small++;
  }
  expect(small).toBeGreaterThanOrEqual(8);
  // つぶれた瞬間の土煙
  expect(dust.length).toBeGreaterThanOrEqual(3);
});

test('光に溶けるものは今までどおりすぐ隠し、破片を出さない。props はすぐ破片になる', () => {
  const { d, cityView } = make();
  d.onHit({ hit: { id: 'b1', kind: 'vaporize' }, target: building({ id: 1, x: 10, dist: 10 }) });
  d.onHit({ hit: { id: 'p2', kind: 'push' }, target: { id: 2, x: 50, z: 0, dist: 50 } });
  expect(cityView.log.hidden).toEqual([1]);
  expect(cityView.log.crushed).toEqual([]);
  expect(cityView.log.propsHidden).toEqual([2]);
  expect(d.pool.count).toBeGreaterThanOrEqual(2);
});

test('手前の物理（地面は y=0 の平面）には、えぐれた穴の外の破片だけを回し、穴の中の破片はプールへ', () => {
  // 焦点の近くのビル。穴（半径 130）の中にあるとき
  const inCrater = make();
  inCrater.d.setPhysicsFocus([100, 20, 0]);
  inCrater.d.onHit({ hit: { id: 'b3', kind: 'push' }, target: building() });
  run(inCrater.d, 0.62, [130]);
  expect(inCrater.d.near.bodies.length).toBe(0);
  expect(inCrater.d.pool.count).toBeGreaterThan(0);
  // 穴がまだ届いていない（球の半径 60）とき、手前の物理を使う
  const flat = make();
  flat.d.setPhysicsFocus([100, 20, 0]);
  flat.d.onHit({ hit: { id: 'b3', kind: 'push' }, target: building() });
  run(flat.d, 0.62, [60]);
  expect(flat.d.near.bodies.length).toBeGreaterThan(0);
});

// 穴（半径 130）の中のビルを壊し、破片が止まるまで進める
const settleIn = (d, n, crater = 130, sec = 16) => {
  d.pool.setCrater(crater);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = 40 + (i % 7) * 12;
    d.onHit({ hit: { id: 'b' + i, kind: 'push' }, target: building({ id: i, x: Math.cos(a) * r, z: Math.sin(a) * r, dist: r }) });
  }
  return run(d, sec, [crater]);
};

test('穴の中で止まった破片は瓦礫として残る。建物ごとに大きな塊も残る', () => {
  const { d } = make();
  settleIn(d, 4);
  expect(d.pool.count).toBe(0);
  expect(d.rubble.count).toBeGreaterThan(4 * 4);
  let big = 0;
  for (let s = 0; s < d.rubble.capacity; s++) if (d.rubble.isLive(s) && d.rubble.data.size[s] >= 2.5) big++;
  expect(big).toBeGreaterThanOrEqual(4 * 2); // mid は建物ごとに 2 つ
});

test('瓦礫の数は画質の上限（rubbleMax）を超えない。超えた分は古いものから土煙になる', () => {
  let tier = TIERS.low;
  const cityView = fakeCity();
  const d = createDestruction({ cityView, getTier: () => tier, seed: 5 });
  // 何回かに分けて壊す（破片のプールがあふれないように）
  let dust = [];
  for (let k = 0; k < 4; k++) {
    d.pool.setCrater(130);
    for (let i = 0; i < 60; i++) {
      const id = k * 100 + i, a = (i / 60) * Math.PI * 2, r = 40 + (i % 7) * 12;
      d.onHit({ hit: { id: 'b' + id, kind: 'push' }, target: building({ id, x: Math.cos(a) * r, z: Math.sin(a) * r, dist: r }) });
    }
    dust = dust.concat(run(d, 14, [130]));
    expect(d.rubble.count).toBeLessThanOrEqual(TIERS.low.rubbleMax);
  }
  expect(d.rubble.count).toBe(TIERS.low.rubbleMax);
  expect(dust.length).toBeGreaterThan(0);
  // 画質の上限が下がると、瓦礫もすぐ減る（次の update で土煙として返す）
  const before = d.rubble.count;
  tier = { ...TIERS.low, rubbleMax: 200 };
  d.onHit({ hit: { id: 'p999', kind: 'push' }, target: { id: 999, x: 300, z: 0, dist: 300 } });
  const evicted = d.update(1 / 60, [130]);
  expect(d.rubble.count).toBeLessThanOrEqual(200);
  expect(evicted.length).toBeGreaterThanOrEqual(before - 200);
});

test('止まった瓦礫は毎フレーム動かさない（位置も変更の印も変わらない）', () => {
  const { d } = make();
  settleIn(d, 4);
  d.rubble.takeChanges();
  const snap = Float32Array.from(d.rubble.data.py);
  const snapX = Float32Array.from(d.rubble.data.px);
  run(d, 3, [130]);
  expect(d.rubble.takeChanges().slots).toEqual([]);
  expect(Array.from(d.rubble.data.py)).toEqual(Array.from(snap));
  expect(Array.from(d.rubble.data.px)).toEqual(Array.from(snapX));
});

test('大きな一発で穴が広がると、宙に浮く瓦礫は消える（土煙）', () => {
  const { d } = make();
  settleIn(d, 4);
  const n = d.rubble.count;
  expect(n).toBeGreaterThan(0);
  d.pool.setCrater(300);
  const dust = d.update(1 / 60, [300]);
  expect(d.rubble.count).toBe(0);
  expect(dust.length).toBeGreaterThanOrEqual(n);
});
