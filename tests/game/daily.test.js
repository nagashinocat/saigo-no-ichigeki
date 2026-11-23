import { test, expect } from 'vitest';
import { jstDayKey, parseCityKey, citySeed, pickCity, cityLabel, cityLink, shareBase, rememberRetryCity, RETRY_CITY_KEY } from '../../src/game/daily.js';
import { createGame } from '../../src/game/game.js';
import { SHARE_BASE_URL, CONFIG } from '../../src/config.js';
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
  expect(cityLink({ source: 'daily', key: '20261121' }, { loc })).toBe('https://nagashinocat.github.io/saigo/?city=20261121');
  expect(cityLink({ source: 'link', key: '20261120' }, { loc })).toBe('https://nagashinocat.github.io/saigo/?city=20261120');
  expect(cityLink({ source: 'debug', key: null, seed: 9 }, { loc })).toBe('https://nagashinocat.github.io/saigo/?seed=9');
});

// R3 fix1（点検 Important 1）: artifact の iframe の中のアドレスは友達が開けない。正式な URL（SHARE_BASE_URL）を使い分ける
const PAGES = 'https://nagashinocat.github.io/saigo/';
const pagesLoc = { origin: 'https://nagashinocat.github.io', pathname: '/saigo/' };
const frameLoc = { origin: 'https://abc123.claudeusercontent.com', pathname: '/r/index.html' };
const devLoc = { origin: 'http://localhost:5199', pathname: '/' };
test('R3 fix1: リンクの元 — 上の窓か iframe か × 正式な URL のあり・なし × 今の場所が正式な URL と同じか', () => {
  // 上の窓・正式な URL なし → 今の場所
  expect(shareBase({ loc: devLoc, framed: false, canonical: null })).toBe('http://localhost:5199/');
  // 上の窓・正式な URL あり・同じ場所 → 今の場所（= 正式な URL）
  expect(shareBase({ loc: pagesLoc, framed: false, canonical: PAGES })).toBe(PAGES);
  expect(shareBase({ loc: pagesLoc, framed: false, canonical: 'https://nagashinocat.github.io/saigo/?x=1#y' })).toBe(PAGES); // 引数・# は比べない
  // 上の窓・正式な URL あり・違う場所 → 正式な URL
  expect(shareBase({ loc: devLoc, framed: false, canonical: PAGES })).toBe(PAGES);
  // iframe・正式な URL あり（違う場所でも同じ場所でも）→ 正式な URL
  expect(shareBase({ loc: frameLoc, framed: true, canonical: PAGES })).toBe(PAGES);
  expect(shareBase({ loc: pagesLoc, framed: true, canonical: PAGES })).toBe(PAGES);
  // iframe・正式な URL なし → リンクを出さない
  expect(shareBase({ loc: frameLoc, framed: true, canonical: null })).toBe(null);
  expect(shareBase({ loc: frameLoc, framed: true, canonical: '' })).toBe(null);
  // cityLink も同じ
  expect(cityLink({ source: 'daily', key: '20261121' }, { loc: frameLoc, framed: true, canonical: PAGES })).toBe(PAGES + '?city=20261121');
  expect(cityLink({ source: 'daily', key: '20261121' }, { loc: frameLoc, framed: true, canonical: null })).toBe(null);
});
test('R3 fix1（持ち主 19:03）: 正式な URL の既定は GitHub Pages の nagashinocat/saigo-no-ichigeki（VITE_SHARE_URL で上書きできる）', () => {
  expect(SHARE_BASE_URL).toBe(import.meta.env.VITE_SHARE_URL || 'https://nagashinocat.github.io/saigo-no-ichigeki/');
  // artifact の iframe の中でも、既定の正式な URL へのリンクになる
  expect(cityLink({ source: 'daily', key: '20261122' }, { loc: frameLoc, framed: true, canonical: SHARE_BASE_URL })).toBe('https://nagashinocat.github.io/saigo-no-ichigeki/?city=20261122');
});
test('R3 fix1: iframe の中のアドレスは、どの組み合わせでも出さない', () => {
  for (const framed of [true, false]) for (const canonical of [null, '', PAGES]) for (const c of [{ source: 'daily', key: '20261121' }, { source: 'link', key: '20261120' }, { source: 'debug', key: null, seed: 3 }]) {
    const url = cityLink(c, { loc: frameLoc, framed, canonical });
    if (framed) expect(String(url)).not.toContain('claudeusercontent');
    if (url) expect(url.startsWith(framed ? PAGES : (canonical ? PAGES : frameLoc.origin))).toBe(true);
  }
});

