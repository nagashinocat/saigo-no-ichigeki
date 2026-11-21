import { test, expect } from 'vitest';
import { createIntroFlow, introMode, RETRY_KEY } from '../../src/ui/introFlow.js';
import { createGame } from '../../src/game/game.js';
import { createPressTracker } from '../../src/input/press.js';
import { CONFIG } from '../../src/config.js';

// main.js と同じつなぎ方: 画面のタップは、導入が受け取る間は導入へ（長押しにならない）、ゲームが始まってからは長押しへ
function rig(mode = 'full') {
  const game = createGame({ seed: 3 });
  const events = { shot: 0, fizzle: 0, start: 0, skip: 0, begin: 0 };
  game.on('shot', () => events.shot++);
  game.on('fizzle', () => events.fizzle++);
  const press = createPressTracker({ onStart: () => game.pressStart(), onEnd: () => game.pressEnd(), onCancel: () => game.pressCancel() });
  const flow = createIntroFlow({
    mode,
    onBegin: () => events.begin++,
    onSkip: () => events.skip++,
    onStart: () => { events.start++; game.begin(); },
  });
  const down = (id = 1) => { if (flow.consumePointer()) return; press.down(id); };
  const up = (id = 1) => press.up(id);
  const tick = (sec, dt = 1 / 60) => { for (let t = 0; t < sec - 1e-9; t += dt) { flow.update(dt); game.update(dt); } };
  return { game, flow, press, events, down, up, tick };
}

test('最初の読み込み: 小さな TAP の画面 → タップで導入が始まる（音を鳴らせるようになる操作）', () => {
  const { flow, events, down, up } = rig();
  expect(flow.state).toBe('gate');
  expect(flow.blocksInput).toBe(true);
  down(); up();
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
    const { game, flow, press, events, down, up, tick } = rig();
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
    void press;
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

test('リトライ: 導入を飛ばして短い題字から（TAP の画面もなし）', () => {
  const { flow, events, tick } = rig('short');
  expect(flow.state).toBe('intro');
  expect(flow.timeline.short).toBe(true);
  tick(flow.timeline.total + 0.1);
  expect(flow.state).toBe('title');
  expect(events.skip).toBe(0);
  expect(flow.start()).toBe(true);
});

test('introMode: リトライの印があれば短い題字（印は一度で消える）、撮影の ?debug は ?intro がなければ今までどおり', () => {
  const store = new Map();
  const ss = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  expect(introMode({ params: new URLSearchParams(''), storage: ss })).toBe('full');
  ss.setItem(RETRY_KEY, '1');
  expect(introMode({ params: new URLSearchParams(''), storage: ss })).toBe('short');
  expect(store.has(RETRY_KEY)).toBe(false);
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
  expect(flow.consumePointer(100)).toBe(true); // TAP: 導入へ（onBegin の準備がここで走る）
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
  f2.markReady(5000);
  f2.consumePointer();
  expect(f2.state).toBe('title');
});
