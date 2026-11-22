import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R1e fix1（見直し: 説明の言葉がぶつかる）: 「払う」は短いタップ（まわりの者をはがす）だけの言葉。
// R1f（持ち主 18:14「LOOK OUT!の矢印をタップ」）: 隠れる操作は「LOOK OUT! の矢印をタップ」。シュッ（なぞる）はやめたので説明からも消す
test('R1f: はじめの説明で、隠れる操作は「LOOK OUT! の矢印をタップ」（シュッとなぞるは出さない）。「払う」は短いタップの言葉だけ', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const m = html.match(/<div id="start">([\s\S]*?)<\/div>/);
  expect(m).not.toBe(null);
  const text = m[1].replace(/<[^>]+>/g, ' ');
  expect(text).not.toContain('シュッ');
  expect(text).not.toContain('なぞ');
  expect(text).toContain('LOOK OUT!');
  expect(text).toContain('矢印をタップ');
  expect(text).toContain('短くタップで払う');
  const uses = text.match(/払[うっえいわ]/g) ?? [];
  expect(uses.length).toBe(2);
});
