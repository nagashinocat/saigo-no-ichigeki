import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createCinematic, leadFor, barsFor } from '../../src/render/cinematic.js';
import { createReplay } from '../../src/render/replay.js';
import { planFinale } from '../../src/render/finalePlan.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// R4: 縦動画（share/clip.js）は、リプレイの写しと演出の時刻表から、プレイヤーが見たのと同じ場面を描き直す。
// その入り口: replay.seek（決まった刻みで指定の時刻まで進める）と cinematic.spaceShot（演出を動かさずに宇宙の一コマを描く）

const city = generateCity(3);
const shotOf = (amount, centre = { x: 12, z: -30 }) => ({ amount, radius: radiusFor(amount), isBig: true, centre });
const SHOT = shotOf(CONFIG.power.max);
const ARMY = [{ id: 11, x: 120, z: 20, patrol: true }, { id: 12, x: -200, z: 90, patrol: true }, { id: 13, x: 40, z: 400, patrol: true }, { id: 4, x: 5, z: 3 }];

function makeReplay() {
  const ticks = [], events = [];
  const r = createReplay({ size: { w: 720, h: 1280 } }, { scene: new THREE.Scene(), onRestore() { ticks.length = 0; }, onTick(dt) { ticks.push(dt); } });
  for (const e of ['replayStart', 'cut', 'aftermath', 'replayEnd', 'skip']) r.on(e, (a) => events.push(e + (a?.name ? ':' + a.name : '')));
  r.play({ shot: SHOT, buildings: city.buildings, heroYaw: 0.3 });
  return { r, ticks, events };
}

test('replay.seek: 決まった刻みで時刻まで進める（ふつうに再生したときと同じ刻みの並び・同じカメラ）。暗転なし・結果へ進まない', () => {
  const live = makeReplay(), seek = makeReplay();
  const target = live.r.timeline.cut('side').t0 + 0.5;
  while (live.r.time < target - 1e-9) live.r.update(1 / 60);
  seek.r.seek(live.r.time);
  expect(seek.r.time).toBeCloseTo(live.r.time, 9);
  expect(seek.ticks).toEqual(live.ticks);
  expect(seek.r.camera.position.toArray()).toEqual(live.r.camera.position.toArray());
  expect(seek.r.cut).toBe('side');
  expect(seek.r.screen.grade.fade).toBe(0);
  // 先へ何度かに分けて進めても同じ
  const split = makeReplay();
  split.r.seek(target / 3); split.r.seek(target / 2); split.r.seek(live.r.time);
  expect(split.ticks).toEqual(live.ticks);
  // 戻らない・終わらない
  seek.r.seek(1);
  expect(seek.r.time).toBeCloseTo(live.r.time, 9);
  seek.r.seek(1e9);
  expect(seek.r.time).toBeLessThanOrEqual(seek.r.timeline.end + 1e-9);
  expect(seek.r.time).toBeGreaterThan(seek.r.timeline.end - seek.r.timeline.tick - 1e-9); // 刻みの並びの上で最後まで
  expect(seek.r.finished).toBe(false);
  expect(seek.events.filter((e) => !e.startsWith('cut'))).toEqual(['replayStart']);
});

test('replay.seek: 1 回に細かい刻みで進めるのは maxFine まで、残りは粗い刻み（遅い端末で録画が遅れていかない）', () => {
  const { r, ticks } = makeReplay();
  const n0 = ticks.length, t0 = r.time;
  r.seek(t0 + 2, { maxFine: 10 });
  expect(r.time).toBeCloseTo(t0 + 2, 6);
  expect(ticks.length - n0).toBeLessThan(10 + 2 / (1 / 15) + 2);
  expect(ticks.length - n0).toBeGreaterThan(10);
});

function makeCinematic() {
  const views = { size: { w: 720, h: 1280 } };
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const explosionView = { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0.002 } };
  const cin = createCinematic(views, { setHeroYaw() {} }, explosionView, { renderer, scene: new THREE.Scene() });
  const plan = planFinale({ shot: SHOT, buildings: city.buildings, enemies: [], rng: createRng(3), lead: leadFor(SHOT.radius) });
  return { cin, plan, views };
}

test('cinematic.spaceShot: 宇宙・縦一線の光の一コマは、演出を再生したときと同じカメラ・同じ画づくり（同じ時刻表から）', () => {
  const live = makeCinematic();
  live.cin.play(live.plan, SHOT, { enemies: () => ARMY });
  const tl = live.cin.timeline;
  const shots = makeCinematic();
  const sparks = new Map();
  for (const at of [tl.chaseEnd + 1.0, tl.flatten + 0.4, tl.flatten + 1.2, tl.lineEnd + 0.3]) {
    while (live.cin.time < at - 1e-9) live.cin.update(1 / 60);
    const s = shots.cin.spaceShot(live.cin.time, { shot: SHOT, timeline: tl, enemies: ARMY, sparks });
    expect(s.camera.position.toArray()).toEqual(live.cin.camera.position.toArray());
    expect(s.camera.quaternion.toArray()).toEqual(live.cin.camera.quaternion.toArray());
    expect(s.scene).toBe(shots.cin.spaceScene);
    const { bars, fade, ...rest } = s.screen.grade;
    const { bars: lb, fade: lf, ...lrest } = live.cin.screen.grade;
    expect(rest).toEqual(lrest);
    expect(bars).toBeCloseTo(barsFor(720 / 1280), 9);
    expect(fade).toBe(0);
  }
  // 演出そのものは動かさない（off のまま）
  expect(shots.cin.active).toBe(false);
  expect(shots.cin.timeline).toBe(null);
});
