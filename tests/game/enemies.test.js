import { test, expect } from 'vitest';
import { maxEnemyReach, patrolBand } from '../../src/game/enemies.js';
import { radiusFor } from '../../src/game/charge.js';
import { createGame } from '../../src/game/game.js';
import { createEnemies, spawnRateAt, approachSpeed, lineOfSight, roadNode, swarmRing } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
import { prePass2, PRE_PASS2_ENEMY } from './prePass2.js';
import { CONFIG } from '../../src/config.js';
import { generateCity, GRID } from '../../src/world/cityGen.js';

const E = CONFIG.enemy;
const cfgWith = (enemy) => ({ ...CONFIG, enemy: { ...E, ...enemy } });
const P = GRID.PITCH;
// 道路の中心線からのずれ（縦・横の近いほう）
const offRoad = (x, z) => {
  const off = (v) => Math.abs(v - (Math.round(v / P - 0.5) + 0.5) * P);
  return Math.min(off(x), off(z));
};
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

test('軍勢は spawnPerSec で、spawnDist ほどの距離の道路の上に湧き、探す（search）', () => {
  const e = createEnemies(createRng(1), cfgWith({ spawnPerSec: 1.2, surgeMul: 1, searchSpeed: 0, alertRate: 0 }));
  e.update(10); // 約12体
  expect(e.list.length).toBe(12);
  expect(new Set(e.list.map((x) => x.id)).size).toBe(12);
  for (const x of e.list) {
    expect(x.state).toBe('search');
    expect(offRoad(x.x, x.z)).toBeLessThanOrEqual(E.laneSpread + 1e-9);
    expect(x.dist).toBeGreaterThanOrEqual(E.spawnDist[0] - P / 2);
    expect(x.dist).toBeLessThanOrEqual(E.spawnDist[1] + P / 2);
    expect(x.dist).toBeCloseTo(Math.hypot(x.x, x.z), 9);
    expect(x.angle).toBeCloseTo(Math.atan2(x.z, x.x), 9);
  }
});

test('探す: 道路に沿って searchSpeed で飛び、交差点で曲がる（建物の間の道からはみ出さない）', () => {
  const city = generateCity(7);
  // 持ち主 10:06 の釣り合いの直し（Pass 2 で序盤の湧く速さ 0.1/秒）で、40 秒に湧く者が少なく、曲がった者の割合の数が少なすぎるので、
  // ここは前の湧き方（tests/game/prePass2.js）で同じ数を見る（確かめるのは道に沿って走り、曲がること）
  const e = createEnemies(createRng(7), prePass2(), { buildings: city.buildings });
  const seen = new Map(); // id → { dx, dz }（縦にも横にも動いたか）
  let maxOff = 0, n = 0, fast = 0;
  for (let i = 0; i < 40 * 30; i++) {
    const before = new Map(e.list.map((x) => [x.id, [x.x, x.z, x.state]]));
    e.update(1 / 30);
    for (const x of e.list) {
      const b = before.get(x.id);
      if (!b || b[2] !== 'search' || x.state !== 'search') continue;
      maxOff = Math.max(maxOff, offRoad(x.x, x.z));
      const v = Math.hypot(x.x - b[0], x.z - b[1]) * 30;
      expect(v).toBeLessThanOrEqual(E.searchSpeed + 1e-6);
      n++; if (v > E.searchSpeed * 0.95) fast++;
      const s = seen.get(x.id) ?? { dx: 0, dz: 0 };
      s.dx += Math.abs(x.x - b[0]); s.dz += Math.abs(x.z - b[1]);
      seen.set(x.id, s);
    }
  }
  expect(maxOff).toBeLessThan(GRID.ROAD / 2);
  expect(fast / n).toBeGreaterThan(0.8); // ほとんどの間は全速
  // 長く探した者は、縦の道にも横の道にも入っている（交差点で曲がる）
  const turned = [...seen.values()].filter((s) => s.dx > P && s.dz > P).length;
  expect(turned).toBeGreaterThan(seen.size * 0.3);
  // 持ち主の要望（2026-11-21 10:01「群勢もっと早くして」、22:15「もっとスピード上げて」）: 探す速さは 28〜34 m/s（前は 24）
  expect(E.searchSpeed).toBeGreaterThanOrEqual(28);
  expect(E.searchSpeed).toBeLessThanOrEqual(34);
});

test('lineOfSight: 主人公までの線分が建物の足元にさえぎられるか', () => {
  const wall = { x: 20, z: 0, w: 4, d: 10, dist: 20 };
  expect(lineOfSight(40, 0, [wall])).toBe(false);
  expect(lineOfSight(40, 20, [wall])).toBe(true);
  expect(lineOfSight(10, 0, [wall])).toBe(true);  // 建物より手前
  expect(lineOfSight(40, 9, [wall])).toBe(false); // (20, 4.5) で角に当たる
  expect(lineOfSight(40, 9, [wall], 0)).toBe(false);
  expect(lineOfSight(40, 12, [wall], 0)).toBe(true);
  expect(lineOfSight(40, 12, [wall], 1)).toBe(false); // 広げると当たる
});

