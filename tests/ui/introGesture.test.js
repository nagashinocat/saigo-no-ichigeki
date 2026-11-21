import { test, expect } from 'vitest';
import { createIntroGesture, AUDIO_GESTURES } from '../../src/ui/introGesture.js';
import { createIntroFlow } from '../../src/ui/introFlow.js';

// 身代わりの音: unlock を記録し、running は手で切り替える
function rig() {
  const log = [];
  const audio = { running: false, unlock() { log.push('unlock'); } };
  const flow = createIntroFlow({ mode: 'full', onBegin: () => log.push('begin'), onSkip: () => log.push('skip') });
  const gesture = createIntroGesture({ audio, flow });
  const win = new EventTarget(), target = new EventTarget();
  gesture.attach(win, target);
  const ev = (type, timeStamp) => { const e = new Event(type); if (timeStamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: timeStamp }); return e; };
  return { log, audio, flow, gesture, win, target, ev };
}

test('音を鳴らせるようにする操作: pointerdown だけでなく pointerup・touchend・click・keydown でも unlock（iOS / Android はタッチの pointerdown を操作と見なさない）', () => {
  expect(AUDIO_GESTURES).toEqual(expect.arrayContaining(['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']));
  for (const type of AUDIO_GESTURES) {
    const { log, win, ev } = rig();
    win.dispatchEvent(ev(type));
    expect(log, type).toEqual(['unlock']);
  }
  // 鳴らせるようになったら呼ばない
  const { log, audio, win, ev } = rig();
  audio.running = true;
  for (const type of AUDIO_GESTURES) win.dispatchEvent(ev(type));
  expect(log).toEqual([]);
});

test('TAP の画面: 押しただけ（pointerdown）では導入を始めず、離した（pointerup）操作で、unlock を呼んでから導入を始める', () => {
  const { log, flow, target, ev } = rig();
  expect(flow.consumePointer(10)).toBe(true); // 画面の pointerdown は導入が受け取る（長押しにならない）
  expect(flow.state).toBe('gate');
  expect(log).toEqual([]);
  target.dispatchEvent(ev('pointerup', 80));
  expect(flow.state).toBe('intro');
  expect(log).toEqual(['unlock', 'begin']); // 同じ操作の中で、unlock が先
});

test('click だけ来る（pointerup が来ない環境）でも始まる。pointerup のあとの click で二度は始めない', () => {
  const a = rig();
  a.target.dispatchEvent(a.ev('click', 90));
  expect(a.flow.state).toBe('intro');
  expect(a.log).toEqual(['unlock', 'begin']);
  const b = rig();
  b.target.dispatchEvent(b.ev('pointerup', 80));
  b.flow.markReady(2000);
  b.target.dispatchEvent(b.ev('click', 2100)); // 同じ TAP の click（準備のあとに届く）
  expect(b.flow.state).toBe('intro'); // 飛ばさない
  expect(b.log).toEqual(['unlock', 'begin']);
});

test('導入の間の pointerup・click は飛ばさない（飛ばすのは pointerdown だけ）。準備の間にたまったタップは今までどおり飛ばさない', () => {
  const { log, flow, target, ev } = rig();
  flow.consumePointer(10);
  target.dispatchEvent(ev('pointerup', 60));
  flow.markReady(1500); // onBegin の終わり
  // 準備の間に押した 2 回目（あとから届く）
  expect(flow.consumePointer(900)).toBe(true);
  target.dispatchEvent(ev('pointerup', 950));
  target.dispatchEvent(ev('click', 960));
  expect(flow.state).toBe('intro');
  expect(log.filter((x) => x === 'skip')).toHaveLength(0);
  // 準備のあとの押下は飛ばす
  flow.consumePointer(1600);
  expect(flow.state).toBe('title');
});

test('キー（Space / Enter）: unlock を呼んでから導入を始める', () => {
  const { log, flow, gesture } = rig();
  gesture.key(50);
  expect(flow.state).toBe('intro');
  expect(log).toEqual(['unlock', 'begin']);
});
