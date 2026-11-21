import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createHandView } from '../../src/render/handView.js';
import { buildHandModel } from '../../src/render/handModel.js';
import { HAND_JOINTS } from '../../src/render/handPose.js';
import { introHandsTo } from '../../src/render/intro.js';
import { INTRO, createIntroTimeline } from '../../src/render/introTimeline.js';

// 導入の手の拍（S6。持ち主 15:55「貯め始めと最後の一撃を放つ瞬間（力を握り込む）」）も、S10 と同じく決してハートに見えない（持ち主 15:24）。
// S10 の画面での代わりの測り方（tests/render/handView.test.js）を、導入の手の動き（introHandsTo: 貯め → 握り込む、全画面の縦長、寄るカメラ）で確かめる
const FINGER_TIPS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
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

test('導入の手の拍は、握り込む途中も締めきっても、白へ切り替わるまでハートの形にならない（S10 の代わりの測り方）', () => {
  const len = createIntroTimeline().beat('hands').dur;
  for (const detail of ['low', 'high']) {
    for (const aspect of [390 / 844, 432 / 768]) {
      const m = hands(detail);
      const view = createHandView(m, detail);
      const st = { t: -1 };
      const sp = (s, n) => m[s].bones[n].getWorldPosition(new THREE.Vector3()).project(view.camera);
      for (const after of [0.04, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22, 0.25, 0.4, 0.6, len - INTRO.hands.releaseAt - 0.01]) {
        introHandsTo(view, st, INTRO.hands.releaseAt + after, aspect);
        const label = `${detail} ${aspect.toFixed(2)} +${after}`;
        const pts = [];
        for (const s of ['right', 'left']) for (const n of HAND_JOINTS) if (n !== 'wrist') pts.push(sp(s, n));
        const ys = pts.map((p) => p.y), xs = pts.map((p) => p.x);
        const H = Math.max(...ys) - Math.min(...ys), W = Math.max(...xs) - Math.min(...xs);
        // 親指は上へ巻き上げない（縦長の全画面は画角が広く手が小さく映るので、S10 の -0.02 を手の高さに対する割合で測る）
        for (const s of ['right', 'left']) expect((sp(s, 'thumb-tip').y - sp(s, 'thumb-phalanx-proximal').y) / H, `${label} ${s} thumb`).toBeLessThan(-0.03);
        const tw = (s) => m[s].bones['thumb-tip'].getWorldPosition(new THREE.Vector3());
        expect(tw('right').distanceTo(tw('left')), label).toBeGreaterThan(0.08);
        if (after < 0.12) continue;
        // 縦長の全画面では画面の x が縮むので、S10 の横の重なり（0.25）は縦横の比で直して測る
        const fx = (s) => FINGER_TIPS.map((n) => sp(s, n).x);
        expect((Math.max(...fx('left')) - Math.min(...fx('right'))) / W, label).toBeGreaterThan(0.1);
        const top = Math.max(...ys);
        const band = xs.filter((x, i) => ys[i] > top - 0.15 * H);
        expect((Math.max(...band) - Math.min(...band)) / W, label).toBeGreaterThan(0.38);
        // 横に広く低い握り（画面の縦横の比をそろえて測る）
        expect((H / W) / aspect, label).toBeLessThan(1.25);
      }
    }
  }
});