// 一人だけ置いて動かす（湧かない設定）
function solo(enemy, extra = {}, buildings = []) {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 0, alertRate: 0, ...extra }), { buildings });
  const x = { id: 1, state: 'search', speed: E.searchSpeed, turn: 0, searchTime: 0, lane: [0, 0], ...enemy };
  x.dist = Math.hypot(x.x, x.z); x.angle = Math.atan2(x.z, x.x);
  e.list.push(x);
  return { e, x };
}

test('見つける: spotDist の内側で建物にさえぎられずに見えたら chase。さえぎられていれば探し続ける', () => {
  const [nx] = roadNode(0, 0); // 広場のすぐ外の道（x = 13）
  // 広場のまわりの道を -z へ進む者（主人公が見える）
  const a = solo({ x: nx, z: 20, heading: -Math.PI / 2, ni: 0, nj: -1, di: 0, dj: -1 });
  for (let i = 0; i < 30 && a.x.state === 'search'; i++) a.e.update(1 / 30);
  expect(a.x.state).toBe('chase');
  expect(a.x.dist).toBeLessThanOrEqual(E.spotDist + 1e-9);
  // 同じ場所でも、間に建物があれば見つけない
  const wall = { x: 6, z: 9, w: 3, d: 3, dist: Math.hypot(6, 9) };
  const b = solo({ x: nx, z: 20, heading: -Math.PI / 2, ni: 0, nj: -1, di: 0, dj: -1 }, { searchSpeed: 0, accel: 0 }, [wall]);
  b.x.speed = 0;
  for (let i = 0; i < 30; i++) b.e.update(1 / 30);
  expect(b.x.state).toBe('search');
  // 遠ければ見えていても見つけない
  const c = solo({ x: E.spotDist + 5, z: 0.5, heading: Math.PI / 2, ni: 1, nj: 0, di: 0, dj: 1 }, { searchSpeed: 0, accel: 0 });
  c.x.speed = 0;
  for (let i = 0; i < 30; i++) c.e.update(1 / 30);
  expect(c.x.state).toBe('search');
});

test('気配を感じた者は、広場の角の交差点で引き返さず、広場を囲む道を回る（そこで主人公を見つける）', () => {
  const [nx, nz] = roadNode(0, 0); // 広場の角（13, 13）
  // 外から広場の角へ向かう、気配を感じた者（近づく向きしか選ばない）
  const { e, x } = solo({ x: nx, z: nz + P, heading: -Math.PI / 2, ni: 0, nj: 0, di: 0, dj: -1, alert: true });
  let t = 0;
  while (x.state === 'search' && t < 3) { e.update(1 / 60); t += 1 / 60; expect(x.dj).not.toBe(1); }
  expect(x.state).toBe('chase');
  expect(t).toBeLessThan(2);
});

test('見つける距離は、広場を囲む道（の一番外の車線）より余裕をもって外まで届く（届かないと誰も主人公を見つけられない）', () => {
  const ring = roadNode(0, 0)[0]; // 広場を囲む道の中心線までの距離（13m）
  expect(E.spotDist).toBeGreaterThan(ring + E.laneSpread + 1);
  // 広場を囲む道のいちばん外の車線を通る者も、道の真ん中あたりで見つける
  // 持ち主 10:02（ライトを約 5% 小さく。扇の半分の角 0.665 rad）: 前は z = 20 m（もう扇の内側の縁のそば。0.665 rad では扇の内に 1.4 m・0.05 秒しか
  // いない）から走り出していたのを、ライトの外（z = 34 m、主人公まで約 37 m）から車線を走って入ってくる形に。扇の内（z 約 31 → 18.6 m）を走り抜ける前に見つける
  const { e, x } = solo({ x: ring + E.laneSpread, z: 34, heading: -Math.PI / 2, ni: 0, nj: -1, di: 0, dj: -1, lane: [E.laneSpread, 0] });
  expect(Math.hypot(x.x, x.z)).toBeGreaterThan(E.spotDist); // 始めはライトの外
  for (let i = 0; i < 60 && x.state === 'search'; i++) e.update(1 / 60);
  expect(x.state).toBe('chase');
  expect(x.z).toBeGreaterThan((ring + E.laneSpread) / Math.tan(E.spotHalfAngle) - 1); // 扇の内にいる間に（走り抜ける前に）
});

