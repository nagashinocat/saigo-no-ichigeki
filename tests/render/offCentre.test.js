import { test, expect } from 'vitest';
import * as THREE from 'three';
import { toLocal, toWorld } from '../../src/render/blastFrame.js';
import { createCinematic, leadFor } from '../../src/render/cinematic.js';
import { planFinale, planRetreat } from '../../src/render/finalePlan.js';
import { createReplay } from '../../src/render/replay.js';
import { createBlackhole } from '../../src/render/blackhole.js';
import { createHandView } from '../../src/render/handView.js';
import { layoutViews, createCityCamera, fitCityCamera } from '../../src/render/views.js';
import { createStyle } from '../../src/render/style.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// M1（spec §16）: 爆心は放った瞬間の主人公の位置。演出・リプレイ・時間切れの結末は、爆心のまわりで原点のときと同じ絵を撮る
// （街を爆心の分だけずらすと、カメラも同じだけずれる）
const C = { x: 187.5, z: -96.25 };
const city = generateCity(3);
const moved = (list) => list.map((b) => ({ ...b, x: b.x + C.x, z: b.z + C.z, dist: Math.hypot(b.x + C.x, b.z + C.z) }));
const near = (a, b, tol = 1e-6) => { for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 4); };

test('M1: toLocal / toWorld: 爆心を原点とした位置へ写す（dist と angle も）。原点ならそのまま（同じ物）', () => {
  const list = [{ id: 1, x: 200, z: -90, dist: 0, angle: 0, w: 4 }, { id: 2, angle: 1, dist: 5 }];
  const l = toLocal(list, C);
  expect(l[0]).toMatchObject({ id: 1, x: 12.5, z: 6.25, w: 4 });
  expect(l[0].dist).toBeCloseTo(Math.hypot(12.5, 6.25), 12);
  expect(l[0].angle).toBeCloseTo(Math.atan2(6.25, 12.5), 12);
  expect(l[1]).toBe(list[1]); // 位置のない者はそのまま
  expect(list[0].x).toBe(200); // 元は変えない
  expect(toLocal(list, { x: 0, z: 0 })).toBe(list);
  expect(toLocal(list, null)).toBe(list);
  expect(toWorld([1, 2, 3], C)).toEqual([188.5, 2, -93.25]);
});

function cinematicCams(centre, buildings) {
  const shot = { amount: 100, radius: radiusFor(100), isBig: true, ...(centre ? { centre } : {}) };
  const poses = [];
  const enemyView = { setHeroYaw() {}, setFocus(f) { if (f) poses.push(f.pose); } };
  const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const cin = createCinematic({ size: { w: 390, h: 844 } }, enemyView, explosionView, { renderer, scene: new THREE.Scene() });
  const local = toLocal(buildings, centre);
  const plan = planFinale({ shot, buildings: local, enemies: [], rng: createRng(3), lead: leadFor(shot.radius), retreat: false });
  plan.retreat = planRetreat(plan, { buildings: local, radius: shot.radius, lead: leadFor(shot.radius), city: centre ? { x: -centre.x, z: -centre.z } : null });
  cin.play(plan, shot, { buildings: local });
  const out = [];
  for (let i = 0; i < 60 * 9; i++) {
    cin.update(1 / 60);
    if (i % 30 === 0 && cin.fullscreen && cin.camera !== null) {
      const cam = cin.camera;
      out.push({ stage: cin.stage, pos: cam.position.toArray(), dir: new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).toArray() });
    }
  }
  return { out, poses, cin };
}

test('M1: 最後の一発の演出は爆心のまわり: 街を爆心へずらすと、軍勢の後ろ・追うカットのカメラも同じだけずれ、向きは同じ。乗り手は世界の位置', () => {
  const a = cinematicCams(null, city.buildings);
  const b = cinematicCams(C, moved(city.buildings));
  expect(b.cin.centre).toEqual(C);
  expect(a.out.length).toBeGreaterThan(5);
  const stages = new Set();
  a.out.forEach((o, i) => {
    const p = b.out[i];
    expect(p.stage).toBe(o.stage);
    if (o.stage === 'space' || o.stage === 'flatten' || o.stage === 'silence' || o.stage === 'rumble' || o.stage === 'done') { near(p.pos, o.pos); return; } // 宇宙は別の場面
    stages.add(o.stage);
    near(p.pos, [o.pos[0] + C.x, o.pos[1], o.pos[2] + C.z]);
    near(p.dir, o.dir);
  });
  expect(stages.has('swell') || stages.has('race')).toBe(true);
  expect(stages.has('chase')).toBe(true);
  // 演出の乗り手（撮る一人）の姿勢も世界の位置
  if (a.poses[0]) { expect(b.poses[0].x).toBeCloseTo(a.poses[0].x + C.x, 4); expect(b.poses[0].z).toBeCloseTo(a.poses[0].z + C.z, 4); }
});

