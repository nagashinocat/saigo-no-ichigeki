import { test, expect } from 'vitest';
import { createHeroAura } from '../../src/render/heroAura.js';
import { TIERS } from '../../src/render/quality.js';

test('主人公のまわりの力のゆらぎ: 光の粒の数は画質の段で抑え、low では殻を出さない', () => {
  const a = createHeroAura('high');
  for (const t of ['high', 'mid', 'low']) {
    a.setTier(t);
    expect(a.motes.geometry.drawRange.count).toBe(TIERS[t].auraMax);
    expect(a.shell.visible).toBe(TIERS[t].auraShell);
  }
  expect(TIERS.low.auraMax).toBeLessThan(TIERS.mid.auraMax);
  expect(TIERS.mid.auraMax).toBeLessThan(TIERS.high.auraMax);
});

test('update は時間と画素の係数を進めるだけ（足元の高さを動かさない）', () => {
  const a = createHeroAura('mid');
  const y = a.group.position.y;
  a.update(0.5, 700); a.update(0.25, 700);
  expect(a.motes.material.uniforms.uTime.value).toBeCloseTo(0.75, 9);
  expect(a.motes.material.uniforms.uPx.value).toBe(700);
  expect(a.group.position.y).toBe(y);
});
