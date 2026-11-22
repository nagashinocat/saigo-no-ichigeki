import { test, expect } from 'vitest';
import { inDanger, isSpotted, lookoutArrow, createLookout } from '../../src/game/lookout.js';
import { findCover } from '../../src/game/cover.js';
import { screenToWorld } from '../../src/input/controls.js';
import { screenBearingDeg } from '../../src/ui/stickMarks.js';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// R1e（持ち主 16:55「見つかりそうなときに隠れられそうな向きに矢印とLOOK OUT!みたいなのをポップな字で出したら良いかも」）:
// まだ見つかっていない・隠れられる（掴まれていない・待ち時間でない）ときに、軍勢のライトがもうすぐ主人公に届きそうなら「LOOK OUT!」と、
// シュッで入れる物陰の向きの矢印。「もうすぐ届く」は、ライトの届く長さの約 1.4 倍の内でライトの角より少し広い扇の内（見通しあり）、
// または約 0.6 秒後のその者の位置からライトに入る。見つかった・隠れた・危なくなくなったら消える（最低 0.4 秒は出し、少しのヒステリシス）
const E = CONFIG.enemy, L = CONFIG.lookout;
const H = { x: 0, z: 0 };
// 主人公から向き ang（rad、世界）に d m 離れて、主人公の方（から off rad ずれた向き）を向いて進む探す者
function rider(d, { ang = Math.PI, off = 0, speed = 0, state = 'search' } = {}) {
  const x = H.x + Math.cos(ang) * d, z = H.z + Math.sin(ang) * d;
  return { id: 1, state, x, z, heading: Math.atan2(H.z - z, H.x - x) + off, speed };
}

test('R1e: LOOK OUT! の値は config にある（約 1.4 倍・約 0.6 秒・最低 0.4 秒・数回/秒）', () => {
  expect(L.nearK).toBeCloseTo(1.4, 6);
  expect(L.predictSec).toBeCloseTo(0.6, 6);
  expect(L.minShowSec).toBeCloseTo(0.4, 6);
  expect(L.angleK).toBeGreaterThan(1);
  expect(L.angleK).toBeLessThan(1.5);
  expect(L.holdK).toBeGreaterThan(1);
  expect(1 / L.checkEvery).toBeLessThanOrEqual(10);
});

test('R1e: もうすぐ届く: ライトの届く長さの 1.4 倍のしきいの両側（止まっている者）', () => {
  const R = E.spotDist * L.nearK;
  expect(inDanger(rider(R - 0.1), H, [])).toBe(true);
  expect(inDanger(rider(R + 0.1), H, [])).toBe(false);
  expect(inDanger(rider(E.spotDist - 1), H, [])).toBe(true); // もうライトの中（次の見る瞬間に見つかる）
});

test('R1e: もうすぐ届く: 少し広い扇（ライトの半分の角 × angleK）のしきいの両側。後ろ向きは届かない', () => {
  const A = E.spotHalfAngle * L.angleK, d = E.spotDist * 1.2;
  expect(inDanger(rider(d, { off: A - 0.01 }), H, [])).toBe(true);
  expect(inDanger(rider(d, { off: A + 0.01 }), H, [])).toBe(false);
  expect(inDanger(rider(d, { off: -(A - 0.01) }), H, [])).toBe(true);
  expect(inDanger(rider(10, { off: Math.PI }), H, [])).toBe(false);
});

test('R1e: もうすぐ届く: 0.6 秒後の位置からライトに入る（速い者は 1.4 倍より遠くても）。しきいの両側', () => {
  const v = 30, ahead = v * L.predictSec;
  expect(E.spotDist + ahead).toBeGreaterThan(E.spotDist * L.nearK); // 1.4 倍の外の話
  expect(inDanger(rider(E.spotDist + ahead - 0.5, { speed: v }), H, [])).toBe(true);
  expect(inDanger(rider(E.spotDist + ahead + 0.5, { speed: v }), H, [])).toBe(false);
});

test('R1e: もうすぐ届く: 建物にさえぎられていれば届かない', () => {
  const wall = [{ x: -20, z: 0, w: 4, d: 30 }];
  expect(inDanger(rider(E.spotDist * 1.2), H, wall)).toBe(false);
  expect(inDanger(rider(E.spotDist * 1.2), H, [])).toBe(true);
});

test('R1e: 見つかっている = 追う・近づく・よろめく・掴む・群がる者がいる', () => {
  expect(isSpotted([{ state: 'search' }, { state: 'dead' }])).toBe(false);
  for (const s of ['chase', 'approach', 'stagger', 'grab', 'cling']) expect(isSpotted([{ state: 'search' }, { state: s }])).toBe(true);
});

