import { test, expect } from 'vitest';
import { shareText, reasonText, resultContent } from '../../src/ui/result.js';

test('shareText は金額と遊ぶ場所のURLを含む日本語', () => {
  const s = shareText(3.2e8, 'https://example.com/machi/');
  expect(s).toMatch(/¥3\.2億/);
  expect(s).toContain('https://example.com/machi/');
  expect(s).toMatch(/[ぁ-ん]/);
});

test('終わった理由の文言', () => {
  expect(reasonText('released')).toBe('最後の一発');
  expect(reasonText('blackhole')).toBe('ブラックホールになった');
});

test('結果の中身: 最後の一発は破壊額を出し、ブラックホールは破壊額を出さない（共有もしない）', () => {
  expect(resultContent(3.2e8, 'released')).toEqual({ reason: '最後の一発', amount: '¥3.2億', share: true });
  expect(resultContent(0, 'blackhole')).toEqual({ reason: 'ブラックホールになった', amount: null, share: false });
});
