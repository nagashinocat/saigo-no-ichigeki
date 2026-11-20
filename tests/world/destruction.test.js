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
