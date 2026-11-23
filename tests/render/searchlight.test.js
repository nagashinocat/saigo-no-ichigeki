import { test, expect } from 'vitest';
import { searchlightAim, SEARCHLIGHT } from '../../src/render/searchlight.js';

// R1（spec §15 大物）: 大物の探照灯。来た直後は主人公の方を中心に大きく掃き（上空の画面の広場を光が横切る）、そのあとは前の道を照らし、
// 近づけば主人公を照らす
const pose = (x, z, yaw) => ({ x, y: 3, z, yaw, pitch: 0, roll: 0, keep: 1 });

test('来た直後: 光は主人公の近く（主人公の先 arriveOver m の内）を左右に掃く', () => {
  const p = pose(0, -60, 0); // 主人公の 60 m 南で、主人公（+z）を向く
  const xs = [];
  for (let age = 0.2; age < SEARCHLIGHT.arriveSec; age += 0.2) {
    const a = searchlightAim(p, { age, time: age, dist: 60 });
    expect(a.arriving).toBe(true);
    expect(Math.hypot(a.target.x, a.target.z)).toBeLessThan(SEARCHLIGHT.arriveOver + 60 * Math.sin(SEARCHLIGHT.arriveSwing) + 1);
    xs.push(a.target.x);
  }
  expect(Math.max(...xs)).toBeGreaterThan(15); // 左右へ大きく振る
  expect(Math.min(...xs)).toBeLessThan(-15);
});

test('来た直後は強く、点いた瞬間からなめらかに明るくなる。倒れて消えるときは消える', () => {
  const p = pose(0, -40, 0);
  expect(searchlightAim(p, { age: 0 }).intensity).toBe(0);
  expect(searchlightAim(p, { age: 0.5 }).intensity).toBeGreaterThan(1);
  expect(searchlightAim(p, { age: 10 }).intensity).toBeCloseTo(1, 6);
  expect(searchlightAim({ ...p, keep: 0 }, { age: 10 }).intensity).toBe(0);
});

test('そのあと: 遠くでは前の道（バイクの向きの reach m 先の地面）を照らし、近づくと主人公を照らす', () => {
  const far = searchlightAim(pose(0, -60, 0), { age: 10, time: 0, dist: 60 });
  expect(far.toHero).toBe(0);
  expect(far.target.y).toBe(0);
  expect(far.target.z).toBeCloseTo(-60 + SEARCHLIGHT.lamp[2] * 1.6 + SEARCHLIGHT.reach, 1);
  const near = searchlightAim(pose(0, -10, 0), { age: 10, time: 0, dist: 10 });
  expect(near.toHero).toBe(1);
  expect(Math.hypot(near.target.x, near.target.z)).toBeLessThan(1e-6);
});

test('heroPos: 来た直後の掃きは渡した主人公の位置のまわり、近づけば主人公の位置を照らす', () => {
  const heroPos = { x: 40, z: 25 };
  const a = searchlightAim(pose(40, -35, 0), { age: 0, time: 0, dist: 60, heroPos });
  expect(Math.hypot(a.target.x - 40, a.target.z - 25)).toBeLessThan(SEARCHLIGHT.arriveOver + 1);
  const n = searchlightAim(pose(40, 15, 0), { age: 10, dist: 10, heroPos });
  expect([n.target.x, n.target.z]).toEqual([40, 25]);
});

// リトライの見直し Important 1: その場のリトライ（restartRound）では、大物の「現れた瞬間」（bornId・bornAt）を忘れる。
// 大物の id は同じ種なら同じなので、忘れないと新しい一回の大物は来た直後の掃き（arriving）をしない
test('reset: 前の一回で大物が現れていても、リセットのあとの大物は来た直後の掃きから（読み直したページと同じ）', async () => {
  const THREE = await import('three');
  const { createSearchlight } = await import('../../src/render/searchlight.js');
  const { createEnemyView } = await import('../../src/render/enemyView.js');
  const boss = { e: { id: 100099, state: 'hunt', x: 0, z: -60 }, b: pose(0, -60, 0) };
  const sl = createSearchlight(new THREE.Group());
  expect(sl.update(boss, 5).arriving).toBe(true);
  expect(sl.update(boss, 30).arriving).toBe(false); // 一回目: 来てから時間がたった
  const fresh = createSearchlight(new THREE.Group());
  sl.reset();
  expect(sl.update(boss, 40.2)).toEqual(fresh.update(boss, 40.2)); // 新しく作ったものと同じ（来た直後）
  expect(sl.update(boss, 40.4).arriving).toBe(true);
  // enemyView からも（main.js の restartRound が呼ぶ）
  const view = createEnemyView(new THREE.Scene(), 'mid', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  view.searchlight.update(boss, 5); view.searchlight.update(boss, 30);
  view.resetRound();
  expect(view.searchlight.update(boss, 40.2).arriving).toBe(true);
});