function replayCams(centre, buildings, survivors = null) {
  const cams = [];
  const r = createReplay({ size: { w: 390, h: 844 } }, { scene: new THREE.Scene(), onTick(dt, cam) { cams.push(cam.position.toArray()); } });
  r.play({ shot: { amount: 100, radius: CONFIG.radius.max, isBig: true, ...(centre ? { centre } : {}) }, buildings, heroYaw: 0.4, survivors });
  for (let i = 0; i < 60 * 16 && !r.finished; i++) r.update(1 / 60);
  return { cams, r };
}

test('M1: リプレイは爆心のまわり: どのカット（通り・横・真上・主人公）も、街をずらした分だけカメラがずれる。撃退失敗の引きの絵も', () => {
  const sv = [{ id: 1, x: 300, z: 40 }, { id: 2, x: -250, z: -310 }];
  const a = replayCams(null, city.buildings, sv);
  const b = replayCams(C, moved(city.buildings), sv.map((s) => ({ ...s, x: s.x + C.x, z: s.z + C.z })));
  expect(a.cams.length).toBeGreaterThan(100);
  expect(b.cams.length).toBe(a.cams.length);
  a.cams.forEach((p, i) => near(b.cams[i], [p[0] + C.x, p[1], p[2] + C.z]));
  expect(b.r.aftermath).toBeTruthy();
  near(b.r.camera.position.toArray(), [a.r.camera.position.x + C.x, a.r.camera.position.y, a.r.camera.position.z + C.z]);
});

test('M1: 時間切れの黒い球は主人公のいる所（カメラはそのまわりで同じ絵）', () => {
  const sunDir = createStyle('low').sunDir;
  const views = () => { const layout = layoutViews(390, 844), cityCamera = createCityCamera(); fitCityCamera(cityCamera, layout.city.w / layout.city.h); return { size: { w: 390, h: 844 }, layout, cityCamera }; };
  const hand = createHandView(null, 'high');
  const a = createBlackhole(views(), hand, { renderer: {}, scene: new THREE.Scene(), sunDir, buildings: city.buildings });
  const b = createBlackhole(views(), hand, { renderer: {}, scene: new THREE.Scene(), sunDir, buildings: moved(city.buildings) });
  a.play(); b.play(C);
  for (let i = 0; i < 300; i++) { a.update(1 / 60); b.update(1 / 60); }
  near(b.camera.position.toArray(), [a.camera.position.x + C.x, a.camera.position.y, a.camera.position.z + C.z]);
  const da = new THREE.Vector3(0, 0, -1).applyQuaternion(a.camera.quaternion), db = new THREE.Vector3(0, 0, -1).applyQuaternion(b.camera.quaternion);
  near(db.toArray(), da.toArray());
});

test('M1: 爆発の球・衝撃波の輪・爆心の光は一発の爆心に置く（払うは払った所、最後の一発は放った所）。街のゆがみと地面の網も爆心へ', async () => {
  const { createExplosionView } = await import('../../src/render/explosionView.js');
  const { createCityView } = await import('../../src/render/cityView.js');
  const scene = new THREE.Scene();
  const view = createExplosionView(scene, 'low', { sunDir: new THREE.Vector3(0.8, 0.4, -0.4).normalize() });
  const cam = new THREE.PerspectiveCamera();
  const puff = { id: 1, shot: { radius: 22, small: true, centre: { x: -40, z: 12 } }, front: 5 };
  const big = { id: 2, shot: { radius: 300, isBig: true, centre: C }, front: 80 };
  view.update(1 / 60, [puff, big], cam, 500, 0);
  const spheres = [];
  const u = (o) => o.material?.uniforms;
  view.group.traverse((o) => { if (o.isMesh && o.visible && u(o)?.uCentre && (u(o).uRing || u(o).uRadius)) spheres.push(o); });
  const at = (x, z) => spheres.filter((o) => Math.abs(o.position.x - x) < 1e-9 && Math.abs(o.position.z - z) < 1e-9);
  expect(at(-40, 12).length).toBe(2); // 払うの球と輪
  expect(at(C.x, C.z).length).toBe(2); // 最後の一発の球と輪
  for (const o of spheres) expect(o.material.uniforms.uCentre.value.toArray()).toEqual([o.position.x, 0, o.position.z]);
  expect(view.light.position.x).toBe(C.x);
  expect(view.light.position.z).toBe(C.z);
  const style = createStyle('low');
  const cv = createCityView(generateCity(3), style, 'low');
  cv.setBlastCentre(C);
  expect(style.uniforms.uBlastC.value.toArray()).toEqual([C.x, C.z]);
  const ground = cv.group.children.find((o) => o.isMesh && o.material === style.ground);
  expect(ground.position.toArray()).toEqual([C.x, 0, C.z]);
  expect(cv.blastCentre).toEqual(C);
});
