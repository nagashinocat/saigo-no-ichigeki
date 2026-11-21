import { test, expect } from 'vitest';
import * as THREE from 'three';
import { buildHeroBody, createHeroBodyBuilder, skinPose, HERO_BODY, HERO_BONES, REST_POSE, FLOAT_POSE, HERO_WIND } from '../../src/render/heroBody.js';

// 主人公の体（距離の場 + Surface Nets の体・頭・両手と、髪の房・上着の裾・襟巻きの尾）。
// 比率は立ち姿（REST_POSE）で、シルエットは宙に浮く姿（FLOAT_POSE）で確かめる。
const rest = buildHeroBody({ detail: 'mid', pose: REST_POSE }); // 比率は格子の粗さに引きずられない中くらいの細かさで
const float = { low: buildHeroBody({ detail: 'low' }), mid: buildHeroBody({ detail: 'mid' }), high: buildHeroBody({ detail: 'high' }) };

const pos = (b) => b.geometry.attributes.position;
const isBody = (b, i) => b.geometry.attributes.aKind.getX(i) === 0; // 距離の場の体（髪・裾・襟巻きの尾でない）
function bounds(b, filter = () => true) {
  const P = pos(b), box = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); if (filter(v, i)) box.expandByPoint(v); }
  return box;
}

test('頂点数は軽い: high 8000 以下、low 3000 以下（余裕を見て 2700 以下）、mid はその間', () => {
  const n = (d) => pos(float[d]).count;
  expect(n('high')).toBeLessThanOrEqual(8000);
  expect(n('low')).toBeLessThanOrEqual(2700);
  expect(n('mid')).toBeLessThanOrEqual(n('high'));
  expect(n('mid')).toBeGreaterThanOrEqual(n('low'));
  // 細かい段ほど細かい（同じ形を粗くしただけ）
  expect(n('high')).toBeGreaterThan(n('low') * 1.6);
  for (const d of ['low', 'mid', 'high']) expect(float[d].counts.vertices).toBe(n(d));
});

test('成人の比率: 頭身 7〜7.5、肩幅は身長の 0.23〜0.29、股下は約半分、手首は腰の高さ、指先は太ももの中ほど', () => {
  const box = bounds(rest, (v, i) => isBody(rest, i)); // 体（髪のかたまりまで。なびく房と襟巻きの尾は除く）
  const H = box.max.y - box.min.y;
  expect(H).toBeGreaterThan(1.68);
  expect(H).toBeLessThan(1.82);
  expect(box.min.y).toBeGreaterThan(-0.01); // 立ち姿は足の裏が地面
  // 頭の高さ: あごから頭のてっぺんまで（あごは頭の骨の頂点のうち、顔の前の真ん中でいちばん低い所）
  const head = HERO_BONES.indexOf('head');
  const chin = bounds(rest, (v, i) => rest.skinIndex[i * 2] === head && rest.skinWeight[i * 2] > 0.6 && Math.abs(v.x) < 0.02 && v.z > 0.05).min.y;
  expect(Math.abs(chin - HERO_BODY.chin)).toBeLessThan(0.02);
  const headH = box.max.y - chin;
  expect(H / headH).toBeGreaterThanOrEqual(7);
  expect(H / headH).toBeLessThanOrEqual(7.5);
  // 肩幅（三角筋の外から外。立ち姿で腕を下ろした肩の高さ）
  const sh = bounds(rest, (v) => v.y > HERO_BODY.shoulderY - 0.05 && v.y < HERO_BODY.shoulderY - 0.02);
  const W = sh.max.x - sh.min.x;
  expect(W / H).toBeGreaterThan(0.23);
  expect(W / H).toBeLessThan(0.29);
  expect(sh.max.x - sh.min.x).toBeGreaterThan(2.4 * (bounds(rest, (v) => v.y > 1.6 && v.y < 1.65).max.x)); // 肩は頭の幅の 2 倍以上
  // 股下（左右の脚の間の、体のいちばん低い所）
  const crotch = bounds(rest, (v) => Math.abs(v.x) < 0.012 && v.y < 1.0 && Math.abs(v.z) < 0.05).min.y;
  expect(crotch / H).toBeGreaterThan(0.44);
  expect(crotch / H).toBeLessThan(0.5);
  // 下ろした手の指先
  const tip = bounds(rest, (v, i) => isBody(rest, i) && v.x > 0.17).min.y;
  expect(tip / H).toBeGreaterThan(0.34);
  expect(tip / H).toBeLessThan(0.41);
  // 首: 頭より細い
  const neck = bounds(rest, (v, i) => isBody(rest, i) && v.y > HERO_BODY.chin - 0.03 && v.y < HERO_BODY.chin - 0.01 && Math.abs(v.x) < 0.12 && Math.abs(v.z) < 0.03);
  expect(neck.max.x).toBeLessThan(bounds(rest, (v) => v.y > 1.6 && v.y < 1.65).max.x);
});

