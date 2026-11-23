import { test, expect } from 'vitest';
import { inDanger, isSpotted, lookoutArrow, createLookout } from '../../src/game/lookout.js';
import { findCover } from '../../src/game/cover.js';
import { screenToWorld } from '../../src/input/controls.js';
import { screenBearingDeg } from '../../src/ui/stickMarks.js';
import { createGame } from '../../src/game/game.js';
import { seesHero, roadNode } from '../../src/game/enemies.js';
import { CONFIG } from '../../src/config.js';

// R1e（持ち主 16:55「見つかりそうなときに隠れられそうな向きに矢印とLOOK OUT!みたいなのをポップな字で出したら良いかも」）:
// まだ見つかっていない・隠れられる（掴まれていない・待ち時間でない）ときに、軍勢のライトがもうすぐ主人公に届きそうなら「LOOK OUT!」と、
// シュッで入れる物陰の向きの矢印。「もうすぐ届く」は、ライトの届く長さの nearK 倍の内でライトの角より少し広い扇の内（見通しあり）、
// または predictSec 秒の内の道すじの上からライトに入る。隠れた・危なくなくなったら消える（最低 minShowSec 秒は出し、少しのヒステリシス）。
// 持ち主 10:02: 早め・長め（1.8 倍・扇 × 1.4・1.2 秒・最低 1.0 秒）にし、見つかった直後も graceSec 秒は押せる矢印を出す
const E = CONFIG.enemy, L = CONFIG.lookout;
const H = { x: 0, z: 0 };
// 主人公から向き ang（rad、世界）に d m 離れて、主人公の方（から off rad ずれた向き）を向いて進む探す者
function rider(d, { ang = Math.PI, off = 0, speed = 0, state = 'search' } = {}) {
  const x = H.x + Math.cos(ang) * d, z = H.z + Math.sin(ang) * d;
  return { id: 1, state, x, z, heading: Math.atan2(H.z - z, H.x - x) + off, speed };
}

// 持ち主 10:02（「隠れるの矢印を押すタイミングがない」）: 早めに（約 1.8 倍・扇 × 約 1.4・約 1.2 秒の先読み）、長く（最低約 1.0 秒）、
// 確かめは 0.1 秒ごと、見つかった直後も約 0.8 秒は押せる
test('持ち主 10:02: LOOK OUT! の値は config にある（約 1.8 倍・扇 × 約 1.4・約 1.2 秒・最低約 1.0 秒・0.1 秒ごと・見つかった直後の猶予 約 0.8 秒）', () => {
  expect(L.nearK).toBeCloseTo(1.8, 6);
  expect(L.angleK).toBeCloseTo(1.4, 6);
  expect(L.predictSec).toBeCloseTo(1.2, 6);
  expect(L.minShowSec).toBeCloseTo(1.0, 6);
  expect(L.checkEvery).toBeCloseTo(0.1, 6);
  expect(L.graceSec).toBeCloseTo(0.8, 6);
  expect(L.holdK).toBeGreaterThan(1);
});

