import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R1e fix1（見直し: 説明の言葉がぶつかる）: 「払う」は短いタップ（まわりの者をはがす）だけの言葉。隠れる操作は「シュッとなぞる」と呼び、
// 遊ぶ人が見る説明（#start）では同じ言葉を使う
test('R1e fix1: はじめの説明で、隠れる操作は「シュッとなぞる」。「払う」は短いタップの言葉だけ', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const m = html.match(/<div id="start">([\s\S]*?)<\/div>/);
  expect(m).not.toBe(null);
  const text = m[1].replace(/<[^>]+>/g, ' ');
  expect(text).toContain('シュッとなぞ');
  expect(text).toContain('短くタップで払う');
  // 「払う」「払っ」「払え」…が出るのは、タップの払うとその説明（払うは まわりの者を はがす）だけ
  const uses = text.match(/払[うっえいわ]/g) ?? [];
  expect(uses.length).toBe(2);
  expect(text).not.toMatch(/すばやく払/);
});