test('骨と重み: どの頂点も 2 本の骨に重みの和 1。頭の頂点は頭の骨、指先は手の骨、足先は足の骨', () => {
  for (const b of [rest, float.low, float.high]) {
    const n = pos(b).count;
    expect(b.skinIndex.length).toBe(n * 2);
    for (let i = 0; i < n; i++) {
      expect(b.skinWeight[i * 2] + b.skinWeight[i * 2 + 1]).toBeCloseTo(1, 5);
      expect(b.skinWeight[i * 2]).toBeGreaterThanOrEqual(b.skinWeight[i * 2 + 1]);
      expect(b.skinIndex[i * 2]).toBeLessThan(HERO_BONES.length);
    }
  }
  expect(HERO_BONES).toEqual(expect.arrayContaining(['pelvis', 'spine', 'chest', 'neck', 'head', 'upperArm.L', 'foreArm.L', 'hand.L', 'upperArm.R', 'foreArm.R', 'hand.R', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R']));
  const P = pos(rest), v = new THREE.Vector3();
  const main = (i) => HERO_BONES[rest.skinIndex[i * 2]];
  let headN = 0, handN = 0, footN = 0;
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    if (isBody(rest, i) && v.y > 1.62) { expect(main(i)).toBe('head'); headN++; }
    if (isBody(rest, i) && v.x > 0.195 && v.y < 0.78) { expect(main(i)).toBe('hand.L'); handN++; }
    if (v.x < -0.05 && v.y < 0.06 && v.z > 0.08) { expect(main(i)).toBe('foot.R'); footN++; }
  }
  expect(Math.min(headN, handN, footN)).toBeGreaterThan(10);
});

test('姿勢を付けられる: 何も回さなければ同じ形。左の前腕を曲げると左手だけが動き、頭は動かない', () => {
  const b = float.low;
  const P = pos(b).array;
  const same = skinPose(b, {});
  for (let i = 0; i < P.length; i++) expect(same[i]).toBeCloseTo(P[i], 5);
  const bent = skinPose(b, { 'foreArm.L': [-1.2, 0, 0] });
  const hand = HERO_BONES.indexOf('hand.L'), head = HERO_BONES.indexOf('head');
  let moved = 0, still = 0;
  for (let i = 0; i < P.length / 3; i++) {
    const d = Math.hypot(bent[i * 3] - P[i * 3], bent[i * 3 + 1] - P[i * 3 + 1], bent[i * 3 + 2] - P[i * 3 + 2]);
    if (b.skinIndex[i * 2] === hand && b.skinWeight[i * 2] > 0.95) { expect(d).toBeGreaterThan(0.1); moved++; }
    if (b.skinIndex[i * 2] === head && b.skinWeight[i * 2] > 0.95) { expect(d).toBeLessThan(1e-6); still++; }
  }
  expect(moved).toBeGreaterThan(20);
  expect(still).toBeGreaterThan(20);
});

// 三角形を画面の格子へ塗る（正射影）。u, v は横と縦の向き。keep(頂点) で塗る三角形を選ぶ
function rasterize(b, u, v, cell = 0.01, keep = () => true) {
  const P = pos(b), I0 = b.geometry.index.array;
  const I = I0.filter((_, k) => keep(I0[k - (k % 3)]));
  const pu = new Float32Array(P.count), pv = new Float32Array(P.count);
  const p = new THREE.Vector3();
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < P.count; i++) { p.fromBufferAttribute(P, i); pu[i] = p.dot(u); pv[i] = p.dot(v); }
  for (const i of I) { u0 = Math.min(u0, pu[i]); u1 = Math.max(u1, pu[i]); v0 = Math.min(v0, pv[i]); v1 = Math.max(v1, pv[i]); }
  const W = Math.ceil((u1 - u0) / cell) + 1, H = Math.ceil((v1 - v0) / cell) + 1;
  const img = new Uint8Array(W * H);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], bb = I[t + 1], c = I[t + 2];
    const xs = [pu[a], pu[bb], pu[c]].map((x) => (x - u0) / cell), ys = [pv[a], pv[bb], pv[c]].map((y) => (y - v0) / cell);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / area;
      const w1 = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) img[x + y * W] = 1;
    }
  }
  // 行ごとの塗られた区間の数と幅
  const row = (vv) => {
    const y = Math.round((vv - v0) / cell);
    let runs = 0, filled = 0, prev = 0;
    for (let x = 0; x < W; x++) { const f = img[x + y * W]; if (f && !prev) runs++; filled += f; prev = f; }
    return { runs, width: filled * cell };
  };
  let area = 0;
  for (const f of img) area += f;
  return { W: W * cell, H: H * cell, area: area * cell * cell, row, v0 };
}

