import { test, expect } from 'vitest';
import * as THREE from 'three';
import { pullbackDistance, createCameraFollow } from '../../src/render/views.js';
import { CONFIG } from '../../src/config.js';

const pos = [0, 280, 260];
const dir = new THREE.Vector3(0, -0.8, -0.6).normalize().toArray();
const at = (t) => Math.hypot(pos[0] - dir[0] * t, pos[1] - dir[1] * t, pos[2] - dir[2] * t);

test('pullbackDistance: 十分遠ければ 0、近ければ視線と逆へ下がって中心から minDist ちょうどになる', () => {
  expect(pullbackDistance(pos, dir, 100)).toBe(0);
  const t = pullbackDistance(pos, dir, 600);
  expect(t).toBeGreaterThan(0);
  expect(at(t)).toBeCloseTo(600, 6);
});

test('球が最大まで広がる間ずっと、カメラと中心の距離は front × 1.3 以上', () => {
  const follow = createCameraFollow();
  const dt = 1 / 60, R = CONFIG.radius.max;
  let front = 0;
  for (let i = 0; i < 400; i++) {
    front = Math.min(R, front + CONFIG.blast.speed * dt);
    const t = follow.update(dt, pos, dir, front, R);
    expect(at(t)).toBeGreaterThanOrEqual(front * 1.3 - 1e-6);
  }
});

test('動き出しはなめらか（最初のフレームはほとんど動かない）で、終わると元の位置へ戻る', () => {
  const follow = createCameraFollow();
  const dt = 1 / 60;
  const first = follow.update(dt, pos, dir, 0, CONFIG.radius.max);
  let prev = first, maxOut = 0;
  for (let i = 0; i < 180; i++) {
    const t = follow.update(dt, pos, dir, 0, CONFIG.radius.max);
    maxOut = Math.max(maxOut, t - prev);
    prev = t;
  }
  expect(follow.t).toBeGreaterThan(100);
  expect(first).toBeLessThan(maxOut * 0.2); // 速さ0から加速する
  let maxStep = 0;
  for (let i = 0; i < 600; i++) {
    const t = follow.update(dt, pos, dir, 0, 0);
    maxStep = Math.max(maxStep, Math.abs(t - prev));
    prev = t;
  }
  expect(follow.t).toBeLessThan(0.5);
  expect(maxStep).toBeLessThan(8);
});

test('小さな一発ではカメラは動かない', () => {
  const follow = createCameraFollow();
  for (let i = 0; i < 120; i++) expect(follow.update(1 / 60, pos, dir, 100, 120)).toBe(0);
});
