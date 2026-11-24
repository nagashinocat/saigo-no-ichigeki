import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { hazeMarkState, createHazeMark } from '../../src/ui/hazeMark.js';

// Fix round 2（まとめ役の裁定）: 閃光の残りの間、主人公のそばに小さな残りの輪（--p、1 → 0）。主人公が閃光の範囲の外へ出たら out（薄く）
test('Fix round 2: 閃光の残りがある間だけ出し、輪は残りの割合。範囲の外にいれば out', () => {
  expect(hazeMarkState({ haze: null, hero: { x: 0, z: 0 } }).show).toBe(false);
  const s = hazeMarkState({ haze: { x: 0, z: 0, r: 90, left: 2.5, total: 10 }, hero: { x: 10, z: 0 } });
  expect(s).toMatchObject({ show: true, out: false });
  expect(s.p).toBeCloseTo(0.25, 6);
  expect(hazeMarkState({ haze: { x: 0, z: 0, r: 90, left: 5, total: 10 }, hero: { x: 91, z: 0 } }).out).toBe(true);
});

test('Fix round 2: DOM に位置と割合を書き、出す・消す。CSS は [hidden] で消える', () => {
  const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
  const cls = new Set();
  const el = { hidden: true, style, classList: { toggle(k, on) { if (on) cls.add(k); else cls.delete(k); } } };
  const v = createHazeMark(el);
  v.update({ show: true, p: 0.5, out: true }, { sx: 120, sy: 300 });
  expect(el.hidden).toBe(false);
  expect(style.left).toBe('120px'); expect(style.top).toBe('300px');
  expect(style.props['--p']).toBe('0.500');
  expect(cls.has('out')).toBe(true);
  v.update({ show: false, p: 0 }, null);
  expect(el.hidden).toBe(true);
  const css = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  expect(css).toMatch(/#hazeMark\[hidden\][^{]*\{[^}]*display:\s*none/);
  expect(css).toMatch(/<div id="hazeMark"/);
});
