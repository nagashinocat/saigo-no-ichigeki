import { test, expect } from 'vitest';
import * as THREE from 'three';
import { buildHandModel } from '../../src/render/handModel.js';
import { HAND_JOINTS, poseFor, JOIN_POSE } from '../../src/render/handPose.js';

const models = { high: buildHandModel({ detail: 'high' }), low: buildHandModel({ detail: 'low' }) };

const lefts = { high: buildHandModel({ detail: 'high', side: 'left' }), low: buildHandModel({ detail: 'low', side: 'left' }) };

test('side を省くと右手', () => {
  for (const m of Object.values(models)) expect(m.side).toBe('right');
  for (const m of Object.values(lefts)) expect(m.side).toBe('left');
});

test('左手は右手の鏡像: 頂点は x が反転し、三角形の向きはどれも外向き', () => {
  const faceN = (P, a, b, c) => {
    const A = new THREE.Vector3().fromBufferAttribute(P, a);
    const u = new THREE.Vector3().fromBufferAttribute(P, b).sub(A), v = new THREE.Vector3().fromBufferAttribute(P, c).sub(A);
    return u.cross(v);
  };
  for (const detail of ['high', 'low']) {
    const R = models[detail].mesh.geometry, L = lefts[detail].mesh.geometry;
    const RP = R.attributes.position, LP = L.attributes.position, RN = R.attributes.normal, LN = L.attributes.normal;
    expect(LP.count).toBe(RP.count);
    expect(L.index.count).toBe(R.index.count);
    expect(L.groups).toEqual(R.groups);
    for (let i = 0; i < RP.count; i++) {
      expect(LP.getX(i)).toBe(-RP.getX(i));
      expect(LP.getY(i)).toBe(RP.getY(i));
      expect(LP.getZ(i)).toBe(RP.getZ(i));
      expect(LN.getX(i)).toBe(-RN.getX(i));
      expect(LN.getY(i)).toBe(RN.getY(i));
    }
    // 巻き方向から出る面の向きが、頂点の法線（外向き）とそろっている
    for (const [name, g] of [['right', R], ['left', L]]) {
      const I = g.index.array, P = g.attributes.position, N = g.attributes.normal;
      let inward = 0;
      const n = new THREE.Vector3();
      for (let t = 0; t < I.length; t += 3) {
        n.set(0, 0, 0);
        for (let k = 0; k < 3; k++) n.add(new THREE.Vector3().fromBufferAttribute(N, I[t + k]));
        if (faceN(P, I[t], I[t + 1], I[t + 2]).dot(n) <= 0) inward++;
      }
      expect(inward, `${detail} ${name}: 内向きの三角形`).toBe(0);
    }
    // 右手を作り直さない（同じ細かさの左手は右手の形を使い回す）
    expect(L.attributes.skinIndex.array).toEqual(R.attributes.skinIndex.array);
  }
});

test('同じ構えを当てると、左手の肌は右手の肌の鏡像になる（骨も鏡に映っている）', () => {
  for (const detail of ['high', 'low']) {
    const r = buildHandModel({ detail }), l = buildHandModel({ detail, side: 'left' });
    const pose = poseFor(0.9, 0.4);
    for (const m of [r, l]) { m.setPose(pose); m.root.updateMatrixWorld(true); m.mesh.skeleton.update(); }
    const P = r.mesh.geometry.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3();
    let worst = 0;
    for (let i = 0; i < P.count; i += 7) {
      a.fromBufferAttribute(P, i); r.mesh.applyBoneTransform(i, a);
      b.fromBufferAttribute(l.mesh.geometry.attributes.position, i); l.mesh.applyBoneTransform(i, b);
      worst = Math.max(worst, a.distanceTo(b.set(-b.x, b.y, b.z)));
    }
    expect(worst, detail).toBeLessThan(1e-5);
    // 構えはきちんと形を変えている（何もしない setPose ではない）
    const rest = models[detail].bones['index-finger-tip'].getWorldPosition(new THREE.Vector3());
    expect(r.bones['index-finger-tip'].getWorldPosition(new THREE.Vector3()).distanceTo(rest)).toBeGreaterThan(0.02);
  }
});

