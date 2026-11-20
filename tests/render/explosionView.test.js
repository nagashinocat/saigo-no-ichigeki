import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createExplosionView } from '../../src/render/explosionView.js';
import { TIERS } from '../../src/render/quality.js';
import { CONFIG } from '../../src/config.js';
import { frontAt } from '../../src/game/blast.js';

const camera = new THREE.PerspectiveCamera(60, 1, 1, 5000);
const make = (tier = 'mid') => {
  const scene = new THREE.Scene();
  return { scene, view: createExplosionView(scene, tier, { sunDir: new THREE.Vector3(0.8, 0.4, -0.4).normalize() }) };
};
const shot = (radius) => ({ amount: 10, radius, isBig: false });
const spheresVisible = (scene) => {
  let n = 0;
  scene.traverse((o) => { if (o.material?.uniforms?.uBirth && o.visible) n++; });
  return n;
};
// blasts を game.blasts と同じ形で進める
function run(view, list, sec, dt = 1 / 60) {
  for (let t = 0; t < sec; t += dt) {
    for (const b of list) { b.t = (b.t ?? 0) + dt; b.front = frontAt(b.t, b.shot.radius); }
    const live = list.filter((b) => b.front < b.shot.radius);
    view.update(dt, live, camera, 500);
  }
}

test('同時に生きている一発ごとに球を描き、終わった球は消えていき、やがて busy でなくなる', () => {
  const { scene, view } = make();
  const list = [{ id: 1, shot: shot(200), front: 0 }, { id: 2, shot: shot(80), front: 0 }];
  view.update(1 / 60, list, camera, 500);
  expect(spheresVisible(scene)).toBe(2);
  expect(view.busy).toBe(true);
  run(view, list, 2.5);
  expect(spheresVisible(scene)).toBe(0);
  expect(view.busy).toBe(false);
});

test('粉の粒の数は dustMax を超えない', () => {
  for (const tier of ['low', 'mid']) {
    const { scene, view } = make(tier);
    const dust = scene.getObjectByName('dust');
    for (let i = 0; i < 40; i++) {
      view.dust(Array.from({ length: 300 }, (_, k) => ({ pos: [k, 5, i], size: 3 })));
      view.update(1 / 60, [], camera, 500);
    }
    expect(dust.geometry.instanceCount).toBeLessThanOrEqual(TIERS[tier].dustMax);
    expect(dust.geometry.attributes.aPos.count).toBe(TIERS[tier].dustMax);
  }
});

test('放つと白く光ってすぐ収まり、揺れは front が速く広がる間だけ出る', () => {
  const { view } = make();
  view.begin(shot(300));
  view.update(1 / 60, [], camera, 500);
  expect(view.screen.flash).toBeGreaterThan(0.5);
  view.update(0.5, [], camera, 500);
  expect(view.screen.flash).toBe(0);

  const b = { id: 7, shot: shot(300), front: 0 };
  run(view, [b], 0.4);
  expect(view.cameraInfo.shake).toBe(0); // じわじわ期は揺れない
  run(view, [b], 0.4); // 弾けた直後
  const growing = view.cameraInfo.shake;
  expect(growing).toBeGreaterThan(0);
  // 同じ段階なら大きな一発ほど揺れが大きい
  const small = make().view;
  run(small, [{ id: 1, shot: shot(60), front: 0 }], 0.4);
  expect(small.cameraInfo.shake).toBeLessThan(growing);
  run(view, [b], 3);
  expect(view.cameraInfo.shake).toBeLessThan(growing * 0.01);
});

test('cameraInfo は今の球の大きさを返す（先回りは上空カメラの側 blastCamera.js が前線から決める）', () => {
  const { view } = make();
  const b = { id: 3, shot: shot(400), front: 0 };
  run(view, [b], 0.5);
  expect(view.cameraInfo.front).toBeCloseTo(b.front, 5);
});

test('じわじわ期は球が脈打って揺れず、弾けた瞬間に光が跳ね上がり揺れの一撃が出る', () => {
  const { view } = make();
  const b = { id: 5, shot: shot(400), front: 0, t: 0 };
  const burstAt = CONFIG.blast.creepSec * Math.sqrt(400 / CONFIG.radius.max);
  run(view, [b], 0.1); // 放った閃光が収まる
  run(view, [b], burstAt - 0.2);
  expect(view.screen.flash).toBe(0);
  expect(view.cameraInfo.shake).toBe(0);
  run(view, [b], 0.3); // 弾ける
  expect(view.cameraInfo.shake).toBeGreaterThan(0.002);
});
test('弾ける瞬間（front が creepFrac × radius を越えた更新）に一度だけ閃光が出る', () => {
  const { view } = make();
  const b = { id: 6, shot: shot(300), front: 0, t: 0 };
  run(view, [b], 0.2);
  let peaks = 0, prev = 0;
  for (let i = 0; i < 120; i++) { run(view, [b], 1 / 60); if (view.screen.flash > prev + 0.1) peaks++; prev = view.screen.flash; }
  expect(peaks).toBe(1);
});

