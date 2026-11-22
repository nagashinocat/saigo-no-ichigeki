import { test, expect } from 'vitest';
import { shareText, shareOrCopy, shareFlow, buildCopyFallback, SHARE_NOTE, headlineText, resultContent, breakdownLines, bestLine, GAME_TITLE, AMOUNT_LABEL } from '../../src/ui/result.js';
import { budgetLine } from '../../src/ui/format.js';

const CLEAR = { clear: true, total: 95, survivors: [] };
const FAIL = { clear: false, total: 80, survivors: [{ id: 1, x: 0, z: 600, patrol: true }, { id: 2, x: 610, z: 0, patrol: true }, { id: 3, x: -30, z: 5, patrol: false }] };

test('タイトルは「最後の一撃」（持ち主 15:57）', () => {
  expect(GAME_TITLE).toBe('最後の一撃');
});

test('見出し: 撃退成功 / 撃退失敗　残り N 体 / 時間切れはブラックホール', () => {
  expect(headlineText('released', CLEAR)).toBe('撃退成功');
  expect(headlineText('released', FAIL)).toBe('撃退失敗　残り 3 体');
  expect(headlineText('blackhole', null)).toBe('ブラックホールになった');
});

// R3: 被害額のたとえ（compare）を添える。ブラックホールも称号を共有できるので share は true
test('結果の中身: 最後の一発は勝ち負けの見出しと被害額。ブラックホールは被害額を出さない', () => {
  expect(resultContent(3.2e8, 'released', CLEAR)).toEqual({ title: '最後の一撃', headline: '撃退成功', clear: true, amount: '¥3.2億', compare: budgetLine(3.2e8), share: true });
  expect(resultContent(1.5e7, 'released', FAIL)).toEqual({ title: '最後の一撃', headline: '撃退失敗　残り 3 体', clear: false, amount: '¥1,500万', compare: budgetLine(1.5e7), share: true });
  expect(resultContent(0, 'blackhole', null)).toEqual({ title: '最後の一撃', headline: 'ブラックホールになった', clear: null, amount: null, compare: null, share: true, rank: 'C' }); // R2: 時間切れは C
});

test('共有の文言: タイトル「最後の一撃」、勝ち負け、破壊額、遊ぶ場所の URL', () => {
  const url = 'https://example.com/machi/';
  const ok = shareText(3.2e8, CLEAR, url);
  expect(ok).toContain('最後の一撃');
  expect(ok).toContain('撃退成功');
  expect(ok).toMatch(/¥3\.2億/);
  expect(ok).toContain(url);
  expect(ok).not.toContain('街破壊');
  const ng = shareText(1.5e7, FAIL, url);
  expect(ng).toContain('撃退失敗');
  expect(ng).toContain('残り 3 体');
  expect(ng).toMatch(/¥1,500万/);
});

test('fix1（持ち主 16:48「被害額だけでおまけは書かなくていいよ」）: 金額の見出しは「被害額」だけ。共有の文言も「被害額」', () => {
  expect(AMOUNT_LABEL).toBe('被害額');
  for (const o of [CLEAR, FAIL]) {
    const t = shareText(3.2e8, o, 'https://example.com/');
    expect(t).toContain('被害額 ¥3.2億');
    expect(t).not.toContain('おまけ');
    expect(t).not.toContain('破壊額');
  }
});

