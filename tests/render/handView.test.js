import { test, expect } from 'vitest';
import { createHandView } from '../../src/render/handView.js';
import { CONFIG } from '../../src/config.js';
import * as THREE from 'three';
import { buildHandModel } from '../../src/render/handModel.js';
import { HAND_JOINTS } from '../../src/render/handPose.js';
import { heartFrames, interlace, litWindow } from './heartProxy.js';

const DT = 1 / 60;
const run = (view, sec, ...args) => { for (let t = 0; t < sec - 1e-9; t += DT) view.update(DT, ...args); };

// 場面の中の位置・大きさ・光の強さ・uniform の数がすべて有限か
function expectFinite(view) {
  const bad = [];
  view.scene.traverse((o) => {
    for (const v of [o.position, o.scale]) if (!v.toArray().every(Number.isFinite)) bad.push(o.type + ' transform');
    if (o.isLight && !Number.isFinite(o.intensity)) bad.push('light intensity');
    for (const [k, u] of Object.entries(o.material?.uniforms ?? {})) {
      const v = u.value;
      const nums = typeof v === 'number' ? [v] : v?.toArray ? v.toArray() : [];
      if (!nums.every(Number.isFinite)) bad.push(k);
    }
  });
  expect(bad).toEqual([]);
}

for (const tier of ['high', 'low']) {
  test(`createHandView(null) は今までどおり球だけで動く（${tier}）`, () => {
    const view = createHandView(null, tier);
    let skinned = 0;
    view.scene.traverse((o) => { if (o.isSkinnedMesh) skinned++; });
    expect(skinned).toBe(0);
    expect(view.scene.isScene).toBe(true);
    expect(view.camera.isPerspectiveCamera).toBe(true);
    for (const [level, active, steady] of [[0, false, 1], [0.5, true, 0.6], [0.95, true, 0.05], [1, true, 0], [NaN, true, NaN]]) {
      run(view, 0.5, level, active, steady);
      expectFinite(view);
    }
    view.release({ amount: CONFIG.power.max, radius: 400, isBig: true });
    run(view, 3, 0, false, 0.4);
    expectFinite(view);
    view.release(undefined); // 中身のない一発でもこわれない
    run(view, 1, 0, false, 0.4);
    expectFinite(view);
    // 大きさのない画面でもカメラはこわれない
    view.resize(0);
    view.resize(NaN);
    expect(view.camera.projectionMatrix.toArray().every(Number.isFinite)).toBe(true);
  });
}


const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const hands = (detail) => ({ right: buildHandModel({ detail }), left: buildHandModel({ detail, side: 'left' }) });
const palmGap = (view) => view.palms.right.distanceTo(view.palms.left);

test('両手のモデルを渡すと、両方が場面に入り、手のひらが球をはさんで向かい合う', () => {
  const m = hands('low');
  const view = createHandView(m, 'low');
  let skinned = 0;
  view.scene.traverse((o) => { if (o.isSkinnedMesh) skinned++; });
  expect(skinned).toBe(4); // 肌と輪郭線、それぞれ両手ぶん
  run(view, 1, 0.5, true, 1);
  const { right, left } = view.palms, { center } = view.orbSphere;
  // 右手は右、左手は左。球は両手の手のひらの間の中ほど
  const cam = view.camera;
  const sx = (p) => p.clone().project(cam).x;
  expect(sx(right)).toBeGreaterThan(0.1);
  expect(sx(left)).toBeLessThan(-0.1);
  const mid = right.clone().add(left).multiplyScalar(0.5);
  expect(Math.abs(sx(center) - sx(mid))).toBeLessThan(0.05);
  // 手のひら（甲の反対の向き）が球を向く。手首を反らすので、手のひらの向きは中手骨で測る
  for (const [side, model] of Object.entries(m)) {
    const q = model.bones['middle-finger-metacarpal'].getWorldQuaternion(new THREE.Quaternion());
    const palmDir = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
    const toOrb = center.clone().sub(view.palms[side]).normalize();
    expect(palmDir.dot(toOrb), side).toBeGreaterThan(0.8);
  }
});