test('見つけたら（R0、持ち主 22:15「まだ主人公前で止まる感じ」）: 止まる一拍（にらみ）はなく、そのまま全速で主人公へ一直線に突っ込み（離れない）、ブレーキは最後の 0.5 m ほどだけ', () => {
  expect(E.spotPause).toBeUndefined();
  expect(E.slowDist).toBeLessThanOrEqual(0.6);
  const [nx] = roadNode(0, 0);
  const { e, x } = solo({ x: nx, z: 20, heading: -Math.PI / 2, ni: 0, nj: -1, di: 0, dj: -1 });
  while (x.state === 'search') e.update(1 / 60);
  let prev = x.dist, px = x.x, pz = x.z, t = 0, top = 0;
  const speeds = [];
  while (x.state === 'chase' && t < 20) {
    e.update(1 / 60); t += 1 / 60;
    // 見つけてから掴むまで、主人公からの距離は一度も増えない（向き直る途中も、外へ向かう分は主人公のまわりを回る向きへ逃がす）
    expect(x.dist).toBeLessThanOrEqual(prev + 1e-9);
    if (x.state !== 'chase') break;
    expect(x.dist).toBeGreaterThanOrEqual(E.grabRange - 1e-9);
    top = Math.max(top, x.speed);
    // 見つけた瞬間から一度も減速しない（向き直る間も、実際に動いた速さは探す速さの 9 割以上）
    if (prev > E.grabRange + E.slowDist) {
      expect(x.speed).toBeGreaterThanOrEqual(E.searchSpeed * 0.9);
      expect(Math.hypot(x.x - px, x.z - pz) * 60).toBeGreaterThanOrEqual(E.searchSpeed * 0.9 - 1e-6);
    }
    speeds.push([prev, x.speed]);
    prev = x.dist; px = x.x; pz = x.z;
  }
  expect(x.state).toBe('grab');
  expect(x.dist).toBeLessThanOrEqual(E.grabRange + 1e-9);
  expect(t).toBeLessThan(1.5); // 13〜20 m を一気に
  // 突っ込む速さは探す速さ以上（見つけて遅くならない）
  expect(top).toBeLessThanOrEqual(E.speed + 1e-9);
  expect(E.speed).toBeGreaterThanOrEqual(E.searchSpeed);
  // 持ち主 22:15「もっとスピード上げて」: 突っ込む速さは 30〜36 m/s（前は 16〜20 m/s の 18）
  expect(E.speed).toBeGreaterThanOrEqual(30);
  expect(E.speed).toBeLessThanOrEqual(36);
  // 減速の曲線より速くない。減速しても 6 m/s より遅くならない
  for (const [d, v] of speeds) if (d < E.grabRange + E.slowDist) expect(v).toBeLessThanOrEqual(approachSpeed(d) + 1e-9);
  expect(approachSpeed(E.grabRange)).toBeGreaterThanOrEqual(6);
});

test('外を向いているときに見つけても、その場で止まらず、主人公のまわりを回りながら向き直って突っ込む（主人公からは離れない）', () => {
  // 主人公に背を向けて（+x へ）走っている者。fix1: ライトの向きによらず見えるのは chase.hearDist（9 m）の内なので、その内に置く
  // （それより遠くで背を向けていれば、最後に見た所へ向かう: spottedChase.test.js）
  expect(E.chase.hearDist).toBeGreaterThan(8.5);
  const { e, x } = solo({ x: 8.5, z: 0.5, heading: 0, ni: 0, nj: 0, di: 1, dj: 0, state: 'chase', speed: E.searchSpeed });
  let prev = x.dist, px = x.x, pz = x.z;
  for (let i = 0; i < 20 && x.state === 'chase'; i++) {
    e.update(1 / 60);
    expect(x.dist).toBeLessThanOrEqual(prev + 1e-9);
    expect(Math.hypot(x.x - px, x.z - pz) * 60).toBeGreaterThanOrEqual(6);
    prev = x.dist; px = x.x; pz = x.z;
  }
});

test('掴む枠が埋まっていても止まって待たない: あふれた者もそのまま突っ込み、掴んでいる者の外を群がって回る（cling。止まらない）。枠が空けば、いちばん先に飛びついた者がすぐ掴み、回りながら内へ入る', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 100, spawnDist: [10, 10], speed: 100, slowMin: 1, chaseAccel: 1e4 }));
  let n = 0;
  for (let i = 0; i < 20; i++) n = e.update(0.1);
  expect(n).toBe(E.maxGrabbing);
  const grab = e.list.filter((x) => x.state === 'grab');
  expect(grab.length).toBe(E.maxGrabbing);
  for (const g of grab) expect(g.dist).toBeLessThanOrEqual(E.grabRange + 1e-9);
  // 順番待ちの輪はない: 掴めなかった者は掴んでいる者のすぐ外を回る。止まって待つ者はいない
  expect(E.queueDist).toBeUndefined();
  const clingers = e.list.filter((x) => x.state === 'cling');
  expect(clingers.length).toBeGreaterThan(0);
  for (const c of clingers) {
    expect(c.dist).toBeGreaterThan(E.grabRange);
    expect(c.dist).toBeLessThanOrEqual(swarmRing(c.layer) + 1e-9);
    expect(c.grabTime).toBeGreaterThanOrEqual(0);
  }
  expect(new Set(clingers.map((c) => c.layer))).toEqual(new Set(clingers.map((_, i) => i))); // 重なる段は 0, 1, 2 …
  // 回り続ける: 掴む者も群がる者も、毎フレーム 6 m/s 以上で動いている
  const before = new Map(e.list.map((x) => [x.id, [x.x, x.z]]));
  e.update(1 / 60);
  for (const x of e.list) {
    if (x.state !== 'grab' && x.state !== 'cling') continue;
    const [bx, bz] = before.get(x.id);
    expect(Math.hypot(x.x - bx, x.z - bz) * 60).toBeGreaterThanOrEqual(6);
    expect(x.speed).toBeGreaterThanOrEqual(6);
  }
  // 掴んでいた一人が倒れると、いちばん先に飛びついた者がすぐ掴む（外へは出ない）。掴んでいる数は変わらない
  const first = e.list.find((c) => c.state === 'cling' && c.layer === 0);
  const g0 = e.list.find((x) => x.state === 'grab');
  g0.state = 'dead'; g0.deadTime = 0;
  let d0 = first.dist;
  n = e.update(1 / 60);
  expect(first.state).toBe('grab');
  expect(first.dist).toBeLessThanOrEqual(d0 + 1e-12);
  expect(n).toBe(E.maxGrabbing);
  expect(first.unpile).toBeGreaterThanOrEqual(0); // 重なりから下りる見た目のための秒
  for (let i = 0; i < 60; i++) { d0 = first.dist; e.update(1 / 60); expect(first.dist).toBeLessThanOrEqual(d0 + 1e-12); }
  expect(first.dist).toBeLessThanOrEqual(E.grabRange + 1e-9); // 1 秒で掴む者の輪へ入る
});

