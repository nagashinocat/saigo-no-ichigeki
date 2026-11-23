import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createCinematic, leadFor, SPACE_LOOK } from '../../src/render/cinematic.js';
import { createTimeline, FINALE, SPACE_BEATS, spaceTierFor, spaceTierRadii } from '../../src/render/finaleTimeline.js';
import { planFinale } from '../../src/render/finalePlan.js';
import { createReplayTimeline } from '../../src/render/replayTimeline.js';
import { planClip, CLIP } from '../../src/share/clip.js';
import { rumbleKeys } from '../../src/audio/audio.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';
import SNAP from './spaceMaxSnapshot.json';

// R1i（持ち主 2026-11-23 10:29）: 宇宙から見た爆発（ドーム → 縦一線の光）の大きさを、放った一撃の規模で 3 段階に。
// 今のものが最大（そのまま）。中（普通）と小（しょうもない）は小さく・控えめ・短く、縦一線の光は画面の上まで届かずに細って消える
const city = generateCity(3);
const shotOf = (amount) => ({ amount, radius: radiusFor(amount), isBig: true });
const ARMY = [{ id: 1, angle: 0.3, dist: 40, state: 'approach', deadTime: 0 }, { id: 11, angle: 0.8, dist: 120, state: 'search', deadTime: 0, patrol: true }];
// R1i fix1: しきい値は力（%）で持ち、半径は radiusFor で出す
const T = spaceTierRadii();
// 段ごとに試す一撃: 小（最小の力・小の上の端）、中（中の下の端・上の端）、最大（膝ちょうど・満タン）
const POW_AT = (r) => { let lo = 0, hi = 100; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (radiusFor(m) < r) lo = m; else hi = m; } return hi; };
const CASES = {
  small: [CONFIG.power.minRelease, POW_AT(T.normal) - 0.05],
  normal: [POW_AT(T.normal) + 1e-6, 96.9],
  max: [97, 100],
};

function makeCinematic(size, shot) {
  const renderer = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, getPixelRatio: () => 1, compile() {} };
  const cin = createCinematic({ size }, { setHeroYaw() {} }, { screen: { flash: 0, time: 0, heat: null }, cameraInfo: { front: 0, shake: 0.002 } },
    { renderer, scene: new THREE.Scene(), lights: { sun: new THREE.DirectionalLight(), fill: new THREE.HemisphereLight() } });
  const plan = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(3), lead: leadFor(shot.radius) });
  cin.play(plan, shot);
  return cin;
}
const meshes = (scene) => ({
  dome: scene.children.find((o) => o.isMesh && o.material.uniforms?.uFlat),
  line: scene.children.find((o) => o.isMesh && o.material.uniforms?.uThin),
});

test('R1i: 段は爆発の半径で決まる（設定の値）。境目ちょうどで上の段', () => {
  expect(T.max).toBe(CONFIG.radius.kneeRadius); // 最大 = 膝（力 97%）から
  expect(T.normal).toBe(radiusFor(CONFIG.spaceTier.normalPct * CONFIG.power.max / 100));
  expect(T.max).toBe(radiusFor(CONFIG.spaceTier.maxPct * CONFIG.power.max / 100));
  expect(spaceTierFor(radiusFor(100))).toBe('max');
  expect(spaceTierFor(radiusFor(97))).toBe('max');
  expect(spaceTierFor(radiusFor(96.99))).toBe('normal');
  expect(spaceTierFor(T.max)).toBe('max');
  expect(spaceTierFor(T.max - 1e-6)).toBe('normal');
  expect(spaceTierFor(T.normal)).toBe('normal');
  expect(spaceTierFor(T.normal - 1e-6)).toBe('small');
  expect(spaceTierFor(radiusFor(CONFIG.power.minRelease))).toBe('small');
  for (const [tier, amounts] of Object.entries(CASES)) for (const a of amounts) expect(spaceTierFor(radiusFor(a)), `${a}`).toBe(tier);
  // 設定を変えれば段も変わる
  const cfg = { ...CONFIG, spaceTier: { normalPct: 20, maxPct: 40 } };
  expect(spaceTierFor(radiusFor(30), cfg)).toBe('normal');
  expect(spaceTierFor(radiusFor(45), cfg)).toBe('max');
  expect(spaceTierFor(radiusFor(15), cfg)).toBe('small');
  // 時刻表は段を持つ（渡せば段を決められる）
  expect(createTimeline({ radius: radiusFor(100) }).tier).toBe('max');
  expect(createTimeline({ radius: radiusFor(30) }).tier).toBe('small');
  expect(createTimeline({ radius: radiusFor(30), tier: 'max' }).tier).toBe('max');
});

