import { test, expect } from 'vitest';
import { bindPointerInput } from '../../src/input/bindDom.js';
import { createControls } from '../../src/input/controls.js';
import { createPuffBuffer, secondFingerTaps } from '../../src/input/puffBuffer.js';
import { createLookoutView, arrowTarget, HIT_R, RING_R, TAP_BOX } from '../../src/ui/lookoutView.js';
import { fakeDom } from './fakeDom.js';

// 持ち主 22:47「隠れるより先に払うが反応して爆発してる」: LOOK OUT! の矢印（見えている丸・矢印・その下の「TAP」の字）のどこをタップしても
// 必ず隠れ、払わない。本物の入力の道すじ（bindPointerInput → createControls → lookoutView の当たり → main.js と同じ secondFingerTaps）で試す。
// 再現（Chrome のタッチ、../machi-hakai-shots/round5/arrow-tap-probe-before.log）: 見えている丸は content-box で当たりより (+4, +4) ずれて
// 直径 96 px（脈打ちで ×1.06・縁取り 4 px）、「TAP」の字は丸の下の当たりの外。丸の縁と「TAP」のタップは払うになっていた。

const VIEW = { w: 390, h: 844 };
// 見えている丸の外縁（縁取りの線 4 px と、脈打ちの ×1.06 を含む）
const VISIBLE_R = RING_R * 1.06 + 4;

function mkEl() { return { hidden: true, style: {}, classList: { add() {}, remove() {} }, offsetWidth: 0, textContent: '' }; }
function rig({ busy = false } = {}) {
  const dom = fakeDom();
  const parts = { '.lo-text': mkEl(), '.lo-arrow': mkEl(), '.lo-hit': mkEl(), '.lo-tap': mkEl() };
  const el = { ...mkEl(), querySelector: (k) => parts[k] ?? null };
  const view = createLookoutView(el, { view: () => VIEW });
  const log = [];
  const buffer = createPuffBuffer();
  // main.js の tryPuff と同じ: 払えなければ（前の払うが広がり終わる間際）覚えておく
  const game = { busy, puffs: 0 };
  const tryPuff = (x, y) => {
    if (!game.busy) { game.puffs++; log.push('puff'); return true; }
    buffer.push(x, y, dom.ms / 1000, 'busy', 0.1);
    return false;
  };
  const taps = secondFingerTaps({ buffer, puff: tryPuff, hide: () => log.push('hide') });
  const controls = createControls({ ...taps, hideHit: (x, y) => view.hit(x, y) });
  bindPointerInput(dom.target, { controls, perf: dom.perf });
  dom.fire('pointerdown', { pointerId: 1, clientX: 195, clientY: 800 }); // 1 本目: 溜め
  const tap = (x, y, between = () => {}) => {
    dom.advance(0.05);
    dom.fire('pointerdown', { pointerId: 2, clientX: x, clientY: y });
    between();
    dom.advance(0.08);
    dom.fire('pointerup', { pointerId: 2, clientX: x + 2, clientY: y + 1 }); // 指は少し転がる
  };
  return { dom, el, parts, view, log, buffer, game, tap, controls };
}

const SCENES = [
  { name: '右', at: { sx: 195, sy: 500 }, deg: 0 },
  { name: '下', at: { sx: 195, sy: 500 }, deg: 90 },
  { name: '左上', at: { sx: 195, sy: 500 }, deg: -135 },
  { name: '上（字が主人公の側）', at: { sx: 195, sy: 500 }, deg: -90 },
  { name: '右の端へ寄せた', at: { sx: 380, sy: 400 }, deg: 0 },
  { name: '左上の角へ寄せた', at: { sx: 8, sy: 10 }, deg: -135 },
  { name: '下の端へ寄せた', at: { sx: 195, sy: 836 }, deg: 90 },
];

function insidePoints(t) {
  const pts = [['真ん中', t.cx, t.cy]];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    pts.push([`見えている丸の縁 ${k * 22.5}°`, t.cx + Math.cos(a) * (VISIBLE_R - 1), t.cy + Math.sin(a) * (VISIBLE_R - 1)]);
  }
  const b = TAP_BOX;
  for (const [n, x, y] of [['TAP の真ん中', (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], ['TAP の左下', b.x0 + 1, b.y1 - 1], ['TAP の右下', b.x1 - 1, b.y1 - 1], ['TAP の左上', b.x0 + 1, b.y0 + 1]]) {
    pts.push([n, t.cx + x, t.cy + y]);
  }
  return pts;
}

test('22:47: 「TAP」の字の箱は、見えている丸の下にあり、丸と重ならない字の大きさ', () => {
  expect(RING_R).toBe(44); // 直径 88 px の丸（前と同じ大きさ）
  expect(HIT_R).toBeGreaterThanOrEqual(Math.ceil(VISIBLE_R)); // 当たりは見えている丸の外縁を含む
  expect(TAP_BOX.y0).toBeGreaterThanOrEqual(RING_R);
  expect(TAP_BOX.x1 - TAP_BOX.x0).toBeGreaterThanOrEqual(36);
});