// R2（spec §15 ギリギリのボーナス・評価のランク）: 結果にランクを大きく、倍率の内訳を小さな行で。金額の見出しは「被害額」のまま（おまけと書かない）
const BONUS = { base: 1.3e12, timeLeft: 0.47, near: 12, timeMul: 1.4767, closeMul: 1.4, mul: 1.4767 * 1.4 };
const CLEAR_R = { ...CLEAR, bonus: BONUS, puffsUsed: 0, rank: 'S' };
test('R2: 内訳の行: 残り時間と、すぐそばの軍勢（倍率は小数 2 桁）', () => {
  expect(breakdownLines(BONUS)).toEqual(['残り 0.5 秒　×1.48', 'すぐそばの軍勢 12 体　×1.40']);
  expect(breakdownLines({ ...BONUS, timeLeft: 31.2, timeMul: 1, near: 0, closeMul: 1, mul: 1 })).toEqual(['残り 31.2 秒　×1.00', 'すぐそばの軍勢 0 体　×1.00']);
  expect(breakdownLines(null)).toEqual([]);
  for (const l of breakdownLines(BONUS)) expect(l).not.toContain('おまけ');
});
test('R2: 結果の中身にランクと内訳（放った一発のとき）。ブラックホールは C で内訳なし', () => {
  const c = resultContent(2.7e12, 'released', CLEAR_R);
  expect(c.rank).toBe('S');
  expect(c.breakdown).toEqual(breakdownLines(BONUS));
  expect(c.amount).toBe('¥2.7兆');
  const f = resultContent(2.1e12, 'released', { ...FAIL, bonus: BONUS, puffsUsed: 3, rank: 'C' });
  expect(f.rank).toBe('C');
  expect(f.breakdown.length).toBe(2);
  expect(resultContent(0, 'blackhole', null).breakdown).toBeUndefined();
});
test('R2: 共有の文言にランク', () => {
  const t = shareText(2.7e12, CLEAR_R, 'https://example.com/');
  expect(t).toContain('ランク S');
  expect(t).toContain('被害額 ¥2.7兆');
});

// R3（spec §15 今日の街・被害額のたとえ・称号・共有）
const CITY = { label: '今日の街 11/21', share: '今日の街 11/21', link: 'https://example.com/g/?city=20261121' };
const LINK_CITY = { label: '11/20の街（リンク）', share: '11/20の街', link: 'https://example.com/g/?city=20261120' };
const TITLES_NEW = [{ id: 'closeCall', name: 'ギリギリの英雄', isNew: true }, { id: 'noPuff', name: '払わぬ者', isNew: false }];

test('R3: 結果の中身に街の名前・たとえ・称号のバッジ（初めては NEW）・自己ベスト', () => {
  const c = resultContent(2.7e12, 'released', CLEAR_R, { city: CITY, titles: TITLES_NEW, best: { best: { rank: 'S', damage: 2.7e12 }, isNew: true } });
  expect(c.city).toBe('今日の街 11/21');
  expect(c.compare).toBe('国家予算（一般会計 約122兆円）の約8.1日分');
  expect(c.titles).toEqual(TITLES_NEW);
  expect(c.best).toEqual({ text: '自己ベスト S ¥2.7兆', isNew: true });
  const f = resultContent(2.1e12, 'released', { ...FAIL, bonus: BONUS, puffsUsed: 3, rank: 'C' }, { city: LINK_CITY, titles: [], best: { best: { rank: 'A', damage: 2.4e12 }, isNew: false } });
  expect(f.city).toBe('11/20の街（リンク）');
  expect(f.titles).toEqual([]);
  expect(f.best).toEqual({ text: '自己ベスト A ¥2.4兆', isNew: false });
  // ブラックホールは被害額もたとえも無いが、称号と前の自己ベストは出す
  const b = resultContent(0, 'blackhole', null, { city: CITY, titles: [{ id: 'blackhole', name: 'すべてを飲み込んだ者', isNew: true }], best: { best: null, isNew: false } });
  expect(b.compare).toBe(null);
  expect(b.titles.map((t) => t.name)).toEqual(['すべてを飲み込んだ者']);
  expect(b.best).toBe(null);
  // 付けるものが無ければ前と同じ
  expect(resultContent(2.7e12, 'released', CLEAR_R).city).toBeUndefined();
});

test('R3: 自己ベストの行', () => {
  expect(bestLine({ best: { rank: 'B', damage: 1.86e12 }, isNew: false })).toEqual({ text: '自己ベスト B ¥1.9兆', isNew: false });
  expect(bestLine({ best: null, isNew: false })).toBe(null);
  expect(bestLine(null)).toBe(null);
});

