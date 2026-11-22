import { test, expect } from 'vitest';
import { layoutViews } from '../../src/render/views.js';

const SIZES = [[390, 844], [1280, 720], [375, 667], [768, 1024], [1024, 768], [1920, 1080], [333, 333], [801, 451], [1, 1], [2, 3]];

const area = (r) => r.w * r.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

for (const [w, h] of [[390, 844], [1280, 720]]) {
  test(`${w}x${h}: 街が上 65%（全幅）、手が下 35%（全幅）`, () => {
    const l = layoutViews(w, h);
    // 左下原点なので、上側は y が大きい側
    expect(l.city).toEqual({ x: 0, y: h - Math.round(h * 0.65), w, h: Math.round(h * 0.65) });
    expect(l.hand).toEqual({ x: 0, y: 0, w, h: h - Math.round(h * 0.65) });
  });

  test(`${w}x${h}: HUD は街の画面の上端の帯に重なる（別の区画を持たない）`, () => {
    const l = layoutViews(w, h);
    expect(inside(l.hud, l.city)).toBe(true);
    expect(l.hud).toMatchObject({ x: 0, w });
    expect(l.hud.y + l.hud.h).toBe(h);
    expect(l.hud.h).toBeGreaterThan(0);
    expect(l.hud.h).toBeLessThan(l.city.h * 0.25);
  });
}

test('どの大きさでも街と手の Rect は重ならず画面を埋め、HUD の帯は街の中にある', () => {
  for (const [w, h] of SIZES) {
    const l = layoutViews(w, h);
    const rects = [l.city, l.hand, l.hud];
    for (const r of rects) {
      for (const k of ['x', 'y', 'w', 'h']) expect(Number.isInteger(r[k]), `${w}x${h} ${k}`).toBe(true);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.w).toBeGreaterThanOrEqual(0);
      expect(r.h).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(w);
      expect(r.y + r.h).toBeLessThanOrEqual(h);
    }
    expect(overlap(l.city, l.hand), `${w}x${h}`).toBe(false);
    expect(area(l.city) + area(l.hand), `${w}x${h}`).toBe(w * h);
    expect(inside(l.hud, l.city), `${w}x${h} hud`).toBe(true);
  }
});

test('真っ白の間に、画面全体の描画（画面効果の大きさ・low の重ね描き）を一度温め、その上を白で塗る（白から街への切り替わりで止まらない）', async () => {
  const THREE = await import('three');
  const { createViews } = await import('../../src/render/views.js');
  const log = [];
  const renderer = {
    autoClear: true,
    setSize() {}, setViewport(x, y, w, h) { log.push(['viewport', w, h]); }, setScissor() {}, setScissorTest() {},
    getPixelRatio: () => 1, getRenderTarget: () => null, setRenderTarget() {},
    render(scene) { log.push(['render', scene.isScene ? 'scene' : 'quad']); },
    getClearColor(c) { return c.set(0, 0, 0); }, getClearAlpha: () => 1, setClearColor(c) { log.push(['clearColor', c.getHex()]); },
    clear() { log.push(['clear']); },
  };
  const views = createViews(renderer, () => ({ bloom: false, heatHaze: false }));
  views.resize(390, 844);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  const grade = { bars: 0.1, ca: 0, vig: 0.3, sat: 1, grain: 0, streak: 0, exposure: 1, fade: 0, warm: 0, contrast: 1 };
  log.length = 0;
  views.renderWhite({ scene, camera: cam, fx: { flash: 0, grade } });
  // 画面全体で場面を描き、重ね描き（grade）も描いてから
  expect(log.some(([k, w, h]) => k === 'viewport' && w === 390 && h === 844)).toBe(true);
  const iScene = log.findIndex(([k, s]) => k === 'render' && s === 'scene');
  const iQuad = log.findIndex(([k, s]) => k === 'render' && s === 'quad');
  expect(iScene).toBeGreaterThanOrEqual(0);
  // 閃光（low の白い重ね）と、帯・周辺減光の重ねの両方を描いて温める（fx の flash が 0 でも）
  expect(log.filter(([k, s]) => k === 'render' && s === 'quad')).toHaveLength(2);
  expect(iQuad).toBeGreaterThan(iScene);
  // 最後は白で塗る
  const iClear = log.findLastIndex(([k]) => k === 'clear');
  expect(iClear).toBeGreaterThan(iQuad);
  expect(log.some(([k, c]) => k === 'clearColor' && c === 0xffffff)).toBe(true);
  // 温めずに呼べば、白で塗るだけ
  log.length = 0;
  views.renderWhite();
  expect(log.some(([k]) => k === 'render')).toBe(false);
  expect(log.some(([k]) => k === 'clear')).toBe(true);
});

// M1（spec §16「上空のカメラは、主人公を真ん中に保ったまま、なめらかについていく。上空の距離感は今のまま」）
test('M1: 上空カメラは主人公についていく: なめらかに（一歩で跳ばない）、追いつけば同じ距離感で主人公が前と同じ画面の位置に来る', async () => {
  const THREE = await import('three');
  const { createViews } = await import('../../src/render/views.js');
  const renderer = { setSize() {}, setViewport() {}, setScissor() {}, setScissorTest() {}, getPixelRatio: () => 1, getRenderTarget: () => null, setRenderTarget() {}, render() {}, getClearColor(c) { return c; }, getClearAlpha: () => 1, setClearColor() {}, clear() {} };
  const views = createViews(renderer, () => ({ bloom: false, heatHaze: false }));
  views.resize(390, 844);
  const cam = views.cityCamera;
  views.updateCamera(1 / 60);
  const at0 = new THREE.Vector3(0, 1, 0).project(cam);
  const d0 = cam.position.length();
  const target = { x: 60, z: -40 };
  views.follow(target);
  views.updateCamera(1 / 60);
  // 一歩では跳ばない（主人公 11 m/s より少しだけ遅れて動き出す）
  expect(cam.position.x).toBeGreaterThan(0);
  expect(cam.position.x).toBeLessThan(5);
  for (let i = 0; i < 240; i++) views.updateCamera(1 / 60);
  const at = new THREE.Vector3(target.x, 1, target.z).project(cam);
  expect(at.x).toBeCloseTo(at0.x, 3);
  expect(at.y).toBeCloseTo(at0.y, 3);
  // 距離感（主人公からの距離）は同じ
  expect(cam.position.distanceTo(new THREE.Vector3(target.x, 0, target.z))).toBeCloseTo(d0, 3);
  // 全体の見える構図（widePosition）も主人公のまわり
  const w = views.widePosition(300, 390 / 844, new THREE.Vector3());
  expect(w.x).toBeCloseTo(cam.position.x, 3);
  // 速く走っても主人公は画面の真ん中の近くから外れない（11 m/s、遅れは数 m）
  const moving = { x: 60, z: -40 };
  views.follow(moving);
  let worst = 0;
  for (let i = 0; i < 180; i++) {
    moving.x += 11 / 60;
    views.updateCamera(1 / 60);
    const p = new THREE.Vector3(moving.x, 1, moving.z).project(cam);
    worst = Math.max(worst, Math.abs(p.x - at0.x));
  }
  expect(worst).toBeGreaterThan(0.001);
  expect(worst).toBeLessThan(0.12);
});