const DT = 1 / 30;
const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 }, kinds: {} } };
function scene() {
  const g = createGame({ seed: 1, cfg: quiet });
  g.begin(); g.pressStart();
  for (let t = 0; t < 1; t += DT) g.update(DT);
  return g;
}
// 街の中で、主人公の方を向いてライトが届きそうな探す者（見通しのある向きを探す）
function threatFor(g) {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI, d = E.spotDist * 1.2;
    const e = { id: 77, state: 'search', x: g.hero.x + Math.cos(a) * d, z: g.hero.z + Math.sin(a) * d, speed: 0 };
    e.heading = Math.atan2(g.hero.z - e.z, g.hero.x - e.x);
    if (inDanger(e, g.hero, g.city.buildings)) return e;
  }
  return null;
}
const st = (g, extra = {}) => ({ hero: g.hero, enemies: g.enemies.list, buildings: g.city.buildings, hideBlock: g.hideBlock, azimuthDeg: 0, ...extra });

test('R1e: 危ないときに出る。掴まれている・待ち時間・もう見つかっている・隠れている・溜めていないときは出ない', () => {
  const g = scene();
  const e = threatFor(g);
  expect(e).not.toBe(null);
  g.enemies.list.push(e);
  const run = (extra) => { const lo = createLookout(); let s; for (let i = 0; i < 10; i++) s = lo.update(DT, st(g, extra)); return s.show; };
  expect(run({})).toBe(true);
  expect(run({ hideBlock: 'grabbed' })).toBe(false);
  expect(run({ hideBlock: 'cooldown' })).toBe(false);
  expect(run({ hideBlock: 'off' })).toBe(false);
  expect(run({ hero: { ...g.hero, hidden: true } })).toBe(false);
  expect(run({ enemies: [...g.enemies.list, { state: 'chase', x: 500, z: 500 }] })).toBe(false);
  expect(run({ enemies: [] })).toBe(false); // 危なくない
});

