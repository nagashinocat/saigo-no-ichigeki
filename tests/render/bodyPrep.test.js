import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createEnemyView } from '../../src/render/enemyView.js';
import { buildHeroBody, createHeroBodyBuilder, FLOAT_POSE } from '../../src/render/heroBody.js';
import { createRiderBodyBuilder } from '../../src/render/riderBody.js';
import { createBodyPrep } from '../../src/render/bodyPrep.js';

const sun = new THREE.Vector3(0.3, 1, 0.2).normalize();
const setup = () => {
  const heroBody = buildHeroBody({ detail: 'low' });
  const enemyView = createEnemyView(new THREE.Scene(), 'mid', { sunDir: sun, heroBody });
  // 覚えていない組（ほかのテストと共有の覚えを使わず、毎回 0 から組み立てる）
  const heroBuilder = createHeroBodyBuilder({ detail: 'low', pose: { ...FLOAT_POSE } });
  const riderBuilder = createRiderBodyBuilder({ detail: 'low', fresh: true });
  return { heroBody, enemyView, heroBuilder, riderBuilder };
};

test('TAP の直後（onBegin）に finish すると、導入のバイクの拍の前に、乗り手の専用の体と画質の段の主人公の体がそろう', () => {
  const { heroBody, enemyView, heroBuilder, riderBuilder } = setup();
  const prep = createBodyPrep({ heroBuilder, riderBuilder, enemyView });
  expect(enemyView.focusMesh).toBe(null);
  expect(enemyView.heroBody).toBe(heroBody);
  prep.finish();
  expect(prep.done).toBe(true);
  expect(enemyView.focusMesh).not.toBe(null);
  expect(enemyView.focusMesh.geometry).toBe(riderBuilder.body.geometry);
  expect(enemyView.heroBody).toBe(heroBuilder.body);
});

test('step は主人公の体 → 乗り手の体の順に区切り 1 つずつ進め、できたら enemyView へ渡す（low の段: 主人公の細かい体はなし）', () => {
  const { enemyView, heroBuilder, riderBuilder } = setup();
  const prep = createBodyPrep({ heroBuilder, riderBuilder, enemyView });
  let n = 0;
  while (!heroBuilder.done) { expect(riderBuilder.done).toBe(false); prep.step(); n++; }
  expect(n).toBeGreaterThanOrEqual(3);
  expect(enemyView.heroBody).toBe(heroBuilder.body);
  expect(enemyView.focusMesh).toBe(null);
  while (!prep.done) prep.step();
  expect(enemyView.focusMesh.geometry).toBe(riderBuilder.body.geometry);

  const low = setup();
  const p2 = createBodyPrep({ heroBuilder: null, riderBuilder: low.riderBuilder, enemyView: low.enemyView });
  p2.finish();
  expect(low.enemyView.heroBody).toBe(low.heroBody);
  expect(low.enemyView.focusMesh).not.toBe(null);
});

test('手の空いた時間の組み立ては、paused（導入の再生中）の間は区切りを進めない。再開すると続きから', () => {
  const { enemyView, heroBuilder, riderBuilder } = setup();
  let paused = true;
  const queue = [];
  const prep = createBodyPrep({ heroBuilder, riderBuilder, enemyView, idle: (fn) => queue.push(fn), paused: () => paused });
  prep.startIdle();
  for (let i = 0; i < 5; i++) queue.shift()();
  expect(heroBuilder.done).toBe(false);
  expect(heroBuilder.body).toBe(null);
  expect(queue.length).toBe(1); // 止めている間も、次の空き時間を待つ
  paused = false;
  while (queue.length) queue.shift()();
  expect(prep.done).toBe(true);
  expect(enemyView.heroBody).toBe(heroBuilder.body);
  expect(enemyView.focusMesh).not.toBe(null);
});