// 持ち主のスケッチ（owner-hands-sketch.jpg）: 両手が球を左右から包む。前腕は左右の下・外から低く入り、
// 指は上へ立って球の上へ丸くかぶさり、親指は球の下で内へ伸びて先が近づく。全体で球を囲む菱形・輪になる
const FINGER_TIPS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
test('構え: 手のひらは球を向き、指先は球の中心より上、親指の先は下、前腕は左右の下・外から低く入る（持ち主のスケッチ）', () => {
  for (const [detail, aspect] of [['low', 390 / 295], ['high', 390 / 295], ['low', 1280 / 252]]) {
    for (const level of [0, 0.5, 1]) {
      const m = hands(detail);
      const view = createHandView(m, detail);
      view.resize(aspect);
      run(view, 1.2, level, level > 0, 1);
      const { center } = view.orbSphere;
      const scr = (p) => p.clone().project(view.camera);
      const c = scr(center);
      const wp = (model, n) => model.bones[n].getWorldPosition(new THREE.Vector3());
      const tips = {};
      for (const [side, model] of Object.entries(m)) {
        const label = `${detail} ${aspect.toFixed(2)} ${level} ${side}`;
        const out = side === 'right' ? 1 : -1; // 画面の外側の向き（x）
        // 手のひら（中手骨の -Y）が球を向く
        const q = model.bones['middle-finger-metacarpal'].getWorldQuaternion(new THREE.Quaternion());
        const palmDir = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
        expect(palmDir.dot(center.clone().sub(view.palms[side]).normalize()), label).toBeGreaterThan(0.8);
        // 指先は球の中心より上（場面でも画面でも）、指先は手のひらより内側（球の上へかぶさる）
        for (const n of FINGER_TIPS) {
          const p = wp(model, n);
          expect(p.y, `${label} ${n}`).toBeGreaterThan(center.y);
          expect(scr(p).y, `${label} ${n}`).toBeGreaterThan(c.y);
          expect((scr(p).x - scr(view.palms[side]).x) * out, `${label} ${n}`).toBeLessThan(0);
        }
        // 親指の先は球の中心より下で、付け根より内側（球の下で内へ伸びる）
        const tt = wp(model, 'thumb-tip'), tb = wp(model, 'thumb-metacarpal');
        expect(tt.y, `${label} thumb`).toBeLessThan(center.y);
        expect(scr(tt).y, `${label} thumb`).toBeLessThan(c.y);
        expect((scr(tt).x - scr(tb).x) * out, `${label} thumb`).toBeLessThan(0);
        // 前腕は手首から左右の外・下へ、低く（水平から 45° より寝て）伸びる
        const w = scr(wp(model, 'wrist'));
        const arm = scr(new THREE.Vector3(0, 0, 0.12).applyMatrix4(model.bones.wrist.matrixWorld));
        const dx = (arm.x - w.x) * out * aspect, dy = arm.y - w.y; // 画面の縦横の比をそろえる
        expect(dx, `${label} forearm outward`).toBeGreaterThan(0);
        expect(dy, `${label} forearm downward`).toBeLessThan(0);
        expect(Math.abs(dy), `${label} forearm flat`).toBeLessThan(dx);
        tips[side] = { fingers: FINGER_TIPS.map((n) => wp(model, n)), thumb: tt };
      }
      // 左右の指先は球の上で近づくが触れない。親指の先も球の下で近づく
      const gap = palmGap(view);
      let fingerGap = Infinity;
      for (const a of tips.right.fingers) for (const b of tips.left.fingers) fingerGap = Math.min(fingerGap, a.distanceTo(b));
      const label = `${detail} ${aspect.toFixed(2)} ${level}`;
      expect(fingerGap, label).toBeGreaterThan(0.08);
      expect(fingerGap, label).toBeLessThan(gap * 0.6);
      const thumbGap = tips.right.thumb.distanceTo(tips.left.thumb);
      expect(thumbGap, label).toBeGreaterThan(0.08);
      expect(thumbGap, label).toBeLessThan(gap * 0.75);
    }
  }
});

