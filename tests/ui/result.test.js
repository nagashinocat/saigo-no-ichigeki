import { test, expect } from 'vitest';
import { shareText, headlineText, resultContent, breakdownLines, GAME_TITLE, AMOUNT_LABEL } from '../../src/ui/result.js';

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
  expect(resultContent(0, 'blackhole', null)).toEqual({ title: '最後の一撃', headline: 'ブラックホールになった', clear: null, amount: null, share: false, rank: 'C' }); // R2: 時間切れは C
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
