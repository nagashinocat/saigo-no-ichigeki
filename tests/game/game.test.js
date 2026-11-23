import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { createScore } from '../../src/game/score.js';
import { radiusFor } from '../../src/game/charge.js';
import { CONFIG } from '../../src/config.js';

// M2: 貯める速さが 1.9/秒になり、満タンまで 50 秒を超える。残り 20 秒から加わる見回る者・49 秒の大物に掴まれないよう、どちらも置かない
const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 }, kinds: {} } };
const record = (g, names) => {
  const log = [];
  for (const n of names) g.on(n, (p) => log.push([n, p]));
  return log;
};
const step = (g, n, dt = 0.1) => { for (let i = 0; i < n; i++) g.update(dt); };
const secFor = (amount) => amount / CONFIG.power.chargePerSec;
// sec 秒長押しする（離さない）
const hold = (g, sec) => { g.pressStart(); step(g, Math.round(sec / 0.1)); };
const runUntil = (g, pred, max = 600) => { let n = 0; while (!pred() && n++ < max) g.update(0.1); };

test('最初の pressStart で始まり、長押しの間だけ力が貯まる（離しても、貯まる前の力は増えない）', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  expect(g.phase).toBe('ready');
  expect(g.power.value).toBe(0);
  step(g, 10);
  expect(g.power.value).toBe(0);
  expect(g.timer.remaining).toBe(CONFIG.roundSeconds);
  hold(g, 2);
  expect(g.phase).toBe('playing');
  expect(g.power.value).toBeCloseTo(2 * CONFIG.power.chargePerSec);
  g.pressEnd(); // minRelease 未満: 放たない
  const v = g.power.value;
  step(g, 10);
  expect(g.power.value).toBe(v);
  expect(g.timer.remaining).toBeCloseTo(CONFIG.roundSeconds - 3);
});

test('指を離さない限り放たれない: 上限まで貯めても押したままなら一発は出ない', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot', 'cinematicStart', 'over']);
  hold(g, secFor(CONFIG.power.max) + 5);
  expect(g.power.value).toBe(CONFIG.power.max);
  expect(g.phase).toBe('playing');
  expect(log).toHaveLength(0);
  expect(g.blasts).toEqual([]);
});

test('minRelease 未満で離すと何も起きず、貯めた力は残り、続けて押すと続きから貯まる', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot', 'cinematicStart']);
  hold(g, secFor(CONFIG.power.minRelease) / 2);
  g.pressEnd();
  expect(log).toHaveLength(0);
  expect(g.phase).toBe('playing');
  expect(g.charge.active).toBe(false);
  hold(g, secFor(CONFIG.power.minRelease) / 2 + 0.2);
  g.pressEnd();
  expect(log.map(([n]) => n)).toEqual(['shot', 'cinematicStart']);
});

test('離すと最後の一発: 貯めた量で半径が決まり、演出（freezeSec）の間は止まり、そのあと爆発してゲームは over(released)', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot', 'cinematicStart', 'cinematicEnd', 'hit', 'shotScored', 'over']);
  hold(g, secFor(60));
  const amount = g.power.value;
  g.pressEnd();
  const shot = log.find(([n]) => n === 'shot')[1];
  expect(shot.amount).toBeCloseTo(amount);
  expect(shot.radius).toBeCloseTo(radiusFor(amount));
  expect(shot.isBig).toBe(true);
  expect(g.power.value).toBe(0);
  expect(g.phase).toBe('cinematic');
  expect(g.timer.paused).toBe(true);
  const t = g.timer.remaining;
  step(g, 10);
  expect(g.phase).toBe('cinematic');
  expect(log.some(([n]) => n === 'hit' || n === 'cinematicEnd')).toBe(false);
  step(g, 5);
  expect(g.phase).toBe('finale');
  expect(log.filter(([n]) => n === 'cinematicEnd')).toHaveLength(1);
  expect(g.blasts).toHaveLength(1);
  runUntil(g, () => g.phase === 'over');
  expect(g.phase).toBe('over');
  expect(g.timer.remaining).toBe(t); // 放ったあと時間は進まない
  const values = log.filter(([n]) => n === 'hit').map(([, p]) => p.target.value);
  expect(values.length).toBeGreaterThan(0);
  const ids = log.filter(([n]) => n === 'hit').map(([, p]) => p.hit.id);
  expect(new Set(ids).size).toBe(ids.length);
  const expected = createScore().addShot(values);
  expect(g.score.total).toBeCloseTo(expected);
  const names = log.map(([n]) => n);
  expect(names.filter((n) => n === 'shotScored')).toHaveLength(1);
  expect(names.indexOf('shotScored')).toBeLessThan(names.indexOf('over'));
  const over = log.filter(([n]) => n === 'over');
  expect(over).toHaveLength(1);
  expect(over[0][1]).toEqual({ reason: 'released', total: g.score.total, outcome: g.outcome });
});