test('貯め0.9で、両手の10本の指先がすべてカメラから見える（画角内で、球に隠れない）', () => {
  for (const [detail, aspect] of [['high', 390 / 295], ['low', 390 / 295], ['high', 1280 / 252], ['low', 375 / 233], ['high', 768 / 358]]) {
    const m = hands(detail);
    const restDist = {};
    for (const [side, model] of Object.entries(m)) {
      model.root.updateMatrixWorld(true);
      const w = model.bones.wrist.getWorldPosition(new THREE.Vector3());
      restDist[side] = Object.fromEntries(TIPS.map((n) => [n, model.bones[n].getWorldPosition(new THREE.Vector3()).distanceTo(w)]));
    }
    const view = createHandView(m, detail);
    view.resize(aspect);
    run(view, 1.2, 0.9, true, 1);
    const p = new THREE.Vector3(), w = new THREE.Vector3();
    for (let frame = 0; frame < 12; frame++) {
      run(view, 0.037, 0.9, true, 1); // 震えのいろいろな瞬間で
      const { center, radius } = view.orbSphere;
      const cam = view.camera.position;
      const toOrb = center.clone().sub(cam);
      const orbAngle = Math.asin(Math.min(1, radius / toOrb.length()));
      for (const [side, model] of Object.entries(m)) {
        model.bones.wrist.getWorldPosition(w);
        for (const n of TIPS) {
          const label = `${detail} ${aspect.toFixed(2)} ${side} ${n}`;
          model.bones[n].getWorldPosition(p);
          // 握りこぶしにならない: 手首から、開いた手の 45% 以上は離れている
          expect(p.distanceTo(w) / model.root.matrixWorld.getMaxScaleOnAxis(), label).toBeGreaterThan(restDist[side][n] * 0.45);
          // 画角の中
          const ndc = p.clone().project(view.camera);
          expect(Math.abs(ndc.x) < 0.97 && Math.abs(ndc.y) < 0.97 && ndc.z < 1, label).toBe(true);
          // 球に隠れない: 球の手前か、球の横
          const toTip = p.clone().sub(cam);
          const nearer = toTip.dot(toOrb.clone().normalize()) < toOrb.length() - radius * 0.3;
          const beside = toTip.angleTo(toOrb) > orbAngle * 1.05;
          expect(nearer || beside, label).toBe(true);
        }
      }
    }
  }
});

test('貯めるほど両手の間が少し広がる', () => {
  const view = createHandView(hands('low'), 'low');
  run(view, 1, 0, false, 1);
  const g0 = palmGap(view);
  run(view, 1, 0.9, true, 1);
  const g9 = palmGap(view);
  expect(g9).toBeGreaterThan(g0 * 1.1);
  expect(g9).toBeLessThan(g0 * 2);
});

