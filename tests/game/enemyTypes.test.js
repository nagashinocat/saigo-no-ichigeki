import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { createEnemies, maxEnemyReach } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// R1（持ち主 2026-11-21 21:05「ゲーム性は全部入れよう」、spec §15）: まとめて払った「×k」（09:11 で力を戻すのはやめた）と、軍勢の種類
// （2 回払わないとはがれない重い者・吸う力の強い者・終盤に 1 体だけ来る大物）。どれも撃退の数に入る
const E = CONFIG.enemy, K = E.kinds;
const quiet = { ...CONFIG, enemy: { ...E, spawnPerSec: 0 } };
// 力の動きだけを見る（掴む者に吸われない）
const still = { ...quiet, enemy: { ...quiet.enemy, drainPerSec: 0 } };
const DT = 1 / 30;
const record = (g, names) => {
  const log = [];
  for (const n of names) g.on(n, (p) => log.push([n, p]));
  return log;
};
const runUntil = (g, pred, max = 600) => { let n = 0; while (!pred() && n++ < max) g.update(DT); };
// 主人公の近くに n 人を並べる（puff.radius の内、掴む距離より外）
const ring = (n, dist = 6, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: 900 + i, angle: (i / n) * Math.PI * 2, dist, state: 'chase', ...extra }));

for (const n of [2, 3, 5, 9]) {
  test(`まとめて払う（持ち主 09:11 で力を戻すのはやめた）: ${n} 体を払っても、力は cost を引いただけ。k ≥ 3 なら「×k」の知らせ`, () => {
    const g = createGame({ seed: 1, cfg: still });
    const log = record(g, ['combo']);
    g.pressStart();
    g.power.add(50);
    g.pressCancel(); // 貯めない（力の動きだけを見る）
    g.enemies.list.push(...ring(n));
    const before = g.power.value;
    expect(g.puff()).toBe(true);
    runUntil(g, () => g.blasts.length === 0);
    expect(g.enemies.list.filter((e) => e.id >= 900 && e.state === 'dead')).toHaveLength(n);
    expect(g.power.value).toBeCloseTo(before - CONFIG.puff.cost, 6);
    if (n < 3) expect(log).toEqual([]);
    else {
      const ks = log.map(([, p]) => p.k);
      expect(ks[ks.length - 1]).toBe(n);
      expect(ks[0]).toBeGreaterThanOrEqual(3);
      expect(ks).toEqual([...ks].sort((a, b) => a - b)); // 数が増えるたびに（×3, ×4, …）
      expect(log[0][1]).not.toHaveProperty('refund');
    }
  });
}

test('重い者: 1 回目の払うでは倒れず、後ろへよろめいて（離れて）掴む枠から外れ、2 回目の払うで倒れる。遅い（×0.92。M2: 主人公 28 m/s より速く突っ込める）', () => {
  expect(K.heavy).toMatchObject({ hp: 2, speedMul: 0.92 });
  expect(CONFIG.enemy.speed * K.heavy.speedMul).toBeGreaterThan(CONFIG.hero.speed);
  const g = createGame({ seed: 1, cfg: quiet });
  g.pressStart();
  g.power.add(50);
  g.pressCancel();
  const h = { id: 950, kind: 'heavy', angle: 0, dist: E.grabRange, state: 'grab', grabTime: 1 };
  g.enemies.list.push(h);
  g.update(DT);
  expect(g.grabbing).toBe(1);
  g.puff();
  runUntil(g, () => h.state !== 'grab', 30);
  expect(h.state).toBe('stagger');
  expect(h.hp).toBe(1);
  const d0 = h.dist;
  for (let i = 0; i < 6; i++) g.update(DT);
  expect(h.dist).toBeGreaterThan(d0 + 1); // 後ろへ押し戻される
  expect(g.grabbing).toBe(0);
  runUntil(g, () => g.blasts.length === 0);
  expect(h.state).not.toBe('dead'); // 同じ一発には二度当たらない
  // よろめきが終われば、また突っ込んでくる
  runUntil(g, () => h.state === 'grab' || h.state === 'cling', 200);
  expect(['grab', 'cling']).toContain(h.state);
  g.puff();
  runUntil(g, () => g.blasts.length === 0);
  expect(h.state).toBe('dead');
});

test('重い者: 最後の一発（大きな一発）は 1 回で倒す（大物も）', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.enemies.list.push({ id: 951, kind: 'heavy', angle: 0, dist: 30, state: 'chase' }, { id: 952, kind: 'boss', angle: 1, dist: 30, state: 'chase' });
  expect(g.enemies.applyBlastFront(40)).toBe(2);
  expect(g.enemies.list.filter((e) => e.state === 'dead')).toHaveLength(2);
});

