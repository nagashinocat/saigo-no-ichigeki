import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { radiusFor } from '../../src/game/charge.js';
import { CONFIG } from '../../src/config.js';

// S9（持ち主 2026-11-21 13:16）: 放った一発で、その時点で街にいる軍勢を全員倒せたらクリア（撃退成功）。
// 一人でも生き残れば失敗（撃退失敗、残り N 体）。最大溜めなら必ず全員を巻き込める。時間切れのブラックホールはそのまま
const DT = 1 / 30;
const record = (g, names) => {
  const log = [];
  for (const n of names) g.on(n, (p) => log.push([n, p]));
  return log;
};
// sec 秒長押しし（近づいた者は払う）、amount の力を持たせて離し、一発を最後まで進める
function releaseAt(seed, sec, amount, cfg = CONFIG) {
  const g = createGame({ seed, cfg });
  const log = record(g, ['over']);
  g.pressStart();
  for (let t = 0; t < sec; t += DT) {
    if (g.grabbing > 0) g.puff();
    g.update(DT);
  }
  g.power.take();
  g.power.add(amount);
  const alive = g.enemies.list.filter((e) => e.state !== 'dead');
  g.pressEnd();
  g.settle();
  return { g, log, alive };
}

test('最大溜めの一発は、どの種・どの時刻に放っても必ず撃退成功（見回る者を含め全員倒れる）', () => {
  for (let seed = 1; seed <= 16; seed++) {
    for (const sec of [1, 25, 58]) {
      const { g, log, alive } = releaseAt(seed, sec, CONFIG.power.max);
      expect(alive.some((e) => e.patrol)).toBe(true);
      expect(g.outcome, `seed ${seed} t ${sec}`).toMatchObject({ clear: true, survivors: [] });
      expect(g.outcome.total).toBe(alive.length);
      expect(log).toEqual([['over', { reason: 'released', total: g.score.total, outcome: g.outcome }]]);
    }
  }
});

test('届かない一発は撃退失敗: 生き残りは、放った瞬間に生きていて前線の外にいた者（数と位置）', () => {
  const amount = 30;
  const R = radiusFor(amount);
  const { g, log, alive } = releaseAt(4, 20, amount);
  const expected = alive.filter((e) => e.dist > R);
  expect(expected.length).toBeGreaterThan(0);
  const o = g.outcome;
  expect(o.clear).toBe(false);
  expect(o.total).toBe(alive.length);
  expect(o.survivors.map((s) => s.id).sort()).toEqual(expected.map((e) => e.id).sort());
  for (const s of o.survivors) {
    const e = expected.find((x) => x.id === s.id);
    expect(s).toEqual({ id: e.id, x: e.x, z: e.z, patrol: !!e.patrol });
  }
  // 前線の内にいた者は全員倒れている
  for (const e of alive) if (e.dist <= R) expect(e.state).toBe('dead');
  expect(log[0][1].outcome).toBe(o);
});

test('放ったあとに現れた者は数えない（湧くのは放った瞬間で止まる。リストに足されても生き残りにはならない）', () => {
  const g = createGame({ seed: 2 });
  g.pressStart();
  for (let t = 0; t < 10; t += DT) { if (g.grabbing) g.puff(); g.update(DT); }
  g.power.add(CONFIG.power.max);
  g.pressEnd();
  const n0 = g.enemies.list.length;
  g.update(0.05); // 演出の止まった間: 湧かない
  expect(g.enemies.list.length).toBe(n0);
  // 放ったあとに、届かない遠くへ一人足す
  g.enemies.list.push({ id: 999999, x: 5000, z: 0, dist: 5000, angle: 0, state: 'search' });
  g.settle();
  expect(g.outcome.clear).toBe(true);
  expect(g.outcome.survivors).toEqual([]);
});

test('放つ前に倒れていた者は、生き残りにも全員の数にも入らない', () => {
  const g = createGame({ seed: 5 });
  g.pressStart();
  for (let t = 0; t < 8; t += DT) g.update(DT);
  const dead = g.enemies.list.find((e) => e.patrol);
  dead.state = 'dead'; dead.deadTime = 0;
  const alive = g.enemies.list.filter((e) => e.state !== 'dead').length;
  g.power.add(CONFIG.power.max);
  g.pressEnd();
  g.settle();
  expect(g.outcome.total).toBe(alive);
});

test('時間切れ（ブラックホール）はそのまま: over は { reason: blackhole, total: 0 } だけで、勝ち負けはつかない', () => {
  const g = createGame({ seed: 1 });
  const log = record(g, ['over']);
  g.pressStart();
  g.pressCancel();
  for (let t = 0; t < CONFIG.roundSeconds + 1; t += 0.1) g.update(0.1);
  expect(g.phase).toBe('over');
  expect(log).toEqual([['over', { reason: 'blackhole', total: 0 }]]);
  expect(g.outcome).toBe(null);
});

test('遊んでいる間の「街の軍勢」の数は、生きている者の数（見回る者を含む）', () => {
  const g = createGame({ seed: 3 });
  expect(g.aliveCount).toBe(CONFIG.enemy.patrol.count);
  g.pressStart();
  for (let t = 0; t < 12; t += DT) g.update(DT);
  expect(g.aliveCount).toBe(g.enemies.list.filter((e) => e.state !== 'dead').length);
});

test('fix1: 一発の半径ちょうど（dist === radius）にいる者も倒れる（生き残りに入らない）', () => {
  // 20.93 / 20.945: 浮動小数の足し算で、最後の前線が半径にわずかに届かなかった量（fix1 で前線を半径ちょうどで止める）
  for (const amount of [20.93, 20.945, 37.3, 61.7, 88.8, CONFIG.power.max]) {
    const R = radiusFor(amount);
    const g = createGame({ seed: 6, cfg: { ...CONFIG, enemy: { ...CONFIG.enemy, patrol: { ...CONFIG.enemy.patrol, count: 0 } } } });
    g.pressStart();
    for (let t = 0; t < 2; t += DT) g.update(DT);
    for (const e of g.enemies.list) { e.state = 'dead'; e.deadTime = 0; }
    const edge = { id: 424242, x: R, z: 0, dist: R, angle: 0, state: 'search' };
    g.enemies.list.push(edge);
    g.power.take(); g.power.add(amount);
    g.pressEnd();
    g.settle();
    expect(edge.dist).toBe(R);
    expect(edge.state, `amount ${amount}`).toBe('dead');
    expect(g.outcome).toMatchObject({ clear: true, total: 1, survivors: [] });
  }
});
