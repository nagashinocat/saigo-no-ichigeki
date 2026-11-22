import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// 持ち主 2026-11-23 08:41（「リトライ押したら暗い画面に操作説明が出てる」「TAPの文字がかなりデカく」）: リトライはページを読み直さず、
// その場で遊び直す。game.restart() は同じ種の街で、読み直したページの createGame({ seed }) と同じ一回を最初から始める
// （軍勢の湧き方・種類・見回り・大物・吸う・払う・隠れる・勝ち負けまで同じ）。登録した知らせ（on）はそのまま残る

const DT = 1 / 30;
// 決まった操作で一回を遊び、途中の姿と終わりの結果を写す
function play(g, { releaseAt = 22 } = {}) {
  const trace = [];
  let t = 0, released = false;
  g.pressStart();
  // 放てなければ（力が足りない）時間切れまで（ブラックホール）。どちらでも 'over' まで
  for (let i = 0; g.phase !== 'over' && t < CONFIG.roundSeconds + 30; i++, t += DT) {
    g.setMove(Math.cos(t * 0.9), Math.sin(t * 0.6));
    if (Math.abs(t - 5) < DT / 2 || Math.abs(t - 11) < DT / 2) g.puff();
    if (Math.abs(t - 8) < DT / 2) g.hide(1, 0);
    if (!released && t >= releaseAt) { g.pressEnd(); released = true; }
    g.update(DT);
    if (i % 15 === 0) {
      trace.push({
        t: +t.toFixed(3), phase: g.phase, hero: [g.hero.x, g.hero.z, g.hero.hidden], power: g.power.value, left: g.timer.remaining, puffs: g.puffsLeft, drained: g.drainedTotal,
        enemies: g.enemies.list.map((e) => [e.id, e.kind ?? null, e.state, +e.x.toFixed(6), +e.z.toFixed(6)]),
      });
    }
  }
  return { trace, outcome: g.outcome, stats: g.runStats, score: g.score.total, phase: g.phase };
}

test('restart: 遊んだあと（放って結果まで）でも、同じ種の新しい createGame と同じ姿から始まる', () => {
  const seed = 20261123;
  const fresh = createGame({ seed });
  const g = createGame({ seed });
  play(g, { releaseAt: 9 });
  expect(g.phase).toBe('over');
  g.restart();
  expect(g.phase).toBe('ready');
  expect(g.timer.remaining).toBe(CONFIG.roundSeconds);
  expect(g.power.value).toBe(fresh.power.value);
  expect(g.puffsLeft).toBe(fresh.puffsLeft);
  expect(g.drainedTotal).toBe(0);
  expect(g.outcome).toBe(null);
  expect(g.charge.active).toBe(false);
  expect(g.blasts.length).toBe(0);
  expect(g.maxCombo).toBe(0);
  expect(g.runStats).toEqual(fresh.runStats);
  expect({ x: g.hero.x, z: g.hero.z, hidden: !!g.hero.hidden }).toEqual({ x: fresh.hero.x, z: fresh.hero.z, hidden: !!fresh.hero.hidden });
  expect(g.enemies.list).toEqual(fresh.enemies.list);
  expect(g.city).toBe(g.city); // 街の作りは同じもの（描く側の cityView と同じ id）
  expect(g.cityValue).toBe(fresh.cityValue);
});

test('restart: そのあと同じ操作で遊ぶと、読み直したページ（新しい createGame）とまったく同じ一回になる（5 回続けても）', () => {
  const seed = 777;
  const want = play(createGame({ seed }));
  expect(want.phase).toBe('over');
  const g = createGame({ seed });
  // 一回目は別の遊び方（ブラックホールまで放たない）
  play(g, { releaseAt: Infinity });
  expect(g.phase).toBe('over');
  for (let k = 0; k < 5; k++) {
    g.restart();
    expect(play(g)).toEqual(want);
  }
});

test('restart: 登録した知らせ（on）は残り、新しい一回の出来事を知らせる。止めていた（setHidden）ことは一時停止の側が決める', () => {
  const g = createGame({ seed: 5 });
  const got = [];
  g.on('shot', () => got.push('shot'));
  g.on('over', (e) => got.push('over:' + e.reason));
  play(g, { releaseAt: 9 });
  expect(got).toEqual(['shot', 'over:released']);
  g.setHidden(true);
  g.restart();
  g.pressStart();
  expect(g.phase).toBe('ready'); // 一時停止の間は始まらない
  g.setHidden(false);
  play(g, { releaseAt: 9 });
  expect(got).toEqual(['shot', 'over:released', 'shot', 'over:released']);
});
