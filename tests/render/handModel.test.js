import { test, expect } from 'vitest';
import * as THREE from 'three';
import { buildHandModel } from '../../src/render/handModel.js';
import { createHandView } from '../../src/render/handView.js';
import { HAND_JOINTS } from '../../src/render/handPose.js';

const DT = 1 / 60;
const run = (view, sec, ...args) => { for (let t = 0; t < sec - 1e-9; t += DT) view.update(DT, ...args); };
const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const models = { high: buildHandModel({ detail: 'high' }), low: buildHandModel({ detail: 'low' }) };

test('25関節（wrist と各指の metacarpal〜tip）すべてのボーンがある', () => {
  for (const m of Object.values(models)) {
    expect(HAND_JOINTS).toHaveLength(25);
    for (const name of HAND_JOINTS) {
      expect(m.bones[name]?.isBone, name).toBe(true);
      expect(m.bones[name].name).toBe(name);
    }
    expect(m.mesh.isSkinnedMesh).toBe(true);
    expect(m.mesh.skeleton.bones).toHaveLength(25);
    // 骨は手首から指先へつながっている（指先の親は第一関節、第一関節の親は第二関節…）
    expect(m.bones['index-finger-tip'].parent).toBe(m.bones['index-finger-phalanx-distal']);
    expect(m.bones['thumb-metacarpal'].parent).toBe(m.bones.wrist);
    let found = false;
    m.root.traverse((o) => { if (o === m.mesh) found = true; });
    expect(found).toBe(true);
  }
});

test('頂点数が上限内（high ≤ 6000, low ≤ 2500）', () => {
  const count = (m) => m.mesh.geometry.attributes.position.count;
  expect(count(models.high)).toBeLessThanOrEqual(6000);
  expect(count(models.low)).toBeLessThanOrEqual(2500);
  // 細かいほうがきちんと細かい（low を流用していない）
  expect(count(models.high)).toBeGreaterThan(count(models.low) * 1.5);
});

test('スキンの重みは各頂点で合計1、参照するボーンの番号は範囲内', () => {
  for (const m of Object.values(models)) {
    const { skinIndex, skinWeight, position } = m.mesh.geometry.attributes;
    const nb = m.mesh.skeleton.bones.length;
    for (let i = 0; i < position.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const idx = skinIndex.getComponent(i, k), w = skinWeight.getComponent(i, k);
        expect(Number.isInteger(idx) && idx >= 0 && idx < nb).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
        sum += w;
      }
      expect(Math.abs(sum - 1)).toBeLessThan(1e-4);
      // 使うのは最も近い2本まで
      expect(skinWeight.getComponent(i, 2) + skinWeight.getComponent(i, 3)).toBe(0);
    }
  }
});

test('隣り合う指は肌でつながらない（手袋のように指がくっつかない）', () => {
  // 第二関節より先の骨どうしが、別の指どうしで同じ三角形を作らない
  for (const m of Object.values(models)) {
    const g = m.mesh.geometry, idx = g.index.array, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const names = m.mesh.skeleton.bones.map((b) => b.name);
    const fingerOf = (v) => {
      const n = names[sw.getComponent(v, 0) >= sw.getComponent(v, 1) ? si.getComponent(v, 0) : si.getComponent(v, 1)];
      return /intermediate|distal|tip/.test(n) || /^thumb-phalanx/.test(n) ? n.split('-')[0] : null;
    };
    let bad = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const f = [idx[t], idx[t + 1], idx[t + 2]].map(fingerOf).filter(Boolean);
      if (new Set(f).size > 1) bad++;
    }
    expect(bad).toBe(0);
  }
});

test('poseFor(0.9) を当てると、どの指先も手首から一定以上離れ、球の中心より手前（カメラ側）か横にある', () => {
  for (const [tier, aspect] of [['high', 384 / 432], ['low', 234 / 296], ['high', 16 / 9]]) {
    const model = buildHandModel({ detail: tier });
    const p = new THREE.Vector3(), w = new THREE.Vector3();
    model.root.updateMatrixWorld(true);
    model.bones.wrist.getWorldPosition(w);
    const restDist = Object.fromEntries(TIPS.map((n) => [n, model.bones[n].getWorldPosition(p).distanceTo(w)]));

    const view = createHandView(model, tier);
    view.resize(aspect);
    run(view, 1.2, 0.9, true, 1);
    for (let frame = 0; frame < 12; frame++) {
      run(view, 0.037, 0.9, true, 1); // 震えのいろいろな瞬間で
      const { center, radius } = view.orbSphere;
      const cam = view.camera.position;
      const toOrb = center.clone().sub(cam);
      const orbAngle = Math.asin(Math.min(1, radius / toOrb.length()));
      model.bones.wrist.getWorldPosition(w);
      for (const n of TIPS) {
        model.bones[n].getWorldPosition(p);
        // 握りこぶしにならない: 手首から、開いた手の 45% 以上は離れている
        expect(p.distanceTo(w) / model.root.matrixWorld.getMaxScaleOnAxis(), n).toBeGreaterThan(restDist[n] * 0.45);
        const toTip = p.clone().sub(cam);
        const nearer = toTip.dot(toOrb.clone().normalize()) < toOrb.length() - radius * 0.3;
        const beside = toTip.angleTo(toOrb) > orbAngle * 1.05;
        expect(nearer || beside, `${tier} ${aspect.toFixed(2)} ${n}`).toBe(true);
      }
    }
  }
});
