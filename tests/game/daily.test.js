import { test, expect } from 'vitest';
import { jstDayKey, parseCityKey, citySeed, pickCity, cityLabel, cityLink } from '../../src/game/daily.js';
import { createGame } from '../../src/game/game.js';
import { steerBot, actBot } from '../../src/game/bot.js';

// R3（spec §15 今日の街）: 日本時間の日付（YYYYMMDD）で全員が同じ街。?city=YYYYMMDD で上書き（友達のリンク）。?seed=（撮影・試し）がいちばん強い
const at = (iso) => Date.parse(iso);

test('R3: 今日の街は日本時間の日付（UTC 15:00 で日付が変わる）', () => {
  expect(jstDayKey(at('2026-11-21T14:59:59Z'))).toBe('20261121');
  expect(jstDayKey(at('2026-11-21T15:00:00Z'))).toBe('20261122');
  expect(jstDayKey(at('2026-12-31T15:00:00Z'))).toBe('20270101');
  expect(jstDayKey(at('2026-03-04T00:00:00Z'))).toBe('20260304');
});

test('R3: ?city= は実在の日付の YYYYMMDD だけを受ける', () => {
  expect(parseCityKey('20261121')).toBe('20261121');
  for (const bad of [null, '', '2026112', '202611211', '20261131', '20260230', '2026-11-21', 'abc', '19991301', '00000101']) expect(parseCityKey(bad)).toBe(null);
  expect(parseCityKey('20240229')).toBe('20240229'); // うるう日
});

test('R3: 街の種は日付から決まる（同じ日は同じ種、別の日は別の種）', () => {
  expect(citySeed('20261121')).toBe(citySeed('20261121'));
  expect(citySeed('20261121')).not.toBe(citySeed('20261122'));
  expect(Number.isInteger(citySeed('20261121'))).toBe(true);
});

test('R3: 優先順位 ?seed=（試し）> ?city=（リンク）> 今日の街', () => {
  const now = at('2026-11-21T03:00:00Z');
  const P = (s) => new URLSearchParams(s);
  expect(pickCity({ params: P(''), now })).toEqual({ source: 'daily', key: '20261121', seed: citySeed('20261121'), today: '20261121' });
  expect(pickCity({ params: P('?city=20261120'), now })).toEqual({ source: 'link', key: '20261120', seed: citySeed('20261120'), today: '20261121' });
  expect(pickCity({ params: P('?city=20261120&seed=42'), now })).toEqual({ source: 'debug', key: null, seed: 42, today: '20261121' });
  expect(pickCity({ params: P('?seed=7'), now }).seed).toBe(7);
  // 壊れた ?city= は今日の街へ
  expect(pickCity({ params: P('?city=hello'), now })).toEqual({ source: 'daily', key: '20261121', seed: citySeed('20261121'), today: '20261121' });
  // 今日の日付のリンクで来た友達は、今日の街と同じ（見出しも今日の街）
  expect(pickCity({ params: P('?city=20261121'), now }).source).toBe('daily');
});

test('R3: 結果の街の名前「今日の街 11/21」「11/20の街（リンク）」（年が違えば年も）', () => {
  expect(cityLabel({ source: 'daily', key: '20261121', today: '20261121' })).toBe('今日の街 11/21');
  expect(cityLabel({ source: 'link', key: '20261120', today: '20261121' })).toBe('11/20の街（リンク）');
  expect(cityLabel({ source: 'link', key: '20251120', today: '20261121' })).toBe('2025/11/20の街（リンク）');
  expect(cityLabel({ source: 'link', key: '20260301', today: '20261121' })).toBe('3/1の街（リンク）');
  expect(cityLabel({ source: 'debug', key: null, seed: 42, today: '20261121' })).toBe('試しの街（seed 42）');
});

test('R3: 共有のリンクは今のページ（origin + pathname）に ?city= だけ（試しの種は ?seed=）', () => {
  const loc = { origin: 'https://nagashinocat.github.io', pathname: '/saigo/' };
  expect(cityLink({ source: 'daily', key: '20261121' }, loc)).toBe('https://nagashinocat.github.io/saigo/?city=20261121');
  expect(cityLink({ source: 'link', key: '20261120' }, loc)).toBe('https://nagashinocat.github.io/saigo/?city=20261120');
  expect(cityLink({ source: 'debug', key: null, seed: 9 }, loc)).toBe('https://nagashinocat.github.io/saigo/?seed=9');
});

// 同じ種なら街も軍勢の湧き方・見回りも同じ（友達のリンクで同じ街に挑める）
function schedule(seed, sec = 25) {
  const g = createGame({ seed });
  g.begin(); g.pressStart();
  const log = [];
  for (let i = 0; i < sec * 30; i++) {
    steerBot(g, {}); actBot(g, { grab: 2, trigger: 0, crowd: Infinity, hide: true }); g.update(1 / 30);
    if (i % 30 === 0) log.push(g.enemies.list.map((e) => [e.id, e.kind ?? '', e.patrol ? 1 : 0, e.state, +(e.x ?? NaN).toFixed(3), +(e.z ?? NaN).toFixed(3)]));
  }
  return { city: g.city, log, hero: [g.hero.x, g.hero.z], power: g.power.value };
}
test('R3: 同じ日の街は同じ街・同じ軍勢の時刻表（見回り・種類を含む）。別の日は別の街', () => {
  const s = citySeed('20261121');
  const a = schedule(s), b = schedule(s);
  expect(a.city).toEqual(b.city);
  expect(a.log).toEqual(b.log);
  expect(a.hero).toEqual(b.hero);
  expect(a.log.at(-1).some((r) => r[2] === 1)).toBe(true); // 見回る者も入っている
  const c = schedule(citySeed('20261122'), 5);
  expect(c.city.buildings.map((x) => [x.x, x.z])).not.toEqual(a.city.buildings.map((x) => [x.x, x.z]));
}, 30000);
