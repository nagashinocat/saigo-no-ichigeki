import { test, expect } from 'vitest';
import { settleRun, jstHour } from '../../src/game/runResult.js';
import { createRecords } from '../../src/game/records.js';
import { TITLES, pickTitle, runSeed } from '../../src/game/titles.js';

// R3 fix1: 結果を出すとき — 自己ベスト・今日の初撃退・記録の塗り替え・日本時間の時刻から、結果に出す称号を一つ選び、初めてなら NEW
function memStorage() { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
const bonus = (timeLeft) => ({ base: 1, timeLeft, near: 9, timeMul: 1, closeMul: 1, mul: 1 });
const stats = (o = {}) => ({ puffs: 2, maxCombo: 0, hides: 2, spotted: 2, bossGrabbed: false, kills: { normal: 3, patrol: 3, heavy: 1, drainer: 1, boss: 0 }, release: { timeLeft: 5, near: 9, power: 100, centreDist: 25 }, ...o });
const clearO = (o = {}) => ({ clear: true, total: 9, survivors: [], bonus: bonus(5), puffsUsed: 2, rank: 'B', ...o });
const NOON = Date.parse('2026-11-22T03:00:00Z'); // 日本時間 12 時
const base = (o = {}) => ({ cityKey: '20261122', citySeed: 42, reason: 'released', outcome: clearO(), stats: stats(), damage: 2.4e12, cityValue: 0.42e12, now: NOON, ...o });

test('R3 fix1: 日本時間の時', () => {
  expect(jstHour(Date.parse('2026-11-21T15:30:00Z'))).toBe(0);
  expect(jstHour(Date.parse('2026-11-21T19:59:00Z'))).toBe(4);
  expect(jstHour(NOON)).toBe(12);
});

test('R3 fix1: その日の街で初めての撃退成功 → 今日の初撃退。2 回目は付かない。前の回が失敗だけなら初めて', () => {
  const rec = createRecords(memStorage());
  const a = settleRun({ records: rec, ...base() });
  expect(a.ctx.firstClearToday).toBe(true);
  expect(a.ctx.newBest).toBe(false); // 前のベストが無い
  expect(a.best).toMatchObject({ isNew: true });
  const b = settleRun({ records: rec, ...base({ damage: 2.5e12 }) });
  expect(b.ctx.firstClearToday).toBe(false);
  expect(b.ctx.newBest).toBe(true); // 前のベストを塗り替えた
  const rec2 = createRecords(memStorage());
  settleRun({ records: rec2, ...base({ outcome: clearO({ clear: false, survivors: [{}], rank: 'C' }) }) });
  expect(settleRun({ records: rec2, ...base() }).ctx.firstClearToday).toBe(true);
  // 試しの種（街の鍵なし）は付けない
  expect(settleRun({ records: createRecords(memStorage()), ...base({ cityKey: null }) }).ctx.firstClearToday).toBe(false);
});

test('R3 fix1: 結果に出す称号は一つ（pickTitle と同じ）。初めては NEW、二度目は NEW なし。覚えるのは出した称号だけ', () => {
  const s = memStorage();
  const rec = createRecords(s);
  const r = settleRun({ records: rec, ...base({ now: Date.parse('2026-11-21T17:00:00Z') }) }); // 日本時間 2 時
  expect(r.titles).toHaveLength(1);
  expect(r.titles[0].id).toBe(pickTitle(r.ctx, runSeed(r.ctx, 42)));
  const t = TITLES.find((x) => x.id === r.titles[0].id);
  expect(r.titles[0]).toEqual({ id: t.id, name: t.name, rarity: t.rarity, isNew: true });
  expect(JSON.parse(s.m.get('saigo-no-ichigeki:titles'))).toEqual([t.id]);
  const again = settleRun({ records: rec, ...base({ now: Date.parse('2026-11-21T17:00:00Z') }) });
  if (again.titles[0]?.id === t.id) expect(again.titles[0].isNew).toBe(false);
});

test('R3 fix1: ブラックホールは前のベストを見せ、記録しない。称号は「すべてを飲み込んだ者」など', () => {
  const rec = createRecords(memStorage());
  settleRun({ records: rec, ...base() });
  const r = settleRun({ records: rec, ...base({ reason: 'blackhole', outcome: null, damage: 0, stats: stats({ release: null }) }) });
  expect(r.best).toMatchObject({ isNew: false, best: { rank: 'B', damage: 2.4e12 } });
  expect(r.titles).toHaveLength(1);
  expect(r.ctx.firstClearToday).toBe(false);
});

test('R3 fix1: 何も取れなければ称号なし（空）', () => {
  const r = settleRun({ records: createRecords(memStorage()), ...base({ cityKey: null, outcome: clearO({ clear: false, survivors: [{}], rank: 'C' }) }) });
  expect(r.titles).toEqual([]);
});