test('最大まで貯めた一発は街の端まで届く', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot']);
  hold(g, secFor(CONFIG.power.max) + 1);
  g.pressEnd();
  expect(log[0][1].radius).toBeGreaterThanOrEqual(CONFIG.cityRadius);
});

test('放ったあと（演出・爆発の間・終わった後）は、押しても小爆発を押しても何も始まらない', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot', 'puff']);
  hold(g, secFor(40));
  g.pressEnd();
  for (const until of ['cinematic', 'finale', 'over']) {
    runUntil(g, () => g.phase === until);
    expect(g.phase).toBe(until);
    g.pressStart();
    expect(g.charge.active).toBe(false);
    expect(g.puff()).toBe(false);
    g.pressEnd();
  }
  expect(log.map(([n]) => n)).toEqual(['shot']);
});

test('時間切れまで放たなければ over(blackhole)。破壊額はつかない', () => {
  const g = createGame({ seed: 1, cfg: { ...quiet, roundSeconds: 2 } });
  const log = record(g, ['shot', 'over']);
  hold(g, 1);
  g.pressEnd();
  step(g, 15);
  expect(g.phase).toBe('over');
  expect(log).toEqual([['over', { reason: 'blackhole', total: 0 }]]);
});

test('押したまま時間切れになっても over(blackhole)（離しても一発は出ない）', () => {
  const g = createGame({ seed: 1, cfg: { ...quiet, roundSeconds: 5 } });
  const log = record(g, ['shot', 'over']);
  hold(g, 5.2);
  expect(g.phase).toBe('over');
  expect(g.charge.active).toBe(false);
  g.pressEnd();
  expect(log).toEqual([['over', { reason: 'blackhole', total: 0 }]]);
});

test('小爆発: 貯めた力を cost 使い、主人公のまわり puff.radius の軍勢を倒す。ビルは壊さず、破壊額は 0 のまま', () => {
  const cfg = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0 } };
  const g = createGame({ seed: 1, cfg });
  const log = record(g, ['puff', 'hit', 'shot']);
  hold(g, secFor(20)); // 押したまま、別の指で小爆発
  // 近くに軍勢を置く（湧かない設定なので直接並べる）
  g.enemies.list.push(
    { id: 901, angle: 0, dist: CONFIG.puff.radius - 5, state: 'approach' },
    { id: 902, angle: 1, dist: CONFIG.enemy.grabRange, state: 'grab' },
    { id: 903, angle: 2, dist: CONFIG.puff.radius + 60, state: 'approach' }, // R0: 突っ込む速さ 32 m/s でも前線が過ぎるまでに届かない距離
  );
  const before = g.power.value;
  expect(g.canPuff).toBe(true);
  expect(g.puff()).toBe(true);
  expect(g.power.value).toBeCloseTo(before - CONFIG.puff.cost);
  expect(log.map(([n]) => n)).toEqual(['puff']);
  const shot = log[0][1];
  expect(shot).toMatchObject({ radius: CONFIG.puff.radius, small: true, isBig: false, amount: CONFIG.puff.cost });
  expect(g.blasts).toHaveLength(1);
  expect(g.blasts[0].shot.small).toBe(true);
  // 軍勢がこちらへ歩いてくる分を除くため speed 0 にはせず、puff の前線が通り過ぎるまで進める
  step(g, 12);
  const byId = (id) => g.enemies.list.find((e) => e.id === id);
  expect(byId(901).state).toBe('dead');
  expect(byId(902).state).toBe('dead');
  expect(byId(903).state).not.toBe('dead');
  expect(g.blasts).toEqual([]);
  expect(log.some(([n]) => n === 'hit')).toBe(false);
  expect(g.score.total).toBe(0);
  expect(g.phase).toBe('playing');
});