test('最後の一発（持ち主 19:09）: 放ったら 1〜2 フレームで両手を握り合わせる — 手のひらを合わせて球を押しつぶし、指は相手の付け根を越えて交互に組み、親指は下で横に交差する', () => {
  const wp = (m, s, n) => m[s].bones[n].getWorldPosition(new THREE.Vector3());
  for (const detail of ['low', 'high']) {
    const m = hands(detail);
    const view = createHandView(m, detail);
    view.resize(390 / 295);
    run(view, 1, 0.9, true, 1);
    const stance = palmGap(view), stanceR = view.orbSphere.radius;
    view.release({ amount: CONFIG.power.max, isBig: true });
    run(view, 2 * DT, 0, false, 0.6);
    const label = detail;
    expect(view.joined, label).toBeGreaterThan(0.95);
    // 手のひらを合わせる（構えの 3 割より近い）。球は押しつぶされる（構えの半分より小さい）が、芯は残る
    expect(palmGap(view), label).toBeLessThan(stance * 0.3);
    expect(view.orbSphere.radius, label).toBeLessThan(stanceR * 0.5);
    expect(view.orbSphere.radius, label).toBeGreaterThan(0.02);
    // 指は交互に組み、相手の手の付け根を越えて届く
    const il = interlace(m);
    expect(il.alternations, label).toBe(7);
    expect(il.reach, label).toBe(true);
    // 親指は球の下で、左右が横に交差する（右手の親指の先が左手の親指の先より左）。先どうしは合わせない
    const { center } = view.orbSphere;
    // （画面で）親指の先は球の中心より下: 下の縁に横に並ぶ
    for (const side of ['right', 'left']) expect(wp(m, side, 'thumb-tip').project(view.camera).y, `${label} ${side}`).toBeLessThan(center.clone().project(view.camera).y);
    expect(wp(m, 'right', 'thumb-tip').x, label).toBeLessThan(wp(m, 'left', 'thumb-tip').x);
    expect(wp(m, 'right', 'thumb-tip').distanceTo(wp(m, 'left', 'thumb-tip')), label).toBeGreaterThan(0.08);
  }
});

// 持ち主（15:24）: 「ハートには見えないように」。どの瞬間も、尖った頂の下に光る内側があり親指がそれを下から囲む形にしない。
// 画面での代わりの測り方: 0.12 秒からは左右の指先の群れが横に大きく重なる（光を指で埋める）、
// 一番上の点のまわり（高さの上 15%）が手の幅の 4 割より広い（ひとつの尖った頂にならない）、
// 親指の先は付け根の節より下（上へ巻き上げない）、握った形は横に広く低い（縦横の比 1.25 未満）
test('最後の一発の寄る途中も締めきっても、ハートの形にならない: 指が早く交差して光を埋め、上は尖らず、親指は上へ巻き上げない', () => {
  for (const detail of ['low', 'high']) {
    const m = hands(detail);
    const view = createHandView(m, detail);
    view.resize(390 / 295);
    run(view, 1, 0.9, true, 1);
    view.release({ amount: CONFIG.power.max, isBig: true });
    const sp = (s, n) => m[s].bones[n].getWorldPosition(new THREE.Vector3()).project(view.camera);
    let t = 0;
    for (const at of [0.04, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22, 0.25, 0.6]) {
      run(view, at - t, 0, false, 1);
      t = at;
      const label = `${detail} ${at}`;
      const pts = [];
      for (const s of ['right', 'left']) for (const n of HAND_JOINTS) if (n !== 'wrist') pts.push(sp(s, n));
      const ys = pts.map((p) => p.y), xs = pts.map((p) => p.x);
      const H = Math.max(...ys) - Math.min(...ys), W = Math.max(...xs) - Math.min(...xs);
      // 親指は上へ巻き上げない（どの瞬間も）。左右の親指の先は合わせない
      for (const s of ['right', 'left']) expect(sp(s, 'thumb-tip').y - sp(s, 'thumb-phalanx-proximal').y, `${label} ${s} thumb`).toBeLessThan(-0.02);
      const tw = (s) => m[s].bones['thumb-tip'].getWorldPosition(new THREE.Vector3());
      expect(tw('right').distanceTo(tw('left')), label).toBeGreaterThan(0.08);
      if (at < 0.12) continue;
      // 指先の群れが横に重なる（右手の指先の一番左が、左手の指先の一番右より左）
      const fx = (s) => FINGER_TIPS.map((n) => sp(s, n).x);
      expect(Math.max(...fx('left')) - Math.min(...fx('right')), label).toBeGreaterThan(0.25);
      // 上はひとつの尖った頂にならない
      const top = Math.max(...ys);
      const band = xs.filter((x, i) => ys[i] > top - 0.15 * H);
      expect((Math.max(...band) - Math.min(...band)) / W, label).toBeGreaterThan(0.38);
      // 横に広く低い握り（締めつける挟み）
      expect(H / W, label).toBeLessThan(1.25);
    }
  }
});

