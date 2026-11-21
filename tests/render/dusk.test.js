import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createStyle, FACADE, DUSK, WINDOW_LAMP_MAX } from '../../src/render/style.js';
import { BLOOM } from '../../src/render/screenFx.js';
import { createSpaceView } from '../../src/render/spaceView.js';
import { createCityView } from '../../src/render/cityView.js';
import { generateCity } from '../../src/world/cityGen.js';

// 暗めの夕方（日が沈んだ直後）: 夕日は地平の下、直射光は弱く低く深い橙、空の上は藍。
// 窓の明かりが多く灯り、浮遊バイクの推進の光は窓よりはっきり明るい（bloom がにじませる）。

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const azimuth = (v) => Math.atan2(v.x, -v.z);

test('空の夕日は地平のすぐ下で、直射光と同じ方角（ブラックホールの結末の構図も同じ方角）', () => {
  const s = createStyle('low');
  expect(s.skySun.y).toBeLessThan(0);
  expect(s.skySun.y).toBeGreaterThan(-0.15);
  expect(s.skySun.length()).toBeCloseTo(1, 6);
  expect(azimuth(s.skySun)).toBeCloseTo(azimuth(s.sunDir), 6);
  expect(s.uniforms.uSkySun.value.equals(s.skySun)).toBe(true);
});

test('直射光は弱く低い深い橙、影側の空の光は群青で弱め', () => {
  const s = createStyle('high');
  const [sun, , fill] = s.lights;
  expect(s.sunDir.y).toBeLessThan(0.36);
  expect(s.sunDir.y).toBeGreaterThan(0.2); // アニメ調の3段の陰影が残る高さ
  expect(sun.intensity).toBeLessThan(3.0);
  expect(sun.color.g).toBeLessThan(sun.color.r * 0.6);
  expect(sun.color.b).toBeLessThan(sun.color.r * 0.4);
  expect(fill.intensity).toBeLessThan(1.4);
  expect(fill.color.b).toBeGreaterThan(fill.color.r);
});

test('窓の明かりは多く灯る（どの種類も 4 割以上の窓が灯りうる）', () => {
  for (const kind of ['house', 'office', 'tower']) expect(FACADE[kind].lit).toBeGreaterThanOrEqual(0.4);
});

test('推進の光は bloom がかかるほど明るく、窓の明かりはかからない（バイクの光が街の灯りに埋もれない）', () => {
  // 窓の灯りのいちばん明るいもの（線形の値の輝度）は閾値の下
  expect(WINDOW_LAMP_MAX).toBeLessThan(BLOOM.threshold);
  // 推進の光は、近くで見たとき（vFar = 0、シェーダーの 1.6 倍）でも閾値の 1.5 倍を超える
  expect(lum(DUSK.thrust) * 1.6).toBeGreaterThan(BLOOM.threshold * 1.5);
  // 色は今までの淡い緑のまま（明るさだけ上げる）
  const n = DUSK.thrust.clone().multiplyScalar(1 / DUSK.thrust.g);
  expect(n.r).toBeCloseTo(0.55, 2); expect(n.b).toBeCloseTo(0.82, 2);
});

test('tintFigures: 軍勢と主人公の陰影の色を夕方の光に合わせ、推進の光を上げる（uniform の値を書き換える）', () => {
  const s = createStyle('mid');
  const u = {
    uSun: { value: new THREE.Color(1, 0.66, 0.4) }, uSky: { value: new THREE.Color(0.46, 0.54, 1) },
    uGround: { value: new THREE.Color(0.55, 0.4, 0.42) }, uThrust: { value: new THREE.Color(0.55, 1, 0.82) },
  };
  const before = { ...u };
  s.tintFigures(u);
  expect(u.uSun).toBe(before.uSun); // 同じ uniform の値を書き換える（材質どうしで共有しているため）
  expect(u.uSun.value.equals(DUSK.figureSun)).toBe(true);
  expect(u.uSky.value.equals(DUSK.figureSky)).toBe(true);
  expect(u.uGround.value.equals(DUSK.figureGround)).toBe(true);
  expect(u.uThrust.value.equals(DUSK.thrust)).toBe(true);
  // 暗くしても姿は読める: 影側の光（空と地面の平均の 0.55 倍）と日なたの光の輝度に下限
  const amb = lum(DUSK.figureSky.clone().add(DUSK.figureGround).multiplyScalar(0.5 * 0.55));
  expect(amb).toBeGreaterThan(0.12);
  expect(amb + lum(DUSK.figureSun) * 1.1).toBeGreaterThan(0.45);
  // 足りない uniform は飛ばす
  expect(() => s.tintFigures({ uSun: { value: new THREE.Color() } })).not.toThrow();
});

