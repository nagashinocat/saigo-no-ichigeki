import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { createReplaySim, replayTargets } from '../../src/game/replaySim.js';
import { radiusFor } from '../../src/game/charge.js';
import { blastDuration } from '../../src/game/blast.js';

// リプレイの爆発: 放つ直前の街と軍勢の写しから、同じ一発をもう一度起こす（ゲームの採点や状態には触れない）

function playGame(seed, amount) {
  const game = createGame({ seed });
  const hits = [];
  game.on('hit', ({ hit }) => hits.push(hit.id + ':' + hit.kind));
  game.pressStart();
  for (let i = 0; i < 300; i++) game.update(1 / 30); // 軍勢が湧いて近づく
  game.power.drain(1e9); game.power.add(amount);
  const enemies = game.enemies.list.map((e) => ({ ...e }));
  game.pressEnd();
  const shot = { amount, radius: radiusFor(amount), isBig: true };
  for (let i = 0; i < 600 && game.phase !== 'over'; i++) game.update(1 / 60); // S8: 最大の一発が 4.8 → 5.7 秒になったので 400 → 600 歩
  return { game, hits, enemies, shot };
}

test('同じ一発: 本物のゲームと同じビルと props に、同じ順で、同じ種類の命中が起きる', () => {
  for (const [seed, amount] of [[7, 100], [3, 30]]) {
    const { game, hits, enemies, shot } = playGame(seed, amount);
    const sim = createReplaySim({ shot, targets: replayTargets(game.city), enemies });
    const got = [];
    // 刻みはゲームと違ってよい（命中は前線の距離だけで決まる）
    let t = 0;
    while (!sim.done) { const dt = 0.013 + 0.01 * Math.sin(t * 9); t += dt; for (const e of sim.step(dt)) got.push(e.hit.id + ':' + e.hit.kind); }
    expect(got).toEqual(hits);
    expect(sim.time).toBeGreaterThanOrEqual(blastDuration(shot.radius));
  }
});

test('命中には、ゲームの hit と同じ形で対象（位置と大きさ）が付く', () => {
  const { game, enemies, shot } = playGame(7, 100);
  const sim = createReplaySim({ shot, targets: replayTargets(game.city), enemies });
  const evs = sim.step(2.0);
  const b = evs.find((e) => e.hit.id[0] === 'b');
  const src = game.city.buildings.find((x) => 'b' + x.id === b.hit.id);
  expect(b.target).toBe(src);
});

test('軍勢は写しを使い、前線に触れると倒れて吹き飛ぶ時間が進む。元の一覧は変わらない', () => {
  const { game, enemies, shot } = playGame(7, 100);
  const alive = enemies.filter((e) => e.state !== 'dead');
  expect(alive.length).toBeGreaterThan(2);
  const before = JSON.stringify(enemies);
  const sim = createReplaySim({ shot, targets: replayTargets(game.city), enemies });
  expect(sim.blasts).toHaveLength(1);
  expect(sim.blasts[0].shot).toBe(shot);
  sim.step(1.0);
  const far = Math.max(...alive.map((e) => e.dist));
  expect(sim.front).toBeLessThan(far + 400);
  for (const e of sim.enemies) if (e.dist <= sim.front) expect(e.state).toBe('dead');
  const dead = sim.enemies.find((e) => e.state === 'dead');
  const t0 = dead.deadTime;
  sim.step(0.2);
  expect(dead.deadTime).toBeCloseTo(t0 + 0.2, 9);
  expect(JSON.stringify(enemies)).toBe(before);
  while (!sim.done) sim.step(0.1);
  expect(sim.blasts).toEqual([]); // 終わった一発は一覧から消える（ゲームと同じ）
});

test('同じ写しから二度起こすと、同じ時刻に同じ命中', () => {
  const { game, enemies, shot } = playGame(11, 70);
  const run = () => {
    const sim = createReplaySim({ shot, targets: replayTargets(game.city), enemies });
    const out = [];
    for (let i = 0; i < 200; i++) out.push(sim.step(1 / 60).map((e) => e.hit.id).join(','), sim.front);
    return out;
  };
  expect(run()).toEqual(run());
});

test('リプレイの軍勢は止まった姿で写す（速さ 0。止まっているのに推進光の尾を引かない）。元の軍勢は変えない', () => {
  const enemies = [{ id: 1, angle: 0, dist: 30, state: 'search', speed: 24, turn: 3, lean: 2 }];
  const sim = createReplaySim({ shot: { radius: 100, amount: 50, isBig: true }, targets: [], enemies });
  expect(sim.enemies[0].speed).toBe(0);
  expect(sim.enemies[0].turn).toBe(0);
  expect(sim.enemies[0].lean).toBe(0);
  expect(enemies[0].speed).toBe(24);
});