test('鷲掴みで締めつける間、弾ける直前に手が震える', () => {
  // 寄る動きそのものを除くため、震えの位相だけ違う 2 つの画面を同じ時刻の進みで比べる（差は震えだけになる）
  const pair = [createHandView(hands('low'), 'low'), createHandView(hands('low'), 'low')];
  run(pair[0], 1, 0.5, true, 1);
  run(pair[1], 1 + 3 * DT, 0.5, true, 1);
  for (const v of pair) v.release({ amount: CONFIG.power.max, isBig: true });
  const diff = [];
  for (let t = 0; t < 0.24; t += DT) { for (const v of pair) v.update(DT, 0, false, 1); diff.push({ t, d: pair[0].palms.right.distanceTo(pair[1].palms.right) }); }
  const mean = (a, b) => { const xs = diff.filter((q) => q.t >= a && q.t < b).map((q) => q.d); return xs.reduce((x, y) => x + y, 0) / xs.length; };
  const early = mean(0, 0.08), late = mean(0.15, 0.24);
  expect(late).toBeGreaterThan(early * 2);
  expect(late).toBeGreaterThan(0.006);
});

test('握り合わせたまま保つ間: 手の中に押しつぶされた球の芯が脈打って燃え残り、指は交互に組んだまま、手は細かく震え続ける', () => {
  const wp = (m, s, n) => m[s].bones[n].getWorldPosition(new THREE.Vector3());
  const m = hands('low');
  const v = createHandView(m, 'low');
  v.resize(390 / 295);
  run(v, 1, 0.9, true, 1);
  v.release({ amount: CONFIG.power.max, isBig: true });
  run(v, 0.5, 0, false, 1);
  const radii = [], ps = [];
  for (let t = 0; t < 0.6; t += DT) {
    v.update(DT, 0, false, 1);
    radii.push(v.orbSphere.radius);
    ps.push(v.palms.right);
    expect(v.joined).toBeCloseTo(1, 5);
  }
  // 芯は小さいが消えない（構えの球より小さく、見える大きさ）。大きさが脈打つ
  expect(Math.min(...radii)).toBeGreaterThan(0.05);
  expect(Math.max(...radii)).toBeLessThan(0.2);
  expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.02);
  // 芯は握り合わせた手の中: 親指の先より上。指は保つ間も交互に組んだまま（持ち主 19:09）
  const { center } = v.orbSphere;
  for (const side of ['right', 'left']) expect(wp(m, side, 'thumb-tip').project(v.camera).y, side).toBeLessThan(center.clone().project(v.camera).y);
  const il = interlace(m);
  expect(il.alternations).toBe(7);
  expect(il.reach).toBe(true);
  // 保つ間も細かく震え続ける
  let jit = 0;
  for (let i = 2; i < ps.length; i++) jit += ps[i].clone().sub(ps[i - 1]).sub(ps[i - 1].clone().sub(ps[i - 2])).length();
  expect(jit / (ps.length - 2)).toBeGreaterThan(0.001);
});

