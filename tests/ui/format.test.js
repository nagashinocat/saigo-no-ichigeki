import { test, expect } from 'vitest';
import { formatYen } from '../../src/ui/format.js';

test('formatYen', () => {
  expect(formatYen(9800)).toBe('¥9,800'); expect(formatYen(32_000_000)).toBe('¥3,200万');
  expect(formatYen(320_000_000)).toBe('¥3.2億'); expect(formatYen(1.5e12)).toBe('¥1.5兆');
});
test('境界と末尾の .0 の除去', () => {
  expect(formatYen(0)).toBe('¥0'); expect(formatYen(10_000)).toBe('¥1万'); expect(formatYen(100_000_000)).toBe('¥1億');
  expect(formatYen(1e12)).toBe('¥1兆');
});
