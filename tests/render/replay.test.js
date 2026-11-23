import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createReplay, replayBars, AFTERMATH_TIMING } from '../../src/render/replay.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { CONFIG } from '../../src/config.js';

// リプレイの監督: 決まった刻みで世界を進め（画面の速さによらない）、4つのカットを順に見せ、飛ばせて、何度でも同じに見せ直せる

const city = generateCity(7);
const shot = { amount: 100, radius: CONFIG.radius.max, isBig: true };

function make({ w = 390, h = 844 } = {}) {
  const log = { ticks: [], restores: 0, events: [], cams: [] };
  const sun = new THREE.DirectionalLight(0xffffff, 4), fill = new THREE.HemisphereLight(0xffffff, 0x000000, 1.6);
  const fog = { value: 320 };
  const blastLight = new THREE.PointLight(0xffffff, 0);
  const r = createReplay({ size: { w, h } }, {
    scene: new THREE.Scene(), lights: { sun, fill }, fog, blastLight,
    onRestore() { log.restores++; log.ticks = []; },
    onTick(dt, cam) { log.ticks.push(dt); log.cams.push(cam.position.toArray()); blastLight.intensity = 100; },
  });
  for (const e of ['replayStart', 'cut', 'aftermath', 'replayEnd']) r.on(e, (a) => log.events.push(e + (a?.name ? ':' + a.name : '')));
  return { r, log, sun, fill, fog, blastLight };
}
const play = (r) => r.play({ shot, buildings: city.buildings, heroYaw: 0.5 });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test('放つ直前へ戻してから、street の始まりまで先に進め、4つのカットを順に見せて結果へ', () => {
  const { r, log } = make();
  play(r);
  expect(log.restores).toBe(1);
  expect(log.events).toEqual(['replayStart']);
  const tl = r.timeline;
  expect(sum(log.ticks)).toBeCloseTo(tl.bStart, 9);
  expect(r.screen.grade.fade).toBe(1); // 暗転から
  for (let i = 0; i < 60 * 14 && !r.finished; i++) r.update(1 / 60);
  expect(log.events).toEqual(['replayStart', 'cut:street', 'cut:side', 'cut:top', 'cut:hero', 'replayEnd']);
  expect(r.finished).toBe(true);
  expect(sum(log.ticks)).toBeCloseTo(tl.blastAt(tl.end), 6);
  expect(r.screen.grade.bars).toBeCloseTo(replayBars(390 / 844), 6);
  expect(r.screen.grade.bars).toBeGreaterThan(0.05);
  // 待つ間も世界はゆっくり進み、知らせは繰り返さない
  const n = log.ticks.length;
  r.update(1 / 60);
  expect(log.ticks.length).toBe(n + 1);
  expect(log.events.filter((e) => e === 'replayEnd')).toHaveLength(1);
});

test('刻みは画面の速さによらない: 60fps・30fps・ばらばらでも、世界へ渡す秒の並びが同じ', () => {
  const runs = [[1 / 60], [1 / 30], [0.011, 0.023, 0.017, 0.05, 0.004]].map((dts) => {
    const { r, log } = make();
    play(r);
    let i = 0;
    while (!r.finished && i < 5000) r.update(dts[i++ % dts.length]);
    return log.ticks;
  });
  expect(runs[1]).toEqual(runs[0]);
  expect(runs[2]).toEqual(runs[0]);
});

test('もう一度 play すると、同じリプレイ（同じ刻み・同じカメラ）', () => {
  const { r, log } = make();
  const once = () => {
    play(r);
    while (!r.finished) r.update(1 / 60);
    return { ticks: log.ticks.slice(), cams: log.cams.slice(-200) };
  };
  const a = once();
  log.cams = [];
  const b = once();
  expect(b.ticks).toEqual(a.ticks);
  expect(b.cams).toEqual(a.cams.slice(-b.cams.length));
});

test('飛ばす: 暗くなり、暗いうちに最後まで進めて結果へ（世界は終わりの状態）。そのあと明ける', () => {
  const { r, log } = make();
  play(r);
  for (let i = 0; i < 90; i++) r.update(1 / 60);
  expect(r.cut).toBe('street');
  r.skip();
  let frames = 0;
  while (!r.finished && frames < 120) { r.update(1 / 60); frames++; }
  expect(r.finished).toBe(true);
  expect(frames).toBeLessThan(40); // 0.22 秒暗くして、数フレームで早送り
  expect(log.events.at(-1)).toBe('replayEnd');
  expect(sum(log.ticks)).toBeCloseTo(r.timeline.blastAt(r.timeline.end), 6);
  expect(r.screen.grade.fade).toBeGreaterThan(0.9);
  for (let i = 0; i < 40; i++) r.update(1 / 60);
  expect(r.screen.grade.fade).toBeLessThan(0.5);
});