// 燃え残る芯は光として読める（石や影に見せない）: 保つ間、芯の熱い色の重み（uEmber）は 1 近く、明るさ（uPower）は高い。
// 光の板は握った両手より大きく広がり、暖かい光を強く出す（low の段でも同じ。ブルームに頼らない）。肌も芯の光を受ける
test('鷲掴みのまま保つ間、芯は熱い光として明るく燃え、光の板は握った手のまわりへ暖かくこぼれる（high / low）', () => {
  for (const detail of ['low', 'high']) {
    const m = hands(detail);
    const v = createHandView(m, detail);
    v.resize(390 / 295);
    run(v, 1, 0.9, true, 1);
    const mats = [];
    v.scene.traverse((o) => { if (o.material?.uniforms) mats.push(o); });
    const orb = mats.find((o) => o.material.uniforms.uCore && o.material.uniforms.uDeep);
    const halo = mats.find((o) => o.material.uniforms.uOrbFrac);
    expect(orb && halo, detail).toBeTruthy();
    v.release({ amount: CONFIG.power.max, isBig: true });
    run(v, 0.45, 0, false, 1);
    let light = null;
    v.scene.traverse((o) => { if (o.isPointLight) light = o; });
    for (let t = 0; t < 1.1; t += DT) {
      v.update(DT, 0, false, 1);
      const label = `${detail} ${t.toFixed(2)}`;
      const ou = orb.material.uniforms, hu = halo.material.uniforms;
      expect(orb.visible, label).toBe(true);
      expect(ou.uEmber.value, label).toBeGreaterThan(0.95);
      expect(ou.uPower.value * ou.uFade.value, label).toBeGreaterThan(0.8);
      expect(hu.uEmber.value, label).toBeGreaterThan(0.95);
      expect(hu.uPower.value, label).toBeGreaterThan(0.7);
      // 光の板は握った両手を覆うほど広い（手のひらの間より大きい半径）
      expect(halo.scale.x, label).toBeGreaterThan(palmGap(v));
      expect(light.intensity, label).toBeGreaterThan(0.8);
    }
    // 構えに戻ると芯の色はやめる
    run(v, 2, 0, false, 1);
    expect(orb.material.uniforms.uEmber.value, detail).toBe(0);
  }
});

test('放ってから保つまで、組んだ指（付け根の曲げ）は緩まない（持ち主 19:09 の握り合わせ）', () => {
  for (const level of [0.6, 0.9]) {
    const m = hands('low');
    const dips = [];
    const sp = m.right.setPose;
    m.right.setPose = (pose) => { dips.push(pose['index-finger-phalanx-proximal'][0]); sp(pose); };
    const v = createHandView(m, 'low');
    run(v, 1, level, true, 1);
    dips.length = 0;
    v.release({ amount: CONFIG.power.max, isBig: true });
    run(v, 1.0, 0, false, 1); // 寄って締めつけ、そのまま保つ
    expect(v.joined).toBeCloseTo(1, 5);
    if (level < 0.75) {
      // 震えのない力では、1 フレームも緩まない
      for (let i = 1; i < dips.length; i++) expect(dips[i], `${level} frame ${i}`).toBeGreaterThanOrEqual(dips[i - 1] - 1e-9);
    } else {
      // 震える力でも、放った瞬間より震えの幅（5°）以上は緩まない
      for (let i = 1; i < dips.length; i++) expect(dips[i], `${level} frame ${i}`).toBeGreaterThan(dips[0] - 5 * Math.PI / 180);
    }
    expect(dips[dips.length - 1]).toBeGreaterThan(dips[0]);
  }
});

test('払う（小爆発）: 手のひらを街のほうへ鋭く突き出して弾き、約0.4秒で構えに戻る。両手は合わさらない', () => {
  const m = hands('low');
  const v = createHandView(m, 'low');
  run(v, 1, 0.3, true, 1);
  const stance = { gap: palmGap(v), z: v.palms.right.z };
  v.release({ amount: CONFIG.puff.cost, isBig: false });
  run(v, 0.09, 0, false, 1);
  expect(v.pushed).toBeGreaterThan(0.9);
  expect(v.joined).toBe(0);
  expect(v.flash).toBeGreaterThan(0.3);
  // 前（街のほう、目から遠ざかる -z）へ突き出し、両手の間は狭まらない
  expect(v.palms.right.z).toBeLessThan(stance.z - 0.3);
  expect(palmGap(v)).toBeGreaterThan(stance.gap * 0.9);
  // 手のひらは前（-z）を向く
  const q = m.right.bones['middle-finger-metacarpal'].getWorldQuaternion(new THREE.Quaternion());
  expect(new THREE.Vector3(0, -1, 0).applyQuaternion(q).z).toBeLessThan(-0.5);
  // 約0.4秒で構えに戻る
  run(v, 0.2, 0, false, 1);
  expect(v.pushed).toBeGreaterThan(0.05);
  expect(v.pushed).toBeLessThan(0.95);
  run(v, 0.15, 0, false, 1);
  expect(v.pushed).toBe(0);
  const rest = createHandView(hands('low'), 'low');
  run(rest, 1, 0, false, 1);
  expect(Math.abs(palmGap(v) - palmGap(rest)) / palmGap(rest)).toBeLessThan(0.08);
});