test('力が足りなければ小爆発は押せない（何も使わず、何も起きない）', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['puff']);
  expect(g.canPuff).toBe(false); // 始まる前
  expect(g.puff()).toBe(false);
  hold(g, secFor(CONFIG.puff.cost) - 0.5);
  expect(g.canPuff).toBe(false);
  const v = g.power.value;
  expect(g.puff()).toBe(false);
  expect(g.power.value).toBe(v);
  step(g, 6);
  expect(g.canPuff).toBe(true);
  expect(g.puff()).toBe(true);
  expect(log).toHaveLength(1);
});

test('小爆発が広がっている間は次の小爆発は押せない（連打で力を無駄にしない）。広がり終われば押せる', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  hold(g, secFor(40));
  expect(g.puff()).toBe(true);
  const v = g.power.value;
  expect(g.canPuff).toBe(false);
  expect(g.puff()).toBe(false);
  expect(g.power.value).toBe(v);
  runUntil(g, () => g.blasts.length === 0);
  expect(g.canPuff).toBe(true);
  expect(g.puff()).toBe(true);
});

test('長押ししながら小爆発を押せ、押した分だけ最後の一発の半径が小さくなる', () => {
  const shotOf = (puffs) => {
    const g = createGame({ seed: 1, cfg: quiet });
    const log = record(g, ['shot']);
    hold(g, secFor(40));
    for (let i = 0; i < 2; i++) { if (i < puffs) expect(g.puff()).toBe(true); step(g, 10); } // どちらも同じ時間だけ押す
    expect(g.charge.active).toBe(true); // 長押しは途切れない
    g.pressEnd();
    return log[0][1];
  };
  const a = shotOf(0), b = shotOf(2);
  expect(b.amount).toBeCloseTo(a.amount - 2 * CONFIG.puff.cost);
  expect(b.radius).toBeLessThan(a.radius);
});

test('掴まれている数 × drainPerSec で貯めた力が減る（持ち主 19:50: 掴まれている間は長押ししていても貯まらない）。0 になってもゲームは続く', () => {
  const cfg = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 10, surgeMul: 1, spawnDist: [3, 3] } };
  const g = createGame({ seed: 1, cfg });
  const log = record(g, ['over']);
  hold(g, 1);
  g.pressEnd();
  step(g, 20);
  const grabbing = g.enemies.list.filter((e) => e.state === 'grab').length;
  expect(grabbing).toBe(CONFIG.enemy.maxGrabbing);
  expect(g.grabbing).toBe(grabbing);
  expect(g.power.value).toBe(0);
  // 長押ししても貯まらず、掴まれている分だけ減る（力を足して確かめる）
  g.pressStart();
  g.power.add(20);
  const v0 = g.power.value;
  g.update(0.1);
  expect(g.chargeHeld).toBe(true);
  expect(g.power.value).toBeCloseTo(v0 - grabbing * CONFIG.enemy.drainPerSec * 0.1);
  expect(g.phase).toBe('playing');
  expect(log).toHaveLength(0);
});