test('掴む者は止まらない（R0）: 主人公のまわりを回り続けながら吸う。主人公からは離れず、進む向きは回る向き、曲がる速さで内へ傾く', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 0 }));
  const g = { id: 1, angle: 0.3, dist: E.grabRange, state: 'grab', grabTime: 1 };
  e.list.push(g);
  e.update(1 / 60);
  let prev = [g.x, g.z, g.angle];
  let swept = 0;
  for (let i = 0; i < 60; i++) {
    expect(e.update(1 / 60)).toBe(1);
    const v = Math.hypot(g.x - prev[0], g.z - prev[1]) * 60;
    expect(v).toBeGreaterThanOrEqual(6);
    expect(g.speed).toBeGreaterThanOrEqual(6);
    expect(g.dist).toBeLessThanOrEqual(E.grabRange + 1e-9);
    const da = Math.atan2(Math.sin(g.angle - prev[2]), Math.cos(g.angle - prev[2]));
    expect(da).toBeGreaterThan(0); // 主人公から見て左回り（角度が増える）。乗り手の右手側に主人公
    swept += da;
    expect(Math.cos(g.heading - (g.angle + Math.PI / 2))).toBeGreaterThan(0.9);
    expect(g.turn).toBeGreaterThan(2);
    prev = [g.x, g.z, g.angle];
  }
  expect(swept).toBeGreaterThan(Math.PI); // 1 秒で半周より多く回る
});

test('群がる者（cling）の輪は掴む者の外。段が増えると一回り外へ（大きな群れでも止まって重ならない）', () => {
  expect(swarmRing(0)).toBeGreaterThan(E.grabRange + 1);
  expect(swarmRing(0)).toBeLessThan(E.grabRange + 3);
  let prev = swarmRing(0);
  for (let k = 1; k < 60; k++) { expect(swarmRing(k)).toBeGreaterThanOrEqual(prev); prev = swarmRing(k); }
  expect(swarmRing(59)).toBeGreaterThan(swarmRing(0) + 2);
  expect(swarmRing(1000)).toBeLessThan(15);
});

test('近づく途中で掴む枠が埋まっても、外へ押し戻されず、その場で止まらずに突っ込んで群がり、枠が空けば掴む', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 0 }));
  // 5 人が掴んでいて枠は残り 1。3m に来ている者と、もう掴む寸前の者（どちらか一人だけが掴める）
  for (let i = 0; i < E.maxGrabbing - 1; i++) e.list.push({ id: 100 + i, angle: i, dist: E.grabRange, state: 'grab', grabTime: 1 });
  const w = { id: 1, angle: 0.5, dist: 3, state: 'chase' };
  const last = { id: 2, angle: 2.5, dist: E.grabRange + 0.01, state: 'chase' };
  e.list.push(w, last);
  const prev = new Map([[1, w.dist], [2, last.dist]]);
  for (let i = 0; i < 60; i++) {
    e.update(1 / 60);
    for (const x of [w, last]) { expect(x.dist).toBeLessThanOrEqual(prev.get(x.id) + 1e-12); prev.set(x.id, x.dist); }
  }
  expect([w.state, last.state].sort()).toEqual(['cling', 'grab']); // 6 つ目の枠は埋まり、もう一人は待たずに群がった
  const c = w.state === 'cling' ? w : last, g = c === w ? last : w;
  // 枠が空けば、離れずに掴む
  g.state = 'dead'; g.deadTime = 0;
  e.update(1 / 60);
  expect(c.dist).toBeLessThanOrEqual(prev.get(c.id) + 1e-12);
  expect(c.state).toBe('grab');
});

test('もう掴む距離の内側にいる者は外へ押し戻されない（その場で掴む・飛びつく）', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 0 }));
  for (let i = 0; i < E.maxGrabbing - 1; i++) e.list.push({ id: 100 + i, angle: i, dist: E.grabRange, state: 'grab', grabTime: 1 });
  const a = { id: 1, angle: 0.5, dist: 2, state: 'chase' }, b = { id: 2, angle: 2.5, dist: 1.5, state: 'chase' };
  e.list.push(a, b);
  e.update(1 / 60);
  expect(a.state).toBe('grab'); expect(a.dist).toBeCloseTo(2, 9);
  expect(b.state).toBe('cling'); expect(b.dist).toBeCloseTo(1.5, 9);
});