test('重い者の速さ: 探す・突っ込む・回る速さはふつうの者の speedMul（0.92）倍', () => {
  const en = createEnemies(createRng(3), { ...CONFIG, enemy: { ...E, spawnPerSec: 0 } });
  const a = { id: 1, angle: 0, dist: 20, state: 'chase', speed: 0 };
  const b = { id: 2, kind: 'heavy', angle: Math.PI, dist: 20, state: 'chase', speed: 0 };
  en.list.push(a, b);
  for (let i = 0; i < 18; i++) en.update(DT); // 全速（突っ込む速さ）に上がりきった
  expect(b.speed / a.speed).toBeCloseTo(K.heavy.speedMul, 2);
  for (let i = 0; i < 60; i++) en.update(DT);
  expect(a.state).toBe('grab'); expect(b.state).toBe('grab');
  expect(b.speed / a.speed).toBeCloseTo(K.heavy.speedMul, 2);
});

test('吸う者: 掴んでいる間、貯めた力をふつうの者の 2.5 倍の速さで吸う。大物は 4 倍', () => {
  expect(K.drainer.drainMul).toBe(2.5);
  expect(K.boss.drainMul).toBe(4);
  for (const [kind, mul] of [[undefined, 1], ['heavy', 1], ['drainer', 2.5], ['boss', 4]]) {
    const g = createGame({ seed: 1, cfg: quiet });
    g.pressStart();
    g.power.add(80);
    g.pressCancel();
    g.enemies.list.push({ id: 960, kind, angle: 0, dist: E.grabRange, state: 'grab', grabTime: 1 });
    const v0 = g.power.value;
    g.update(0.1);
    expect(g.power.value, String(kind)).toBeCloseTo(v0 - mul * E.drainPerSec * 0.1, 6);
    expect(g.enemies.drainLoad).toBeCloseTo(mul, 9);
  }
});

// 一回を払わずに進め、湧いた者（探す者）の種類と湧いた時刻を集める
function spawnLog(seed) {
  const g = createGame({ seed });
  g.pressStart();
  const seen = new Map();
  for (let t = 0; t < CONFIG.roundSeconds - DT; t += DT) {
    g.update(DT);
    for (const e of g.enemies.list) if (!e.patrol && !seen.has(e.id)) seen.set(e.id, { kind: e.kind ?? 'normal', t: t + DT, e }); // 湧いた時刻（この刻みの終わり）
  }
  return [...seen.values()];
}

test('種類の湧き方: 重い者は 20 秒から探す者の約 15%、吸う者は 30 秒から約 15%。その前には来ない。見回る者はふつうの者', () => {
  const logs = [1, 2, 3, 4, 5, 6, 7, 8].map(spawnLog).flat();
  const before = (t) => logs.filter((s) => s.t < t && s.kind !== 'boss');
  expect(before(K.heavy.after).filter((s) => s.kind === 'heavy')).toHaveLength(0);
  expect(before(K.drainer.after).filter((s) => s.kind === 'drainer')).toHaveLength(0);
  const share = (kind, from) => { const xs = logs.filter((s) => s.t >= from && s.kind !== 'boss'); return xs.filter((s) => s.kind === kind).length / xs.length; };
  expect(share('heavy', K.heavy.after)).toBeGreaterThan(0.1);
  expect(share('heavy', K.heavy.after)).toBeLessThan(0.2);
  expect(share('drainer', K.drainer.after)).toBeGreaterThan(0.1);
  expect(share('drainer', K.drainer.after)).toBeLessThan(0.2);
  const g = createGame({ seed: 3 });
  for (const e of g.enemies.list) expect(e.patrol && !e.kind).toBe(true);
});

test('大物: どの回も 1 体だけ、48〜50 秒に湧き、来たことを知らせる（bossArrive を一度）。3 回払わないと倒れない', () => {
  expect(K.boss.at).toBeGreaterThanOrEqual(48);
  expect(K.boss.at).toBeLessThanOrEqual(50);
  expect(K.boss.hp).toBe(3);
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = createGame({ seed });
    const log = record(g, ['bossArrive']);
    g.pressStart();
    let t = 0, bornAt = null;
    for (; t < CONFIG.roundSeconds - DT; t += DT) {
      g.update(DT);
      if (bornAt === null && g.enemies.list.some((e) => e.kind === 'boss')) bornAt = t;
    }
    expect(bornAt, `seed ${seed}`).toBeGreaterThanOrEqual(48 - 1e-6);
    expect(bornAt).toBeLessThanOrEqual(50);
    expect(g.enemies.list.filter((e) => e.kind === 'boss')).toHaveLength(1);
    expect(log).toHaveLength(1);
    const boss = g.enemies.list.find((e) => e.kind === 'boss');
    expect(log[0][1]).toMatchObject({ id: boss.id });
    expect(Number.isFinite(log[0][1].x) && Number.isFinite(log[0][1].z)).toBe(true);
  }
  // 3 回払って倒れる
  const g = createGame({ seed: 1, cfg: quiet });
  g.pressStart(); g.power.add(60); g.pressCancel();
  const b = { id: 970, kind: 'boss', angle: 0, dist: E.grabRange, state: 'grab', grabTime: 1 };
  g.enemies.list.push(b);
  for (let i = 0; i < 3; i++) {
    expect(b.state, `hit ${i}`).not.toBe('dead');
    runUntil(g, () => b.state === 'grab' || b.state === 'cling', 300);
    expect(g.puff()).toBe(true);
    runUntil(g, () => g.blasts.length === 0);
  }
  expect(b.state).toBe('dead');
});