test('setHidden(true) の間は update(dt) で何も進まない', () => {
  const g = createGame({ seed: 1 }); g.pressStart(); g.setHidden(true); const t = g.timer.remaining, v = g.power.value;
  g.update(30); expect(g.timer.remaining).toBe(t); expect(g.power.value).toBe(v);
  g.setHidden(false); g.update(0.1); expect(g.timer.remaining).toBeLessThan(t);
});

test('setHidden(true) の間は pressStart も小爆発も無視される', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.setHidden(true);
  g.pressStart();
  expect(g.phase).toBe('ready');
  expect(g.charge.active).toBe(false);
  g.setHidden(false);
  hold(g, secFor(20));
  g.setHidden(true);
  expect(g.canPuff).toBe(false);
  expect(g.puff()).toBe(false);
});

test('update は dt を 0.1 秒に丸める', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.pressStart();
  g.update(30);
  expect(g.timer.remaining).toBeCloseTo(CONFIG.roundSeconds - 0.1);
});

test('over の後は pressStart も update も何もしない', () => {
  const g = createGame({ seed: 1, cfg: { ...quiet, roundSeconds: 0.2 } });
  g.pressStart(); step(g, 3);
  expect(g.phase).toBe('over');
  const v = g.power.value, t = g.timer.remaining;
  g.pressStart(); g.update(0.1);
  expect(g.charge.active).toBe(false);
  expect(g.phase).toBe('over');
  expect(g.power.value).toBe(v);
  expect(g.timer.remaining).toBe(t);
});

test('最後の一発の間（finale）はタイマー・軍勢・力が止まり、爆発だけが進む', () => {
  // 遠くに湧いて動かない軍勢（速い軍勢は 27 秒の長押しの間に届いて力を吸い切ってしまうので、止めておく）
  const cfg = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 4, spawnDist: [200, 260], searchSpeed: 0, accel: 0 } };
  const g = createGame({ seed: 1, cfg });
  hold(g, secFor(80));
  g.pressEnd();
  runUntil(g, () => g.phase === 'finale');
  const t = g.timer.remaining, v = g.power.value;
  const n = g.enemies.list.length;
  const f0 = g.blasts[0].front;
  step(g, 3);
  expect(g.blasts[0].front).toBeGreaterThan(f0);
  expect(g.timer.remaining).toBe(t);
  expect(g.power.value).toBe(v);
  expect(g.enemies.list.length).toBe(n); // 新しく湧かない
  for (const e of g.enemies.list) if (e.dist <= g.blasts[0].front) expect(e.state).toBe('dead');
});

test('dt は負・NaN・Infinity でも安全に扱われる', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.pressStart();
  const t = g.timer.remaining, v = g.power.value;
  for (const bad of [-5, NaN, Infinity, -Infinity, undefined]) g.update(bad);
  expect(g.timer.remaining).toBe(t);
  expect(g.power.value).toBe(v);
  g.update(Infinity - Infinity);
  expect(g.timer.remaining).toBe(t);
});

test('blasts は進行中の一発ごとに id・shot・front を読み取り専用で返す', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  expect(g.blasts).toEqual([]);
  hold(g, secFor(30));
  g.puff();
  step(g, 2);
  const list = g.blasts;
  expect(list).toHaveLength(1);
  expect(list[0].id).toBeGreaterThan(0);
  expect(list[0].shot.radius).toBeGreaterThan(0);
  expect(list[0].front).toBeGreaterThan(0);
  const before = list[0].front;
  expect(() => { list[0].front = 999; }).toThrow();
  expect(() => { list.push({}); }).toThrow();
  expect(g.blasts[0].front).toBe(before);
  // 終わった一発は外れる
  step(g, 20);
  expect(g.blasts).toEqual([]);
});

