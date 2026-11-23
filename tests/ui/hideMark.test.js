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

// Fix round 3（見直し Important B「物陰で黙って見つかる」）: 物陰に近づく者がいるとき（lookout の coverWarn）は、かくれ中の印を赤く脈打たせる
test('Fix round 3: 近づく者がいるとき（warn）は印に warn の印（赤い脈）を付け、いなくなれば外す', () => {
  expect(hideMarkState({ hero: { hidden: true, dashing: null }, hideLeft: 3, holdSec: 10, warn: true }).warn).toBe(true);
  expect(hideMarkState({ hero: { hidden: true, dashing: null }, hideLeft: 3, holdSec: 10 }).warn).toBe(false);
  expect(hideMarkState({ hero: { hidden: false }, hideLeft: 0, holdSec: 10, warn: true }).warn).toBe(false);
  const cls = new Set();
  const el = { hidden: true, style: { setProperty() {} }, classList: { toggle(c, on) { if (on) cls.add(c); else cls.delete(c); } } };
  const v = createHideMark(el);
  v.update({ show: true, p: 0.5, warn: true }, { sx: 10, sy: 10 });
  expect(cls.has('warn')).toBe(true);
  v.update({ show: true, p: 0.5, warn: false }, { sx: 10, sy: 10 });
  expect(cls.has('warn')).toBe(false);
});