test('シルエットが人として読める（宙に浮く姿を正面と、リプレイの横からの向きで投影）', () => {
  const b = float.high;
  // 体の形（後ろへ流れる襟巻きの尾は除く。尾は別に確かめる）
  const noTail = (i) => b.geometry.attributes.aKind.getX(i) !== 3;
  const front = rasterize(b, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), 0.01, noTail);
  // 縦長: 背の高さは幅の 2〜4 倍（腕を少し開き、手首を返して手のひらを下へ向けている）
  expect(front.H / front.W).toBeGreaterThan(2.0);
  expect(front.H / front.W).toBeLessThan(4);
  // 外枠のうち塗られているのは 2〜4 割（人の形は箱ではない）
  expect(front.area / (front.W * front.H)).toBeGreaterThan(0.18);
  expect(front.area / (front.W * front.H)).toBeLessThan(0.42);
  const J = b.joints;
  // 頭 → 首のくびれ → 肩の張り
  const headW = front.row(J.head[1] + 0.075).width, neckW = front.row(J.head[1] - 0.035).width, shW = front.row(J['upperArm.L'][1] - 0.04).width;
  expect(neckW).toBeLessThan(headW * 0.85);
  expect(shW).toBeGreaterThan(headW * 2.4);
  // 手の高さで、左手・体・右手が離れている（腕を少し開いている）
  expect(front.row(J['hand.L'][1] - 0.04).runs).toBeGreaterThanOrEqual(3);
  // ひざの高さで左右の脚が離れている
  expect(front.row((J['shin.L'][1] + J['shin.R'][1]) / 2).runs).toBe(2);
  // リプレイの向き（主人公の正面から約 66° 回った、ほぼ横顔）
  const az = 1.15;
  const side = rasterize(b, new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)), new THREE.Vector3(0, 1, 0), 0.01, noTail);
  expect(side.H / side.W).toBeGreaterThan(2.0); // 手が前へ出る
  // 襟巻きの尾は首の後ろから、体より後ろへ流れる
  const tail = bounds(b, (_, i) => !noTail(i));
  expect(tail.min.z).toBeLessThan(bounds(b, (_, i) => isBody(b, i)).min.z - 0.15);
  expect(side.H / side.W).toBeLessThan(5.5);
  // 足はつま先が下がる（いちばん低いのはつま先。かかとより 5cm 以上下）
  const ankle = J['foot.L'];
  expect(J.toeL[1]).toBeLessThan(ankle[1] - 0.12);
  expect(J.toeL[1]).toBeLessThan(J.heelL[1] - 0.05);
});

