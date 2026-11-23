import { test, expect } from 'vitest';
import { createEnemies } from '../../src/game/enemies.js';
import { createGame } from '../../src/game/game.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// まとめ役 Pass 2（持ち主 10:06「払う全部使って隠れる無しでもクリアできない」）: 払ったあと puff.guardSec 秒は掴まれない。
// その間に掴みに来た者（掴む輪・群がる輪に着いた者）は払いの残りで弾かれる（puff.guardKill なら倒れ、でなければよろめく）。
// 払うの「何回でも掴み直される」を、払ったあと逃げる間に変える
const E = CONFIG.enemy, P = CONFIG.puff;
const DT = 1 / 60;
const quiet = { ...CONFIG, enemy: { ...E, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...E.patrol, count: 0 }, kinds: {} } };
// 主人公（原点）から d m の所で、主人公へ突っ込む者
const charger = (id, d, a = 0) => ({ id, state: 'chase', x: Math.cos(a) * d, z: Math.sin(a) * d, heading: a + Math.PI, speed: E.speed, turn: 0, searchTime: 0, lane: [0, 0], seenT: 0, sees: true, dist: d, angle: a });

test('Pass 2: 払うの守りの値は config にある（数秒・弾かれた者は倒れる）', () => {
  expect(P.guardSec).toBeGreaterThanOrEqual(1);
  expect(P.guardSec).toBeLessThanOrEqual(8);
  expect(typeof P.guardKill).toBe('boolean');
});

test('Pass 2: 守りの間（guard）に着いた者は掴まず弾かれる。守りが切れたら掴める', () => {
  const en = createEnemies(createRng(1), quiet, { heroPos: { x: 0, z: 0 } });
  en.guard(P.guardSec);
  expect(en.guardLeft).toBeCloseTo(P.guardSec, 6);
  const a = charger(1, 6);
  en.list.push(a);
  let grabbed = false;
  for (let t = 0; t < P.guardSec - 0.1; t += DT) { en.update(DT); if (a.state === 'grab' || a.state === 'cling') grabbed = true; }
  expect(grabbed).toBe(false);
  expect(['dead', 'stagger', 'chase']).toContain(a.state);
  if (P.guardKill) expect(a.state).toBe('dead');
  for (let t = 0; t < 0.2; t += DT) en.update(DT);
  expect(en.guardLeft).toBe(0);
  const b = charger(2, 6, 1);
  en.list.push(b);
  for (let t = 0; t < 1.5 && b.state !== 'grab'; t += DT) en.update(DT);
  expect(b.state).toBe('grab');
});

test('Pass 2: 守りの間に着いた重い者・大物は倒れず、よろめくだけ（hp は減らない）', () => {
  const en = createEnemies(createRng(1), { ...quiet, enemy: { ...quiet.enemy, kinds: E.kinds } }, { heroPos: { x: 0, z: 0 } });
  en.guard(P.guardSec);
  const h = { ...charger(1, 6), kind: 'heavy' }, b = { ...charger(2, 6, 2), kind: 'boss' };
  en.list.push(h, b);
  const seen = new Set();
  for (let t = 0; t < 1.2; t += DT) { en.update(DT); seen.add(h.state); seen.add(b.state); }
  expect(seen.has('stagger')).toBe(true);
  expect(seen.has('grab')).toBe(false);
  expect(h.state).not.toBe('dead');
  expect(b.state).not.toBe('dead');
  expect(h.hp ?? E.kinds.heavy.hp).toBe(E.kinds.heavy.hp);
  expect(b.hp ?? E.kinds.boss.hp).toBe(E.kinds.boss.hp);
});

test('Pass 2: 守りがなければ、すぐ掴まれる（払わない者は今までどおり）', () => {
  const en = createEnemies(createRng(1), quiet, { heroPos: { x: 0, z: 0 } });
  const a = charger(1, 6);
  en.list.push(a);
  for (let t = 0; t < 1.5 && a.state !== 'grab'; t += DT) en.update(DT);
  expect(a.state).toBe('grab');
});

test('Pass 2: game.puff は守りを始める（払えなかったときは始めない）', () => {
  const g = createGame({ seed: 3, cfg: quiet });
  g.begin(); g.pressStart();
  for (let t = 0; t < 3; t += 1 / 30) g.update(1 / 30); // 払える力まで貯める
  expect(g.enemies.guardLeft).toBe(0);
  expect(g.puff()).toBe(true);
  expect(g.enemies.guardLeft).toBeCloseTo(P.guardSec, 6);
  for (let t = 0; t < P.guardSec + 0.1; t += 1 / 30) g.update(1 / 30);
  expect(g.enemies.guardLeft).toBe(0);
});

// Pass 2: 払ったあと puff.hideLockSec 秒は隠れられない（hideBlock: cooldown）。払うの守りと隠れるを続けて使い、どちらの弱さも消す遊び方にしない
test('Pass 2: 払ったあと hideLockSec 秒は隠れられず、過ぎれば隠れられる', () => {
  expect(P.hideLockSec).toBeGreaterThan(P.guardSec);
  const g = createGame({ seed: 3, cfg: quiet });
  g.begin(); g.pressStart();
  for (let t = 0; t < 3; t += 1 / 30) g.update(1 / 30);
  expect(g.hideBlock).toBe(null);
  expect(g.puff()).toBe(true);
  let t = 0;
  for (; t < P.hideLockSec - 0.1; t += 1 / 30) { expect(g.hideBlock, `t=${t.toFixed(2)}`).not.toBe(null); g.update(1 / 30); }
  for (; t < P.hideLockSec + 0.2; t += 1 / 30) g.update(1 / 30);
  expect(g.hideBlock).toBe(null);
});
