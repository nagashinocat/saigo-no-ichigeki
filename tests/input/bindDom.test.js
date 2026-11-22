import { test, expect } from 'vitest';
import { bindPointerInput, eventMs } from '../../src/input/bindDom.js';
import { createControls } from '../../src/input/controls.js';
import { CONFIG } from '../../src/config.js';
import { fakeDom } from './fakeDom.js';

// R1c（M1 の見直し Minor 1〜2）: main.js の指・マウスの配線を、controls の DOM 側の薄い層（input/bindDom.js）へ出して試す

function rig(opts) {
  const dom = fakeDom(opts);
  const log = [];
  const controls = createControls({
    onChargeStart: () => log.push('start'),
    onChargeEnd: () => log.push('fire'),
    onChargeCancel: () => log.push('cancel'),
    onPuff: (x, y) => log.push(['puff', x, y]),
  });
  const puffs = [];
  const bind = bindPointerInput(dom.target, { controls, puff: (x, y) => { puffs.push([x, y]); controls.charging && log.push('rpuff'); }, perf: dom.perf });
  return Object.assign(dom, { log, controls, puffs, bind }); // dom.ms は getter（広げると固まる）
}

test('R1c eventMs: 入力の時刻は performance.now() と同じ時計の ms（古い WebKit のエポックの timeStamp も戻す。無い・先の時刻は今）', () => {
  const perf = { now: () => 5000, timeOrigin: 1.7e12 };
  expect(eventMs({ timeStamp: 4800 }, perf)).toBe(4800);
  expect(eventMs({ timeStamp: 1.7e12 + 4700 }, perf)).toBe(4700); // 古い WebKit: エポックからの ms
  expect(eventMs({ timeStamp: 0 }, perf)).toBe(5000);
  expect(eventMs({}, perf)).toBe(5000);
  expect(eventMs({ timeStamp: 9000 }, perf)).toBe(5000); // 今より先にはしない
  expect(eventMs(null, perf)).toBe(5000);
  // timeOrigin が無い古いブラウザ: Date.now() から求める
  const old = { now: () => 5000 };
  expect(Math.abs(eventMs({ timeStamp: Date.now() - 300 }, old) - 4700)).toBeLessThan(50);
});

test('R1c Minor 1: PC で左の溜め中に右クリックで払い、左を先に離すと、左を離したときに放つ（黙って打ち切らない）', () => {
  const { fire, log, advance } = rig();
  fire('pointerdown', { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1 });
  expect(log).toEqual(['start']);
  advance(0.3);
  // 左を押したままの右ボタン: pointerdown にはならず（chorded）、mousedown と pointermove が来る
  fire('mousedown', { button: 2, buttons: 3 });
  fire('pointermove', { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 3 });
  expect(log).toEqual(['start', 'rpuff']);
  advance(0.2);
  // 左を先に離す: pointerup ではなく、buttons から左が消えた pointermove（と mouseup の左）
  fire('pointermove', { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 2 });
  fire('mouseup', { button: 0, buttons: 2 });
  expect(log).toEqual(['start', 'rpuff', 'fire']);
  // 右を最後に離す: pointerup（button 2）とキャプチャが外れた知らせ。もう何もしない（二度放たない・打ち切らない）
  advance(0.2);
  fire('pointerup', { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 0 });
  fire('lostpointercapture', { pointerType: 'mouse', pointerId: 1 });
  expect(log).toEqual(['start', 'rpuff', 'fire']);
});

test('R1c Minor 1: 左が離れた知らせが来なくても、溜めの指の pointerup はボタンに関わらず controls.up へ（放つ）', () => {
  const { fire, log } = rig();
  fire('pointerdown', { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1 });
  fire('mousedown', { button: 2, buttons: 3 });
  fire('pointerup', { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 0 });
  fire('lostpointercapture', { pointerType: 'mouse', pointerId: 1 });
  expect(log).toEqual(['start', 'rpuff', 'fire']);
});

