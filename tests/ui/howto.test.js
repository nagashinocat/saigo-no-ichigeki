import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R1e fix1（見直し: 説明の言葉がぶつかる）: 「払う」は短いタップ（まわりの者をはがす）だけの言葉。
// R1f（持ち主 18:14「LOOK OUT!の矢印をタップ」）: 隠れる操作は「LOOK OUT! の矢印をタップ」。シュッ（なぞる）はやめたので説明からも消す
test('R1f: はじめの説明で、隠れる操作は「LOOK OUT! の矢印をタップ」（シュッとなぞるは出さない）。「払う」は短いタップの言葉だけ', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const m = html.match(/<div id="start"[^>]*>([\s\S]*?)<\/div>/);
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

// R1g（持ち主 00:47「リプレイボタン押したら説明がでてる」）: リトライの読み直しでは、遊び方の説明（#start）を出さない
test('R1g: main.js はリトライ（mode retry）のとき遊び方の説明を隠す。通常の読み込みは導入の終わりで出す', () => {
  const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  expect(src).toMatch(/startMode === 'retry'|introFlow\.mode === 'retry'/);
  expect(src).toMatch(/startHint\.hidden = true/);
  expect(src).toMatch(/onStart\(\)[\s\S]*startHint\.hidden = false/);
});

// 持ち主 2026-11-23 08:41「リトライ押したら暗い画面に操作説明が出てる」。原因（retry-fix-report.md）: #start（遊び方の説明）は HTML では出ていて、
// main.js が動いてから隠していた。端末で JS を読み・街を組み立てる数秒の間、暗い地に説明だけが見えた（ヘッドレスで JS を遅らせて撮った）。
// 説明ははじめから隠し、出すのは TAP START（onStart）と撮影の ?debug（bypass）だけ
test('#start ははじめから hidden（JS が動く前の暗い画面に説明を出さない）。出すのは TAP START と撮影の bypass だけ', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  expect(html).toMatch(/<div id="start" hidden>/);
  const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const shows = src.match(/startHint\.hidden = false/g) ?? [];
  expect(shows.length).toBe(2);
  expect(src).toMatch(/onStart\(\)[\s\S]*?startHint\.hidden = false/);
  expect(src).toMatch(/startMode === 'bypass'\) startHint\.hidden = false/);
});

// 持ち主 2026-11-23 08:41「TAPの文字がかなりデカく出てるのは仕様？」: ふだんのリトライはその場で遊び直す（TAP なし）。控えの読み直し（タッチ）の
// 案内は、遊ぶ画面を暗くしない HUD の知らせの大きさの「タップでスタート」の一行
test('控えの読み直しのタッチの案内は小さな一行（最大 20 px・暗い幕なし・「タップでスタート」）', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const gate = html.match(/#intro-gate\.retry \{([^}]*)\}/)[1];
  const span = html.match(/#intro-gate\.retry span \{([^}]*)\}/)[1];
  expect(gate).toMatch(/background: transparent/);
  const sizes = [...span.match(/font-size: ([^;]+);/)[1].matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
  expect(Math.max(...sizes)).toBeLessThanOrEqual(20);
  const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  expect(src).toMatch(/RETRY_TAP_TEXT = 'タップでスタート'/);
});

test('メニューのリトライと結果の「もう一度」は、その場の遊び直し（requestRetry → restartRound）。直接 location.reload しない', () => {
  const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const onRetries = [...src.matchAll(/onRetry\(\) \{([^}]*)\}/g)].map((m) => m[1].trim());
  expect(onRetries).toEqual(['requestRetry();', 'requestRetry();']);
  expect(src).toMatch(/restart: restartRound/);
  expect(src.match(/location\.reload\(\)/g)).toHaveLength(1); // 控えの読み直しだけ
});
