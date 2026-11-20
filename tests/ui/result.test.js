import { test, expect } from 'vitest';
import { shareText, reasonText } from '../../src/ui/result.js';

test('shareText は金額と遊ぶ場所のURLを含む日本語', () => {
  const s = shareText(3.2e8, 'https://example.com/machi/');
  expect(s).toMatch(/¥3\.2億/);
  expect(s).toContain('https://example.com/machi/');
  expect(s).toMatch(/[ぁ-ん]/);
});

test('終わった理由の文言', () => {
  expect(reasonText('time')).toBe('時間切れ');
  expect(reasonText('drained')).toBe('力を奪われた');
});
