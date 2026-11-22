import { test, expect } from 'vitest';
import { hideMarkState, createHideMark } from '../../src/ui/hideMark.js';

// R1f fix1（見直し Minor 1・持ち主の判断 2）: 物陰にいる間は、主人公の上に小さな「かくれ中」と、残りの秒（holdSec）を示す細い輪を出す
test('R1f fix1: 隠れている間だけ出し、輪は残りの割合（跳ぶ間は出さない）', () => {
  expect(hideMarkState({ hero: { hidden: false }, hideLeft: 0, holdSec: 12 }).show).toBe(false);
  expect(hideMarkState({ hero: { hidden: true, dashing: 0.5 }, hideLeft: 12, holdSec: 12 }).show).toBe(false);
  const s = hideMarkState({ hero: { hidden: true, dashing: null }, hideLeft: 3, holdSec: 12 });
  expect(s.show).toBe(true);
  expect(s.p).toBeCloseTo(0.25, 6);
  expect(hideMarkState({ hero: { hidden: true, dashing: null }, hideLeft: 20, holdSec: 12 }).p).toBe(1);
});

test('R1f fix1: 出す・消すと輪の割合を DOM に書く（変わったときだけ）', () => {
  const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
  const el = { hidden: true, style };
  const v = createHideMark(el);
  v.update({ show: true, p: 0.5 }, { sx: 100, sy: 200 });
  expect(el.hidden).toBe(false);
  expect(style.left).toBe('100px'); expect(style.top).toBe('200px');
  expect(style.props['--p']).toBe('0.500');
  v.update({ show: false, p: 0 }, null);
  expect(el.hidden).toBe(true);
});