test('両手とも25関節の骨がある', () => {
  for (const [side, m] of [...Object.values(models).map((m) => ['right', m]), ...Object.values(lefts).map((m) => ['left', m])]) {
    expect(m.mesh.skeleton.bones).toHaveLength(25);
    for (const name of HAND_JOINTS) expect(m.bones[name]?.isBone, `${side} ${name}`).toBe(true);
  }
  // 左手の関節は右手の関節の鏡の位置
  for (const d of ['high', 'low']) {
    for (const name of HAND_JOINTS) {
      const a = models[d].bones[name].getWorldPosition(new THREE.Vector3()), b = lefts[d].bones[name].getWorldPosition(new THREE.Vector3());
      expect(b.x).toBeCloseTo(-a.x, 6); expect(b.y).toBeCloseTo(a.y, 6); expect(b.z).toBeCloseTo(a.z, 6);
    }
  }
});

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
      // 使うのは最も近い2本まで。手首の近くだけ、3本目の枠に手首の骨（手首を反らしても手のひらの付け根が折れない）
      expect(skinWeight.getComponent(i, 3)).toBe(0);
      if (skinWeight.getComponent(i, 2) > 0) expect(m.mesh.skeleton.bones[skinIndex.getComponent(i, 2)].name).toBe('wrist');
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

test('手首に切れ目がない: 指をどう曲げても、手首の近くの肌は前腕と一緒にいて、手のひらの付け根の三角形も裏返らない', () => {
  // 手首の関節は構えで回らないので、手首より腕側の肌は動かないはず。手のひらの付け根（拳の手前）もほとんど動かない
  const nrm = (A, a, b, c) => {
    const u = new THREE.Vector3(A[b * 3] - A[a * 3], A[b * 3 + 1] - A[a * 3 + 1], A[b * 3 + 2] - A[a * 3 + 2]);
    const v = new THREE.Vector3(A[c * 3] - A[a * 3], A[c * 3 + 1] - A[a * 3 + 1], A[c * 3 + 2] - A[a * 3 + 2]);
    return u.cross(v).normalize();
  };
  for (const detail of ['high', 'low']) {
    for (const [name, pose] of [['0', poseFor(0, 0)], ['0.9', poseFor(0.9, 0.3)], ['1', poseFor(1, 0.7)], ['join', JOIN_POSE]]) {
      const m = buildHandModel({ detail });
      // 手首の曲げは外して、指だけを曲げる（手首を反らしたときは下の別のテストで確かめる）
      m.setPose({ ...pose, wrist: [0, 0, 0] });
      m.root.updateMatrixWorld(true);
      m.mesh.skeleton.update();
      const P = m.mesh.geometry.attributes.position, I = m.mesh.geometry.index.array;
      const sk = new Float32Array(P.count * 3), v = new THREE.Vector3();
      let moved = 0;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i);
        m.mesh.applyBoneTransform(i, v);
        sk.set([v.x, v.y, v.z], i * 3);
        const z = P.getZ(i), d = v.distanceTo(new THREE.Vector3().fromBufferAttribute(P, i));
        if (z > -0.012) moved = Math.max(moved, d);
      }
      expect(moved, `${detail} ${name}: 手首より腕側の肌の動き`).toBeLessThan(0.0015);
      let flipped = 0;
      for (let t = 0; t < I.length; t += 3) {
        if (Math.min(P.getZ(I[t]), P.getZ(I[t + 1]), P.getZ(I[t + 2])) < -0.035) continue;
        if (nrm(P.array, I[t], I[t + 1], I[t + 2]).dot(nrm(sk, I[t], I[t + 1], I[t + 2])) < 0.5) flipped++;
      }
      expect(flipped, `${detail} ${name}: 手首まわりで大きく向きの変わる三角形`).toBe(0);
    }
  }
});