test('R1e: 矢印は、シュッでその物陰へ入る向き（矢印の向きに払うと M2 の hide が選ぶ物陰の向きと 15° の内で合う）', () => {
  let checked = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = createGame({ seed, cfg: quiet });
    g.begin(); g.pressStart();
    for (let t = 0; t < 1; t += DT) g.update(DT);
    for (const [ox, oz] of [[0, 0], [8, -5], [-6, 9]]) {
      const hero = { ...g.hero, x: g.hero.x + ox, z: g.hero.z + oz };
      for (const az of [0, 40]) {
        const a = lookoutArrow(hero, g.city.buildings, [], az);
        if (!a) continue;
        const s = (a.deg * Math.PI) / 180;
        const w = screenToWorld(Math.cos(s), Math.sin(s), az);
        const spot = findCover(hero, { x: w.x, z: w.z }, g.city.buildings, [], CONFIG);
        expect(spot).not.toBe(null);
        const b = screenBearingDeg(spot.x - hero.x, spot.z - hero.z, az);
        expect(Math.abs(((b - a.deg + 540) % 360) - 180)).toBeLessThanOrEqual(15);
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(10);
});

test('R1e: 矢印は、ライトがもうすぐ届く者のライトが届かない物陰（安全）があれば、そちらを選ぶ（ライトの方へ向かわせない）', () => {
  let seen = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = createGame({ seed, cfg: quiet });
    g.begin(); g.pressStart();
    for (let t = 0; t < 1; t += DT) g.update(DT);
    const e = threatFor(g);
    if (!e) continue;
    let any = false;
    for (let k = 0; k < L.dirs; k++) {
      const r = (k / L.dirs) * 2 * Math.PI, w = screenToWorld(Math.cos(r), Math.sin(r), 0);
      const p = findCover(g.hero, w, g.city.buildings, [], CONFIG);
      if (p && !inDanger(e, p, g.city.buildings, CONFIG, L.holdK)) any = true;
    }
    const a = lookoutArrow(g.hero, g.city.buildings, [], 0, [e]);
    if (!any || !a) continue;
    expect(a.safe).toBe(true);
    expect(inDanger(e, a.spot, g.city.buildings, CONFIG, L.holdK)).toBe(false);
    seen++;
  }
  expect(seen).toBeGreaterThan(0);
});

test('R1e: 最低 0.4 秒は出す。危なくなくなってもすぐには消えず、少しのヒステリシス（出ている間は 1.4 倍 × holdK まで出し続ける）', () => {
  const lo = createLookout();
  const base = { hero: H, buildings: [], hideBlock: null, azimuthDeg: 0 };
  const near = rider(E.spotDist * L.nearK - 1);
  // 一度だけ危ない → 0.4 秒は出たまま、それを過ぎて危なくなければ消える
  let s = lo.update(DT, { ...base, enemies: [near] });
  expect(s.show).toBe(true);
  let t = DT;
  while (t < L.minShowSec - 2 * DT) { s = lo.update(DT, { ...base, enemies: [] }); t += DT; expect(s.show).toBe(true); }
  for (let i = 0; i < Math.ceil((L.checkEvery + 0.1) / DT) + 4; i++) s = lo.update(DT, { ...base, enemies: [] });
  expect(s.show).toBe(false);
  // ヒステリシス: 出る前は 1.4 倍の少し外では出ない。出ている間は 1.4 倍の少し外（holdK の内）でも出し続ける
  const lo2 = createLookout();
  const edge = rider(E.spotDist * L.nearK * (1 + (L.holdK - 1) / 2));
  for (let i = 0; i < 20; i++) s = lo2.update(DT, { ...base, enemies: [edge] });
  expect(s.show).toBe(false);
  for (let i = 0; i < Math.ceil(L.checkEvery / DT) + 1; i++) s = lo2.update(DT, { ...base, enemies: [near] }); // 次の確かめまで
  expect(s.show).toBe(true);
  for (let i = 0; i < 40; i++) s = lo2.update(DT, { ...base, enemies: [edge] });
  expect(s.show).toBe(true);
  const gone = rider(E.spotDist * L.nearK * L.holdK + 1);
  for (let i = 0; i < 40; i++) s = lo2.update(DT, { ...base, enemies: [gone] });
  expect(s.show).toBe(false);
});

test('R1e: 見つかった・隠れたら、0.4 秒を待たずにすぐ消える', () => {
  const lo = createLookout();
  const base = { hero: H, buildings: [], hideBlock: null, azimuthDeg: 0 };
  expect(lo.update(DT, { ...base, enemies: [rider(30)] }).show).toBe(true);
  expect(lo.update(DT, { ...base, enemies: [rider(30, { state: 'chase' })] }).show).toBe(false);
  expect(lo.update(DT, { ...base, enemies: [rider(30)] }).show).toBe(true);
  expect(lo.update(DT, { ...base, hero: { ...H, hidden: true }, enemies: [rider(30)] }).show).toBe(false);
  expect(lo.update(DT, { ...base, enemies: [rider(30)] }).show).toBe(true);
  expect(lo.update(DT, { ...base, hideBlock: 'cooldown', enemies: [rider(30)] }).show).toBe(false);
});

test('R1e: 確かめるのは数回/秒（checkEvery 秒ごと）。その間のフレームは前の答えを使う', () => {
  const lo = createLookout();
  const base = { hero: H, buildings: [], hideBlock: null, azimuthDeg: 0 };
  for (let i = 0; i < 30; i++) lo.update(DT, { ...base, enemies: [rider(30)] });
  // 1 秒のうち、危ないかの確かめは 1 / checkEvery 回ほど（見つかったかの軽い確かめは毎フレーム、別に数える）
  expect(lo.checks).toBeLessThanOrEqual(Math.ceil(1 / L.checkEvery) + 1);
  expect(lo.checks).toBeGreaterThanOrEqual(Math.floor(1 / L.checkEvery) - 1);
});

// R1e fix1（見直し: 矢印が 0.2 秒古くなる）: 選んだ物陰は checkEvery ごとに選び直すが、矢印の角は毎フレーム、今の主人公の所から
// その物陰へ向け直す。主人公が動いても、矢印の向きに払えば（M2 の hide と同じ探し方で）15° の内の物陰へ入る
test('R1e fix1: 主人公が動いても、矢印は毎フレームその物陰の方へ向き直り、矢印の向きのシュッで 15° の内の物陰へ入る', () => {
  let frames = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = createGame({ seed, cfg: quiet });
    g.begin(); g.pressStart();
    for (let t = 0; t < 1; t += DT) g.update(DT);
    const e = threatFor(g);
    if (!e) continue;
    const lo = createLookout();
    const hero = { ...g.hero };
    let s = lo.update(DT, { hero, enemies: [e], buildings: g.city.buildings, hideBlock: null, azimuthDeg: 0 });
    if (!s.show || s.deg == null) continue;
    const spot = s.spot;
    // 次の確かめまでの間（checkEvery 秒）、主人公は 28 m/s で物陰と直角の向きへ動く
    const away = Math.atan2(spot.z - hero.z, spot.x - hero.x) + Math.PI / 2;
    for (let i = 0; i < Math.floor(L.checkEvery / DT) - 1; i++) {
      hero.x += Math.cos(away) * 28 * DT; hero.z += Math.sin(away) * 28 * DT;
      s = lo.update(DT, { hero, enemies: [e], buildings: g.city.buildings, hideBlock: null, azimuthDeg: 0 });
      expect(s.show).toBe(true);
      const want = screenBearingDeg(s.spot.x - hero.x, s.spot.z - hero.z, 0);
      expect(Math.abs(((s.deg - want + 540) % 360) - 180)).toBeLessThan(1e-6); // 今の主人公から物陰へ
      const r = (s.deg * Math.PI) / 180, w = screenToWorld(Math.cos(r), Math.sin(r), 0);
      const p = findCover(hero, w, g.city.buildings, [], CONFIG);
      expect(p).not.toBe(null);
      const b = screenBearingDeg(p.x - hero.x, p.z - hero.z, 0);
      expect(Math.abs(((b - s.deg + 540) % 360) - 180)).toBeLessThanOrEqual(15);
      frames++;
    }
  }
  expect(frames).toBeGreaterThan(5);
});