test('カメラ: street は通りの人の目の高さ、top は真上から見下ろす、hero は主人公のすぐそば。光と霞みは終わると戻る', () => {
  const { r, sun, fill, fog, blastLight } = make();
  play(r);
  const at = (name) => { while (r.cut !== name) r.update(1 / 60); for (let i = 0; i < 30; i++) r.update(1 / 60); return r.camera; };
  const st = at('street');
  expect(st.position.y).toBeLessThan(4);
  const fwd = new THREE.Vector3();
  const top = at('top');
  top.getWorldDirection(fwd);
  expect(fwd.y).toBeLessThan(-0.99);
  expect(fog.value).toBeGreaterThan(320 + top.position.y * 0.9); // 遠い真上のカメラでは霞みを延ばす
  const hero = at('hero');
  expect(hero.position.length()).toBeLessThan(7);
  expect(r.silhouette).toBeGreaterThan(0.5);
  expect(blastLight.intensity).toBeLessThan(100 * 0.2); // 主人公を影絵にするため、爆心の光を弱める
  expect(sun.intensity).toBeLessThan(4);
  expect(r.light.mesh.visible).toBe(true);
  r.stop();
  expect(r.active).toBe(false);
  expect(sun.intensity).toBeCloseTo(4, 9);
  expect(fill.intensity).toBeCloseTo(1.6, 9);
  expect(fog.value).toBe(320);
  expect(r.light.mesh.visible).toBe(false);
});

test('小さな一発・横長の画面でも、終わりまで進み、カメラはいつも有限', () => {
  for (const [amount, w, h] of [[CONFIG.power.minRelease, 1280, 720], [40, 390, 844]]) {
    const { r } = make({ w, h });
    r.play({ shot: { amount, radius: radiusFor(amount), isBig: true }, buildings: city.buildings });
    let i = 0;
    while (!r.finished && i++ < 2000) {
      r.update(1 / 60);
      for (const v of r.camera.position.toArray()) expect(Number.isFinite(v)).toBe(true);
    }
    expect(r.finished).toBe(true);
  }
});

test('最後のカットの爆心の光は、刻みのないフレームが続いても重ねて弱まらない（爆発が決めた値 × (1 − 影絵の割合)）', () => {
  const { r, blastLight } = make();
  play(r);
  while (r.cut !== 'hero') r.update(1 / 60);
  r.update(1 / 60);
  const k = r.silhouette;
  expect(k).toBeGreaterThan(0.5);
  // 刻みより細かい dt を何フレームも（onTick が呼ばれないフレームがある）
  for (let i = 0; i < 40; i++) {
    r.update(1 / 240);
    expect(blastLight.intensity).toBeCloseTo(100 * (1 - r.silhouette), 6);
  }
});

test('S9: 撃退失敗なら、最後まで見せたあと（飛ばしても）暗転を挟んで生き残りの引きの絵で待つ。成功なら前のまま', () => {
  const survivors = [{ x: 620, z: 30 }, { x: -40, z: -650 }];
  for (const skip of [false, true]) {
    const { r } = make();
    r.play({ shot, buildings: city.buildings, heroYaw: 0.5, survivors });
    if (skip) { r.update(1 / 60); r.skip(); }
    for (let i = 0; i < 60 * 16 && !r.finished; i++) r.update(1 / 60);
    expect(r.finished).toBe(true);
    expect(r.aftermath).not.toBe(null);
    for (let i = 0; i < 90; i++) r.update(1 / 60);
    const cam = r.camera;
    expect(cam.position.toArray()).toEqual(r.aftermath.pos.map((v) => expect.closeTo(v, 4)));
    for (const s of survivors) {
      const p = new THREE.Vector3(s.x, 3, s.z).project(cam);
      expect(Math.abs(p.x)).toBeLessThan(1);
      expect(Math.abs(p.y)).toBeLessThan(1);
    }
    expect(r.screen.grade.fade).toBeLessThan(0.3); // 結果の後ろでも街と光が読める
    expect(r.silhouette).toBe(0);
  }
  const { r } = make();
  r.play({ shot, buildings: city.buildings, heroYaw: 0.5, survivors: [] });
  for (let i = 0; i < 60 * 16 && !r.finished; i++) r.update(1 / 60);
  expect(r.aftermath).toBe(null);
  r.update(1 / 60);
  expect(r.cut).toBe('hero');
});