test('R1i: 最大の時刻表は前（HEAD ee0f916）のまま', () => {
  for (const s of SNAP.timeline) {
    const tl = createTimeline({ radius: radiusFor(s.a) });
    expect(tl.tier).toBe('max');
    for (const k of Object.keys(s)) {
      if (k === 'a' || k === 'beat') continue;
      if (k === 'dome') { s.dome.forEach((v, i) => expect(tl.domeAt(tl.chaseEnd + [0.3, 0.6, 0.9][i] * (tl.domeEnd - tl.chaseEnd))).toBeCloseTo(v, 5)); continue; }
      expect(tl[k], `${s.a} ${k}`).toBeCloseTo(s[k], 5);
    }
    expect(tl.flattenSec).toBe(FINALE.flattenSec);
    expect(tl.thinSec).toBe(FINALE.thinSec);
    expect(tl.spaceSound).toBe(1);
  }
});

const STAGES = ['hands', 'white', 'swell', 'race', 'chase', 'space', 'flatten', 'silence', 'rumble', 'done'];
test('R1i: どの段の時刻表もすき間なく順に進み、宇宙からあとの長さは段の決まりどおり（最大 > 中 > 小）', () => {
  const spaceLen = {};
  for (const [tier, amounts] of Object.entries(CASES)) {
    const B = { ...FINALE, ...SPACE_BEATS[tier] };
    for (const a of amounts) {
      const r = radiusFor(a);
      const tl = createTimeline({ radius: r, riderDist: r * 0.46, firstDist: r * 0.46 - 30, camDist: r * 0.46 + 14 });
      expect(tl.tier).toBe(tier);
      // 宇宙へ切り替わるまでは段によらない（最大の時刻表と同じ）
      const asMax = createTimeline({ radius: r, riderDist: r * 0.46, firstDist: r * 0.46 - 30, camDist: r * 0.46 + 14, tier: 'max' });
      for (const k of ['burst', 'engulf', 'camHit', 'snap', 'chaseEnd', 'frontDone']) expect(tl[k]).toBe(asMax[k]);
      // 段の長さ
      expect(tl.flattenSec).toBe(B.flattenSec);
      expect(tl.thinSec).toBe(B.thinSec);
      expect(tl.lineEnd - tl.flatten).toBeCloseTo(B.flattenSec + B.thinSec, 9);
      expect(tl.rumble - tl.lineEnd).toBeCloseTo(B.silenceSec, 9);
      expect(tl.end - tl.rumble).toBeCloseTo(B.rumbleHold, 9);
      expect(tl.flatten - tl.chaseEnd).toBeGreaterThanOrEqual(B.spaceMin - 1e-9);
      expect(tl.domeEnd - tl.chaseEnd).toBeGreaterThanOrEqual(B.domeMin - 1e-9);
      expect(tl.flatten - tl.domeEnd).toBeGreaterThanOrEqual(B.spaceHold - 1e-9);
      expect(tl.domeEnd).toBeGreaterThanOrEqual(tl.frontDone - 1e-9); // 半球は前線が止まるまでふくらむ
      // すき間なく: 段は飛ばさず、順に、どれも 0.1 秒以上ある
      let prev = -1; const seen = new Map();
      for (let t = 0; t <= tl.end + 0.1; t += 1 / 240) {
        const i = STAGES.indexOf(tl.stage(t));
        expect(i - prev === 0 || i - prev === 1, `${tier} ${a} t=${t.toFixed(3)} ${STAGES[prev]} → ${STAGES[i]}`).toBe(true);
        prev = i;
        seen.set(STAGES[i], (seen.get(STAGES[i]) ?? 0) + 1 / 240);
      }
      for (const s of STAGES.slice(0, -1)) expect(seen.get(s), `${tier} ${a} ${s}`).toBeGreaterThan(0.1);
      // 半球のふくらみは止まらずに 0 → 1（途中で止まる間がない）
      let pd = 0;
      for (let t = tl.chaseEnd; t <= tl.domeEnd; t += 1 / 120) { const d = tl.domeAt(t); expect(d).toBeGreaterThanOrEqual(pd - 1e-12); pd = d; }
      expect(tl.domeAt(tl.domeEnd)).toBe(1);
      (spaceLen[tier] ??= []).push(tl.end - tl.chaseEnd);
    }
  }
  expect(Math.min(...spaceLen.max)).toBeGreaterThan(Math.max(...spaceLen.normal));
  expect(Math.min(...spaceLen.normal)).toBeGreaterThan(Math.max(...spaceLen.small));
  // 小はぽっと短く（宇宙からあと 3.5 秒まで。小の上の端は街の前線が止まるまで半球がふくらむ分だけ長い）、それでも見える（1.5 秒以上）
  expect(Math.max(...spaceLen.small)).toBeLessThan(3.5);
  expect(Math.min(...spaceLen.small)).toBeGreaterThan(1.5);
});