test('大物は撃退の数に入り、最大溜めで放てば大物ごと必ず撃退成功。大物を残せば撃退失敗。大物も maxEnemyReach の内', () => {
  // fix1: 大物が湧いた直後（まだ払いの届かない 50 m ほど先）に放つ。どの回も大物が生きていて、放った瞬間の数に入る
  let checked = 0;
  for (const seed of [1, 2, 3, 4]) {
    const g = createGame({ seed });
    g.pressStart();
    let t = 0;
    for (; t < K.boss.at + 0.3; t += DT) { if (g.grabbing > 0) g.puff(); g.update(DT); }
    const boss = g.enemies.list.find((e) => e.kind === 'boss');
    expect(boss).toBeTruthy();
    expect(boss.state, `seed ${seed}`).not.toBe('dead');
    expect(boss.dist).toBeLessThanOrEqual(maxEnemyReach(CONFIG));
    const log = record(g, ['over']);
    const alive = g.enemies.list.filter((e) => e.state !== 'dead');
    expect(alive).toContain(boss);
    g.power.take(); g.power.add(CONFIG.power.max);
    g.pressEnd(); g.settle();
    expect(boss.state).toBe('dead');
    expect(g.outcome.clear).toBe(true);
    expect(g.outcome.total).toBe(alive.length); // 大物も放った瞬間の数に入っている
    expect(log[0][1].outcome.survivors).toEqual([]);
    checked++;
  }
  expect(checked).toBe(4);
  // 小さな一発で、大物だけが届かない所にいれば撃退失敗（生き残りに大物）
  const g = createGame({ seed: 1, cfg: { ...quiet, enemy: { ...quiet.enemy, patrol: { ...E.patrol, count: 0 } } } });
  g.pressStart(); g.power.add(30);
  g.enemies.list.push({ id: 980, kind: 'boss', angle: 0, dist: 400, state: 'search', x: 400, z: 0, heading: Math.PI, speed: 0, turn: 0, searchTime: 0, lane: [0, 0], ni: 15, nj: -1, di: -1, dj: 0 });
  g.pressEnd(); g.settle();
  expect(g.outcome.clear).toBe(false);
  expect(g.outcome.survivors.map((s) => s.id)).toEqual([980]);
  expect(g.outcome.survivors[0].kind).toBe('boss');
});

test('heroPos: よろめきは渡した主人公の位置から外へ押し戻され、大物の知らせの距離もそこから測る（動く主人公の仕事がつなげる）', () => {
  const hero = { x: 30, z: -10 };
  const en = createEnemies(createRng(3), { ...CONFIG, enemy: { ...E, spawnPerSec: 0 } }, { heroPos: hero, typeRng: createRng(9) });
  const h = { id: 1, kind: 'heavy', x: 33, z: -10, dist: Math.hypot(33, -10), angle: Math.atan2(-10, 33), state: 'stagger', staggerT: 0, hp: 1 };
  en.list.push(h);
  const d0 = Math.hypot(h.x - hero.x, h.z - hero.z);
  for (let i = 0; i < 6; i++) en.update(DT);
  expect(Math.hypot(h.x - hero.x, h.z - hero.z)).toBeGreaterThan(d0 + 1);
  expect(en.heroPos).toBe(hero);
  for (let t = 0; t < K.boss.at + 0.1; t += DT) en.update(DT);
  const [a] = en.takeArrivals();
  expect(a.dist).toBeCloseTo(Math.hypot(a.x - hero.x, a.z - hero.z), 6);
});

// R1b（持ち主 08:24「吸われてる時をもっと分かりやすく」）: HUD の「−N」と吸われる音の強さのもと。吸われた力の積み上げ（増えるだけ）
test('R1b: drainedTotal は実際に吸われた力の合計（0 で止まった分は数えない）。払う・最後の一発で使った分は数えない', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  expect(g.drainedTotal).toBe(0);
  g.pressStart();
  g.power.add(1);
  g.pressCancel();
  g.enemies.list.push({ id: 961, kind: 'boss', angle: 0, dist: E.grabRange, state: 'grab', grabTime: 1 });
  g.update(0.1);
  const want = Math.min(1, K.boss.drainMul * E.drainPerSec * 0.1);
  expect(g.drainedTotal).toBeCloseTo(want, 9);
  for (let i = 0; i < 10; i++) g.update(0.1);
  expect(g.power.value).toBe(0);
  expect(g.drainedTotal).toBeCloseTo(1, 9); // 1 しか無かった
});