for (const s of SCENES) {
  test(`22:47: 矢印（${s.name}）の見えている所のどこをタップしても隠れ、払わない`, () => {
    for (const [label, x, y] of insidePoints(arrowTarget(s.at, s.deg, VIEW))) {
      const r = rig();
      r.view.update({ show: true, deg: s.deg }, s.at);
      r.tap(x, y);
      expect(r.log, `${label} (${x.toFixed(1)}, ${y.toFixed(1)})`).toEqual(['hide']);
      expect(r.controls.charging).toBe(true);
    }
  });
}

test('22:47: 見えている丸を DOM に置く所と当たりが同じ（border-box の丸の真ん中 = 当たりの真ん中、「TAP」の字の箱 = TAP_BOX）', () => {
  const r = rig();
  const at = { sx: 195, sy: 500 };
  r.view.update({ show: true, deg: 30 }, at);
  const t = r.view.target, hit = r.parts['.lo-hit'].style, tap = r.parts['.lo-tap'].style;
  expect(hit.boxSizing).toBe('border-box');
  expect(hit.width).toBe(`${2 * RING_R}px`); expect(hit.height).toBe(`${2 * RING_R}px`);
  expect(hit.marginLeft).toBe(`${-RING_R}px`); expect(hit.marginTop).toBe(`${-RING_R}px`);
  const ox = parseFloat(r.el.style.left), oy = parseFloat(r.el.style.top);
  expect(ox + parseFloat(hit.left)).toBeCloseTo(t.cx, 0);
  expect(oy + parseFloat(hit.top)).toBeCloseTo(t.cy, 0);
  expect(r.parts['.lo-tap'].hidden).toBe(false);
  expect(ox + parseFloat(tap.left)).toBeCloseTo(t.cx + TAP_BOX.x0, 0);
  expect(oy + parseFloat(tap.top)).toBeCloseTo(t.cy + TAP_BOX.y0, 0);
  expect(tap.width).toBe(`${TAP_BOX.x1 - TAP_BOX.x0}px`); expect(tap.height).toBe(`${TAP_BOX.y1 - TAP_BOX.y0}px`);
});

test('22:47: 矢印のすぐ外のタップは払う（字だけの LOOK OUT!・矢印が出ていないときも払う）', () => {
  const at = { sx: 195, sy: 500 }, deg = 0, t = arrowTarget(at, deg, VIEW);
  const b = TAP_BOX;
  const outside = [
    ['上', t.cx, t.cy - HIT_R - 3], ['右', t.cx + HIT_R + 3, t.cy], ['左', t.cx - HIT_R - 3, t.cy],
    ['TAP の下', t.cx, t.cy + b.y1 + 8], ['主人公の上', at.sx, at.sy],
  ];
  for (const [label, x, y] of outside) {
    const r = rig();
    r.view.update({ show: true, deg }, at);
    r.tap(x, y);
    expect(r.log, label).toEqual(['puff']);
  }
  const r = rig();
  r.view.update({ show: true, deg: null }, at); // 字だけ（待ち時間の間）
  r.tap(t.cx, t.cy);
  expect(r.log).toEqual(['puff']);
});

test('22:47: 触れたときに矢印が出ていれば、離すまでに矢印が消えても（見つかった直後の猶予が切れた）隠れる。払わない', () => {
  const at = { sx: 195, sy: 500 }, t = arrowTarget(at, 0, VIEW);
  const r = rig();
  r.view.update({ show: true, deg: 0, grace: true }, at);
  r.tap(t.cx, t.cy, () => r.view.update({ show: false }, null));
  expect(r.log).toEqual(['hide']);
  // 字だけに変わった（払ったあとの待ち時間）
  const q = rig();
  q.view.update({ show: true, deg: 0 }, at);
  q.tap(t.cx + 10, t.cy, () => q.view.update({ show: true, deg: null }, at));
  expect(q.log).toEqual(['hide']);
});

test('22:47: 覚えておいた払う（前の払うが広がり終わる間際のタップ）が、矢印のタップを払うに変えない', () => {
  const at = { sx: 195, sy: 500 }, t = arrowTarget(at, 0, VIEW);
  // 広がっている間に矢印をタップ: 覚えない（払うの道を通らない）
  const r = rig({ busy: true });
  r.view.update({ show: true, deg: 0 }, at);
  r.tap(t.cx, t.cy);
  expect(r.log).toEqual(['hide']);
  expect(r.buffer.pending).toBeNull();
  r.game.busy = false;
  expect(r.buffer.take(r.dom.ms / 1000, true)).toBeNull();
  // 先に矢印の外を叩いて覚えた払うがあっても、そのあと矢印をタップしたら捨てる（隠れたあとに払いが出ない）
  const q = rig({ busy: true });
  q.view.update({ show: true, deg: 0 }, at);
  q.tap(40, 760);
  expect(q.buffer.pending).not.toBeNull();
  q.tap(t.cx, t.cy);
  expect(q.log).toEqual(['hide']);
  q.game.busy = false;
  expect(q.buffer.take(q.dom.ms / 1000, true)).toBeNull();
});