// 最大の見た目は前のまま（縦長・横長、膝ちょうどと満タン。宇宙の 3 コマと押しつぶし〜線の 5 コマ）
test('R1i: 最大の宇宙の半球と縦一線の光の大きさ・明るさは前のまま', () => {
  for (const s of SNAP.visual) {
    const shot = shotOf(s.a);
    const cin = makeCinematic({ w: s.w, h: s.w === 390 ? 844 : 720 }, shot);
    const tl = cin.timeline;
    const at = [0.3, 1.0, 2.0].map((d) => tl.chaseEnd + d).concat([0.1, 0.4, 0.8, 1.2, 1.45].map((k) => tl.flatten + k));
    at.forEach((tt, i) => {
      const v = cin.spaceShot(tt, { shot, timeline: tl });
      const { dome, line } = meshes(v.scene);
      const got = [dome.scale.x, dome.scale.y, dome.material.uniforms.uI.value, line.scale.x, line.scale.y, line.material.uniforms.uI.value, line.material.uniforms.uThin.value];
      got.forEach((x, j) => expect(x, `${s.w} ${s.a} frame ${i} value ${j}`).toBeCloseTo(s.out[i][j], 3));
    });
  }
});

// 光る部分の先（板の下から 0.69。LINE_FRAG の along が半分になる所）の画面の縦（NDC）。いちばん上まで
function lineRun(size, amount) {
  const shot = shotOf(amount);
  const cin = makeCinematic(size, shot);
  const tl = cin.timeline;
  for (let t = 0; t < tl.chaseEnd + 0.05; t += 1 / 60) cin.update(1 / 60);
  const { dome, line } = meshes(cin.renderScene);
  const up = new THREE.Vector3(), tip = new THREE.Vector3();
  let topNdc = -Infinity, lit = 0, domeW = 0, domeI = 0, lineI = 0, end = null;
  while (cin.time < tl.end + 0.05) {
    cin.update(1 / 60);
    domeW = Math.max(domeW, dome.visible ? dome.scale.x : 0);
    domeI = Math.max(domeI, dome.visible ? dome.material.uniforms.uI.value : 0);
    const u = line.material.uniforms;
    if (!(line.visible && u.uI.value > 0.02)) continue;
    lit += 1 / 60; lineI = Math.max(lineI, u.uI.value);
    up.set(0, 1, 0).applyQuaternion(line.quaternion);
    tip.copy(line.position).addScaledVector(up, 0.22 * line.scale.y);
    const cam = cin.camera; cam.updateMatrixWorld();
    topNdc = Math.max(topNdc, tip.clone().project(cam).y);
    end = cin.time;
  }
  return { tier: tl.tier, topNdc, lit, domeW, domeI, lineI, lastLit: end, lineEnd: tl.lineEnd };
}

for (const size of [{ w: 390, h: 844 }, { w: 1280, h: 720 }]) {
  test(`R1i: 縦一線の光が画面の上を突き抜けるのは最大だけ。中・小は上の端より手前で細って消える。小さい段ほど半球は小さく光は控えめ（${size.w}×${size.h}）`, () => {
    const runs = {};
    for (const [tier, amounts] of Object.entries(CASES)) for (const a of amounts) {
      const r = lineRun(size, a);
      expect(r.tier).toBe(tier);
      expect(r.lit, `${tier} ${a} 線が見える`).toBeGreaterThan(0.1);
      expect(r.lastLit).toBeLessThanOrEqual(r.lineEnd + 1e-6); // lineEnd までに消える
      if (tier === 'max') expect(r.topNdc, `max ${a}`).toBeGreaterThan(1.0);
      else expect(r.topNdc, `${tier} ${a}`).toBeLessThan(0.9);
      (runs[tier] ??= []).push(r);
    }
    const max = (tier, k) => Math.max(...runs[tier].map((r) => r[k])), min = (tier, k) => Math.min(...runs[tier].map((r) => r[k]));
    // 中の線の先は小より高い（段がわかる）
    expect(min('normal', 'topNdc')).toBeGreaterThan(max('small', 'topNdc'));
    for (const k of ['domeW', 'domeI', 'lineI']) {
      expect(min('max', k), k).toBeGreaterThan(max('normal', k));
      expect(min('normal', k), k).toBeGreaterThan(max('small', k));
    }
    // 中は最大の半分より大きく、小は最大の半分より小さい（半球の幅）
    expect(min('normal', 'domeW')).toBeGreaterThan(0.5 * min('max', 'domeW'));
    expect(max('small', 'domeW')).toBeLessThan(0.5 * min('max', 'domeW'));
  });
}

