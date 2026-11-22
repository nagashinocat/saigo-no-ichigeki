import { test, expect } from 'vitest';
import { createRecords, betterThan, KEY_PREFIX } from '../../src/game/records.js';

// R3（spec §15）: 今日の街の自己ベストと称号は端末（localStorage）に。鍵は 'saigo-no-ichigeki:' で始める。保存できない環境でも止まらない
function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };

test('R3: 鍵の名前空間', () => {
  expect(KEY_PREFIX).toBe('saigo-no-ichigeki:');
  const s = memStorage();
  const r = createRecords(s);
  r.submitBest('20261121', { rank: 'B', damage: 2e12 });
  r.addTitles(['sweep']);
  expect([...s.m.keys()].sort()).toEqual(['saigo-no-ichigeki:best:20261121', 'saigo-no-ichigeki:titles']);
});

test('R3: 良し悪しはランクが先、同じランクなら被害額', () => {
  expect(betterThan({ rank: 'A', damage: 1 }, { rank: 'B', damage: 9e12 })).toBe(true);
  expect(betterThan({ rank: 'B', damage: 3e12 }, { rank: 'B', damage: 2e12 })).toBe(true);
  expect(betterThan({ rank: 'B', damage: 2e12 }, { rank: 'B', damage: 2e12 })).toBe(false);
  expect(betterThan({ rank: 'C', damage: 9e12 }, { rank: 'S', damage: 1 })).toBe(false);
  expect(betterThan({ rank: 'C', damage: 1 }, null)).toBe(true);
});

test('R3: 街ごとの自己ベスト。初めてと更新は NEW、下回れば前のまま', () => {
  const r = createRecords(memStorage());
  expect(r.best('20261121')).toBe(null);
  expect(r.submitBest('20261121', { rank: 'B', damage: 2e12 })).toEqual({ best: { rank: 'B', damage: 2e12 }, isNew: true, prev: null });
  expect(r.submitBest('20261121', { rank: 'C', damage: 2.4e12 })).toEqual({ best: { rank: 'B', damage: 2e12 }, isNew: false, prev: { rank: 'B', damage: 2e12 } });
  expect(r.submitBest('20261121', { rank: 'A', damage: 1.9e12 })).toEqual({ best: { rank: 'A', damage: 1.9e12 }, isNew: true, prev: { rank: 'B', damage: 2e12 } });
  expect(r.best('20261121')).toEqual({ rank: 'A', damage: 1.9e12 });
  // 別の街は別のベスト
  expect(r.best('20261122')).toBe(null);
  // 同じ端末でページを読み直しても残る
  const s = memStorage();
  createRecords(s).submitBest('20261121', { rank: 'S', damage: 3e12 });
  expect(createRecords(s).best('20261121')).toEqual({ rank: 'S', damage: 3e12 });
});

test('R3: 試しの種（街の鍵なし）は保存しない', () => {
  const s = memStorage();
  expect(createRecords(s).submitBest(null, { rank: 'S', damage: 3e12 })).toEqual({ best: null, isNew: false, prev: null });
  expect(s.m.size).toBe(0);
});

test('R3: 称号は端末に覚え、初めて取ったものだけを返す（NEW）', () => {
  const s = memStorage();
  const r = createRecords(s);
  expect(r.addTitles(['closeCall', 'noPuff'])).toEqual(['closeCall', 'noPuff']);
  expect(r.addTitles(['noPuff', 'sweep'])).toEqual(['sweep']);
  expect(createRecords(s).titles()).toEqual(['closeCall', 'noPuff', 'sweep']);
  expect(r.addTitles([])).toEqual([]);
});

test('R3: 保存できない（投げる・無い・壊れた中身）でも止まらない', () => {
  for (const st of [throwing, null, undefined]) {
    const r = createRecords(st);
    expect(r.best('20261121')).toBe(null);
    expect(r.submitBest('20261121', { rank: 'A', damage: 1 })).toEqual({ best: { rank: 'A', damage: 1 }, isNew: true, prev: null });
    expect(r.titles()).toEqual([]);
    expect(r.addTitles(['sweep'])).toEqual(['sweep']);
  }
  const s = memStorage();
  s.setItem('saigo-no-ichigeki:best:20261121', '{oops');
  s.setItem('saigo-no-ichigeki:titles', '"not an array"');
  const r = createRecords(s);
  expect(r.best('20261121')).toBe(null);
  expect(r.titles()).toEqual([]);
  s.setItem('saigo-no-ichigeki:best:20261122', JSON.stringify({ rank: 'Z', damage: 'lots' }));
  expect(r.best('20261122')).toBe(null);
});
