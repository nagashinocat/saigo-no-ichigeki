import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../../src/game/game.js';
import { createControls } from '../../src/input/controls.js';
import { bindPointerInput } from '../../src/input/bindDom.js';
import { createViews } from '../../src/render/views.js';
import { createEnemyView } from '../../src/render/enemyView.js';
import { swarmRing } from '../../src/game/enemies.js';
import { BIKE } from '../../src/render/bikePose.js';
import { CONFIG } from '../../src/config.js';
import { fakeDom } from '../input/fakeDom.js';

// R1d（持ち主 14:14「どこかじゃなくてジョイスティックのところに溜まってる」）: 見つけた軍勢が、主人公ではなく画面のスティックの辺りへ集まって見える。
// 本番の経路（bindDom → controls → game.setMove → game.update → views.follow → enemyView.sync）で、溜めの指とスティックの指を
// 押して滑らせ、主人公を街の中心から遠くへ動かす。そのとき、掴む者・群がる者は
//  - 判定（ゲーム）の上で、今の主人公の群がる輪の内にいる
//  - 描かれる上でも（遠くの者を大きく描く boost の中心が主人公）、主人公の描かれる位置のまわりにいて、スティックの画面の所を
//    地面へ映した点には集まらない
// 描かれる位置は、軍勢の頂点シェーダーの「大きく描く中心」の式（aPose.x で origin から中心へ寄せる）を、そのシェーダーの文字から読んで求める

const DT = 1 / 30;
const fakeRenderer = { setSize() {}, setViewport() {}, setScissor() {}, setScissorTest() {}, getPixelRatio: () => 1, getRenderTarget: () => null, setRenderTarget() {}, render() {}, getClearColor(c) { return c; }, getClearAlpha: () => 1, setClearColor() {}, clear() {} };

// 頂点シェーダーの「大きく描く中心」（anchor の mix の 2 つめ）を、今の uniform の値で世界の点へ
function boostCentre(shader, uniforms) {
  const m = shader.match(/vec3 anchor = mix\(origin, ([^;]+?), aPose\.x\);/);
  if (!m) throw new Error('anchor の式が見つからない');
  const expr = m[1].trim();
  if (expr === '(modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz') return new THREE.Vector3(0, 0, 0); // 軍勢の網の原点（街の中心）
  if (expr === 'uHero') return uniforms.uHero.value.clone();
  throw new Error(`知らない anchor の式: ${expr}`);
}

// GLSL の boostFor と同じ（遠くで小さすぎる者を大きく描く倍率）
function boostFor(base, cam, u) {
  const dist = Math.max(1, base.distanceTo(cam.position));
  const px = (u.uHeight.value * u.uPx.value) / dist;
  return Math.min(u.uMaxBoost.value, Math.max(1, u.uMinPx.value / Math.max(px, 1e-3)));
}

