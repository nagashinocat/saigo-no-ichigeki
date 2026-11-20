import { test, expect, vi } from 'vitest';
import { createPressTracker } from '../../src/input/press.js';

function make() {
  const onStart = vi.fn(), onEnd = vi.fn();
  return { onStart, onEnd, t: createPressTracker({ onStart, onEnd }) };
}

test('最初の指だけ有効、2本目の down/up は無視', () => {
  const { t, onStart, onEnd } = make();
  t.down(1); t.down(2);
  expect(onStart).toHaveBeenCalledTimes(1);
  t.up(2);
  expect(onEnd).not.toHaveBeenCalled();
  t.up(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
});

test('cancel は up と同じく onEnd を一度呼ぶ', () => {
  const { t, onStart, onEnd } = make();
  t.down(7);
  t.cancel(7);
  t.up(7);
  expect(onEnd).toHaveBeenCalledTimes(1);
  t.down(8);
  expect(onStart).toHaveBeenCalledTimes(2);
});

test('押していない指の up / cancel は何もしない', () => {
  const { t, onEnd } = make();
  t.up(1); t.cancel(1);
  expect(onEnd).not.toHaveBeenCalled();
});