test('飛びついた者（cling）も爆発の前線で倒れ、掴む数には入らない', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 0 }));
  for (let i = 0; i < E.maxGrabbing; i++) e.list.push({ id: 100 + i, angle: i, dist: E.grabRange, state: 'grab', grabTime: 1 });
  e.list.push({ id: 1, angle: 0.5, dist: E.grabRange + 0.01, state: 'chase' });
  expect(e.update(1 / 60)).toBe(E.maxGrabbing);
  expect(e.list.find((x) => x.id === 1).state).toBe('cling');
  expect(e.applyBlastFront(5)).toBe(E.maxGrabbing + 1);
  expect(e.update(1 / 60)).toBe(0);
});

test('applyBlastFront: front 内の軍勢は dead、掴んでいた者も外れる', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 100, spawnDist: [10, 10], speed: 100 }));
  for (let i = 0; i < 5; i++) e.update(0.1);
  const total = e.list.length;
  expect(e.applyBlastFront(1)).toBe(0);
  const killed = e.applyBlastFront(5);
  expect(killed).toBeGreaterThan(0);
  expect(e.list.filter((x) => x.state === 'dead').length).toBe(killed);
  expect(e.list.filter((x) => x.state === 'grab').length).toBe(0);
  expect(e.applyBlastFront(5)).toBe(0); // 二重に数えない
  expect(e.list.length).toBe(total);
  const n = e.update(0.1);
  expect(n).toBeLessThanOrEqual(E.maxGrabbing);
});

test('倒れた者は動かない。角度と距離だけで置かれた者（approach）も近づいて掴む', () => {
  const e = createEnemies(createRng(4), cfgWith({ spawnPerSec: 0 }));
  e.list.push({ id: 1, angle: 1, dist: 6, state: 'approach' }, { id: 2, angle: 2, dist: 8, state: 'dead', deadTime: 0 });
  e.update(0.05);
  const d = e.list[1]; const pos = [d.x, d.z, d.dist];
  for (let i = 0; i < 120; i++) e.update(1 / 30);
  expect(e.list[0].state).toBe('grab');
  expect([d.x, d.z, d.dist]).toEqual(pos);
});

test('死んだ敵は deadTime が進み、3秒後に list から消える', () => {
  const e = createEnemies(createRng(4), cfgWith({ spawnPerSec: 10, spawnDist: [50, 50] }));
  e.update(0.1);
  const id = e.list[0].id;
  e.applyBlastFront(100);
  const d = e.list.find((x) => x.id === id); expect(d.deadTime).toBe(0);
  e.update(1); expect(d.deadTime).toBeCloseTo(1);
  e.update(2.1);
  expect(e.list.find((x) => x.id === id)).toBeUndefined();
});

// 持ち主の決定（2026-11-21「終盤ほど一気に増やす」）: 序盤は少なく平らに、残り 20 秒ほどから一気に増えて群れになる。60 秒で約 100
const totalSpawn = (t0, t1, cfg = CONFIG) => { let n = 0; for (let t = t0; t < t1; t += 0.01) n += spawnRateAt(t + 0.005, cfg) * 0.01; return n; };

// Fix round 1（まとめ役: 持ち主の決まりへ戻す）: 群れは残り 20 秒ほどから（Pass 2 の 50〜60 秒をやめた）
test('湧く速さ: 序盤は spawnPerSec で平ら、surgeStart（残り 20 秒ほど）から surgeEnd へ一気に surgeMul 倍まで増え、その後は保つ', () => {
  expect(E.surgeStart).toBeGreaterThanOrEqual(36);
  expect(E.surgeStart).toBeLessThanOrEqual(42);
  expect(E.surgeEnd).toBeGreaterThan(E.surgeStart);
  expect(E.surgeEnd).toBeLessThanOrEqual(CONFIG.roundSeconds - 4);
  for (const t of [0, 10, 20, 30, E.surgeStart]) expect(spawnRateAt(t)).toBeCloseTo(E.spawnPerSec, 9);
  expect(spawnRateAt(E.surgeEnd)).toBeCloseTo(E.spawnPerSec * E.surgeMul, 9);
  expect(spawnRateAt(90)).toBeCloseTo(E.spawnPerSec * E.surgeMul, 9);
  expect(E.surgeMul).toBeGreaterThan(6); // 群れ
  let prev = 0;
  for (let t = 0; t <= 70; t += 0.5) { expect(spawnRateAt(t)).toBeGreaterThanOrEqual(prev - 1e-12); prev = spawnRateAt(t); }
  // spawnPerSec 0 なら一人も湧かない（試しの設定）。surgeMul 1 なら平ら
  expect(spawnRateAt(55, cfgWith({ spawnPerSec: 0 }))).toBe(0);
  expect(spawnRateAt(55, cfgWith({ surgeMul: 1 }))).toBeCloseTo(E.spawnPerSec, 9);
});

test('60 秒で湧くのは約 100（前の約 108 と同じほど）。序盤 40 秒は 3 割未満で、残り 20 秒に 7 割以上が湧く', () => {
  const all = totalSpawn(0, 60), early = totalSpawn(0, 40);
  expect(all).toBeGreaterThan(90);
  expect(all).toBeLessThan(115);
  expect(early / all).toBeLessThan(0.3);
  // 実際に湧く数（刻み幅によらない）
  const e = createEnemies(createRng(5), cfgWith({ spawnDist: [500, 500], searchSpeed: 0, accel: 0 }));
  for (let i = 0; i < 400; i++) e.update(0.1);
  const first40 = e.list.length;
  for (let i = 0; i < 200; i++) e.update(0.1);
  expect(e.list.length).toBeGreaterThan(90);
  expect(e.list.length - first40).toBeGreaterThan(e.list.length * 0.7);
});