test('S9 fix1: 撃退失敗の引きの絵は、暗転から明けきって少し保ってから replayEnd（結果より先に生き残りだけの絵を見せる）。タップでその先へ飛ばせる', () => {
  const survivors = [{ x: 620, z: 30 }, { x: -40, z: -650 }];
  const { r, log } = make();
  r.play({ shot, buildings: city.buildings, heroYaw: 0.5, survivors });
  let i = 0;
  while (!log.events.includes('aftermath') && i++ < 60 * 16) r.update(1 / 60);
  expect(log.events).toContain('aftermath');
  expect(log.events).not.toContain('replayEnd');
  expect(r.finished).toBe(false);
  let held = 0;
  while (!log.events.includes('replayEnd') && held < 10) { r.update(1 / 60); held += 1 / 60; }
  expect(held).toBeGreaterThanOrEqual(AFTERMATH_TIMING.fadeIn + AFTERMATH_TIMING.hold - 1 / 30);
  expect(held).toBeLessThan(AFTERMATH_TIMING.fadeIn + AFTERMATH_TIMING.hold + 0.1);
  expect(AFTERMATH_TIMING.hold).toBeGreaterThanOrEqual(1.2);
  expect(AFTERMATH_TIMING.hold).toBeLessThanOrEqual(1.5);
  expect(r.screen.grade.fade).toBeLessThan(0.2); // 明けきっている
  expect(r.finished).toBe(true);
  expect(log.events.filter((e) => e === 'replayEnd')).toHaveLength(1);
  // 引きの絵の間のタップ: すぐ結果へ
  const b = make();
  b.r.play({ shot, buildings: city.buildings, heroYaw: 0.5, survivors });
  i = 0;
  while (!b.log.events.includes('aftermath') && i++ < 60 * 16) b.r.update(1 / 60);
  b.r.update(1 / 60);
  b.r.skip();
  expect(b.log.events.filter((e) => e === 'replayEnd')).toHaveLength(1);
  expect(b.r.finished).toBe(true);
  // 撃退成功は前のまま、最後まで見せた瞬間に replayEnd（aftermath は来ない）
  const c = make();
  c.r.play({ shot, buildings: city.buildings, heroYaw: 0.5 });
  while (!c.r.finished) c.r.update(1 / 60);
  expect(c.log.events).not.toContain('aftermath');
  expect(c.log.events.at(-1)).toBe('replayEnd');
});

test('持ち主 23:01: 真上のカット（top）は引いている: 光の円と穴（半径の 1.18 倍）と、その外の街が、画面の短い辺に余白をもって収まる', async () => {
  const { topHeight, TOP_FRAME } = await import('../../src/render/replay.js');
  const { CONFIG } = await import('../../src/config.js');
  for (const R of [120, 450, CONFIG.radius.max]) {
    for (const [fov, aspect] of [[62, 390 / 844], [44, 16 / 9]]) {
      const tanV = Math.tan(fov / 2 * Math.PI / 180), tanShort = aspect < 1 ? tanV * aspect : tanV;
      const H = topHeight(R, tanShort) * 0.96; // カットの終わり（いちばん寄ったとき）
      const half = H * tanShort; // 短い辺の半分が地面で届く距離
      expect(half).toBeGreaterThan(R * TOP_FRAME.ring * 1.1);
      expect(half).toBeGreaterThan(Math.min(CONFIG.cityRadius, R * TOP_FRAME.cityMax));
    }
  }
});

// Fix round 1（見直し Minor 2）: 撃退失敗の引きの絵（held）の間に飛ばしたときも 'skip' を知らせる（main.js がリプレイの音を止める: audio.cutReplay）
test('Fix round 1: 引きの絵（held）の間に飛ばしても、replayEnd の前に skip を一度だけ知らせる。最後まで見せ終えたあとの skip は知らせない', () => {
  const survivors = [{ x: 620, z: 30 }, { x: -40, z: -650 }];
  const { r, log } = make();
  r.on('skip', () => log.events.push('skip'));
  r.play({ shot, buildings: city.buildings, heroYaw: 0.5, survivors });
  let i = 0;
  while (!log.events.includes('aftermath') && i++ < 60 * 16) r.update(1 / 60);
  r.update(1 / 60);
  expect(log.events).not.toContain('skip');
  r.skip();
  expect(log.events.slice(-2)).toEqual(['skip', 'replayEnd']);
  r.skip(); r.update(1 / 60); r.skip();
  expect(log.events.filter((e) => e === 'skip')).toHaveLength(1);
});