test('vaporize は光に溶ける箱を置き、溶け終わるまで busy', () => {
  const { scene, view } = make();
  view.vaporize({ x: 10, z: 5, w: 12, d: 10, h: 30, color: [0.6, 0.6, 0.65] });
  view.update(1 / 60, [], camera, 500);
  const boxes = scene.getObjectByName('vaporize').children.find((c) => c.isInstancedMesh);
  expect(boxes.count).toBe(1);
  expect(view.busy).toBe(true);
  for (let i = 0; i < 300; i++) view.update(1 / 60, [], camera, 500);
  expect(view.busy).toBe(false);
});

test('同時の一発が球の数を超えても、一番古い球を使い回して最新の一発を描く', () => {
  const { scene, view } = make();
  const list = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, shot: shot(400), front: 0 }));
  for (const b of list) { view.update(1 / 60, list.slice(0, b.id), camera, 500); }
  expect(spheresVisible(scene)).toBe(6);
  // 使い回された古い一発が消えても、新しい一発の球は残る
  run(view, list.slice(2), 1.2); // 前線はまだ途中（160 m/s × 1.2 s < 400 m）
  expect(spheresVisible(scene)).toBe(6);
  run(view, list.slice(2), 4);
  expect(spheresVisible(scene)).toBe(0);
});

test('球を取られた一発は、生きている間も球を作り直さず、閃光も出し直さない', () => {
  const { scene, view } = make();
  const list = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, shot: shot(400), front: 0 }));
  view.update(1 / 60, list, camera, 500); // 8つ同時に始まる
  for (let i = 0; i < 30; i++) view.update(1 / 60, list, camera, 500);
  expect(spheresVisible(scene)).toBe(6);
  expect(view.screen.flash).toBe(0); // 毎フレーム球を奪い合って光り続けない
  run(view, list, 1.0);
  expect(spheresVisible(scene)).toBe(6);
});

test('cameraInfo と screen は毎フレーム同じオブジェクトを書き換える（ゴミを出さない）', () => {
  const { view } = make();
  const c = view.cameraInfo, s = view.screen;
  run(view, [{ id: 1, shot: shot(100), front: 0 }], 0.2);
  expect(view.cameraInfo).toBe(c);
  expect(view.screen).toBe(s);
  expect(c.front).toBeGreaterThan(0);
});

test('ground: heat は球の不透明さ、ember は球の間は満ちて、球が消えてからゆっくり冷える（えぐれた地面の熾火）', () => {
  const { view } = make();
  const list = [{ id: 1, shot: shot(100), front: 0 }];
  run(view, list, 0.3);
  expect(view.ground.heat).toBeCloseTo(1, 5);
  expect(view.ground.ember).toBeCloseTo(1, 5);
  run(view, list, 2.0); // 前線が届き、球が消える
  expect(view.ground.heat).toBe(0);
  const e1 = view.ground.ember;
  expect(e1).toBeGreaterThan(0.2);
  expect(e1).toBeLessThan(1);
  run(view, list, 3.0);
  expect(view.ground.ember).toBeLessThan(e1 * 0.5);
  expect(view.ground.ember).toBeGreaterThan(0);
});

test('大きな一発は放つ瞬間に光らず（演出が白くする）、球が生まれても光らず、弾けた瞬間に強く光る', () => {
  const { view } = make();
  const bigShot = { amount: CONFIG.charge.maxDraw, radius: CONFIG.radius.max, isBig: true };
  view.begin(bigShot);
  for (let i = 0; i < 80; i++) view.update(0, [], camera, 500); // 演出で時間が止まっている間
  expect(view.screen.flash).toBe(0);
  const b = { id: 9, shot: bigShot, front: 0, t: 0 };
  run(view, [b], 1 / 60); // 球が生まれる（じわじわの始まり）
  expect(view.screen.flash).toBe(0);
  let peak = 0;
  for (let i = 0; i < 90; i++) { run(view, [b], 1 / 60); peak = Math.max(peak, view.screen.flash); }
  expect(peak).toBeGreaterThan(0.75); // 1 フレームぶん収まった後の値
});

test('弾けた瞬間の閃光が主役: 放つ瞬間の閃光より強く、大きな一発ほど強い', () => {
  const peakOf = (radius) => {
    const { view } = make();
    const s = shot(radius);
    view.begin(s);
    view.update(1 / 60, [], camera, 500);
    const begin = view.screen.flash;
    view.update(0.5, [], camera, 500);
    const b = { id: 1, shot: s, front: 0, t: 0 };
    let peak = 0;
    for (let i = 0; i < 120; i++) { run(view, [b], 1 / 60); peak = Math.max(peak, view.screen.flash); }
    return { begin, peak };
  };
  const tiny = peakOf(CONFIG.radius.min), mid = peakOf(200), max = peakOf(CONFIG.radius.max);
  for (const p of [tiny, mid, max]) expect(p.peak).toBeGreaterThanOrEqual(p.begin * 0.98);
  expect(tiny.peak).toBeLessThan(mid.peak);
  expect(mid.peak).toBeLessThan(max.peak);
  expect(tiny.peak).toBeGreaterThan(0.4);
});