test('R1e: もうすぐ届く: ライトの届く長さの nearK 倍のしきいの両側（止まっている者）', () => {
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

test('R1e: もうすぐ届く: predictSec 秒の内の位置からライトに入る（速い者は nearK 倍より遠くても）。しきいの両側', () => {
  const v = 30, ahead = v * L.predictSec;
  expect(E.spotDist + ahead).toBeGreaterThan(E.spotDist * L.nearK); // nearK 倍の外の話
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

test('R1e / Fix round 1: 危ないときに出る。掴まれている・もう見つかっている・隠れている・溜めていないときは出ない（待ち時間は字だけ出る）', () => {
  const g = scene();
  const e = threatFor(g);
  expect(e).not.toBe(null);
  g.enemies.list.push(e);
  // 持ち主 10:02: もう見つかっているときは、見つかった直後の猶予（graceSec）を過ぎれば出ない（猶予の間は下の別のテスト）
  const run = (extra, sec = 10 * DT) => { const lo = createLookout(); let s; for (let i = 0; i < Math.ceil(sec / DT); i++) s = lo.update(DT, st(g, extra)); return s.show; };
  expect(run({})).toBe(true);
  expect(run({ hideBlock: 'grabbed' })).toBe(false);
  // Fix round 1（まとめ役の裁定）: 待ち時間（隠れるの待ち・払ったあとの休み）の間も、字だけの LOOK OUT! は出す（矢印なし）。下の別のテスト
  expect(run({ hideBlock: 'cooldown' })).toBe(true);
  expect(run({ hideBlock: 'off' })).toBe(false);
  expect(run({ hero: { ...g.hero, hidden: true } })).toBe(false);
  expect(run({ enemies: [...g.enemies.list, { state: 'chase', x: 500, z: 500 }] }, L.graceSec + 0.2)).toBe(false);
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

test('R1e / 持ち主 10:02: 最低 minShowSec（1.0 秒）は出す。危なくなくなってもすぐには消えず、少しのヒステリシス（出ている間は nearK 倍 × holdK まで出し続ける）', () => {
  const lo = createLookout();
  const base = { hero: H, buildings: [], hideBlock: null, azimuthDeg: 0 };
  const near = rider(E.spotDist * L.nearK - 1);
  // 一度だけ危ない → minShowSec 秒は出たまま、それを過ぎて危なくなければ消える
  let s = lo.update(DT, { ...base, enemies: [near] });
  expect(s.show).toBe(true);
  let t = DT;
  while (t < L.minShowSec - 2 * DT) { s = lo.update(DT, { ...base, enemies: [] }); t += DT; expect(s.show).toBe(true); }
  for (let i = 0; i < Math.ceil((L.checkEvery + 0.1) / DT) + 4; i++) s = lo.update(DT, { ...base, enemies: [] });
  expect(s.show).toBe(false);
  // ヒステリシス: 出る前は nearK 倍の少し外では出ない。出ている間は nearK 倍の少し外（holdK の内）でも出し続ける
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

test('R1e / Fix round 1: 見つかった（押せる物陰がない）・隠れたなら、minShowSec を待たずにすぐ消える。待ち時間なら矢印だけ消える', () => {
  const lo = createLookout();
  const base = { hero: H, buildings: [], hideBlock: null, azimuthDeg: 0 };
  expect(lo.update(DT, { ...base, enemies: [rider(30)] }).show).toBe(true);
  expect(lo.update(DT, { ...base, enemies: [rider(30, { state: 'chase' })] }).show).toBe(false);
  expect(lo.update(DT, { ...base, enemies: [rider(30)] }).show).toBe(true);
  expect(lo.update(DT, { ...base, hero: { ...H, hidden: true }, enemies: [rider(30)] }).show).toBe(false);
  expect(lo.update(DT, { ...base, enemies: [rider(30)] }).show).toBe(true);
  // Fix round 1: 待ち時間の間は、字だけ出したまま矢印を消す
  const cd = lo.update(DT, { ...base, hideBlock: 'cooldown', enemies: [rider(30)] });
  expect(cd.show).toBe(true);
  expect(cd.deg).toBe(null);
  expect(cd.spot).toBe(null);
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

// ---- 持ち主 10:02（「隠れるの矢印を押すタイミングがない」）----
// 前は、見つかる 0.3〜0.5 秒前に出て、見つかった瞬間に消えていた（今日の街 60 で、その前 1.5 秒見つかっていなかった回の p50 0.60 秒。
// scripts/lookout-lead.mjs）。早めに知らせ（約 1.0 秒以上前）、出ている時間を長くし、見つかった直後も graceSec 秒は押せる

// 何もない所をまっすぐ走ってくる者（主人公は止まっている）: 最初に LOOK OUT! が出た時刻から、ライトに入る（見つかりうる最初の）時刻まで
function approachLead({ lateral = 0, speed = E.searchSpeed, start = 140, cfg = CONFIG } = {}) {
  const dt = 1 / 60, lo = createLookout(cfg);
  const e = { id: 5, state: 'search', x: start, z: lateral, heading: Math.PI, speed };
  let t = 0, shownAt = null;
  for (; e.x > -start; t += dt) {
    const s = lo.update(dt, { hero: H, enemies: [e], buildings: [], hideBlock: null, azimuthDeg: 0 });
    if (s.show && shownAt == null) shownAt = t;
    if (!s.show) shownAt = null; // 出続けていた分だけ数える
    if (seesHero(e, H, [], cfg)) return shownAt == null ? 0 : t - shownAt;
    e.x -= speed * dt;
  }
  return null; // ライトに入らない（横に離れすぎ）
}

test('持ち主 10:02: まっすぐ走ってくる探す者（正面・横に 8 / 16 m・重い者の速さ）には、ライトに入る 1.0 秒以上前から LOOK OUT! が出続ける', () => {
  const cases = [{}, { lateral: 8 }, { lateral: -16 }, { speed: E.searchSpeed * E.kinds.heavy.speedMul }, { lateral: 16, speed: E.patrol.speed }];
  for (const c of cases) {
    const lead = approachLead(c);
    expect(lead, JSON.stringify(c)).not.toBe(null);
    expect(lead, JSON.stringify(c)).toBeGreaterThanOrEqual(1.0);
  }
});

test('持ち主 10:02: 角を曲がってくる者（道を走り、次の交差点で主人公の方へ曲がる）にも、ライトに入る前に先に知らせる', () => {
  // 主人公は x = 0 の道の上。探す者は z = -P·k の横の道を +x へ走ってきて、x = 0 の交差点で +z（主人公の方）へ曲がる。
  // 角のビルが見通しをさえぎる（曲がるまで主人公は見えない）
  const node = roadNode(0, -2), cx = node[0], cz = node[1];
  const Hc = { x: cx, z: cz + 30 };
  const wall = [{ x: cx - 13, z: cz + 13, w: 18, d: 18 }]; // 角のビル（交差点の -x・+z の角）
  const e = { id: 9, state: 'search', x: cx - 60, z: cz, heading: 0, speed: E.searchSpeed, ni: 0, nj: -2, di: 1, dj: 0, lane: [0, 0] };
  expect(seesHero(e, Hc, wall, CONFIG)).toBe(false);
  // 曲がる 1.0 秒前（交差点まで 30 m）、まっすぐ先だけの先読みでは届かないが、曲がる道すじの先読みで届く
  const at = { ...e, x: cx - E.searchSpeed * 1.0 };
  expect(seesHero({ ...at, x: cx, z: cz + 2, heading: Math.PI / 2 }, Hc, wall, CONFIG) || seesHero({ ...at, x: cx, z: cz + 6, heading: Math.PI / 2 }, Hc, wall, CONFIG)).toBe(true);
  expect(inDanger(at, Hc, wall)).toBe(true);
  const noRoad = { ...at }; delete noRoad.ni; delete noRoad.nj; delete noRoad.di; delete noRoad.dj;
  expect(inDanger(noRoad, Hc, wall)).toBe(false); // 道を知らなければ（まっすぐ先だけ）知らせられない
});

test('持ち主 10:02: LOOK OUT! は一度出たら最低 minShowSec（約 1.0 秒）出ている', () => {
  const lo = createLookout();
  const base = { hero: H, buildings: [], hideBlock: null, azimuthDeg: 0 };
  expect(lo.update(DT, { ...base, enemies: [rider(E.spotDist * 1.2)] }).show).toBe(true);
  let t = DT, s;
  for (; t < 1.0 - DT / 2; t += DT) { s = lo.update(DT, { ...base, enemies: [] }); expect(s.show, `t=${t.toFixed(2)}`).toBe(true); }
});

// 見つかった直後の猶予: 街の中で、主人公の見える所から追ってくる者（chase）を置く
function spottedScene(seed) {
  const g = createGame({ seed, cfg: quiet });
  g.begin(); g.pressStart();
  for (let t = 0; t < 1; t += DT) g.update(DT);
  const e = threatFor(g);
  if (!e) return null;
  e.state = 'chase'; e.speed = 0;
  return { g, e };
}

test('持ち主 10:02: 見つかった直後の猶予（graceSec）の間は矢印が出て、押せば隠れる（追う者は見失い、最後に見た所を探す）', () => {
  let hid = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sc = spottedScene(seed);
    if (!sc) continue;
    const { g, e } = sc;
    const lo = createLookout();
    // 見つかる前（探す者がいない）→ 見つかった
    lo.update(DT, st(g, { enemies: [] }));
    g.enemies.list.push(e);
    let s = lo.update(DT, st(g));
    if (!s.show) { expect(s.spot).toBe(null); continue; } // 追う者から見えない物陰がない場所（押せる矢印がないので出さない）
    for (let t = DT; t < L.graceSec - 0.15; t += DT) {
      s = lo.update(DT, st(g));
      expect(s.show, `seed ${seed} t=${t.toFixed(2)}`).toBe(true);
      expect(s.grace).toBe(true);
      expect(s.spot).not.toBe(null);
      expect(s.deg).not.toBe(null);
    }
    const from = { x: g.hero.x, z: g.hero.z };
    expect(g.hideBlock).toBe(null);
    expect(g.hideToward(s.spot)).toBe(true);
    expect(g.hero.hidden).toBe(true);
    expect(e.state).toBe('search'); // 見失った
    expect(e.heard.x).toBeCloseTo(from.x, 6); // 最後に見た所を探す
    expect(e.heard.z).toBeCloseTo(from.z, 6);
    expect(lo.update(DT, st(g)).show).toBe(false); // 隠れたら消える
    hid++;
  }
  expect(hid).toBeGreaterThanOrEqual(3);
});

test('持ち主 10:02: 猶予を過ぎたら矢印は消える（見つかったまま）。見失われてまた見つかれば、また猶予', () => {
  let seen = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sc = spottedScene(seed);
    if (!sc) continue;
    const { g, e } = sc;
    const lo = createLookout();
    lo.update(DT, st(g, { enemies: [] }));
    let s, t = 0;
    for (; t < L.graceSec - DT / 2; t += DT) s = lo.update(DT, st(g, { enemies: [e] }));
    if (!s.show) continue; // 押せる物陰がない街の場所
    for (let i = 0; i < 3; i++) { s = lo.update(DT, st(g, { enemies: [e] })); t += DT; }
    expect(t).toBeGreaterThan(L.graceSec);
    expect(s.show).toBe(false);
    for (let i = 0; i < 60; i++) expect(lo.update(DT, st(g, { enemies: [e] })).show).toBe(false); // 見つかったままなら出ない
    // 見失われた（見つかっていない）→ また見つかった: また猶予
    lo.update(DT, st(g, { enemies: [] }));
    expect(lo.update(DT, st(g, { enemies: [e] })).show).toBe(true);
    seen++;
  }
  expect(seen).toBeGreaterThanOrEqual(3);
});

test('持ち主 10:02: 掴まれている主人公には（見つかった直後の猶予でも）矢印は出ない。待ち時間・隠れている間も出ない', () => {
  let n = 0;
  for (const seed of [1, 2, 3, 4]) {
    const sc = spottedScene(seed);
    if (!sc) continue;
    const { g, e } = sc;
    const grab = { id: 88, state: 'grab', x: g.hero.x + 1, z: g.hero.z };
    for (const extra of [{ hideBlock: 'grabbed' }, { enemies: [e, grab] }, { enemies: [e, { ...grab, state: 'cling' }] }, { hideBlock: 'cooldown' }, { hero: { ...g.hero, hidden: true } }]) {
      const lo = createLookout();
      lo.update(DT, st(g, { enemies: [] }));
      for (let t = 0; t < L.graceSec; t += DT) expect(lo.update(DT, st(g, { enemies: [e], ...extra })).show, JSON.stringify(Object.keys(extra))).toBe(false);
    }
    // 猶予の途中で掴まれたら、すぐ消える
    const lo = createLookout();
    lo.update(DT, st(g, { enemies: [] }));
    const s0 = lo.update(DT, st(g, { enemies: [e] }));
    if (s0.show) { expect(lo.update(DT, st(g, { enemies: [e, grab], hideBlock: 'grabbed' })).show).toBe(false); n++; }
  }
  expect(n).toBeGreaterThanOrEqual(2);
});

test('持ち主 10:02: 猶予の矢印も、その向きに払えば（追う者から見えない物陰を探す M2 の hide と同じ探し方で）15° の内の物陰へ入る', () => {
  let checked = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const sc = spottedScene(seed);
    if (!sc) continue;
    const { g, e } = sc;
    for (const az of [0, 40]) {
      const lo = createLookout();
      lo.update(DT, st(g, { enemies: [], azimuthDeg: az }));
      const s = lo.update(DT, st(g, { enemies: [e], azimuthDeg: az }));
      if (!s.show || s.deg == null) continue;
      const r = (s.deg * Math.PI) / 180, w = screenToWorld(Math.cos(r), Math.sin(r), az);
      const p = findCover(g.hero, w, g.city.buildings, [e], CONFIG);
      expect(p).not.toBe(null);
      const b = screenBearingDeg(p.x - g.hero.x, p.z - g.hero.z, az);
      expect(Math.abs(((b - s.deg + 540) % 360) - 180)).toBeLessThanOrEqual(15);
      checked++;
    }
  }
  expect(checked).toBeGreaterThanOrEqual(4);
});

// Fix round 1（まとめ役の裁定、持ち主 10:02「隠れるの矢印を押すタイミングがない」）: 隠れられない待ち時間（hideBlock: cooldown。隠れたあと・
// 払ったあと）の間も、ライトがもうすぐ届くなら「LOOK OUT!」を字だけで出す（矢印・当たりなし。タップは払うのまま）。待ち時間が明ければ矢印も出る
test('Fix round 1: 待ち時間の間は LOOK OUT! を字だけで出し（deg・spot なし）、明けたら矢印も出す。見つかった後・掴まれ・隠れ中は出さない', () => {
  const g = scene();
  const e = threatFor(g);
  expect(e).not.toBe(null);
  const lo = createLookout();
  let s;
  for (let i = 0; i < 6; i++) s = lo.update(DT, st(g, { enemies: [e], hideBlock: 'cooldown' }));
  expect(s.show).toBe(true);
  expect(s.deg).toBe(null);
  expect(s.spot).toBe(null);
  // 待ち時間が明けた: 次の確かめで矢印が出る
  for (let i = 0; i < Math.ceil(L.checkEvery / DT) + 1; i++) s = lo.update(DT, st(g, { enemies: [e] }));
  expect(s.show).toBe(true);
  expect(s.spot).not.toBe(null);
  // また待ち時間に入ったら、その場で矢印だけ消える
  s = lo.update(DT, st(g, { enemies: [e], hideBlock: 'cooldown' }));
  expect(s.show).toBe(true);
  expect(s.spot).toBe(null);
  // 掴まれ・隠れ中・溜めていない（off）は出さない
  for (const extra of [{ hideBlock: 'grabbed' }, { hideBlock: 'off' }, { hideBlock: 'cooldown', hero: { ...g.hero, hidden: true } }, { hideBlock: 'cooldown', enemies: [e, { id: 5, state: 'grab', x: g.hero.x + 1, z: g.hero.z }] }]) {
    const l2 = createLookout();
    let s2;
    for (let i = 0; i < 6; i++) s2 = l2.update(DT, st(g, { enemies: [e], ...extra }));
    expect(s2.show, JSON.stringify(Object.keys(extra))).toBe(false);
  }
});

// Fix round 1（見直し Important 8「終盤ほど重い」）: 一番重いのは矢印の物陰探し（lookoutArrow: 8 向き × 2 回の findCover）。
// 危ないかは checkEvery 秒ごとに確かめるが、物陰は出し始めにすぐ選び、そのあとは arrowEvery 秒ごとに選び直す（矢印の角は毎フレーム今の主人公から）
test('Fix round 1: 物陰を選び直すのは arrowEvery 秒ごと（危ないかの確かめより少ない）。出し始めはすぐ', () => {
  expect(L.arrowEvery).toBeGreaterThan(L.checkEvery);
  expect(L.arrowEvery).toBeLessThanOrEqual(0.4);
  const g = scene();
  const e = threatFor(g);
  const lo = createLookout();
  let s = lo.update(DT, st(g, { enemies: [e] }));
  expect(s.spot).not.toBe(null); // 出し始めはすぐ
  expect(lo.arrowPicks).toBe(1);
  for (let t = 0; t < 1 - 1e-9; t += DT) s = lo.update(DT, st(g, { enemies: [e] }));
  expect(lo.arrowPicks).toBeLessThanOrEqual(Math.ceil(1 / L.arrowEvery) + 1);
  expect(lo.checks).toBeGreaterThan(lo.arrowPicks);
});
