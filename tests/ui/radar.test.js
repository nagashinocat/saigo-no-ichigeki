import { test, expect } from 'vitest';
import { radarRadius, markReachPx, markPos } from '../../src/ui/joystick.js';
import { MARKS } from '../../src/ui/stickMarks.js';
import { CONFIG } from '../../src/config.js';

// R1e（持ち主 16:45「ジョイスティック周りの敵のレーダー用の輪っかをもう少し大きくしたい」）: 印の輪を約 1.5 倍（M2 は輪の中心から
// stickRadiusPx + 9 = 65 px）、印も少し大きく。画面の端では、輪はスティックと同じ中心のまま小さくなる（向きがつまみから見てずれない）
const C = CONFIG.controls, RD = C.radar;
const W = 390, H = 844;
const M2_RADIUS = C.stickRadiusPx + 9;

test('R1e: レーダーの輪は M2 の約 1.5 倍、印は少し大きい（config）', () => {
  expect(RD.radiusPx / M2_RADIUS).toBeGreaterThan(1.45);
  expect(RD.radiusPx / M2_RADIUS).toBeLessThan(1.55);
  expect(RD.markScale).toBeGreaterThan(1.1);
  expect(RD.markScale).toBeLessThan(1.6);
});

test('R1e: 画面の真ん中では、輪は大きいまま。印（いちばん大きい印の縁）はつまみが届く所（輪の縁 + つまみの半径）に重ならない', () => {
  expect(radarRadius(W / 2, H / 2, W, H)).toBe(RD.radiusPx);
  const knobReach = C.stickRadiusPx + C.stickRadiusPx * 0.4;
  expect(RD.radiusPx - markReachPx()).toBeGreaterThan(knobReach);
});

test('R1e: 390×844 の縦の画面の端の近くでは、輪は同じ中心のまま小さくなり、印は画面の内に収まる', () => {
  for (const [cx, cy] of [[90, 422], [195, 740], [300, 90], [W - 95, H - 95], [110, 110]]) {
    const r = radarRadius(cx, cy, W, H);
    expect(r).toBeLessThan(RD.radiusPx);
    expect(r).toBeGreaterThanOrEqual(RD.minRadiusPx);
    const pad = markReachPx();
    expect(cx - r - pad).toBeGreaterThanOrEqual(0);
    expect(cx + r + pad).toBeLessThanOrEqual(W);
    expect(cy - r - pad).toBeGreaterThanOrEqual(0);
    expect(cy + r + pad).toBeLessThanOrEqual(H);
  }
  // 端から少しでも離れていれば大きいまま
  const far = Math.ceil(RD.radiusPx + markReachPx()) + 1;
  expect(radarRadius(far, far, W, H)).toBe(RD.radiusPx);
  // 端すぎても、スティックの輪より内へは縮まない（M2 の輪の大きさが下限）
  expect(radarRadius(20, 422, W, H)).toBe(RD.minRadiusPx);
  expect(RD.minRadiusPx).toBeGreaterThanOrEqual(M2_RADIUS);
});

test('R1e: 印の縁の半径（markReachPx）は、いちばん大きい印（大物・近い）の 45° 回した四角の半分の対角に、光の分を足したもの', () => {
  const boss = 14 * RD.markScale * MARKS.maxSize * Math.SQRT1_2;
  expect(markReachPx()).toBeGreaterThanOrEqual(boss);
  expect(markReachPx()).toBeLessThan(boss + 8);
});

test('R1e: 端すぎて輪が下限でも収まらないとき、はみ出す印だけ画面の縁の内へ寄せる（同じ側のまま）。収まる印は輪の上のまま', () => {
  const cx = 40, cy = 800, r = radarRadius(cx, cy, W, H), pad = markReachPx();
  expect(r).toBe(RD.minRadiusPx);
  for (let deg = -180; deg < 180; deg += 15) {
    const p = markPos(cx, cy, deg, r, W, H);
    expect(p.x).toBeGreaterThanOrEqual(pad - 1e-9); expect(p.x).toBeLessThanOrEqual(W - pad + 1e-9);
    expect(p.y).toBeGreaterThanOrEqual(pad - 1e-9); expect(p.y).toBeLessThanOrEqual(H - pad + 1e-9);
  }
  const up = markPos(cx, cy, -45, r, W, H); // 右上の印は輪の上のまま
  expect(Math.hypot(up.x - cx, up.y - cy)).toBeCloseTo(r, 6);
  const left = markPos(cx, cy, 180, r, W, H); // 左の印は縁へ寄るが、中心より左のまま
  expect(left.x).toBeLessThan(cx);
  expect(left.x).toBeCloseTo(pad, 6);
  // 真ん中では印はみな輪の上
  const m = markPos(195, 422, 30, RD.radiusPx, W, H);
  expect(Math.hypot(m.x - 195, m.y - 422)).toBeCloseTo(RD.radiusPx, 6);
});