test('R3: 共有の文: 題字・ランク・勝ち負け・被害額とたとえ・称号・?city= のリンク・#最後の一撃', () => {
  const t = shareText(2.7e12, CLEAR_R, CITY.link, { reason: 'released', city: CITY, titles: TITLES_NEW });
  expect(t).toBe([
    '「最後の一撃」撃退成功！ ランク S',
    '被害額 ¥2.7兆（国家予算（一般会計 約122兆円）の約8.1日分）',
    '称号「ギリギリの英雄」「払わぬ者」',
    '今日の街 11/21 に挑戦 → https://example.com/g/?city=20261121',
    '#最後の一撃',
  ].join('\n'));
  const f = shareText(2.1e12, { ...FAIL, rank: 'C' }, LINK_CITY.link, { reason: 'released', city: LINK_CITY, titles: [] });
  expect(f).toBe([
    '「最後の一撃」撃退失敗…残り 3 体。 ランク C',
    '被害額 ¥2.1兆（国家予算（一般会計 約122兆円）の約6.3日分）',
    '11/20の街 に挑戦 → https://example.com/g/?city=20261120',
    '#最後の一撃',
  ].join('\n'));
  const b = shareText(0, null, CITY.link, { reason: 'blackhole', city: CITY, titles: [{ id: 'blackhole', name: 'すべてを飲み込んだ者', isNew: true }] });
  expect(b).toBe([
    '「最後の一撃」ブラックホールになった… ランク C',
    '称号「すべてを飲み込んだ者」',
    '今日の街 11/21 に挑戦 → https://example.com/g/?city=20261121',
    '#最後の一撃',
  ].join('\n'));
  expect(b).not.toContain('被害額');
});

test('R3: 共有は Web Share、無ければクリップボードへ写して「コピーしました」', async () => {
  const got = [];
  expect(await shareOrCopy('T', { nav: { share: async (d) => got.push(['share', d]) } })).toBe('shared');
  expect(got).toEqual([['share', { text: 'T' }]]);
  // 取り消しは何も出さない
  expect(await shareOrCopy('T', { nav: { share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } } })).toBe('cancel');
  // Web Share が無い・失敗した → クリップボード
  expect(await shareOrCopy('T', { nav: { clipboard: { writeText: async (t) => got.push(['copy', t]) } } })).toBe('copied');
  expect(await shareOrCopy('T', { nav: { share: async () => { throw new Error('NotAllowed'); }, clipboard: { writeText: async (t) => got.push(['copy', t]) } } })).toBe('copied');
  expect(got.slice(1)).toEqual([['copy', 'T'], ['copy', 'T']]);
  // クリップボードも使えない → 古い execCommand、それも駄目なら failed
  const doc = (ok) => ({ body: { append() {} }, createElement: () => ({ setAttribute() {}, style: {}, select() {}, remove() {} }), execCommand: () => ok });
  expect(await shareOrCopy('T', { nav: {}, doc: doc(true) })).toBe('copied');
  expect(await shareOrCopy('T', { nav: {}, doc: doc(false) })).toBe('failed');
  expect(await shareOrCopy('T', { nav: null, doc: null })).toBe('failed');
  expect(SHARE_NOTE.copied).toBe('コピーしました');
});

// R3 fix1（点検 Important 1）: iframe の中で正式な URL が無ければリンクを出さず、街の名前だけで友達が同じ街を探せるようにする
test('R3 fix1: リンクが無いときの共有の文は街の名前だけ（URL を出さない）', () => {
  const t = shareText(2.7e12, CLEAR_R, null, { reason: 'released', city: { ...CITY, link: null }, titles: [] });
  expect(t).toBe([
    '「最後の一撃」撃退成功！ ランク S',
    '被害額 ¥2.7兆（国家予算（一般会計 約122兆円）の約8.1日分）',
    '今日の街 11/21 に挑戦',
    '#最後の一撃',
  ].join('\n'));
  expect(t).not.toMatch(/https?:|null|undefined/);
  const b = shareText(0, null, null, { reason: 'blackhole', city: { ...CITY, link: null }, titles: [] });
  expect(b).not.toMatch(/https?:|null|undefined/);
  expect(b).toContain('今日の街 11/21 に挑戦');
  // 街も無ければ挑戦の行ごと出さない
  expect(shareText(2.7e12, CLEAR_R, null, { reason: 'released' })).not.toMatch(/https?:|null|undefined|挑戦/);
});