test('近づくほど速度を落とす: 遠くでは speed、掴む手前では slowMin 倍まで遅くなる（距離は水平）', () => {
  expect(approachSpeed(E.spotDist)).toBeCloseTo(E.speed);
  expect(approachSpeed(E.grabRange + E.slowDist)).toBeCloseTo(E.speed);
  expect(approachSpeed(E.grabRange)).toBeCloseTo(E.speed * E.slowMin);
  let prev = Infinity;
  for (let d = E.grabRange + E.slowDist; d >= E.grabRange; d -= 0.5) { const v = approachSpeed(d); expect(v).toBeLessThanOrEqual(prev + 1e-9); prev = v; }
});

// 本物の街で、湧いてから掴むまでの秒（払わず、掴む枠は無制限）
function reachTimes(seeds) {
  const out = [];
  out.back = 0; // 見つけたあと（chase）に主人公から離れた距離の最大
  for (const seed of seeds) {
    const city = generateCity(seed);
    // Pass 2: 届くまでの速さを前と同じ数で見る（湧き方は前のまま。tests/game/prePass2.js）
    const e = createEnemies(createRng(seed + 1), cfgWith({ ...PRE_PASS2_ENEMY, maxGrabbing: 1e9 }), { buildings: city.buildings });
    const born = new Map(), done = new Set(), last = new Map();
    for (let t = 0; t < 59; t += 1 / 30) {
      e.update(1 / 30);
      for (const x of e.list) {
        if (x.state === 'chase' && last.has(x.id)) out.back = Math.max(out.back, x.dist - last.get(x.id));
        if (x.state === 'chase') last.set(x.id, x.dist); else last.delete(x.id);
        if (!born.has(x.id)) born.set(x.id, t);
        if (x.state === 'grab' && !done.has(x.id)) { done.add(x.id); out.push(t - born.get(x.id)); }
      }
    }
  }
  return out;
}

test('届くまでの秒の分布: 前（2026-11-21 fix1: 平均 6.9 秒・中央 5.6 秒）より速く届く（持ち主 22:15「もっとスピード上げて」）。迷い続けない', () => {
  const ts = reachTimes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  expect(ts.length).toBeGreaterThan(300);
  const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
  expect(mean).toBeGreaterThan(3); // R0: 平均 4.6 秒（中央 3.6 秒、p90 8.2 秒、最大 15.8 秒）
  expect(mean).toBeLessThan(5.5);
  expect(q(ts, 0.5)).toBeGreaterThan(2.5);
  expect(q(ts, 0.5)).toBeLessThan(4.8);
  expect(q(ts, 0.1)).toBeGreaterThan(1.5);
  expect(q(ts, 0.9)).toBeLessThan(12);
  expect(Math.max(...ts)).toBeLessThan(25);
  expect(ts.back).toBeLessThanOrEqual(1e-9); // 見つけてからは一度も離れない
});

// ---- S8: 広い街を見回る者と、最大溜めの一発が届く距離 ----
// M2: 見回る者も知らせ（alert）を受ければ狩りに加わる（spec §16「見つかると周りの軍勢へ知らせが広がり」）。ここでは知らせを止めて、
// 見回る者が自分からは主人公を探しに来ないこと（帯の中を見回るだけ）を確かめる。知らせで加わるのは tests/game/headlight.test.js
const NO_ALERT = { ...CONFIG, enemy: { ...CONFIG.enemy, alert: null } };
test('fix1: 見回る者は始めから count 人、探す者の外（patrolBand の内端）から街の端まで、どの方角・どの距離にもいて、主人公を探さず掴みにも来ない（知らせがなければ）', () => {
  const city = generateCity(7);
  const E = createEnemies(createRng(2), NO_ALERT, { buildings: city.buildings, patrolRng: createRng(9) });
  const [lo, hi] = patrolBand(CONFIG);
  // 帯は式で決まる: 内は探す者の動ける範囲の外、外は街の端
  expect(lo).toBeCloseTo(CONFIG.enemy.roamDist + GRID.PITCH / 2);
  expect(hi).toBe(CONFIG.cityRadius);
  const pats = () => E.list.filter((e) => e.patrol);
  expect(pats().length).toBe(CONFIG.enemy.patrol.count);
  // 8 つの方角 × 3 つの距離の帯のどこにも、始めから見回る者がいる
  const rings = [lo, lo + (hi - lo) / 3, lo + 2 * (hi - lo) / 3, hi + 1];
  for (let s8 = 0; s8 < 8; s8++) for (let r = 0; r < 3; r++) {
    const n = pats().filter((e) => Math.floor(((e.angle + Math.PI) / (2 * Math.PI)) * 8) % 8 === s8 && e.dist >= rings[r] - GRID.PITCH && e.dist < rings[r + 1] + GRID.PITCH).length;
    expect(n, `sector ${s8} ring ${r}`).toBeGreaterThan(0);
  }
  let minD = Infinity, maxD = 0;
  const start = new Map(pats().map((e) => [e.id, [e.x, e.z]]));
  // 残り 20 秒（patrol.joinAt）までは見回るだけ（R0: そこから広場の近くの見回る者が狩りに加わる。下のテスト）
  for (let i = 0; i < CONFIG.enemy.patrol.joinAt * 30 - 1; i++) {
    E.update(1 / 30);
    for (const e of pats()) { minD = Math.min(minD, e.dist); maxD = Math.max(maxD, e.dist); expect(e.state).toBe('search'); expect(e.hunting).toBeFalsy(); }
  }
  expect(minD).toBeGreaterThan(lo - GRID.PITCH);
  expect(maxD).toBeGreaterThan(hi - 30); // 街の端まで行く
  expect(maxD).toBeLessThan(hi + 6);
  const moved = pats().filter((e) => Math.hypot(e.x - start.get(e.id)[0], e.z - start.get(e.id)[1]) > 50).length;
  expect(moved).toBeGreaterThan(pats().length * 0.7);
});

