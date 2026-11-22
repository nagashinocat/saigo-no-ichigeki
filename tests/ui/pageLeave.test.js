import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { bindPageLeave } from '../../src/ui/pageLeave.js';
import { createPause } from '../../src/ui/pause.js';
import { createGame } from '../../src/game/game.js';

// 身代わりの window と document（addEventListener を覚え、fire で呼ぶ。target を省けば window 自身）
function rig({ touch = false, scene = 'play' } = {}) {
  const handlers = { win: {}, doc: {} };
  const win = { addEventListener(type, fn) { (handlers.win[type] ??= []).push(fn); } };
  const doc = { hidden: false, addEventListener(type, fn) { (handlers.doc[type] ??= []).push(fn); } };
  const fire = (where, type, target) => { for (const fn of handlers[where][type] ?? []) fn({ type, target: target ?? (where === 'win' ? win : doc) }); };
  const log = [];
  const s = { scene };
  bindPageLeave({ win, doc, touch, inPlay: () => s.scene === 'play' || s.scene === 'cinematic', leave: () => log.push('leave'), back: () => log.push('back') });
  return { win, doc, fire, log, s };
}

// 最終レビュー I1（持ち主 18:14「切り替えたら一時停止」）: PC で Alt+Tab・別のウィンドウへ移っても visibilitychange は来ない
test('I1: PC の window の blur は、遊んでいる間と演出の間だけ一時停止する（結果・導入の画面では何もしない）。focus で tab の理由を外す', () => {
  for (const scene of ['play', 'cinematic']) {
    const { fire, log } = rig({ scene });
    fire('win', 'blur');
    expect(log, scene).toEqual(['leave']);
    fire('win', 'focus');
    expect(log, scene).toEqual(['leave', 'back']);
  }
  for (const scene of ['result', 'intro']) {
    const { fire, log } = rig({ scene });
    fire('win', 'blur');
    expect(log, scene).toEqual([]);
  }
});

test('I1: 同じページの中の要素の blur（メニューの音量のスライダー・ボタン）では止めない（target が window のときだけ）', () => {
  const { fire, log } = rig({ scene: 'play' });
  const slider = { tagName: 'INPUT' };
  fire('win', 'blur', slider);
  fire('win', 'focus', slider);
  expect(log).toEqual([]);
});

test('タッチの端末は今までどおり、どの画面でも blur で一時停止（iOS のコントロールセンターなどは visibilitychange が来ない）', () => {
  const { fire, log } = rig({ touch: true, scene: 'result' });
  fire('win', 'blur');
  expect(log).toEqual(['leave']);
});

test('タブを隠す・pagehide は今までどおり止め、見えたら・pageshow で tab の理由を外す。隠れたままの focus では外さない', () => {
  const { fire, log, doc } = rig({ scene: 'result' });
  doc.hidden = true;
  fire('doc', 'visibilitychange');
  fire('win', 'focus');
  fire('win', 'pageshow');
  expect(log).toEqual(['leave']);
  doc.hidden = false;
  fire('doc', 'visibilitychange');
  fire('win', 'pagehide');
  fire('win', 'pageshow');
  expect(log).toEqual(['leave', 'back', 'leave', 'back']);
});

test('I1: 遊んでいる間の blur で、ゲームの進み（タイマー）が止まる（pause.js とつないだとき）。結果の画面では止めない', () => {
  const game = createGame({ seed: 3 });
  game.begin();
  const pause = createPause({ game, controls: null, audio: null, bgm: null });
  const s = { scene: 'play' };
  const handlers = {};
  const win = { addEventListener(type, fn) { (handlers[type] ??= []).push(fn); } };
  const doc = { hidden: false, addEventListener() {} };
  bindPageLeave({ win, doc, touch: false, inPlay: () => s.scene === 'play', leave: () => pause.set('tab', true), back: () => pause.set('tab', false) });
  const blur = () => handlers.blur.forEach((fn) => fn({ type: 'blur', target: win }));
  game.update(1);
  const t = game.timer.remaining;
  blur();
  expect(pause.paused).toBe(true);
  game.update(1);
  expect(game.timer.remaining).toBe(t);
  handlers.focus.forEach((fn) => fn({ type: 'focus', target: win }));
  expect(pause.paused).toBe(false);
  s.scene = 'result';
  blur();
  expect(pause.paused).toBe(false);
});

test('I1: main.js は bindPageLeave に、メニューを出せる間（遊んでいる間・演出の間）を inPlay として渡す', () => {
  const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  expect(src).toMatch(/bindPageLeave\(\{[^}]*inPlay: menuAvailable/);
  expect(src).not.toMatch(/if \(touchDevice\) \{\s*window\.addEventListener\('blur', leavePage\)/);
});
