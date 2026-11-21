import { test, expect } from 'vitest';
import { createHandView } from '../../src/render/handView.js';
import { buildHandModel } from '../../src/render/handModel.js';
import { HAND_JOINTS } from '../../src/render/handPose.js';
import { introHandsTo } from '../../src/render/intro.js';
import { heartFrames, interlace } from './heartProxy.js';
import { INTRO, createIntroTimeline } from '../../src/render/introTimeline.js';

// 導入の手の拍（S6。持ち主 15:55「貯め始めと最後の一撃を放つ瞬間（力を握り込む）」）も、S10 と同じく決してハートに見えない（持ち主 15:24）。
// S10 の画面での代わりの測り方（tests/render/handView.test.js）を、導入の手の動き（introHandsTo: 貯め → 握り込む、全画面の縦長、寄るカメラ）で確かめる
const hands = (detail) => ({ right: buildHandModel({ detail }), left: buildHandModel({ detail, side: 'left' }) });

test('導入の手の拍: 貯め始めは球が生まれて育ち、放つ瞬間に鷲掴みで握り込む', () => {
  const view = createHandView(hands('low'), 'low');
  const st = { t: -1 };
  introHandsTo(view, st, 0.2, 390 / 844);
  const r0 = view.orbSphere.radius;
  introHandsTo(view, st, INTRO.hands.releaseAt - 0.02, 390 / 844);
  expect(view.orbSphere.radius).toBeGreaterThan(r0 * 1.8);
  expect(view.joined).toBe(0);
  introHandsTo(view, st, INTRO.hands.releaseAt + 0.3, 390 / 844);
  expect(view.joined).toBeCloseTo(1, 2);
  // 巻き戻すと構えから積み直す（撮影・録画の seek）
  introHandsTo(view, st, 0.1, 390 / 844);
  expect(view.joined).toBe(0);
});

test('導入の手の拍は、放った直後の 0〜0.25 秒の 1/60 秒ごとも、そのあと白へ切り替わるまでも、ハートの形にならない（S10 と同じ強さ）', () => {
  const len = createIntroTimeline().beat('hands').dur;
  const times = [];
  for (let i = 1; i <= 15; i++) times.push(i / 60);
  times.push(0.3, 0.4, 0.6, len - INTRO.hands.releaseAt - 0.01);
  for (const detail of ['low', 'high']) {
    for (const aspect of [390 / 844, 432 / 768]) {
      const m = hands(detail);
      const view = createHandView(m, detail);
      const st = { t: -1 };
      for (const after of times) {
        introHandsTo(view, st, INTRO.hands.releaseAt + after, aspect);
        const f = heartFrames(m, view, aspect, HAND_JOINTS);
        const label = `${detail} ${aspect.toFixed(2)} +${after.toFixed(3)}`;
        // 指先は最初のフレームから交差して重なる（S10: 手の幅の 0.33）。頂は尖らない。親指は巻き上げない
        expect(f.overlap, label).toBeGreaterThan(0.33);
        if (f.near < 0.1) expect(f.overlap, label).toBeGreaterThan(0.33);
        expect(f.apex, label).toBeGreaterThan(0.38);
        expect(f.thumb, label).toBeLessThan(-0.03);
        // 締めきったら横に広く低い握り（S10 の 1.25 を 390:295 の画面で測ったのと同じ強さ: 縦横をそろえて 0.95）
        if (after >= 0.12) expect(f.shape, label).toBeLessThan(0.95);
        // 指を組む（持ち主 18:27）: 交互に並ぶか、相手の付け根を越えて届く
        const il = interlace(m);
        expect(il.alternations >= 6 || il.reach, label).toBe(true);
      }
    }
  }
});