// 小さな作り物の document（textarea・ボタン・押す）
function fakeDoc() {
  const mk = (tag) => {
    const e = { tag, className: '', textContent: '', value: '', children: [], attrs: {}, listeners: {}, style: {}, selected: false, removed: false,
      append(...c) { this.children.push(...c); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
      select() { this.selected = true; }, focus() { this.focused = true; }, remove() { this.removed = true; } };
    return e;
  };
  return { createElement: mk, createTextNode: (t) => ({ tag: '#text', textContent: t }), body: { append() {} }, execCommand() { throw new Error('no'); } };
}
const find = (e, pred) => (pred(e) ? e : (e.children ?? []).map((c) => find(c, pred)).find(Boolean));
test('R3 fix1: Web Share もクリップボードも使えないとき、文を選べる読み取り専用の textarea で出す（閉じるボタン付き）', async () => {
  const doc = fakeDoc();
  const nav = { share: async () => { throw new Error('NotAllowedError'); }, clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } } };
  expect(await shareOrCopy('文', { nav, doc })).toBe('failed');
  const shown = [], notes = [];
  const r = await shareFlow('共有の文', { share: (t) => shareOrCopy(t, { nav, doc }), note: (m) => notes.push(m), fallback: (t) => shown.push(t) });
  expect(r).toBe('failed');
  expect(shown).toEqual(['共有の文']);
  expect(notes).toEqual([]); // 「コピーできませんでした」だけで終わらせない
  // 写せたときは「コピーしました」、取り消しは何も出さない
  const n2 = [];
  await shareFlow('x', { share: async () => 'copied', note: (m) => n2.push(m), fallback: () => n2.push('FALLBACK') });
  await shareFlow('x', { share: async () => 'cancel', note: (m) => n2.push(m), fallback: () => n2.push('FALLBACK') });
  expect(n2).toEqual(['コピーしました']);
  // 出し方: 読み取り専用・全部を選んだ textarea と閉じるボタン
  let closed = 0;
  const box = buildCopyFallback(doc, '共有の文\nhttps://example.com/?city=20261121', () => closed++);
  const ta = find(box, (e) => e.tag === 'textarea');
  expect(ta.value).toBe('共有の文\nhttps://example.com/?city=20261121');
  expect(ta.attrs.readonly).toBe('');
  expect(ta.selected).toBe(true);
  expect(box.className).toContain('result-copybox');
  const btn = find(box, (e) => e.tag === 'button');
  expect(btn.textContent).toBe('閉じる');
  btn.listeners.click[0]();
  expect(closed).toBe(1);
  expect(find(box, (e) => e.textContent && /手で/.test(e.textContent))).toBeTruthy();
});

// fix2（再点検 Minor 2）: 携帯で手で写す箱を長押しで選べること。#result の -webkit-touch-callout: none・user-select: none を箱の中だけ戻し、
// window の contextmenu の止め（長押しのメニュー）を箱の中では効かせない
import { readFileSync } from 'node:fs';
import { allowsNativeMenu } from '../../src/ui/result.js';
test('fix2: 手で写す箱は長押しで選べる（#result の止めより強い規則で touch-callout・user-select を戻す）', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const m = html.match(/#result \.result-copybox, #result \.result-copybox \* \{([^}]*)\}/);
  expect(m, '#result .result-copybox の規則').toBeTruthy();
  const body = m[1];
  expect(body).toMatch(/-webkit-touch-callout:\s*default/);
  expect(body).toMatch(/(^|[;\s])user-select:\s*text/);
  expect(body).toMatch(/-webkit-user-select:\s*text/);
  expect(body).toMatch(/touch-action:\s*(auto|manipulation)/);
  // 止めの規則（#result）はそのまま
  expect(html).toMatch(/#game, #hud, #start, #result \{[^}]*-webkit-touch-callout: none/);
});
test('fix2: contextmenu の止めは、手で写す箱の中では効かせない', () => {
  const inBox = { closest: (sel) => (sel === '.result-copybox' ? {} : null) };
  const outside = { closest: () => null };
  expect(allowsNativeMenu(inBox)).toBe(true);
  expect(allowsNativeMenu(outside)).toBe(false);
  expect(allowsNativeMenu(null)).toBe(false);
  expect(allowsNativeMenu({})).toBe(false); // closest の無いもの（window・テキストの節）
  const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  expect(main).toMatch(/addEventListener\('contextmenu', \(e\) => \{ if \(!allowsNativeMenu\(e\.target\)\) e\.preventDefault\(\); \}\)/);
});
