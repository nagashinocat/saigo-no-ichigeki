import { test, expect } from 'vitest';
import { shareText, headlineText, resultContent, GAME_TITLE, AMOUNT_LABEL } from '../../src/ui/result.js';

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

test('結果の中身: 最後の一発は勝ち負けの見出しと被害額。ブラックホールは被害額を出さない（共有もしない）', () => {
  expect(resultContent(3.2e8, 'released', CLEAR)).toEqual({ title: '最後の一撃', headline: '撃退成功', clear: true, amount: '¥3.2億', share: true });
  expect(resultContent(1.5e7, 'released', FAIL)).toEqual({ title: '最後の一撃', headline: '撃退失敗　残り 3 体', clear: false, amount: '¥1,500万', share: true });
  expect(resultContent(0, 'blackhole', null)).toEqual({ title: '最後の一撃', headline: 'ブラックホールになった', clear: null, amount: null, share: false });
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