test('R1c: 溜めの指ではない右ボタンの pointerup は捨てる（指で溜めている間のマウスの右クリックで、指の溜めを放たない）', () => {
  const { fire, log, puffs } = rig();
  fire('pointerdown', { pointerType: 'touch', pointerId: 7 });
  fire('pointerdown', { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 2 });
  fire('pointerup', { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 0 });
  expect(puffs).toHaveLength(1);
  expect(log).toEqual(['start', 'rpuff']);
  expect(log).not.toContain('fire');
  fire('pointerup', { pointerType: 'touch', pointerId: 7 });
  expect(log).toEqual(['start', 'rpuff', 'fire']);
});

test('R1c: 右クリックだけ（溜めていない）は溜めにならない。中ボタンは何もしない', () => {
  const { fire, log, puffs } = rig();
  fire('pointerdown', { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 2 });
  fire('pointerup', { pointerType: 'mouse', pointerId: 1, button: 2 });
  fire('pointerdown', { pointerType: 'mouse', pointerId: 1, button: 1, buttons: 4 });
  fire('pointerup', { pointerType: 'mouse', pointerId: 1, button: 1 });
  expect(puffs).toHaveLength(1);
  expect(log).toEqual([]);
});

test('R1c: pointercancel・キャプチャが外れたときは放たずに打ち切る。押した指はキャプチャする', () => {
  const { fire, log, captured } = rig();
  fire('pointerdown', { pointerId: 3 });
  expect(captured.has(3)).toBe(true);
  fire('pointercancel', { pointerId: 3 });
  expect(log).toEqual(['start', 'cancel']);
  fire('pointerdown', { pointerId: 4 });
  fire('lostpointercapture', { pointerId: 4 });
  expect(log).toEqual(['start', 'cancel', 'start', 'cancel']);
});

for (const [name, opts, stamp] of [
  ['今のブラウザ（timeStamp は timeOrigin から）', {}, (d) => d.ms],
  ['古い WebKit（timeStamp はエポックの ms）', { timeOrigin: 1.7e12 }, (d) => 1.7e12 + d.ms],
]) {
  test(`R1c Minor 2: 一つの時計: 動かさずに長押しした 2 本目は、毎フレームの update だけでスティックになる — ${name}`, () => {
    const d = rig(opts);
    d.fire('pointerdown', { pointerId: 1, timeStamp: stamp(d) });
    d.advance(0.1);
    d.fire('pointerdown', { pointerId: 2, clientX: 60, clientY: 700, timeStamp: stamp(d) });
    // 毎フレームの update（main.js と同じ bind.now()）。0.18 秒の手前ではまだ、過ぎたらスティック
    for (let i = 0; i < 10; i++) { d.advance(1 / 60); d.controls.update(d.bind.now()); }
    expect(d.controls.stick).toBe(null);
    for (let i = 0; i < 2; i++) { d.advance(1 / 60); d.controls.update(d.bind.now()); }
    expect(d.controls.stick).toMatchObject({ cx: 60, cy: 700 });
    // 短いタップは今までどおり払う（同じ時計どうし）
    d.fire('pointerup', { pointerId: 2, clientX: 60, clientY: 700, timeStamp: stamp(d) });
    d.fire('pointerdown', { pointerId: 3, clientX: 80, clientY: 650, timeStamp: stamp(d) });
    d.advance(0.08);
    d.controls.update(d.bind.now());
    d.fire('pointerup', { pointerId: 3, clientX: 80, clientY: 650, timeStamp: stamp(d) });
    expect(d.log).toContainEqual(['puff', 80, 650]);
    expect(CONFIG.controls.longPressSec).toBeCloseTo(0.18, 9);
  });
}

test('R1c: 割り込み（導入・リプレイ）が受け取った pointerdown は controls へ渡さない。割り込みには同じ時計の ms を渡す', () => {
  const dom = fakeDom();
  const log = [];
  const controls = createControls({ onChargeStart: () => log.push('start') });
  const seen = [];
  bindPointerInput(dom.target, { controls, puff: () => {}, perf: dom.perf, intercept: (e, t) => { seen.push(t); return true; } });
  dom.fire('pointerdown', { timeStamp: dom.perf.timeOrigin + 900 });
  expect(seen).toEqual([900]);
  expect(log).toEqual([]);
});