test('S8: 見回る者がいても、狩りに加わるまでは、探して掴みに来る者の湧き方・動きは同じ（M2: 知らせで加わる分を除くため知らせを止める）', () => {
  const city = generateCity(3);
  const a = createEnemies(createRng(4), NO_ALERT, { buildings: city.buildings });
  const b = createEnemies(createRng(4), NO_ALERT, { buildings: city.buildings, patrolRng: createRng(77) });
  // 見回る者が狩りに加わる（R0、patrol.joinAt）までは同じ。加わったあとは掴む枠を取り合うので変わってよい
  for (let i = 0; i < CONFIG.enemy.patrol.joinAt * 30 - 1; i++) { a.update(1 / 30); b.update(1 / 30); }
  const hunt = (E) => E.list.filter((e) => !e.patrol).map((e) => [e.id, e.state, +e.x.toFixed(6), +e.z.toFixed(6)]);
  expect(hunt(b)).toEqual(hunt(a));
});

test('S8: 最大溜めの一発の半径は、軍勢が街で行きうる一番遠い距離（maxEnemyReach）に 40 m 以上の余裕を足した距離より大きい。どの種でも、湧く・探す・見回るどの軍勢もその距離の内にいる', () => {
  const reach = maxEnemyReach(CONFIG);
  expect(radiusFor(CONFIG.power.max, CONFIG)).toBeGreaterThanOrEqual(reach + 40);
  expect(reach).toBeGreaterThanOrEqual(CONFIG.cityRadius); // 見回る者は街の端まで
  let far = 0;
  for (const seed of [1, 2, 7, 11, 23]) {
    const g = createGame({ seed });
    g.pressStart();
    for (let t = 0; t < 59.9; t += 1 / 30) {
      g.update(1 / 30);
      for (const e of g.enemies.list) far = Math.max(far, e.dist);
    }
  }
  expect(far).toBeLessThanOrEqual(reach);
  expect(far).toBeGreaterThan(reach - 40); // 見積もりが大きすぎない
});

test('fix1: 描ける数（enemyView の CAPACITY）は、払わずに 60 秒たったときの探す者（倒れた者を含む）と見回る者の全員より多い', async () => {
  const { CAPACITY, HUNT_CAPACITY } = await import('../../src/render/enemyView.js');
  expect(CAPACITY).toBe(HUNT_CAPACITY + CONFIG.enemy.patrol.count);
  let most = 0;
  for (const seed of [1, 2, 3, 4]) {
    const g = createGame({ seed });
    g.pressStart();
    for (let t = 0; t < 59.9; t += 1 / 30) { g.update(1 / 30); most = Math.max(most, g.enemies.list.filter((e) => !e.patrol).length); }
  }
  expect(most).toBeLessThanOrEqual(HUNT_CAPACITY);
});

test('R0: 残り 20 秒（patrol.joinAt）になると、広場の近く（patrol.joinDist の内）の見回る者が狩りに加わり、主人公へ集まって掴みに来る。遠くの見回る者は見回り続ける', () => {
  const PJ = CONFIG.enemy.patrol;
  expect(PJ.joinAt).toBe(CONFIG.roundSeconds - 20);
  let joined = 0, grabbed = 0, stayed = 0;
  for (const seed of [1, 2, 3, 4]) {
    const city = generateCity(seed);
    const en = createEnemies(createRng(seed + 1), cfgWith({ spawnPerSec: 0 }), { buildings: city.buildings, patrolRng: createRng(seed * 7) });
    let t = 0;
    for (; t < PJ.joinAt - 1e-9; t += 1 / 30) en.update(1 / 30);
    for (const e of en.list) expect(e.hunting).toBeFalsy();
    en.update(1 / 30);
    const pats = en.list.filter((e) => e.patrol);
    const join = pats.filter((e) => e.hunting);
    for (const e of join) expect(e.dist).toBeLessThanOrEqual(PJ.joinDist + 1e-9);
    joined += join.length;
    const far = pats.filter((e) => e.dist > PJ.joinDist + 60);
    for (let i = 0; i < 19 * 30; i++) en.update(1 / 30);
    grabbed += join.filter((e) => e.state === 'grab' || e.state === 'cling').length;
    stayed += far.filter((e) => e.state === 'search').length;
    expect(far.length).toBeGreaterThan(30);
  }
  expect(joined).toBeGreaterThanOrEqual(4 * 3); // 1 回に 3 人以上
  expect(grabbed).toBeGreaterThan(joined * 0.6); // 加わった者の多くは 19 秒のうちに主人公まで来る
  expect(stayed).toBeGreaterThan(4 * 30 * 0.8);
});