test('R1i: 音は画面に従う — 地響きの宇宙からあとは段ごとに小さく、最大は前のまま', () => {
  for (const s of SNAP.timeline.filter((x) => x.a !== 98.6)) {
    const keys = rumbleKeys(createTimeline({ radius: radiusFor(s.a) }));
    expect(keys.map((k) => [k.t, k.g, k.f]).map(([t, g, f]) => [+t.toFixed(6), g, f])).toEqual(SNAP.rumbleKeys[String(s.a)]);
  }
  const at = (a) => { const tl = createTimeline({ radius: radiusFor(a) }); return { tl, keys: rumbleKeys(tl) }; };
  const big = at(100), mid = at(80), small = at(30);
  expect(big.tl.spaceSound).toBe(1);
  expect(mid.tl.spaceSound).toBeLessThan(1);
  expect(small.tl.spaceSound).toBeLessThan(mid.tl.spaceSound);
  // 宇宙へ切り替わる（chaseEnd）までの折れ線は段によらない形、そこから先（こもって消えるまで）は段の大きさ倍
  for (const { tl, keys } of [mid, small]) {
    const ref = rumbleKeys({ ...tl, spaceSound: 1 });
    keys.forEach((k, i) => {
      expect(k.t).toBe(ref[i].t);
      if (k.t <= tl.chaseEnd) expect(k.g).toBe(ref[i].g);
      else expect(k.g).toBeCloseTo(ref[i].g * tl.spaceSound, 9);
    });
    expect(keys.at(-1).t).toBeCloseTo(tl.lineEnd, 9); // 縦一線の光が消えるときに消える
  }
});

test('R1i: 縦動画（R4）も同じ段 — 縦一線の場面の長さ・音の大きさは演出の時刻表の段のもの', () => {
  for (const [tier, amounts] of Object.entries(CASES)) for (const a of amounts) {
    const r = radiusFor(a);
    const replay = createReplayTimeline({ radius: r, streetDist: Math.min(170, Math.max(40, 0.4 * r)) });
    const finale = createTimeline({ radius: r });
    const clip = planClip({ replay, finale });
    expect(clip.tier).toBe(tier);
    const line = clip.segments.find((s) => s.name === 'line');
    expect(line.to - line.from).toBeCloseTo(finale.flattenSec + finale.thinSec, 9);
    expect(line.to).toBeCloseTo(finale.lineEnd, 9);
    expect(clip.audio.spaceSound).toBe(finale.spaceSound);
    expect(clip.total).toBeGreaterThanOrEqual(CLIP.minSec - 1e-9);
    expect(clip.total).toBeLessThanOrEqual(CLIP.maxSec + 1e-9);
  }
});

// R1i Fix round 1（レビュー Minor 2）: 小の衝撃波の輪は半球と同じく控えめ。輪の走る遠さ（宇宙の地表の角度 uRing）は中の 0.45 倍以下。
// 最大の輪は前のまま（SPACE_LOOK.max.ring = 1）
test('R1i fix1: 小の衝撃波の輪は小さく（中の輪の半分より小さく）、最大の輪は前のまま', () => {
  const ringReach = (amount) => {
    const shot = shotOf(amount);
    const cin = makeCinematic({ w: 390, h: 844 }, shot);
    const tl = cin.timeline;
    let reach = 0;
    for (let t = tl.chaseEnd; t < tl.flatten; t += 1 / 60) {
      const v = cin.spaceShot(t, { shot, timeline: tl });
      const earth = v.scene.children.find((o) => o.isMesh && o.material.uniforms?.uRing);
      if (earth.material.uniforms.uRingI.value > 0.01) reach = Math.max(reach, earth.material.uniforms.uRing.value);
    }
    return reach;
  };
  const small = ringReach(30), normal = ringReach(75);
  expect(small).toBeGreaterThan(0);
  expect(small).toBeLessThan(0.45 * normal);
  expect(SPACE_LOOK.max.ring).toBe(1);
});
