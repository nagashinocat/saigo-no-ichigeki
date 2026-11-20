import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { createScore } from '../../src/game/score.js';
import { CONFIG } from '../../src/config.js';

const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0 } };
const record = (g, names) => {
  const log = [];
  for (const n of names) g.on(n, (p) => log.push([n, p]));
  return log;
};
const step = (g, n, dt = 0.1) => { for (let i = 0; i < n; i++) g.update(dt); };
const small = (g) => { g.pressStart(); g.update(0.1); g.pressEnd(); };
const big = (g) => { g.pressStart(); step(g, 8); g.pressEnd(); };

test('小さな一発は cinematic を経ずにすぐ blast が始まる', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot', 'cinematicStart', 'hit']);
  small(g);
  expect(g.phase).toBe('playing');
  expect(log.map(([n]) => n)).toEqual(['shot']);
  expect(log[0][1].isBig).toBe(false);
  step(g, 10);
  expect(log.some(([n]) => n === 'hit')).toBe(true);
  expect(log.some(([n]) => n === 'cinematicStart')).toBe(false);
});

test('大きな一発は cinematic になり、freezeSec の間タイマーが止まり、その後 blast', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot', 'cinematicStart', 'cinematicEnd', 'hit']);
  big(g);
  expect(g.phase).toBe('cinematic');
  expect(g.timer.paused).toBe(true);
  expect(log.filter(([n]) => n === 'cinematicStart')).toHaveLength(1);
  const t = g.timer.remaining, v = g.reserve.value;
  step(g, 10);
  expect(g.phase).toBe('cinematic');
  expect(g.timer.remaining).toBe(t);
  expect(g.reserve.value).toBe(v);
  expect(log.some(([n]) => n === 'hit' || n === 'cinematicEnd')).toBe(false);
  step(g, 5);
  expect(g.phase).toBe('playing');
  expect(g.timer.paused).toBe(false);
  expect(log.filter(([n]) => n === 'cinematicEnd')).toHaveLength(1);
  step(g, 10);
  expect(log.some(([n]) => n === 'hit')).toBe(true);
});

test('cinematic 中の pressStart は無視される', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  big(g);
  expect(g.phase).toBe('cinematic');
  g.pressStart();
  expect(g.charge.active).toBe(false);
  step(g, 15);
  expect(g.charge.active).toBe(false);
});

test('pressEnd は貯めていなければ無視される', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot']);
  g.pressEnd();
  g.pressStart(); g.pressEnd();
  g.pressEnd();
  expect(log).toHaveLength(1);
});

test('blast が終わった時点で、その一発の Hit の value を addShot して shotScored', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['hit', 'shotScored']);
  small(g);
  step(g, 3);
  expect(log.some(([n]) => n === 'shotScored')).toBe(false);
  step(g, 20);
  const values = log.filter(([n]) => n === 'hit').map(([, p]) => p.target.value);
  expect(values.length).toBeGreaterThan(0);
  const scored = log.filter(([n]) => n === 'shotScored');
  expect(scored).toHaveLength(1);
  const expected = createScore().addShot(values);
  expect(scored[0][1].added).toBeCloseTo(expected);
  expect(scored[0][1].total).toBeCloseTo(expected);
  expect(g.score.total).toBeCloseTo(expected);
});

test('同じ建物は二度壊されない', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['hit']);
  small(g); step(g, 8);
  small(g); step(g, 8);
  const ids = log.map(([, p]) => p.hit.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('掴まれている数 × drainPerSec で器が減り、0 で over(drained)', () => {
  const cfg = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 10, spawnDist: [3, 3] } };
  const g = createGame({ seed: 1, cfg });
  const log = record(g, ['over']);
  g.pressStart();
  step(g, 3);
  const grabbing = g.enemies.list.filter((e) => e.state === 'grab').length;
  expect(grabbing).toBeGreaterThan(0);
  const before = g.reserve.value;
  g.update(0.1);
  expect(g.reserve.value).toBeLessThan(before);
  let n = 0;
  while (g.phase !== 'over' && n++ < 300) g.update(0.1);
  expect(g.phase).toBe('over');
  expect(g.reserve.value).toBe(0);
  expect(log).toHaveLength(1);
  expect(log[0][1].reason).toBe('drained');
});

test('時間切れで over(time)、blast 中なら終わってから over', () => {
  const g = createGame({ seed: 1, cfg: { ...quiet, roundSeconds: 0.35 } });
  const log = record(g, ['over']);
  small(g);
  step(g, 3);
  expect(g.timer.isOver()).toBe(true);
  expect(g.phase).toBe('playing'); // 時間は切れたが、じわじわ → 弾ける爆発がまだ走っている
  expect(g.blasts).toHaveLength(1);
  step(g, 20);
  expect(g.phase).toBe('over');
  expect(log).toHaveLength(1);
  expect(log[0][1].reason).toBe('time');

  const h = createGame({ seed: 1, cfg: { ...quiet, roundSeconds: 0.2 } });
  h.pressStart(); step(h, 2);
  expect(h.phase).toBe('over');
});

