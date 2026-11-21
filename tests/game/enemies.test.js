import { test, expect } from 'vitest';
import { createEnemies, spawnRateAt, approachSpeed, lineOfSight, roadNode } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
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
  const e = createEnemies(createRng(7), CONFIG, { buildings: city.buildings });
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
  // 持ち主の要望（2026-11-21 10:01「群勢もっと早くして」）: 探す速さは 22〜26 m/s
  expect(E.searchSpeed).toBeGreaterThanOrEqual(22);
  expect(E.searchSpeed).toBeLessThanOrEqual(26);
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
  const { e, x } = solo({ x: ring + E.laneSpread, z: 20, heading: -Math.PI / 2, ni: 0, nj: -1, di: 0, dj: -1, lane: [E.laneSpread, 0] });
  for (let i = 0; i < 60 && x.state === 'search'; i++) e.update(1 / 60);
  expect(x.state).toBe('chase');
});

test('見つけたら: 急に止まって短い一拍にらみ、主人公へ一直線に全速で突っ込み（離れない）、最後の 1〜2 m だけ急ブレーキして掴む', () => {
  const [nx] = roadNode(0, 0);
  const { e, x } = solo({ x: nx, z: 20, heading: -Math.PI / 2, ni: 0, nj: -1, di: 0, dj: -1 });
  while (x.state === 'search') e.update(1 / 60);
  // 見つけた瞬間からにらむ時間を数える（急ブレーキと重なる）。一拍は全部で spotPause 秒
  let prev = x.dist, t = 0, top = 0, launch = null, launchSpeed = null;
  const speeds = [];
  while (x.state === 'chase' && t < 20) {
    e.update(1 / 60); t += 1 / 60;
    // 見つけてから掴むまで、主人公からの距離は一度も増えない（ブレーキで止まる間の惰性も含む）
    expect(x.dist).toBeLessThanOrEqual(prev + 1e-9);
    expect(x.dist).toBeGreaterThanOrEqual(E.grabRange - 1e-9);
    if (launch == null && !(x.pause > 0)) { launch = t; launchSpeed = x.speed; }
    if (launch != null) top = Math.max(top, x.speed);
    speeds.push([prev, x.speed]); // この一歩の速さは、一歩の前の距離で決まる
    prev = x.dist;
  }
  expect(x.state).toBe('grab');
  expect(x.dist).toBeCloseTo(E.grabRange, 9);
  // 見つけた一拍: 見つけた瞬間から spotPause 秒（0.4〜0.5 秒）で走り出す。その間に急ブレーキでほぼ止まっている
  expect(launch).toBeGreaterThan(E.spotPause - 1 / 30);
  expect(launch).toBeLessThan(E.spotPause + 1 / 30);
  expect(launchSpeed).toBeLessThan(E.searchSpeed * 0.25);
  expect(E.spotPause).toBeGreaterThanOrEqual(0.4);
  expect(E.spotPause).toBeLessThanOrEqual(0.5);
  // 持ち主の要望: 近づく速さは 16〜20 m/s。主人公の手前で減速しきらず、そのまま突っ込む
  expect(top).toBeLessThanOrEqual(E.speed + 1e-9);
  expect(top).toBeGreaterThan(E.speed * 0.9);
  expect(E.speed).toBeGreaterThanOrEqual(16);
  expect(E.speed).toBeLessThanOrEqual(20);
  // 減速の曲線より速くない。減速するのは最後の 2 m だけ（その外では全速の 9 割以上を保つ）
  for (const [d, v] of speeds) if (d < E.grabRange + E.slowDist && v > 0) expect(v).toBeLessThanOrEqual(approachSpeed(d) + 1e-9);
  const late = speeds.filter(([d]) => d > E.grabRange + 2 && d < E.grabRange + 4);
  expect(late.length).toBeGreaterThan(0);
  for (const [, v] of late) expect(v).toBeGreaterThan(E.speed * 0.9);
});

