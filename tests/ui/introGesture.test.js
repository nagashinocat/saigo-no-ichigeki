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
  // pointer: { pointerId, button }（省けば指 1・主ボタン 0）
  const ev = (type, timeStamp, pointer = {}) => {
    const e = new Event(type);
    if (timeStamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: timeStamp });
    if (type.startsWith('pointer') || type === 'click') {
      Object.defineProperty(e, 'button', { value: pointer.button ?? 0 });
      if (type.startsWith('pointer')) Object.defineProperty(e, 'pointerId', { value: pointer.pointerId ?? 1 });
    }
    return e;
  };
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
  target.dispatchEvent(ev('pointerdown', 10));
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
  b.target.dispatchEvent(b.ev('pointerdown', 10));
  b.target.dispatchEvent(b.ev('pointerup', 80));
  b.flow.markReady(2000);
  b.target.dispatchEvent(b.ev('click', 2100)); // 同じ TAP の click（準備のあとに届く）
  expect(b.flow.state).toBe('intro'); // 飛ばさない
  expect(b.log).toEqual(['unlock', 'begin']);
});

test('導入の間の pointerup・click は飛ばさない（飛ばすのは pointerdown だけ）。準備の間にたまったタップは今までどおり飛ばさない', () => {
  const { log, flow, target, ev } = rig();
  flow.consumePointer(10);
  target.dispatchEvent(ev('pointerdown', 10));
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

test('TAP の画面: 始めるのは主ボタン（左クリック・指）だけ。右クリック・中クリックの離す操作では始めない', () => {
  for (const button of [1, 2]) {
    const { log, flow, target, ev } = rig();
    target.dispatchEvent(ev('pointerdown', 10, { button }));
    target.dispatchEvent(ev('pointerup', 80, { button }));
    expect(flow.state, `button ${button}`).toBe('gate');
    expect(log.filter((x) => x === 'begin')).toEqual([]);
    // そのあとの左クリックでは始まる
    target.dispatchEvent(ev('pointerdown', 200));
    target.dispatchEvent(ev('pointerup', 260));
    expect(flow.state).toBe('intro');
  }
  // 右ボタンの click（ふつうは auxclick だが、来ても）でも始めない
  const { flow, target, ev } = rig();
  target.dispatchEvent(ev('click', 90, { button: 2 }));
  expect(flow.state).toBe('gate');
});

test('TAP の画面: 押した指と同じ指を離したときだけ始める（二本目の指を離しても始めない。押していない指の離す操作でも始めない）', () => {
  const { flow, target, ev } = rig();
  target.dispatchEvent(ev('pointerup', 5, { pointerId: 9 })); // 画面の外で押した指
  expect(flow.state).toBe('gate');
  target.dispatchEvent(ev('pointerdown', 10, { pointerId: 1 }));
  target.dispatchEvent(ev('pointerdown', 20, { pointerId: 2 }));
  target.dispatchEvent(ev('pointerup', 40, { pointerId: 2 }));
  expect(flow.state).toBe('gate');
  target.dispatchEvent(ev('pointerup', 60, { pointerId: 1 }));
  expect(flow.state).toBe('intro');
  // pointercancel で押した指を忘れる
  const b = rig();
  b.target.dispatchEvent(b.ev('pointerdown', 10, { pointerId: 3 }));
  b.target.dispatchEvent(b.ev('pointercancel', 20, { pointerId: 3 }));
  b.target.dispatchEvent(b.ev('pointerup', 30, { pointerId: 3 }));
  expect(b.flow.state).toBe('gate');
});

test('鳴らせるようになったあとも、iOS の音のセッション（無音の <audio>）がまだなら、操作のたびに unlock する', () => {
  const { log, audio, win, ev } = rig();
  audio.running = true;
  audio.sessionPending = true;
  win.dispatchEvent(ev('pointerup'));
  expect(log).toEqual(['unlock']);
  audio.sessionPending = false;
  win.dispatchEvent(ev('touchend'));
  expect(log).toEqual(['unlock']);
});
