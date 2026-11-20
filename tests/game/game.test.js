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
  step(g, 5);
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
  expect(g.phase).toBe('playing');
  g.update(0.1);
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