test('宙に浮く: いちばん低いつま先でも地面（y=0）から少し上、頭のてっぺんは約 1.85m', () => {
  const box = bounds(float.mid);
  expect(box.min.y).toBeGreaterThan(0.03);
  expect(box.min.y).toBeLessThan(0.12);
  expect(box.max.y).toBeGreaterThan(1.75);
  expect(box.max.y).toBeLessThan(1.98);
  // 腕は少し開いて手のひらを下へ: 手のひらの向きは下向き
  for (const s of ['L', 'R']) {
    expect(float.mid.palmNormal[s][1]).toBeLessThan(-0.75);
    const hand = float.mid.joints[`hand.${s}`];
    expect(Math.abs(hand[0])).toBeGreaterThan(0.28); // 体から離れている
    expect(hand[1]).toBeGreaterThan(0.75);
  }
});

test('なびく所（髪・上着の裾・襟巻きの尾）だけに揺れの重みがあり、付け根は 0、先ほど大きい', () => {
  const b = float.mid, F = b.geometry.attributes.aFlut, kind = b.geometry.attributes.aKind;
  expect(F.itemSize).toBe(2);
  let body = 0, hair = 0, coat = 0, scarf = 0, maxHair = 0, maxCoat = 0, maxScarf = 0;
  for (let i = 0; i < F.count; i++) {
    const k = kind.getX(i), a = F.getX(i);
    expect(a).toBeGreaterThanOrEqual(0);
    if (k === 0) { expect(a).toBe(0); body++; }
    if (k === 1) { hair++; maxHair = Math.max(maxHair, a); }
    if (k === 2) { coat++; maxCoat = Math.max(maxCoat, a); }
    if (k === 3) { scarf++; maxScarf = Math.max(maxScarf, a); }
  }
  expect(Math.min(body, hair, coat, scarf)).toBeGreaterThan(30);
  expect(maxHair).toBeGreaterThan(0.01);
  expect(maxCoat).toBeGreaterThan(maxHair);
  expect(maxScarf).toBeGreaterThan(maxCoat * 0.8);
  expect(HERO_WIND.length).toBe(3);
});

test('面はどれも外向き（頂点の法線と三角形の巻きがそろう）', () => {
  for (const b of [float.low, float.high]) {
    const P = pos(b), N = b.geometry.attributes.normal, I = b.geometry.index.array;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3();
    let bad = 0;
    for (let t = 0; t < I.length; t += 3) {
      A.fromBufferAttribute(P, I[t]); B.fromBufferAttribute(P, I[t + 1]); C.fromBufferAttribute(P, I[t + 2]);
      const f = B.sub(A).cross(C.sub(A));
      n.fromBufferAttribute(N, I[t]).add(C.fromBufferAttribute(N, I[t + 1])).add(A.fromBufferAttribute(N, I[t + 2]));
      if (f.dot(n) < 0) bad++;
    }
    expect(bad / (I.length / 3)).toBeLessThan(0.002);
  }
});

test('同じ細かさは 1 回だけ組み立てる（2 回目は同じものを返す）。組み立ての時間を記録する', () => {
  expect(buildHeroBody({ detail: 'mid' })).toBe(float.mid);
  expect(float.mid.buildMs).toBeGreaterThan(0);
});

test('少しずつ組み立てる: 区切りごとに step し、できあがった体は一度に組み立てたものと同じで、同じものとして覚える', () => {
  const pose = { ...FLOAT_POSE }; // 覚えていない組
  const b = createHeroBodyBuilder({ detail: 'low', pose });
  expect(b.done).toBe(false);
  expect(b.body).toBe(null);
  let steps = 0;
  while (!b.step()) steps++;
  expect(steps).toBeGreaterThanOrEqual(3); // 体・頭・手・残りの区切り
  expect(b.done).toBe(true);
  expect(buildHeroBody({ detail: 'low', pose })).toBe(b.body);
  const ref = float.low.geometry.attributes.position.array, got = b.body.geometry.attributes.position.array;
  expect(got.length).toBe(ref.length);
  for (let i = 0; i < ref.length; i += 97) expect(got[i]).toBeCloseTo(ref[i], 6);
  // 途中で buildHeroBody を呼ぶと、続きから最後まで組み立てる（二度は組み立てない）
  const pose2 = { ...FLOAT_POSE };
  const c = createHeroBodyBuilder({ detail: 'low', pose: pose2 });
  c.step();
  const whole = buildHeroBody({ detail: 'low', pose: pose2 });
  expect(c.done).toBe(true);
  expect(c.body).toBe(whole);
  expect(c.finish()).toBe(whole);
});
