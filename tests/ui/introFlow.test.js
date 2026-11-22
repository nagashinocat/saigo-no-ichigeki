import { test, expect } from 'vitest';
import { createIntroFlow, introMode, RETRY_KEY } from '../../src/ui/introFlow.js';
import { createGame } from '../../src/game/game.js';
import { createControls } from '../../src/input/controls.js';
import { bindPointerInput } from '../../src/input/bindDom.js';
import { createIntroGesture } from '../../src/ui/introGesture.js';
import { fakeDom } from '../input/fakeDom.js';
import { CONFIG } from '../../src/config.js';

// main.js と同じつなぎ方（R1c: 本番の経路。M1 の見直し Minor 3）: 画面の指は bindPointerInput（input/bindDom.js）から
// createControls へ。pointerdown は、導入が受け取る間は導入へ（intercept。長押しにならない）、ゲームが始まってからは溜めへ。
// TAP の画面を離した操作（pointerup）で導入を始めるのは introGesture（main.js と同じく、配線のあとにつなぐ）
// prep: TAP の直後の準備（onBegin）にかかる秒（その間は時計だけ進み、終わりに markReady。main.js と同じ）
function rig(mode = 'full', { prep = 0 } = {}) {
  const game = createGame({ seed: 3 });
  const events = { shot: 0, fizzle: 0, start: 0, skip: 0, begin: 0 };
  game.on('shot', () => events.shot++);
  game.on('fizzle', () => events.fizzle++);
  const dom = fakeDom();
  const controls = createControls({ onChargeStart: () => game.pressStart(), onChargeEnd: () => game.pressEnd(), onChargeCancel: () => game.pressCancel(), onPuff: () => game.puff() });
  const flow = createIntroFlow({
    mode,
    onBegin: () => { events.begin++; dom.advance(prep); flow.markReady(dom.perf.now()); },
    onSkip: () => events.skip++,
    onStart: () => { events.start++; game.begin(); },
  });
  const bind = bindPointerInput(dom.target, { controls, puff: () => {}, perf: dom.perf, intercept: (e, ms) => flow.consumePointer(ms) });
  const gesture = createIntroGesture({ audio: { running: true, sessionPending: false, unlock() {} }, flow });
  gesture.attach({ addEventListener() {} }, dom.target);
  // stamp: その入力の timeStamp（省けば今。準備の間に押してあとから届く入力は、前の時刻）
  const down = (id = 1, stamp) => dom.fire('pointerdown', { pointerId: id, timeStamp: stamp ?? dom.ms });
  const up = (id = 1) => dom.fire('pointerup', { pointerId: id });
  const tick = (sec, dt = 1 / 60) => { for (let t = 0; t < sec - 1e-9; t += dt) { dom.advance(dt); controls.update(bind.now()); flow.update(dt); game.update(dt); } };
  return { game, flow, controls, events, down, up, tick, dom };
}

test('最初の読み込み: 小さな TAP の画面 → タップで導入が始まる（音を鳴らせるようになる操作）。押しただけでは始めず、離したときに始める', () => {
  const { flow, events, down, up } = rig();
  expect(flow.state).toBe('gate');
  expect(flow.blocksInput).toBe(true);
  down();
  expect(flow.state).toBe('gate');
  expect(events.begin).toBe(0);
  up();
  expect(flow.state).toBe('intro');
  expect(flow.time).toBe(0);
  expect(events.begin).toBe(1);
});

test('TAP START まではタイマーが止まり、ゲームは手つかず（軍勢も湧かない）', () => {
  const { game, flow, down, up, tick } = rig();
  const before = game.enemies.list.length;
  down(); up();
  tick(flow.timeline.total + 1.5);
  expect(flow.state).toBe('title');
  expect(game.phase).toBe('ready');
  expect(game.timer.remaining).toBe(CONFIG.roundSeconds);
  expect(game.power.value).toBe(0);
  expect(game.enemies.list.length).toBe(before);
});