test('大きな一発は演出の間、鷲掴みのまま保ち、演出が終わると構えへ戻る', () => {
  const freeze = CONFIG.cinematic.freezeSec;
  const big = createHandView(hands('low'), 'low');
  run(big, 1, 0.9, true, 0.6);
  expect(big.joined).toBe(0);
  big.release({ amount: CONFIG.power.max, isBig: true });
  run(big, 0.25, 0, false, 0.6);
  expect(big.joined).toBeCloseTo(1, 2);
  // 締めきった瞬間に光が弾ける
  expect(big.flash).toBeGreaterThan(0.3);
  run(big, freeze - 0.3, 0, false, 0.6);
  expect(big.joined).toBeCloseTo(1, 5);
  run(big, 1.5, 0, false, 0.6);
  expect(big.joined).toBe(0);
});

test('寄る途中や戻る途中にもう一度放っても、両手は跳ばずに今の位置から続けて動く', () => {
  for (const [isBig, key, waits] of [[true, 'joined', [0.12]], [false, 'pushed', [0.05, 0.08 + 0.05 + 0.15]]]) {
    for (const wait of waits) {
      const v = createHandView(hands('low'), 'low');
      run(v, 1, 0.5, true, 0.6);
      const shot = { amount: isBig ? CONFIG.power.max : CONFIG.puff.cost, isBig };
      v.release(shot);
      run(v, wait, 0, false, 0.6);
      const before = v[key];
      expect(before, `${key} ${wait}`).toBeGreaterThan(0.1);
      v.release(shot);
      v.update(DT, 0, false, 0.6);
      // 戻らず、今の具合から続けて動く（払うは 0.08 秒で突き出しきる速い動きなので、1 フレームの進みはそのぶん大きい）
      expect(v[key], `${key} ${wait}`).toBeGreaterThanOrEqual(before - 1e-6);
      expect(v[key] - before, `${key} ${wait}`).toBeLessThan(isBig ? 0.15 : 0.55);
      let peak = 0;
      for (let t = 0; t < 0.25; t += DT) { v.update(DT, 0, false, 0.6); peak = Math.max(peak, v[key]); }
      expect(peak, `${key} ${wait}`).toBeCloseTo(1, 2);
    }
  }
});

test('fizzle（足りずに離した）: 両手がびくっと震え、球の光が一瞬しぼみ、約0.6秒で落ち着く。組み合わさらない', () => {
  const calm = createHandView(hands('low'), 'low'), fz = createHandView(hands('low'), 'low');
  for (const v of [calm, fz]) run(v, 1, 0.06, false, 1);
  fz.fizzle();
  let maxDiff = 0;
  for (let i = 0; i < 12; i++) {
    calm.update(DT, 0.06, false, 1); fz.update(DT, 0.06, false, 1);
    maxDiff = Math.max(maxDiff, fz.palms.right.distanceTo(calm.palms.right));
    expect(fz.joined).toBe(0);
  }
  expect(maxDiff).toBeGreaterThan(0.004);
  run(calm, 0.6, 0.06, false, 1); run(fz, 0.6, 0.06, false, 1);
  expect(fz.palms.right.distanceTo(calm.palms.right)).toBeLessThan(0.002);
  expectFinite(fz);
});