test('setHidden(true) の間は update(dt) で何も進まない', () => {
  const g = createGame({ seed: 1 }); g.pressStart(); g.setHidden(true); const t = g.timer.remaining, v = g.reserve.value;
  g.update(30); expect(g.timer.remaining).toBe(t); expect(g.reserve.value).toBe(v);
  g.setHidden(false); g.update(0.1); expect(g.timer.remaining).toBeLessThan(t);
});

test('setHidden(true) の間は pressStart も無視される', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.setHidden(true);
  g.pressStart();
  expect(g.phase).toBe('ready');
  expect(g.charge.active).toBe(false);
});

test('update は dt を 0.1 秒に丸める', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.pressStart();
  g.update(30);
  expect(g.timer.remaining).toBeCloseTo(CONFIG.roundSeconds - 0.1);
});

test('over の後は pressStart も update も何もしない', () => {
  const g = createGame({ seed: 1, cfg: { ...quiet, roundSeconds: 0.2 } });
  g.pressStart(); step(g, 2);
  expect(g.phase).toBe('over');
  const v = g.reserve.value, t = g.timer.remaining;
  g.pressStart(); g.update(0.1);
  expect(g.charge.active).toBe(false);
  expect(g.phase).toBe('over');
  expect(g.reserve.value).toBe(v);
  expect(g.timer.remaining).toBe(t);
});

test('drained で終わるとき、途中の blast の分も採点してから over', () => {
  // 貯めの間は敵が出ず、blast の途中で最初の敵が出て掴む
  const cfg = { ...CONFIG, bigShotRatio: 2, enemy: { ...CONFIG.enemy, spawnPerSec: 0.4, spawnDist: [3, 3], maxGrabbing: 1, drainPerSec: 45 } };
  const g = createGame({ seed: 1, cfg });
  const log = record(g, ['hit', 'shotScored', 'over']);
  g.pressStart(); step(g, 20); g.pressEnd();
  expect(g.phase).toBe('playing');
  let n = 0;
  while (g.phase !== 'over' && n++ < 100) g.update(0.1);
  expect(g.phase).toBe('over');
  const names = log.map(([k]) => k);
  const values = log.filter(([k]) => k === 'hit').map(([, p]) => p.target.value);
  expect(values.length).toBeGreaterThan(0);
  expect(names.filter((k) => k === 'shotScored')).toHaveLength(1);
  expect(names.indexOf('shotScored')).toBeLessThan(names.indexOf('over'));
  const expected = createScore().addShot(values);
  expect(g.score.total).toBeCloseTo(expected);
  expect(log.find(([k]) => k === 'over')[1]).toEqual({ reason: 'drained', total: g.score.total });
});

test('blast が二つ同時に生きていても hit の id は重複せず、前線内の敵は倒れる', () => {
  const cfg = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 5, spawnDist: [20, 30], drainPerSec: 0 } };
  const g = createGame({ seed: 1, cfg });
  const log = record(g, ['hit', 'shotScored']);
  big(g);
  step(g, 15); // cinematic 終了、一つ目の blast が走り出す
  step(g, 10); // じわじわ期（最大 0.8 s）の後に弾ける
  expect(g.enemies.list.some((e) => e.state === 'dead')).toBe(true);
  expect(g.enemies.list.filter((e) => e.state !== 'dead' && e.dist <= 40)).toHaveLength(0);
  small(g); // 二つ目
  step(g, 3);
  expect(log.filter(([k]) => k === 'shotScored')).toHaveLength(0);
  step(g, 20);
  const ids = log.filter(([k]) => k === 'hit').map(([, p]) => p.hit.id);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  expect(log.filter(([k]) => k === 'shotScored')).toHaveLength(2);
});

test('dt は負・NaN・Infinity でも安全に扱われる', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.pressStart();
  const t = g.timer.remaining, v = g.reserve.value;
  for (const bad of [-5, NaN, Infinity, -Infinity, undefined]) g.update(bad);
  expect(g.timer.remaining).toBe(t);
  expect(g.reserve.value).toBe(v);
  g.update(Infinity - Infinity);
  expect(g.timer.remaining).toBe(t);
});

test('blasts は進行中の一発ごとに id・shot・front を読み取り専用で返す', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  expect(g.blasts).toEqual([]);
  small(g);
  step(g, 1);
  small(g);
  const list = g.blasts;
  expect(list).toHaveLength(2);
  expect(list[0].id).not.toBe(list[1].id);
  expect(list[0].shot.radius).toBeGreaterThan(0);
  expect(list[0].front).toBeGreaterThan(list[1].front);
  const before = list[0].front;
  expect(() => { list[0].front = 999; }).toThrow();
  expect(() => { list.push({}); }).toThrow();
  expect(g.blasts[0].front).toBe(before);
  // 終わった一発は外れる
  step(g, 40);
  expect(g.blasts).toEqual([]);
});