test('1〜7 拍のタップは題字の終わりへ飛ぶだけ: 貯めない・放たない・押したままにならない', () => {
  for (const at of [0.3, 2.5, 4, 6, 7.5, 9.5, 11.2, 11.5]) {
    const { game, flow, controls, events, down, up, tick } = rig();
    down(); up();
    tick(at);
    down(7); // 長く押したまま
    tick(1.2);
    expect(flow.state, `${at}`).toBe('title');
    expect(flow.time, `${at}`).toBeCloseTo(flow.timeline.skipTarget, 6);
    expect(flow.buttonVisible).toBe(true);
    expect(events.skip).toBe(1);
    expect(game.charge.active).toBe(false);
    expect(game.power.value).toBe(0);
    up(7);
    expect(events.shot + events.fizzle).toBe(0);
    // 押下は残っていない: ゲームが始まってから押すとちゃんと貯まる
    flow.start();
    down(8);
    expect(game.charge.active).toBe(true);
    up(8);
    expect(controls.charging).toBe(false); // 押したままにならない
  }
});

test('TAP START はゲームを一度だけ始める（二度押しても一度）。そこからタイマーが 60 から進む', () => {
  const { game, flow, events, down, up, tick } = rig();
  expect(flow.start()).toBe(false); // まだ出ていない
  down(); up();
  tick(1);
  expect(flow.start()).toBe(false); // 導入の途中でもまだ（タップは飛ばすだけ）
  down(); up(); // 飛ばす
  expect(flow.start()).toBe(true);
  expect(flow.start()).toBe(false);
  expect(events.start).toBe(1);
  expect(game.phase).toBe('playing');
  expect(game.charge.active).toBe(false); // 始めるだけでは貯めない
  expect(flow.blocksInput).toBe(false);
  tick(1);
  expect(game.timer.remaining).toBeCloseTo(CONFIG.roundSeconds - 1, 5);
});

test('R1g: リトライ（mode retry）は導入も題字も TAP START もなく、すぐ遊べる。最初のタップがそのまま溜めになる', () => {
  const { flow, game, events, down, tick } = rig('retry');
  expect(flow.state).toBe('game');
  expect(flow.blocksInput).toBe(false);
  expect(flow.started).toBe(true);
  expect(flow.buttonVisible).toBe(false);
  expect(events.begin).toBe(0);
  down();
  tick(0.3);
  expect(game.charge.active).toBe(true);
  expect(game.phase).toBe('playing');
});

test('通常の読み込み（mode full）は TAP の画面から導入・題字を通り、最初のタップは溜めにならない', () => {
  const { flow, game, down } = rig('full');
  expect(flow.state).toBe('gate');
  down();
  expect(game.charge.active).toBe(false);
});

test('?intro=short の撮影用の短い題字は今までどおり（リトライとは別）', () => {
  const { flow, events, tick } = rig('short');
  expect(flow.state).toBe('intro');
  expect(flow.timeline.short).toBe(true);
  tick(flow.timeline.total + 0.1);
  expect(flow.state).toBe('title');
  expect(events.skip).toBe(0);
  expect(flow.start()).toBe(true);
});

test('introMode: リトライの印があれば retry（導入も説明もなし。印は一度で消える）、撮影の ?debug は ?intro がなければ今までどおり', () => {
  const store = new Map();
  const ss = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  expect(introMode({ params: new URLSearchParams(''), storage: ss })).toBe('full');
  ss.setItem(RETRY_KEY, '1');
  expect(introMode({ params: new URLSearchParams(''), storage: ss })).toBe('retry');
  expect(store.has(RETRY_KEY)).toBe(false);
  expect(introMode({ params: new URLSearchParams(''), storage: ss })).toBe('full'); // 一度だけ
  expect(introMode({ params: new URLSearchParams('debug'), storage: ss })).toBe('bypass');
  expect(introMode({ params: new URLSearchParams('debug&intro'), storage: ss })).toBe('full');
  expect(introMode({ params: new URLSearchParams('intro=short'), storage: ss })).toBe('short');
  // 保存できない（プライベートモードなど）でもこわれない
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  expect(introMode({ params: new URLSearchParams(''), storage: broken })).toBe('full');
});

