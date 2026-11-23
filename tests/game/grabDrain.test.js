import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// 持ち主（2026-11-23 19:50）「力が吸収されてても減らなくなってるかも」・spec の最後の項:
// 掴まれている（掴む者・群がる者が一人でもいる）間は、長押ししていても貯まらない（力は増えない）。
// 力は drainPerSec × 掴んでいる者の drainMul の合計ずつ減る（掴める数は maxGrabbing まで、前のまま）。
// 掴まれなくなれば、また chargePerSec で貯まる
const E = CONFIG.enemy, K = E.kinds;
// 湧かない・見回る者も大物もいない街。払うの守りは外す（掴む者を直に置くので）
const quiet = { ...CONFIG, enemy: { ...E, spawnPerSec: 0, patrol: { ...E.patrol, count: 0 }, kinds: K }, puff: { ...CONFIG.puff, guardSec: 0 } };
const DT = 1 / 30;

// 長押ししたまま力を start にして、掴む者（kinds の並び。null はふつうの者）を主人公のそばに置く
function grabbed(kinds, start = 50, state = 'grab', cfg = quiet) {
  const g = createGame({ seed: 1, cfg });
  g.pressStart();
  g.power.add(start);
  kinds.forEach((kind, i) => g.enemies.list.push({ id: 960 + i, ...(kind ? { kind } : {}), angle: (i / kinds.length) * Math.PI * 2, dist: E.grabRange, state, grabTime: 1 }));
  return g;
}
// sec 秒進める。どのフレームでも力が増えていないこと・掴まれたままであることを確かめ、減った量を返す
function holdGrabbed(g, sec) {
  const v0 = g.power.value, d0 = g.drainedTotal;
  for (let i = 0; i < Math.round(sec / DT); i++) {
    const v = g.power.value;
    g.update(DT);
    expect(g.charge.active).toBe(true); // 長押しは続いている
    expect(g.power.value, `frame ${i}`).toBeLessThanOrEqual(v);
  }
  return { lost: v0 - g.power.value, drained: g.drainedTotal - d0 };
}

test('掴む者 1 人: 長押ししていても力は一度も増えず、drainPerSec ずつ減る（はっきり見える 1%/秒以上）', () => {
  const g = grabbed([null]);
  const { lost, drained } = holdGrabbed(g, 1);
  expect(g.grabbing).toBe(1);
  expect(lost).toBeCloseTo(E.drainPerSec * 1, 6);
  expect(drained).toBeCloseTo(lost, 9); // HUD の「−N」・吸われる音が使う量も同じ
  expect(100 * E.drainPerSec / CONFIG.power.max).toBeGreaterThanOrEqual(1);
});

test('掴む者 3 人（ふつう 2・重い者 1）: 3 × drainPerSec ずつ減る', () => {
  const g = grabbed([null, null, 'heavy']);
  const { lost } = holdGrabbed(g, 1);
  expect(g.grabbing).toBe(3);
  expect(lost).toBeCloseTo(3 * E.drainPerSec, 6);
});

test('吸う者 1 人: drainPerSec × 2.5 ずつ減る。ふつうの者と一緒なら合計（1 + 2.5）', () => {
  const a = grabbed(['drainer']);
  expect(holdGrabbed(a, 1).lost).toBeCloseTo(K.drainer.drainMul * E.drainPerSec, 6);
  const b = grabbed(['drainer', null]);
  expect(holdGrabbed(b, 1).lost).toBeCloseTo((K.drainer.drainMul + 1) * E.drainPerSec, 6);
});

test('大物に掴まれている: drainPerSec × 4 ずつ減る。力が尽きれば 0 で止まり、長押ししていても増えない', () => {
  const g = grabbed(['boss'], 30);
  expect(holdGrabbed(g, 1).lost).toBeCloseTo(K.boss.drainMul * E.drainPerSec, 6);
  const h = grabbed(['boss'], 1);
  expect(holdGrabbed(h, 1).lost).toBeCloseTo(1, 9);
  expect(h.power.value).toBe(0);
});

test('群がる者（cling）だけがしがみついている間も貯まらない（吸わないので減りもしない）', () => {
  const g = grabbed([null], 40, 'cling');
  const v0 = g.power.value;
  for (let i = 0; i < 15; i++) {
    g.update(DT);
    if (!g.enemies.list.some((e) => e.state === 'cling' || e.state === 'grab')) break;
    expect(g.power.value).toBeLessThanOrEqual(v0);
  }
});

test('掴む者を払えば（掴まれなくなれば）、また chargePerSec で貯まる', () => {
  // 払うの守りあり（払われた者がすぐ掴み直さない）
  const g = grabbed([null, null], 50, 'grab', { ...quiet, puff: CONFIG.puff });
  holdGrabbed(g, 0.5);
  expect(g.puff()).toBe(true);
  let n = 0;
  while ((g.grabbing > 0 || g.enemies.list.some((e) => e.state === 'grab' || e.state === 'cling')) && n++ < 120) g.update(DT);
  expect(g.grabbing).toBe(0);
  const v0 = g.power.value;
  for (let i = 0; i < 30; i++) g.update(DT);
  expect(g.power.value - v0).toBeCloseTo(CONFIG.power.chargePerSec * 30 * DT, 6);
});