// R3 fix1（点検 Minor 1）: 「もう一度」は日本時間の 0 時をまたいでも同じ街。今日の街の鍵を sessionStorage に一度だけ渡す
function memStorage() { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
const throwing = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
test('R3 fix1: もう一度の街は 0 時をまたいでも同じ（一度だけ。?seed= と ?city= が先）', () => {
  const P = (q) => new URLSearchParams(q);
  const s = memStorage();
  const before = pickCity({ params: P(''), now: at('2026-11-21T14:59:00Z') });
  expect(before.key).toBe('20261121');
  rememberRetryCity(s, before);
  expect(s.m.get(RETRY_CITY_KEY)).toBe('20261121');
  expect(RETRY_CITY_KEY.startsWith('saigo-no-ichigeki:')).toBe(true);
  const after = pickCity({ params: P(''), now: at('2026-11-21T15:01:00Z'), storage: s });
  expect(after).toMatchObject({ source: 'daily', key: '20261121', seed: citySeed('20261121'), today: '20261122' });
  expect(cityLabel(after)).toBe('今日の街 11/21');
  // 一度読んだら消える（次の読み直しは新しい日の街）
  expect(s.m.has(RETRY_CITY_KEY)).toBe(false);
  expect(pickCity({ params: P(''), now: at('2026-11-21T15:02:00Z'), storage: s }).key).toBe('20261122');
  // ?seed= と ?city= は URL に残るので、そちらが先（覚えた鍵は使わずに消す）
  rememberRetryCity(s, before);
  expect(pickCity({ params: P('?seed=5'), now: at('2026-11-21T15:01:00Z'), storage: s }).source).toBe('debug');
  rememberRetryCity(s, before);
  expect(pickCity({ params: P('?city=20261101'), now: at('2026-11-21T15:01:00Z'), storage: s }).key).toBe('20261101');
  expect(s.m.has(RETRY_CITY_KEY)).toBe(false);
  // リンクの街・試しの種は覚えない（URL に残る）
  rememberRetryCity(s, { source: 'link', key: '20261101' });
  rememberRetryCity(s, { source: 'debug', key: null, seed: 3 });
  expect(s.m.has(RETRY_CITY_KEY)).toBe(false);
  // 壊れた中身は無視、保存できなくても止まらない
  s.setItem(RETRY_CITY_KEY, 'garbage');
  expect(pickCity({ params: P(''), now: at('2026-11-21T15:01:00Z'), storage: s }).key).toBe('20261122');
  expect(() => rememberRetryCity(throwing, before)).not.toThrow();
  expect(pickCity({ params: P(''), now: at('2026-11-21T15:01:00Z'), storage: throwing }).key).toBe('20261122');
  expect(pickCity({ params: P(''), now: at('2026-11-21T15:01:00Z'), storage: null }).key).toBe('20261122');
});

// 同じ種なら街も軍勢の湧き方・見回りも同じ（友達のリンクで同じ街に挑める）
function schedule(seed, sec = CONFIG.enemy.kinds.boss.at + 3) { // Pass 2: 大物は 55 秒
  const g = createGame({ seed });
  g.begin(); g.pressStart();
  const log = [], bossLog = [];
  g.on('bossArrive', (p) => bossLog.push(JSON.parse(JSON.stringify(p))));
  for (let i = 0; i < sec * 30; i++) {
    steerBot(g, {}); actBot(g, { grab: 2, trigger: 0, crowd: Infinity, hide: true }); g.update(1 / 30);
    if (i % 30 === 0) log.push(g.enemies.list.map((e) => [e.id, e.kind ?? '', e.patrol ? 1 : 0, e.state, +(e.x ?? NaN).toFixed(3), +(e.z ?? NaN).toFixed(3)]));
  }
  return { city: g.city, log, bossLog, hero: [g.hero.x, g.hero.z], power: g.power.value };
}
test('R3: 同じ日の街は同じ街・同じ軍勢の時刻表（見回り・種類・大物（Pass 2: 55 秒）を含む）。別の日は別の街', () => {
  const s = citySeed('20261121');
  const a = schedule(s), b = schedule(s);
  expect(a.city).toEqual(b.city);
  expect(a.log).toEqual(b.log);
  expect(a.hero).toEqual(b.hero);
  expect(a.log.at(-1).some((r) => r[2] === 1)).toBe(true); // 見回る者も入っている
  // fix1（点検 Minor 4）: 大物（49 秒）まで進めて、同じ大物が同じ所に来る
  const bossA = a.log.at(-1).filter((r) => r[1] === 'boss'), bossB = b.log.at(-1).filter((r) => r[1] === 'boss');
  expect(bossA).toHaveLength(1);
  expect(bossA).toEqual(bossB);
  expect(a.bossLog).toEqual(b.bossLog);
  expect(a.bossLog).toHaveLength(1);
  const c = schedule(citySeed('20261122'), 5);
  expect(c.city.buildings.map((x) => [x.x, x.z])).not.toEqual(a.city.buildings.map((x) => [x.x, x.z]));
}, 60000);

// リトライの見直し Minor 2: 控えの読み直しで sessionStorage が使えない（artifact の iframe）ときも、日本時間の 0 時をまたいで同じ今日の街。
// 印は URL の #retry=<鍵>（markRetry）。pickCity はそれを一度だけ使う（introMode が読んだら消す）
test('pickCity: #retry=<鍵> の今日の街を使う（0 時をまたいでも）。?seed=・?city= が先。壊れた鍵は使わない', async () => {
  const { markRetry, introMode } = await import('../../src/ui/introFlow.js');
  const P = (s) => new URLSearchParams(s);
  const throwing = { getItem() { throw new DOMException('x', 'SecurityError'); }, setItem() { throw new DOMException('x', 'SecurityError'); }, removeItem() {} };
  const location = { pathname: '/index.html', search: '', hash: '' };
  const page = { location, history: { state: null, replaceState(_s, _t, url) { const u = new URL(url, 'https://x.test'); location.search = u.search; location.hash = u.hash; } } };
  const before = Date.UTC(2026, 10, 21, 14, 59, 0), after = Date.UTC(2026, 10, 21, 15, 1, 0); // 日本時間 11/21 23:59 → 11/22 0:01
  const pick = pickCity({ params: P(''), now: before, storage: throwing });
  expect(markRetry(throwing, page, pick.key)).toBe('hash');
  expect(location.hash).toBe('#retry=20261121');
  // 読み直したページ（main.js と同じ順: pickCity → introMode）
  const again = pickCity({ params: P(location.search), now: after, storage: throwing, hash: location.hash });
  expect(again).toEqual({ source: 'daily', key: '20261121', seed: citySeed('20261121'), today: '20261122' });
  expect(introMode({ params: P(location.search), storage: throwing, page })).toBe('retry');
  expect(location.hash).toBe(''); // 一度だけ
  expect(pickCity({ params: P(''), now: after, storage: throwing, hash: location.hash }).key).toBe('20261122');
  // ?seed=・?city= が先。壊れた鍵・鍵なしの #retry は今日の街
  expect(pickCity({ params: P('?seed=7'), now: after, hash: '#retry=20261121' }).seed).toBe(7);
  expect(pickCity({ params: P('?city=20261101'), now: after, hash: '#retry=20261121' }).key).toBe('20261101');
  expect(pickCity({ params: P(''), now: after, hash: '#retry=2026xx21' }).key).toBe('20261122');
  expect(pickCity({ params: P(''), now: after, hash: '#retry' }).key).toBe('20261122');
});