test('撮影用の seek: 時刻をそのまま置ける（題字の終わりを越えたら title）', () => {
  const { flow } = rig();
  flow.seek(5);
  expect(flow.state).toBe('intro');
  expect(flow.time).toBe(5);
  flow.seek(99);
  expect(flow.state).toBe('title');
});

test('TAP の直後の準備の間にたまったタップ（timeStamp が readyAt より前）は導入を飛ばさない。準備のあとのタップは今までどおり飛ばす', () => {
  let skips = 0;
  const flow = createIntroFlow({ mode: 'full', onSkip: () => skips++ });
  expect(flow.consumePointer(100)).toBe(true); // TAP を押した: 受け取るだけ（まだ始めない）
  expect(flow.state).toBe('gate');
  expect(flow.release(120)).toBe(true); // 離した: 導入へ（onBegin の準備がここで走る）
  expect(flow.state).toBe('intro');
  flow.markReady(1300); // onBegin の終わり
  expect(flow.consumePointer(900)).toBe(true); // 準備の間に押した 2 回目（あとから届く）: 受け取るが何もしない
  expect(flow.state).toBe('intro');
  expect(skips).toBe(0);
  expect(flow.consumePointer(1300.5)).toBe(true); // 準備のあと: 題字へ飛ばす
  expect(flow.state).toBe('title');
  expect(skips).toBe(1);
  // timeStamp を渡さない呼び方は今までどおり
  const f2 = createIntroFlow({ mode: 'full' });
  f2.consumePointer();
  f2.release();
  f2.markReady(5000);
  f2.consumePointer();
  expect(f2.state).toBe('title');
});

// R1c（M1 の見直し Minor 3）: たまったタップの防ぎを、本番の経路（bindPointerInput → introFlow.consumePointer、一つの時計）で
test('R1c: 本番の経路: TAP の直後の準備の間に押した（あとから届く）タップは導入を飛ばさず、溜めにもならない。準備のあとのタップは飛ばす', () => {
  const { flow, events, controls, game, down, up, dom } = rig('full', { prep: 1.2 });
  down(1); up(1); // TAP の画面: 離して導入へ（準備に 1.2 秒）
  expect(flow.state).toBe('intro');
  const readyMs = dom.ms;
  down(2, readyMs - 400); // 準備の間に押した（timeStamp は準備の終わりより前）
  up(2);
  expect(flow.state).toBe('intro');
  expect(events.skip).toBe(0);
  expect(controls.charging).toBe(false);
  expect(game.charge.active).toBe(false);
  dom.advance(0.05);
  down(3); up(3); // 準備のあと: 題字の終わりへ
  expect(flow.state).toBe('title');
  expect(events.skip).toBe(1);
  expect(controls.charging).toBe(false);
});

test('R1c: 本番の経路: 古い WebKit（timeStamp がエポックの ms）でも、たまったタップの防ぎと TAP START・溜めは同じ', () => {
  const { flow, events, controls, game, down, up, dom } = rig('full', { prep: 1.2 });
  const epoch = (ms) => dom.perf.timeOrigin + ms;
  down(1, epoch(dom.ms)); up(1);
  down(2, epoch(dom.ms - 300)); up(2);
  expect(events.skip).toBe(0);
  dom.advance(0.1);
  down(3, epoch(dom.ms)); up(3);
  expect(flow.state).toBe('title');
  expect(flow.start()).toBe(true);
  down(4, epoch(dom.ms));
  expect(controls.charging).toBe(true);
  expect(game.charge.active).toBe(true);
  up(4);
  expect(controls.charging).toBe(false);
});
