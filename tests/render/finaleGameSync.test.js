import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../../src/game/game.js';
import { createCinematic, leadFor } from '../../src/render/cinematic.js';
import { planFinale, planRetreat, snapshotEnemies } from '../../src/render/finalePlan.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// main.js と同じつなぎ方: 演出の gameDt を 0.1 秒ずつに分けて本物の game.update に渡す
function stepGame(game, gdt) {
  let left = gdt;
  do { const d = Math.min(left, 0.1); game.update(d); left -= d; } while (left > 1e-9);
}

function setup(seed, amount, { ref = false } = {}) {
  const game = createGame({ seed });
  const views = { size: { w: 390, h: 844 } };
  const enemyView = { setHeroYaw() {} };
  const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const cin = createCinematic(views, enemyView, explosionView, { renderer, scene: new THREE.Scene() });
  // fix3: main.js と同じく、撮る場所は白を描いた次のフレームで、放つ瞬間の軍勢の写しから決める（関数で渡す）
  const out = { atRelease: null };
  game.on('cinematicStart', (shot) => {
    const enemies = snapshotEnemies(game.enemies.list), buildings = [...game.city.buildings];
    const args = { shot, lead: leadFor(shot.radius), buildings, enemies, retreat: false };
    if (ref) out.atRelease = planFinale({ ...args, rng: createRng(seed) }); // 比べる用: 放つ瞬間に決めた答え
    cin.play(() => planFinale({ ...args, rng: createRng(seed) }), shot, { retreat: () => planRetreat(cin.plan, { buildings, radius: shot.radius, lead: args.lead }) });
  });
  game.pressStart();
  game.power.drain(1e9);
  game.power.add(amount);
  game.pressEnd();
  return { game, cin, out };
}

test('fix3 撮る場所: 白を描いたフレームではまだ決めず、次のフレームで本物の planFinale で決める。放つ瞬間の軍勢の写しから決めるので、白の間に軍勢の状態が変わっても 60/30/20 fps で同じ答えで、放つ瞬間に決めた答えとも同じ', () => {
  for (const amount of [CONFIG.power.minRelease, CONFIG.power.max]) {
    const plans = [];
    for (const fps of [60, 30, 20]) {
      const { game, cin, out } = setup(7, amount, { ref: true });
      let whiteFrames = 0, moved = false;
      while (!cin.plan) {
        cin.update(1 / fps);
        stepGame(game, cin.gameDt);
        if (cin.white) whiteFrames++;
        // 白の間に軍勢の状態が変わっても（今のゲームは cinematic の間は軍勢を止めているが、それに頼らない）、答えは変わらない
        if (cin.white && !moved) {
          for (const e of game.enemies.list) { e.angle += 0.3; e.dist += 40; if (e.x !== undefined) { e.x += 40; e.z -= 25; } }
          moved = true;
        }
        if (!cin.plan) expect(whiteFrames, `${fps}fps`).toBeLessThanOrEqual(1);
      }
      expect(whiteFrames, `${fps}fps`).toBe(2); // 白を描いた次のフレーム（まだ白の間）
      const { retreat, ...p } = cin.plan;
      plans.push(p);
      const { retreat: r0, ...ref } = out.atRelease;
      expect(p).toEqual(ref);
    }
    expect(plans[1]).toEqual(plans[0]);
    expect(plans[2]).toEqual(plans[0]);
  }
});

test('本物のゲームの前線は、演出の時刻表の前線と数 cm 以内で一致する（白〜スローでふくらむ〜弾けて飲まれるまで。60/30/20 fps）', () => {
  for (const seed of [7, 3]) {
    for (const amount of [CONFIG.power.minRelease, CONFIG.power.max]) {
      for (const fps of [60, 30, 20]) {
        const { game, cin } = setup(seed, amount);
        const dt = 1 / fps;
        let worst = 0, checked = 0;
        // 時刻表は撮る場所が決まると作り直されるので、毎フレーム読む
        while (cin.time < cin.timeline.snap + 0.3) {
          cin.update(dt);
          stepGame(game, cin.gameDt);
          const b = game.blasts[0], tl = cin.timeline;
          if (cin.time < tl.white + 1e-9) continue;
          expect(cin.plan, `seed ${seed} amount ${amount} ${fps}fps`).not.toBeNull();
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
      for (const d of [0.25, 0.05]) { cin.update(d); stepGame(game, cin.gameDt); } // 白を描いた次のフレームで撮る場所が決まる
      const tl = cin.timeline;
      expect(cin.plan).not.toBeNull();
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