test('手首を反らしても切れ目・折れ目が出ない: 前腕の肌は動かず、手首まわりの隣り合う三角形の角度が急に折れない', () => {
  const unit = (A, a, b, c) => {
    const u = new THREE.Vector3(A[b * 3] - A[a * 3], A[b * 3 + 1] - A[a * 3 + 1], A[b * 3 + 2] - A[a * 3 + 2]);
    const v = new THREE.Vector3(A[c * 3] - A[a * 3], A[c * 3 + 1] - A[a * 3 + 1], A[c * 3 + 2] - A[a * 3 + 2]);
    return u.cross(v).normalize();
  };
  for (const detail of ['high', 'low']) {
    for (const side of ['right', 'left']) {
      for (const [name, pose] of [['0', poseFor(0, 0)], ['1', poseFor(1, 0.7)], ['join', JOIN_POSE]]) {
        const label = `${detail} ${side} ${name}`;
        const m = buildHandModel({ detail, side });
        m.setPose(pose);
        m.root.updateMatrixWorld(true);
        m.mesh.skeleton.update();
        const P = m.mesh.geometry.attributes.position, I = m.mesh.geometry.index.array;
        const nSkin = m.mesh.geometry.groups[0].count;
        const sk = new Float32Array(P.count * 3), v = new THREE.Vector3();
        let armMoved = 0;
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i);
          m.mesh.applyBoneTransform(i, v);
          sk.set([v.x, v.y, v.z], i * 3);
          if (P.getZ(i) > 0.01) armMoved = Math.max(armMoved, v.distanceTo(new THREE.Vector3().fromBufferAttribute(P, i)));
        }
        // 手首より腕側（前腕）は手首の曲げで動かない
        expect(armMoved, `${label}: 前腕の肌の動き`).toBeLessThan(0.0015);
        // 手は確かに反っている（中指の中手骨の向きが、休みの向きから手首の曲げのぶん回る）
        const bone = (mm, n) => mm.bones[n].getWorldPosition(new THREE.Vector3());
        const rest = buildHandModel({ detail, side });
        rest.root.updateMatrixWorld(true);
        const dir = (mm) => bone(mm, 'middle-finger-phalanx-proximal').sub(bone(mm, 'middle-finger-metacarpal')).normalize();
        expect(dir(m).angleTo(dir(rest)), label).toBeGreaterThan(-pose.wrist[0] * 0.9);
        expect(dir(m).y, label).toBeGreaterThan(dir(rest).y); // 甲の側（+Y）へ
        // 手首まわり（z が -0.06〜0.02）の隣り合う三角形: 曲げたあとの角度が、休みの角度より 40° 以上急に折れない。
        // 指・親指の節（phalanx）の肌は除く（指の関節はわざとくっきり曲がる）
        const SI = m.mesh.geometry.attributes.skinIndex, SW = m.mesh.geometry.attributes.skinWeight, bn = m.mesh.skeleton.bones.map((b) => b.name);
        const onPhalanx = (k) => /phalanx/.test(bn[SW.getX(k) >= SW.getY(k) ? SI.getX(k) : SI.getY(k)]) && SW.getZ(k) < 0.5;
        const edges = new Map(), bad = [];
        for (let t = 0; t < nSkin; t += 3) {
          const tri = [I[t], I[t + 1], I[t + 2]];
          const z = Math.max(...tri.map((k) => P.getZ(k))), z0 = Math.min(...tri.map((k) => P.getZ(k)));
          if (z0 < -0.06 || z > 0.02 || tri.some(onPhalanx)) continue;
          for (let k = 0; k < 3; k++) {
            const a = tri[k], b = tri[(k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
            const other = edges.get(key);
            if (other === undefined) { edges.set(key, t); continue; }
            const t2 = other;
            const r1 = unit(P.array, I[t], I[t + 1], I[t + 2]), r2 = unit(P.array, I[t2], I[t2 + 1], I[t2 + 2]);
            const s1 = unit(sk, I[t], I[t + 1], I[t + 2]), s2 = unit(sk, I[t2], I[t2 + 1], I[t2 + 2]);
            const restAng = Math.acos(Math.min(1, Math.max(-1, r1.dot(r2)))), posedAng = Math.acos(Math.min(1, Math.max(-1, s1.dot(s2))));
            if (posedAng - restAng > 40 * Math.PI / 180) bad.push(key);
          }
        }
        expect(bad.length, `${label}: 手首まわりで急に折れる辺`).toBe(0);
      }
    }
  }
});
