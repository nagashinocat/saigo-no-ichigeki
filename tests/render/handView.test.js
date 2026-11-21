import { test, expect } from 'vitest';
import { createHandView } from '../../src/render/handView.js';
import { CONFIG } from '../../src/config.js';
import * as THREE from 'three';
import { buildHandModel } from '../../src/render/handModel.js';

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

test('最後の一発: 約0.25秒で両手が球を鷲掴みにする — 指は球の上で交差して球を上から覆い、親指は球の下で先が離れ、ハートの形にならない', () => {
  const wp = (m, s, n) => m[s].bones[n].getWorldPosition(new THREE.Vector3());
  for (const detail of ['low', 'high']) {
    const m = hands(detail);
    const view = createHandView(m, detail);
    view.resize(390 / 295);
    run(view, 1, 0.9, true, 0.6);
    const stance = palmGap(view);
    view.release({ amount: CONFIG.power.max, isBig: true });
    run(view, 0.1, 0, false, 0.6);
    // 0.1 秒ではまだ寄っている途中。球は手の中で燃えたまま（放った瞬間の力の大きさの半分以上）
    expect(palmGap(view)).toBeLessThan(stance);
    expect(view.joined).toBeGreaterThan(0.05);
    expect(view.joined).toBeLessThan(0.5);
    expect(view.orbSphere.radius).toBeGreaterThan(0.2);
    run(view, 0.15, 0, false, 0.6);
    const label = detail;
    expect(view.joined).toBeCloseTo(1, 2);
    // 手のひらで押し込む: 手のひらの間は構えの半分未満
    expect(palmGap(view), label).toBeLessThan(stance * 0.5);
    const { center } = view.orbSphere;
    const tips = (s) => FINGER_TIPS.map((n) => wp(m, s, n));
    // 指先は左右で交差する（右手の指先は左手の指先より左まで、左手の指先は右手の指先より右まで届く）
    expect(Math.min(...tips('right').map((p) => p.x)), label).toBeLessThan(Math.max(...tips('left').map((p) => p.x)));
    // 球は指より下（指先の高さの平均より下）、親指の先より上
    for (const side of ['right', 'left']) {
      const ys = tips(side).map((p) => p.y);
      expect(ys.reduce((a, b) => a + b, 0) / ys.length, `${label} ${side}`).toBeGreaterThan(center.y);
      expect(wp(m, side, 'thumb-tip').y, `${label} ${side}`).toBeLessThan(center.y);
    }
    // 球を上から覆う: 画面で、どちらの手も、球の中心を越えて向こう側まで届く指先が球の中心より上にある
    const c = center.clone().project(view.camera);
    for (const [side, out] of [['right', 1], ['left', -1]]) {
      const over = tips(side).some((p) => { const q = p.clone().project(view.camera); return (q.x - c.x) * out < 0 && q.y > c.y; });
      expect(over, `${label} ${side}`).toBe(true);
    }
    // 親指の先は合わせない（ハートの下の尖りを作らない）
    expect(wp(m, 'right', 'thumb-tip').distanceTo(wp(m, 'left', 'thumb-tip')), label).toBeGreaterThan(0.08);
  }
});

test('鷲掴みで締めつける間、弾ける直前に手が震える', () => {
  const jitter = (v, from, to) => {
    // 手のひらの位置の、フレームごとの加速度（二階差分）の平均
    const ps = [];
    run(v, from, 0, false, 1);
    for (let t = from; t < to; t += DT) { v.update(DT, 0, false, 1); ps.push(v.palms.right); }
    let sum = 0;
    for (let i = 2; i < ps.length; i++) sum += ps[i].clone().sub(ps[i - 1]).sub(ps[i - 1].clone().sub(ps[i - 2])).length();
    return sum / (ps.length - 2);
  };
  const a = createHandView(hands('low'), 'low'), b = createHandView(hands('low'), 'low');
  for (const v of [a, b]) run(v, 1, 0.5, true, 1);
  a.release({ amount: CONFIG.power.max, isBig: true });
  b.release({ amount: CONFIG.power.max, isBig: true });
  const early = jitter(a, 0, 0.08), late = jitter(b, 0.15, 0.24);
  expect(late).toBeGreaterThan(early * 1.5);
  expect(late).toBeGreaterThan(0.004);
});

test('鷲掴みのまま保つ間: 手の中に押し縮められた球の芯が脈打って燃え残り、指は芯の上へ鉤をかけ、前腕は手首へ向かって上がり、手は細かく震え続ける', () => {
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
  // 芯は握った手の中: 指先の高さの平均より下、親指の先より上
  const { center } = v.orbSphere;
  for (const side of ['right', 'left']) {
    const ys = FINGER_TIPS.map((n) => wp(m, side, n).y);
    expect(ys.reduce((a, b) => a + b, 0) / 4, side).toBeGreaterThan(center.y);
    expect(wp(m, side, 'thumb-tip').y, side).toBeLessThan(center.y);
    // 前腕は手首へ向かって上がる（画面で、前腕の先より手首のほうが上）。手の甲を寝かせない
    const w = wp(m, side, 'wrist').project(v.camera), a = new THREE.Vector3(0, 0, 0.12).applyMatrix4(m[side].bones.wrist.matrixWorld).project(v.camera);
    expect(w.y, side).toBeGreaterThan(a.y);
  }
  // 保つ間も細かく震え続ける
  let jit = 0;
  for (let i = 2; i < ps.length; i++) jit += ps[i].clone().sub(ps[i - 1]).sub(ps[i - 1].clone().sub(ps[i - 2])).length();
  expect(jit / (ps.length - 2)).toBeGreaterThan(0.001);
});

test('放ってから保つまで、指先の鉤（第一関節の曲げ）は緩まない', () => {
  for (const level of [0.6, 0.9]) {
    const m = hands('low');
    const dips = [];
    const sp = m.right.setPose;
    m.right.setPose = (pose) => { dips.push(pose['index-finger-phalanx-distal'][0]); sp(pose); };
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