// three の NeutralToneMapping（renderer.toneMapping）と同じ式
function neutral([r, g, b]) {
  const start = 0.8 - 0.04, desat = 0.15;
  const x = Math.min(r, g, b), off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let c = [r - off, g - off, b - off];
  const peak = Math.max(...c);
  if (peak < start) return c;
  const d = 1 - start, np = 1 - (d * d) / (peak + d - start);
  c = c.map((v) => v * (np / peak));
  const k = 1 - 1 / (desat * (peak - np) + 1);
  return c.map((v) => v * (1 - k) + np * k);
}

test('low の段（bloom なし）では、推進の光は飽和した緑へ寄せ、トーンマップのあとも白く飛ばずに緑が残る', () => {
  const s = createStyle('low');
  const u = { uThrust: { value: new THREE.Color() } };
  s.tintFigures(u);
  expect(u.uThrust.value.equals(DUSK.thrustLow)).toBe(true);
  for (const k of [1.6, 2.8]) { // シェーダーの近く（1.6 倍）と遠く（2.8 倍）
    const [r, g, b] = neutral([DUSK.thrustLow.r * k, DUSK.thrustLow.g * k, DUSK.thrustLow.b * k]);
    expect(g).toBeGreaterThan(0.8);
    expect(Math.max(r, b)).toBeLessThan(g * 0.6);
    // 前の色（淡い緑）は白っぽく飛んでいた
    const [r0, g0, b0] = neutral([DUSK.thrust.r * k, DUSK.thrust.g * k, DUSK.thrust.b * k]);
    expect(Math.max(r0, b0)).toBeGreaterThan(g0 * 0.65);
  }
  // 途中で段が下がったとき: 段を渡して色を合わせ直せる
  const m = createStyle('mid');
  m.tintFigures(u, 'low');
  expect(u.uThrust.value.equals(DUSK.thrustLow)).toBe(true);
  m.tintFigures(u);
  expect(u.uThrust.value.equals(DUSK.thrust)).toBe(true);
});

test('宇宙の地球の夕日は、街の空の夕日と同じ方角・同じ低さ', () => {
  const s = createStyle('low');
  const sv = createSpaceView('low');
  expect(sv.sunDir.distanceTo(s.skySun)).toBeLessThan(1e-6);
});

test('街灯の下の道路に光の溜まりを落とす（街灯 1 本に 1 つ。街灯が壊れたら消える）', () => {
  const city = generateCity(7);
  const view = createCityView(city, createStyle('low'), 'low');
  const lamps = city.props.filter((p) => p.kind === 'lamp');
  let pools = null;
  view.group.traverse((o) => { if (o.name === 'lamp-pools') pools = o; });
  expect(pools).not.toBeNull();
  expect(pools.count).toBe(lamps.length);
  expect(pools.material.blending).toBe(THREE.AdditiveBlending);
  expect(pools.material.depthWrite).toBe(false);
  const m = new THREE.Matrix4();
  pools.getMatrixAt(0, m);
  expect(m.determinant()).not.toBe(0);
  // 溜まりの中心（板の中心を置き場所の行列で写す）は地面のすぐ上で、街灯の頭の真下あたり（柱から 3m 以内）
  pools.geometry.computeBoundingBox();
  const c = pools.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(m);
  expect(c.y).toBeGreaterThan(0); expect(c.y).toBeLessThan(0.3);
  const vis = view.getPropVisual(lamps[0].id);
  expect(Math.hypot(c.x - vis.x, c.z - vis.z)).toBeLessThan(3);
  view.hideProp(lamps[0].id);
  pools.getMatrixAt(0, m);
  expect(m.elements.slice(0, 11).every((v) => v === 0)).toBe(true); // 拡大率 0（cityView の hide）
});