// R0（持ち主 22:15「まだ主人公前で止まる感じ」）: 主人公から 25 m 以内の生きている軍勢は、どのフレームでも 6 m/s 以上で動いている
// （見つける・突っ込む・掴む・群がる・掴み直すのどれでも止まって見えない。掴む者は主人公のまわりを回る）。
// 速さは e.speed と、実際に動いた距離 / dt の両方で確かめる
test('R0: 主人公から 25 m 以内の軍勢は、どのフレームでも 6 m/s 以上で動く（掴んでいる者・群がる者も）', () => {
  let frames = 0, grabFrames = 0, clingFrames = 0, heavyOrbit = 0, heavyStagger = 0, bossFrames = 0;
  // M2: 払うは 3 回までになったが、ここは動きの下限を確かめるテスト（よろめく重い者のフレームも数えたい）なので、回数の制限を外す
  const cfg = { ...CONFIG, puff: { ...CONFIG.puff, uses: Infinity } };
  for (const seed of [1, 2, 3]) for (const puff of [false, true]) {
    const g = createGame({ seed, cfg });
    g.pressStart();
    const DT = 1 / 30;
    const prev = new Map();
    for (let t = 0; t < CONFIG.roundSeconds - DT; t += DT) {
      if (puff) { const n = g.enemies.list.filter((e) => e.state !== 'dead' && e.dist <= 4).length; if (g.grabbing >= 1 || n >= 1) g.puff(); }
      g.update(DT);
      if (g.phase !== 'playing') break;
      for (const e of g.enemies.list) {
        if (e.state === 'dead') { prev.delete(e.id); continue; }
        const p = prev.get(e.id);
        prev.set(e.id, [e.x, e.z]);
        if (!p || e.dist > 25) continue;
        frames++;
        if (e.state === 'grab') grabFrames++;
        if (e.state === 'cling') clingFrames++;
        if (e.kind === 'heavy' && (e.state === 'grab' || e.state === 'cling')) heavyOrbit++;
        if (e.kind === 'heavy' && e.state === 'stagger') heavyStagger++;
        if (e.kind === 'boss') bossFrames++;
        const moved = Math.hypot(e.x - p[0], e.z - p[1]) / DT;
        if (e.speed < 6 || moved < 6) throw new Error(`seed ${seed} puff ${puff} t=${t.toFixed(2)} id ${e.id} ${e.state} dist ${e.dist.toFixed(2)} speed ${e.speed.toFixed(2)} moved ${moved.toFixed(2)}`);
      }
    }
  }
  expect(frames).toBeGreaterThan(10000);
  expect(grabFrames).toBeGreaterThan(1000);
  expect(clingFrames).toBeGreaterThan(1000);
  // R1 fix1: 遅い重い者（×0.8）が回る・群がる・よろめくフレームと、大物のフレームも数えに入っている
  expect(heavyOrbit).toBeGreaterThan(0);
  expect(heavyStagger).toBeGreaterThan(0);
  expect(bossFrames).toBeGreaterThan(0);
});

test('R0 fix1: 群がる段と掴む順は、群がった順（あとから狩りに加わった見回る者が、先に群がった者の前に割り込まない）', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 0 }));
  for (let i = 0; i < E.maxGrabbing; i++) e.list.push({ id: 200 + i, angle: i, dist: E.grabRange, state: 'grab', grabTime: 1 });
  const a = { id: 1, angle: 0.5, dist: swarmRing(0) + 0.05, state: 'chase' };
  const b = { id: 2, angle: 2.5, dist: swarmRing(1) + 0.05, state: 'chase' };
  e.list.push(a, b);
  e.update(1 / 60);
  expect([a.state, b.state]).toEqual(['cling', 'cling']);
  expect([a.layer, b.layer]).toEqual([0, 1]);
  // 見回る者は list の前の方にいる（始めに置かれる）。あとから群がっても、段は一番上（後ろ）
  const p = { id: 100003, patrol: true, hunting: true, angle: 4, dist: swarmRing(2) + 0.05, state: 'chase' };
  e.list.unshift(p);
  e.update(1 / 60);
  expect(p.state).toBe('cling');
  expect([a.layer, b.layer, p.layer]).toEqual([0, 1, 2]);
  for (let i = 0; i < 30; i++) { e.update(1 / 60); expect([a.layer, b.layer, p.layer]).toEqual([0, 1, 2]); }
  // 枠が空けば、先に群がった a が掴む（見回る者ではない）
  const g0 = e.list.find((x) => x.state === 'grab'); g0.state = 'dead'; g0.deadTime = 0;
  e.update(1 / 60);
  expect(a.state).toBe('grab');
  expect(p.state).toBe('cling');
  expect([b.layer, p.layer]).toEqual([0, 1]);
});