test('R1d: スティックを画面の遠くへ滑らせて主人公を動かしても、掴む者・群がる者は（判定でも描く上でも）今の主人公に集まり、スティックの所には集まらない', () => {
  const dom = fakeDom();
  const game = createGame({ seed: 4 });
  const controls = createControls({ onChargeStart: () => game.pressStart(), onChargeEnd: () => game.pressEnd(), onChargeCancel: () => game.pressCancel() });
  const bind = bindPointerInput(dom.target, { controls, perf: dom.perf });
  game.begin();
  const views = createViews(fakeRenderer, () => ({ bloom: false, heatHaze: false }));
  views.resize(390, 844);
  views.follow(game.hero, { snap: true });
  const enemyView = createEnemyView(new THREE.Scene(), 'mid', { sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize() });
  const cam = views.cityCamera;
  const { city } = views.layout, Hpx = views.size.h;
  const pointScale = city.h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));

  // 1 本目（溜め）: 画面の上の方。2 本目（スティック）: 街の画面の右下で長押しし、そこから滑らせる
  dom.fire('pointerdown', { pointerId: 1, clientX: 120, clientY: 200 });
  const S = { x: 330, y: 500 };
  dom.fire('pointerdown', { pointerId: 2, clientX: S.x, clientY: S.y });
  dom.advance(0.25);
  // スティックの向き（画面の px のずれ）: 曲がり角を何度も曲がる道すじ
  const legs = [[0, -50], [50, 0], [0, -50], [-50, 0], [0, -50], [50, 0], [0, 50], [50, 0]];
  let worstLogic = 0, worstDrawn = 0, worstAnchor = 0, frames = 0, seenFar = 0, nearStick = 0;
  const ringMax = swarmRing(CONFIG.enemy.swarm.perRing * (CONFIG.enemy.swarm.maxRing + 1)) + 0.5;
  for (let i = 0; i < 40 / DT; i++) {
    const [dx, dy] = legs[Math.floor(i / 60) % legs.length];
    dom.fire('pointermove', { pointerId: 2, clientX: S.x + dx, clientY: S.y + dy });
    dom.advance(DT);
    // main.js の simulate と同じ順
    controls.update(bind.now());
    const stick = controls.stick ? controls.dir : { x: 0, y: 0 };
    game.setMove(stick.x, stick.y);
    game.update(DT);
    if (game.phase !== 'playing') break;
    views.updateCamera(DT);
    enemyView.sync(game.enemies.list, { pointScale, heroPos: game.enemies.heroPos, dt: DT });
    expect(controls.stick).not.toBe(null);
    const H = game.hero;
    const u = enemyView.mesh.material.uniforms;
    // 主人公の描かれる位置（主人公は自分のまわりで大きく描かれる）
    const m = new THREE.Matrix4(), hp = new THREE.Vector3();
    enemyView.hero.getMatrixAt(0, m); hp.setFromMatrixPosition(m);
    expect(Math.hypot(hp.x - H.x, hp.z - H.z)).toBeLessThan(1e-3);
    // スティックの画面の所を地面（y = 0）へ映した点
    const nx = ((S.x - city.x) / city.w) * 2 - 1, ny = ((Hpx - S.y - city.y) / city.h) * 2 - 1;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
    const stickW = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (Math.hypot(H.x, H.z) < 60) continue; // 街の中心から十分に離れてから見る（中心のそばでは違いが出ない）
    const C = boostCentre(enemyView.mesh.material.vertexShader, u);
    const pose = enemyView.mesh.geometry.getAttribute('aPose');
    const drawn = [];
    let k = 0;
    for (const e of game.enemies.list) {
      if (e.patrol) continue; // 見回る者は探す者のあとに並ぶ
      if (e.state === 'dead' && (e.deadTime ?? 0) >= BIKE.deadFling) continue; // 吹き飛んで消えた者は描かれない
      const idx = k++;
      if (e.state !== 'grab' && e.state !== 'cling') continue;
      worstLogic = Math.max(worstLogic, Math.hypot(e.x - H.x, e.z - H.z) - ringMax);
      enemyView.mesh.getMatrixAt(idx, m);
      const o = new THREE.Vector3().setFromMatrixPosition(m);
      const base = new THREE.Vector3(0, u.uHeight.value * 0.5, 0).applyMatrix4(m);
      const boost = boostFor(base, cam, u);
      const a = pose.getX(idx);
      const anchor = o.clone().lerp(C, a);
      // 大きく描く中心（aPose.x → 1 の者）は主人公の描かれる位置: 1 m の内
      if (a > 0.5) worstAnchor = Math.max(worstAnchor, Math.hypot(C.x - hp.x, C.z - hp.z));
      const d = o.clone().add(o.clone().sub(anchor).multiplyScalar(boost - 1)); // 描かれる中心
      drawn.push(d);
    }
    if (drawn.length < 2) continue;
    frames++;
    const cx = drawn.reduce((s, p) => s + p.x, 0) / drawn.length, cz = drawn.reduce((s, p) => s + p.z, 0) / drawn.length;
    const toHero = Math.hypot(cx - hp.x, cz - hp.z), toStick = Math.hypot(cx - stickW.x, cz - stickW.z);
    worstDrawn = Math.max(worstDrawn, toHero);
    if (Math.hypot(stickW.x - hp.x, stickW.z - hp.z) > 20) seenFar++;
    if (toStick < toHero) nearStick++;
  }
  if (process.env.R1D_LOG) console.log({ frames, seenFar, worstLogic, worstAnchor, worstDrawn, nearStick });
  expect(frames).toBeGreaterThan(60); // 掴む者が何人もいて、主人公が中心から離れた所を十分に見た
  expect(seenFar).toBeGreaterThan(60); // スティックの映る点は主人公から 20 m より遠い
  expect(worstLogic).toBeLessThanOrEqual(0); // 判定: 今の主人公の群がる輪の内
  expect(worstAnchor).toBeLessThan(1); // 大きく描く中心は主人公
  expect(worstDrawn).toBeLessThan(4); // 描かれた群れの真ん中は主人公の描かれる位置のまわり（輪 × boost の内）
  expect(nearStick).toBe(0); // スティックの所へは寄らない
});
