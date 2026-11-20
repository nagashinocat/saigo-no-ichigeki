import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../../src/game/game.js';
import { createCinematic, leadFor } from '../../src/render/cinematic.js';
import { planFinale } from '../../src/render/finalePlan.js';
import { buildEyeCloseup } from '../../src/render/enemyView.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// main.js と同じつなぎ方: 演出の gameDt を 0.1 秒ずつに分けて本物の game.update に渡す
function stepGame(game, gdt) {
  let left = gdt;
  do { const d = Math.min(left, 0.1); game.update(d); left -= d; } while (left > 1e-9);
}

function setup(seed, amount) {
  const game = createGame({ seed });
  const views = { size: { w: 390, h: 844 } };
  const enemyView = { setHeroYaw() {}, eyeCloseup: (id) => buildEyeCloseup(id) };
  const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const cin = createCinematic(views, enemyView, explosionView, { renderer, scene: new THREE.Scene() });
  game.on('cinematicStart', (shot) => {
    const plan = planFinale({ shot, rng: createRng(seed), lead: leadFor(shot.radius), buildings: game.city.buildings, enemies: game.enemies.list });
    cin.play(plan, shot);
  });
  game.pressStart();
  game.power.drain(1e9);
  game.power.add(amount);
  game.pressEnd();
  return { game, cin };
}

test('本物のゲームの前線は、演出の時刻表の前線と数 cm 以内で一致する（白〜一拍〜弾けるまで。60/30/20 fps）', () => {
  for (const seed of [7, 3]) {
    for (const amount of [CONFIG.power.minRelease, CONFIG.power.max]) {
      for (const fps of [60, 30, 20]) {
        const { game, cin } = setup(seed, amount);
        const tl = cin.timeline;
        const dt = 1 / fps;
        let worst = 0, checked = 0;
        while (cin.time < tl.snap + 0.3) {
          cin.update(dt);
          stepGame(game, cin.gameDt);
          const b = game.blasts[0];
          if (cin.time < tl.white + 1e-9) continue;
          expect(b, `seed ${seed} amount ${amount} ${fps}fps t=${cin.time.toFixed(3)}`).toBeDefined();
          if (!b) break;
          worst = Math.max(worst, Math.abs(b.front - tl.front(cin.time)));
          checked++;
        }
        expect(checked).toBeGreaterThan(10);
        expect(worst, `seed ${seed} amount ${amount} ${fps}fps`).toBeLessThan(0.05);
      }
    }
  }
});

test('演出が終わって最後の絵のまま待つ間も、ゲームが終わっていなければゲームの時間は進む', () => {
  const { game, cin } = setup(7, CONFIG.power.max);
  while (!cin.finished) { cin.update(1 / 30); stepGame(game, cin.gameDt); }
  cin.update(1 / 30);
  expect(cin.gameDt).toBeCloseTo(1 / 30, 9);
});

test('弾けたあとの見せる期も、本物のゲームの前線は演出の前線と一致し、宇宙の半球がふくらみきる（domeEnd）までに一発が終わって over になる（60/30/20 fps）', () => {
  for (const amount of [CONFIG.power.minRelease, 60, CONFIG.power.max]) {
    for (const fps of [60, 30, 20]) {
      const { game, cin } = setup(7, amount);
      const tl = cin.timeline;
      let worst = 0, phaseAtChaseEnd = null;
      while (cin.time < tl.domeEnd + 2 / fps) {
        cin.update(1 / fps);
        stepGame(game, cin.gameDt);
        if (phaseAtChaseEnd === null && cin.time >= tl.chaseEnd) phaseAtChaseEnd = game.phase;
        const b = game.blasts[0];
        if (cin.time > tl.snap && b) worst = Math.max(worst, Math.abs(b.front - tl.front(cin.time)));
      }
      expect(worst, `amount ${amount} ${fps}fps`).toBeLessThan(0.05);
      if (tl.frontDone > tl.chaseEnd + 0.1) expect(phaseAtChaseEnd).toBe('finale'); // 宇宙へ切り替わっても、まだ広がっている
      expect(game.phase, `amount ${amount} ${fps}fps`).toBe('over');
      expect(cin.time).toBeLessThan(tl.flatten);
    }
  }
});