test('pressCancel（タブを隠す・blur・pointercancel）は放たずに貯めを止め、力は残る。押し直すと続きから貯まる', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot', 'cinematicStart', 'over', 'fizzle']);
  hold(g, secFor(40));
  const v = g.power.value;
  expect(v).toBeGreaterThan(CONFIG.power.minRelease);
  g.pressCancel();
  expect(g.charge.active).toBe(false);
  expect(g.phase).toBe('playing');
  expect(g.power.value).toBe(v);
  g.pressEnd(); // 打ち切った後の離す は何もしない
  step(g, 5);
  expect(g.power.value).toBe(v);
  expect(log).toHaveLength(0);
  hold(g, 1);
  expect(g.power.value).toBeCloseTo(v + CONFIG.power.chargePerSec);
  g.pressEnd(); // ふつうに離せば放つ
  expect(log.map(([n]) => n)).toEqual(['shot', 'cinematicStart']);
});

test('隠れたまま pressCancel が来ても放たず、戻ってからも力は残る', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['shot']);
  hold(g, secFor(30));
  const v = g.power.value;
  g.setHidden(true);
  g.pressCancel();
  g.update(30);
  g.setHidden(false);
  expect(g.charge.active).toBe(false);
  expect(g.power.value).toBe(v);
  expect(g.phase).toBe('playing');
  expect(log).toHaveLength(0);
});

test('minRelease 未満で離すと fizzle（不発の知らせ）を一度出す。押していなければ出さない', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  const log = record(g, ['fizzle', 'shot']);
  g.pressEnd();
  hold(g, 1);
  g.pressEnd();
  g.pressEnd();
  expect(log).toEqual([['fizzle', { power: g.power.value, need: CONFIG.power.minRelease }]]);
  g.pressStart(); g.pressCancel(); // 打ち切りでは知らせない
  expect(log).toHaveLength(1);
});

// 持ち主 2026-11-24「無敵は短く、払うを強く」: 22 → 40 m（巻き込む範囲を広く。tests/game/puffShock.test.js）
test('払う（小爆発）の半径は 40m（持ち主 2026-11-24「払うを強く」）', () => {
  expect(CONFIG.puff.radius).toBe(40);
});

test('settle: 最後の一発を放ったあと（演出・爆発の途中）なら、一発を最後まで進めて over(released) にする。同じ破壊額、命中は settled つきで一度ずつ', () => {
  const finishNormally = () => {
    const g = createGame({ seed: 3, cfg: quiet });
    hold(g, secFor(60)); g.pressEnd();
    runUntil(g, () => g.phase === 'over');
    return g.score.total;
  };
  const expected = finishNormally();
  for (const steps of [0, 5, 20]) { // 演出の止まった間（cinematic）・爆発の途中（finale）
    const g = createGame({ seed: 3, cfg: quiet });
    const log = record(g, ['hit', 'shotScored', 'over', 'cinematicEnd']);
    hold(g, secFor(60)); g.pressEnd();
    step(g, steps);
    expect(g.phase).not.toBe('over');
    const before = log.filter(([n]) => n === 'hit').length;
    g.settle();
    expect(g.phase).toBe('over');
    expect(g.score.total).toBeCloseTo(expected);
    const hits = log.filter(([n]) => n === 'hit');
    expect(hits.length).toBeGreaterThan(before);
    for (const [, p] of hits.slice(before)) expect(p.settled).toBe(true);
    expect(new Set(hits.map(([, p]) => p.hit.id)).size).toBe(hits.length);
    expect(log.filter(([n]) => n === 'over')).toEqual([['over', { reason: 'released', total: g.score.total, outcome: g.outcome }]]);
    expect(log.filter(([n]) => n === 'cinematicEnd')).toHaveLength(1);
    g.settle(); // 終わったあとは何もしない
    expect(log.filter(([n]) => n === 'over')).toHaveLength(1);
  }
});

test('settle: 遊んでいる最中・始まる前・時間切れの後は何もしない', () => {
  const g = createGame({ seed: 1, cfg: quiet });
  g.settle();
  expect(g.phase).toBe('ready');
  hold(g, 1);
  g.settle();
  expect(g.phase).toBe('playing');
});