// S6 fix1（持ち主 15:24「ハートには見えないように」、点で触れ合わない）: 放った直後の 0〜0.25 秒を 1/60 秒ごとに見る。
// どの瞬間も、左右の指先の群れが頂の真ん中で点で触れ合う形にならない: 指先どうしが届く近さ（手の幅の 0.1 以内）なら
// もう横に手の幅の 0.33 以上重なって交差している。上はひとつの尖った頂にならない（上 15% の帯が手の幅の 0.38 より広い）。
// 親指は上へ巻き上げない
test('S6 fix1: 放った直後の 0〜0.25 秒、1/60 秒ごとのどの瞬間も、指先が頂の真ん中で点で触れ合わない（最初のフレームから交差している）', () => {
  for (const detail of ['low', 'high']) {
    const m = hands(detail);
    const view = createHandView(m, detail);
    const aspect = 390 / 295;
    view.resize(aspect);
    run(view, 1, 0.9, true, 1);
    view.release({ amount: CONFIG.power.max, isBig: true });
    for (let i = 1; i <= 15; i++) {
      view.update(DT, 0, false, 1);
      const f = heartFrames(m, view, aspect, HAND_JOINTS);
      const label = `${detail} +${i}/60`;
      if (f.near < 0.1) expect(f.overlap, `${label} tips within reach must already cross`).toBeGreaterThan(0.33);
      expect(f.overlap, `${label} crossed from the first frame`).toBeGreaterThan(0.33);
      expect(f.apex, `${label} apex`).toBeGreaterThan(0.38);
      expect(f.thumb, `${label} thumb`).toBeLessThanOrEqual(0); // 親指は上へ巻き上げない
    }
  }
});

// S6 fix2: 骨だけでは見えない「光る窓」（手のひらの肉と球の光）の形。下の縁が V に尖らない（下の幅が上の 4 割以上。窓がなければよい）
// （手の網に光線を当てて調べるので重い。形の同じ low の網で測る）
test('S6 fix2: 放った直後（+1/60〜+0.1 秒）、両手に囲まれた光る窓の下の縁は尖らない（V にならない）', () => {
  for (const detail of ['low']) {
    const m = hands(detail);
    const view = createHandView(m, detail);
    view.resize(390 / 295);
    run(view, 1, 0.9, true, 1);
    view.release({ amount: CONFIG.power.max, isBig: true });
    for (let i = 1; i <= 6; i++) {
      view.update(DT, 0, false, 1);
      const w = litWindow(view, m, 24);
      expect(w.ratio, `${detail} +${i}/60 window ${JSON.stringify(w)}`).toBeGreaterThanOrEqual(0.4);
    }
  }
}, 60000);

test('持ち主 18:27: 放つと、溜めていた構えからそのまま指を組む: 0〜0.25 秒の 1/60 秒ごとに、指先は左右交互に並ぶか相手の付け根を越えて届き、締めきると交互に深く組む', () => {
  for (const detail of ['low', 'high']) {
    const m = hands(detail);
    const view = createHandView(m, detail);
    view.resize(390 / 295);
    run(view, 1, 0.9, true, 1);
    view.release({ amount: CONFIG.power.max, isBig: true });
    for (let i = 1; i <= 15; i++) {
      view.update(DT, 0, false, 1);
      const f = interlace(m), label = `${detail} +${i}/60`;
      expect(f.alternations >= 6 || f.reach, label).toBe(true);
    }
    run(view, 0.3, 0, false, 1);
    const f = interlace(m);
    expect(f.alternations, detail).toBe(7); // 右左右左…（指が交互）
    expect(f.reach, detail).toBe(true); // 相手の付け根を越えて深く組む（握り合わせでは指が相手の手の甲へ巻きつく）
  }
});