test('掴む枠が埋まっていても止まって待たない: あふれた者もそのまま突っ込み、掴んでいる者の外に重なって飛びつく（cling）。枠が空けば、いちばん先に飛びついた者がすぐ掴む', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 100, spawnDist: [10, 10], speed: 100, slowMin: 1, chaseAccel: 1e4 }));
  let n = 0;
  for (let i = 0; i < 20; i++) n = e.update(0.1);
  expect(n).toBe(E.maxGrabbing);
  const grab = e.list.filter((x) => x.state === 'grab');
  expect(grab.length).toBe(E.maxGrabbing);
  for (const g of grab) expect(g.dist).toBeCloseTo(E.grabRange, 9);
  // 順番待ちの輪はない: 掴めなかった者は主人公のすぐ横（掴む距離）まで来て飛びつき、止まって待つ者はいない
  expect(E.queueDist).toBeUndefined();
  const clingers = e.list.filter((x) => x.state === 'cling');
  expect(clingers.length).toBeGreaterThan(0);
  for (const c of clingers) { expect(c.dist).toBeCloseTo(E.grabRange, 9); expect(c.grabTime).toBeGreaterThanOrEqual(0); }
  expect(new Set(clingers.map((c) => c.layer))).toEqual(new Set(clingers.map((_, i) => i))); // 重なる段は 0, 1, 2 …
  const waiting = e.list.filter((x) => x.state === 'chase' && x.speed === 0 && x.pause == null);
  expect(waiting.length).toBe(0);
  // 掴んでいた一人が倒れると、いちばん先に飛びついた者が（動かずに）すぐ掴む。掴んでいる数は変わらない
  const first = clingers.find((c) => c.layer === 0);
  grab[0].state = 'dead'; grab[0].deadTime = 0;
  const d0 = first.dist;
  n = e.update(1 / 60);
  expect(first.state).toBe('grab');
  expect(first.dist).toBe(d0);
  expect(n).toBe(E.maxGrabbing);
  expect(first.unpile).toBeGreaterThanOrEqual(0); // 重なりから下りる見た目のための秒
});

test('近づく途中で掴む枠が埋まっても、外へ押し戻されず、その場で止まらずに突っ込んで飛びつき、枠が空けば掴む', () => {
  const e = createEnemies(createRng(3), cfgWith({ spawnPerSec: 0 }));
  // 5 人が掴んでいて枠は残り 1。3m に来ている者と、もう掴む寸前の者
  for (let i = 0; i < E.maxGrabbing - 1; i++) e.list.push({ id: 100 + i, angle: i, dist: E.grabRange, state: 'grab', grabTime: 1 });
  const w = { id: 1, angle: 0.5, dist: 3, state: 'chase' };
  const last = { id: 2, angle: 2.5, dist: E.grabRange + 0.01, state: 'chase' };
  e.list.push(w, last);
  let prev = w.dist;
  for (let i = 0; i < 60; i++) {
    e.update(1 / 60);
    expect(w.dist).toBeLessThanOrEqual(prev + 1e-12);
    prev = w.dist;
  }
  expect(last.state).toBe('grab'); // 6 つ目の枠は埋まった
  expect(w.state).toBe('cling'); // 待たずに飛びついた
  expect(w.dist).toBeCloseTo(E.grabRange, 9);
  // 枠が空けば、離れずに掴む
  last.state = 'dead'; last.deadTime = 0;
  e.update(1 / 60);
  expect(w.dist).toBeLessThanOrEqual(prev + 1e-12);
  expect(w.state).toBe('grab');
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
  expect(e.list[0].angle).toBeCloseTo(1, 6);
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
    const e = createEnemies(createRng(seed + 1), cfgWith({ maxGrabbing: 1e9 }), { buildings: city.buildings });
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

test('届くまでの秒の分布: 前（中央 約 11 秒）より速く届く（持ち主の要望「群勢もっと早くして」）。探し回る分だけ長い者もいるが、迷い続けない', () => {
  const ts = reachTimes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  expect(ts.length).toBeGreaterThan(300);
  const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
  expect(mean).toBeGreaterThan(5); // 2026-11-21 の速さ（fix 1）: 平均 6.9 秒（中央 5.6 秒）。前は平均 12.1 秒（中央 10.7 秒）
  expect(mean).toBeLessThan(9);
  expect(q(ts, 0.5)).toBeGreaterThan(4);
  expect(q(ts, 0.5)).toBeLessThan(8);
  expect(q(ts, 0.1)).toBeGreaterThan(2);
  expect(q(ts, 0.9)).toBeLessThan(18);
  expect(Math.max(...ts)).toBeLessThan(30);
  expect(ts.back).toBeLessThanOrEqual(1e-9); // 見つけてからは一度も離れない
});
