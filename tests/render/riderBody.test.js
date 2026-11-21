import { test, expect } from 'vitest';
import * as THREE from 'three';
import { buildRiderBody, createRiderBodyBuilder, RIDER_BODY } from '../../src/render/riderBody.js';
import { RIDER } from '../../src/render/hoverBike.js';

// 演出の肩越しのカットで大きく映る一人の体（距離の場 + Surface Nets）。軍勢の instanced の形と同じ部位の番号・付け根・座り方

const bodies = Object.fromEntries(['low', 'mid', 'high'].map((d) => [d, buildRiderBody({ detail: d })]));

test('組み立てられ、figure の材質の属性（aPart / aPivot / aCol と法線）を持ち、段ごとに細かさが増え、頂点数は上限以内', () => {
  let prev = 0;
  for (const d of ['low', 'mid', 'high']) {
    const b = bodies[d];
    const g = b.geometry;
    for (const k of ['position', 'normal', 'aPart', 'aPivot', 'aCol']) expect(g.getAttribute(k), `${d} ${k}`).toBeTruthy();
    const n = g.attributes.position.count;
    expect(n, d).toBeGreaterThan(prev);
    expect(n, d).toBeLessThanOrEqual(RIDER_BODY.maxVerts[d]);
    expect(g.index.count / 3, d).toBeLessThanOrEqual(RIDER_BODY.maxVerts[d] * 2.2);
    for (const v of g.attributes.position.array) expect(Number.isFinite(v)).toBe(true);
    prev = n;
  }
});

test('大きさ: 浮遊バイクに座った姿（バイクの底 y=0、+z が前）。乗り手の頭の上は 1.5〜1.9 m、幅は 0.9 m 以内、前後は 3.3 m 以内（バイクの鼻先と尾の輪まで）', () => {
  for (const b of Object.values(bodies)) {
    const box = new THREE.Box3().setFromBufferAttribute(b.geometry.attributes.position);
    expect(box.min.y).toBeGreaterThan(-0.2);
    expect(box.max.x - box.min.x).toBeLessThan(0.9);
    expect(box.max.z - box.min.z).toBeLessThan(3.3);
    // 部位ごと: 頭（1）・胴（0）・腕（2, 3）・脚（4）・車体（7）・推進の光（8）がある
    const parts = new Set(b.geometry.attributes.aPart.array);
    for (const p of [0, 1, 2, 3, 4, 7, 8]) expect(parts.has(p), `part ${p}`).toBe(true);
    // 頭は立った兵士の座標（instanced と同じ: 頭は首を付け根に回す）で、首の高さより上
    const P = b.geometry.attributes.position, A = b.geometry.attributes.aPart, V = b.geometry.attributes.aPivot;
    let headTop = -Infinity;
    for (let i = 0; i < P.count; i++) if (A.getX(i) === 1) headTop = Math.max(headTop, P.getY(i));
    expect(headTop).toBeGreaterThan(1.5 + (RIDER.hip[1] - 0.95));
    expect(headTop).toBeLessThan(1.95);
    // 胴の付け根は乗り手の腰（instanced と同じ）
    for (let i = 0; i < P.count; i++) if (A.getX(i) === 0) { expect([V.getX(i), V.getY(i), V.getZ(i)]).toEqual(RIDER.hip.map((v) => Math.fround(v))); break; }
  }
});

test('箱の寄せ集めに見えない: 体の部位（胴・頭・腕・脚）の網は曲面（平らな面の三角形はわずかで、角立った折れ目も少ない）', () => {
  const stats = (g, maxPart) => {
    const N = g.attributes.normal, A = g.attributes.aPart, I = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    let flat = 0, sharp = 0, total = 0;
    const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
    for (let t = 0; t < I.length; t += 3) {
      if (A.getX(I[t]) > maxPart) continue;
      na.fromBufferAttribute(N, I[t]); nb.fromBufferAttribute(N, I[t + 1]); nc.fromBufferAttribute(N, I[t + 2]);
      total++;
      if (na.dot(nb) > 0.99999 && na.dot(nc) > 0.99999) flat++;
      if (Math.min(na.dot(nb), na.dot(nc), nb.dot(nc)) < 0.5) sharp++;
    }
    return { flat: flat / total, sharp: sharp / total, total };
  };
  const s = stats(bodies.mid.geometry, 4.5);
  expect(s.total).toBeGreaterThan(5000);
  expect(s.flat).toBeLessThan(0.05);
  expect(s.sharp).toBeLessThan(0.03); // ヘルメットの縁・しわの稜線の分だけ
});

test('少しずつ組み立てる: step は区切り（胴・頭・腕・脚・車体）ごとに進み、finish は残りを一度に。同じ細かさは使い回す', () => {
  const b = createRiderBodyBuilder({ detail: 'low' });
  expect(b.done).toBe(true); // 上で組み立てた
  expect(b.finish()).toBe(bodies.low);
  const fresh = createRiderBodyBuilder({ detail: 'mid', fresh: true });
  let steps = 0;
  while (!fresh.step()) steps++;
  expect(steps).toBeGreaterThanOrEqual(4);
  expect(fresh.body.geometry.attributes.position.count).toBe(bodies.mid.geometry.attributes.position.count);
  expect(fresh.body.buildMs).toBeGreaterThan(0);
});
