import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { swarmRing, lineOfSight, createEnemies, seesHero } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// R1d（持ち主 13:36「見つかってから敵キャラがどっかいく」）: 見つけた軍勢は、主人公が 28 m/s（M2）で通りを渡り角を曲がっても、
// 主人公が物陰に隠れない限り（M2、持ち主 15:20: 隠れるでだけ見失う。tests/game/hide.test.js）、
// 見失わずに今の主人公を追い続ける。見つけた（chase・approach・grab・cling・stagger に一度でも入った）者を全部記録し、
//  - 二度と search に戻らない
//  - 主人公からの距離が増え続けるのは短い間だけ（払うのよろめき stagger.sec と、角の一瞬を除く）
//  - 見つけた者の主人公からの距離の平均は（よろめきの間を除き）増えない
//  - 掴む者・群がる者は、主人公が動いている間も今の主人公の群がる輪の内
//  - 払いでよろめいた者は、よろめきが終わったそのフレームで chase へ戻り、0.2 秒のうちに今の主人公の方を向いて突っ込み直す
// を確かめる。主人公の道すじは決めた向きの列（溜めている間だけ動く。ビルに当たれば壁に沿って滑る）
// R1f（持ち主 19:47「撒けるようにしたらまだいいかも」。13:36 の「見失わない」を改める）: 見つけた者は、主人公が見えている間（ライトか、すぐ後ろ hearDist の内の見通し）と、
// 見えなくなってから chase.loseSec（約 2 秒）の間は追い続ける。それより長く見えなければ見失い、最後に見た所を探す（search）。
// 「二度と search に戻らない」は、見通しが loseSec 秒より長く切れた者を除いて確かめる（切れていないのに戻った者はいない）。
// 距離が増え続けないことは、見通しのある間だけ（見通しがなければビルを回り込むので、主人公から一度離れうる。tests/game/chaseNav.test.js）

const DT = 1 / 30;
const SPOTTED = new Set(['chase', 'approach', 'grab', 'cling', 'stagger']);
const E = CONFIG.enemy;
const RING_MAX = swarmRing(E.swarm.perRing * (E.swarm.maxRing + 1));

// 通りを渡り、角を曲がる道すじ（1.5 秒ごとに向きを変える。斜めもまぜる）
const LEGS = [[0, -1], [1, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [0.7, 0.7], [0, 1], [-1, 0], [0, -1], [-0.7, 0.7], [1, 0]];

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// 今の主人公を追っている: 掴む・群がる、または chase で、向きが主人公の方（ずれ π/4 未満。よろめきの回る向きは主人公から見て横向き）
function reacquired(e, H) {
  if (e.state === 'grab' || e.state === 'cling') return true;
  if (e.state !== 'chase') return false;
  const toHero = Math.atan2(H.z - e.z, H.x - e.x);
  return Math.abs(wrap(e.heading - toHero)) < Math.PI / 4;
}

// M2: 払うは 3 回までになったが、ここはよろめきからの立ち直りも確かめたいので回数の制限を外す（見失わないことは回数によらない）
const UNLIMITED = { ...CONFIG, puff: { ...CONFIG.puff, uses: Infinity } };
function run(seed, sec = 45) {
  const g = createGame({ seed, cfg: UNLIMITED });
  g.begin(); g.pressStart();
  expect(CONFIG.hero.speed).toBe(28); // M2（持ち主 15:20）
  const rec = new Map(); // id → { back, growSec, maxGrowSec, staggerEnd }
  const LOSE = CONFIG.enemy.chase.loseSec;
  const spottedIds = new Set();
  let lostOk = 0, lostEarly = 0;
  let backToSearch = 0, maxGrowSec = 0, ringOut = 0, staggerRecovered = 0, staggerBad = 0, meanBumps = 0, maxMeanBump = 0, moved = 0;
  let prevMean = null, prevIds = null;
  for (let i = 0; i < sec / DT && g.phase === 'playing'; i++) {
    const [mx, mz] = LEGS[Math.floor((i * DT) / 1.5) % LEGS.length];
    g.setMove(mx, mz);
    const hx = g.hero.x, hz = g.hero.z;
    const before = new Map(g.enemies.list.map((e) => [e.id, { state: e.state, d: Math.hypot(e.x - hx, e.z - hz) }]));
    // 掴まれたら払う（重い者・大物はよろめく）
    if (g.grabbing >= 2) g.puff();
    g.update(DT);
    const H = g.hero;
    if (Math.hypot(H.x - hx, H.z - hz) > 0.3 * CONFIG.hero.speed * DT) moved++;
    const ids = [];
    let sum = 0;
    for (const e of g.enemies.list) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.x - H.x, e.z - H.z);
      let r = rec.get(e.id);
      if (!r && SPOTTED.has(e.state)) { rec.set(e.id, (r = { growSec: 0, blind: 0 })); spottedIds.add(e.id); }
      if (!r) continue;
      const b = before.get(e.id);
      // R1f: 見えない秒（追う者の見え方: ライト（扇・ごく近く・見通し）か、chase.hearDist の内の見通し）。掴む者・群がる者は主人公の上にいる（見失わない）
      const sees = (e.state === 'grab' || e.state === 'cling') || seesHero(e, H, g.city.buildings, CONFIG) || (d <= CONFIG.enemy.chase.hearDist && lineOfSight(e.x, e.z, g.city.buildings, 0, H.x, H.z));
      const blindBefore = r.blind;
      r.blind = sees ? 0 : r.blind + DT;
      if (e.state === 'search') {
        // 見失ったのは、見通しが loseSec 秒より長く切れたときだけ（それより早く search に戻った者はいない）。また見つければ数え直す
        // （ゲームは動く前に見え方を確かめ、ここは動いたあとに確かめるので、数フレームのずれは許す）
        // fix1: ライトの扇の縁で、動く前と後の向きの違いが数フレーム重なる（0.2 秒まで許す）。fix2: else が注釈の中に入っていたのを戻した
        if (blindBefore + DT >= LOSE - 0.2) lostOk++; else { lostEarly++; backToSearch++; }
        rec.delete(e.id);
        continue;
      }
      // 回り込んでいる間（見通しのない者）は距離の決まりの外。fix1: 壁のそばで輪を縮めていた掴む者・群がる者が、壁を過ぎて元の輪へ戻る間
      // （e.orbitR より内。外へ swarm.inSpeed m/s まで）も外（tests/game/chaseNav.test.js）
      const regrow = (e.state === 'grab' || e.state === 'cling') && e.orbitR != null && (b ? b.d : d) < e.orbitR - 1e-6;
      const clear = sees && blindBefore === 0 && !regrow;
      // 距離が増え続けた秒（よろめきは押し戻されるので除く）
      if (clear && e.state !== 'stagger' && b && b.state !== 'stagger') {
        r.growSec = d > b.d + 1e-6 ? r.growSec + DT : 0;
        maxGrowSec = Math.max(maxGrowSec, r.growSec);
      } else if (!clear) r.growSec = 0;
      // よろめきが終わった: そのフレームで chase（か掴む・群がる）へ戻り、0.2 秒のうちに向きが今の主人公の方へ向く（見通しがあれば）
      if (b && b.state === 'stagger' && e.state !== 'stagger') {
        if (['chase', 'grab', 'cling'].includes(e.state)) { staggerRecovered++; r.recoverAt = i; } else staggerBad++;
      }
      if (r.recoverAt != null && i - r.recoverAt === 6) {
        if (clear && !reacquired(e, H)) staggerBad++;
        r.recoverAt = null;
      }
      // 掴む者・群がる者は今の主人公の群がる輪の内
      if ((e.state === 'grab' || e.state === 'cling') && d > RING_MAX + 1e-6) ringOut++;
      if (clear && e.state !== 'stagger' && b && b.state !== 'stagger') { ids.push(e.id); sum += d; }
    }
    // 見つけた者（前のフレームにもいた者だけ）の距離の平均
    if (prevIds && ids.length) {
      const prevSet = new Set(prevIds.map((p) => p.id));
      const both = ids.filter((id) => prevSet.has(id));
      if (both.length) {
        const prevMap = new Map(prevIds.map((p) => [p.id, p.d]));
        let a = 0, b = 0;
        for (const id of both) {
          const e = g.enemies.list.find((x) => x.id === id);
          a += Math.hypot(e.x - H.x, e.z - H.z); b += prevMap.get(id);
        }
        const bump = (a - b) / both.length;
        if (bump > 1e-6) { meanBumps++; maxMeanBump = Math.max(maxMeanBump, bump); }
      }
    }
    prevIds = g.enemies.list.filter((e) => ids.includes(e.id)).map((e) => ({ id: e.id, d: Math.hypot(e.x - H.x, e.z - H.z) }));
    prevMean = ids.length ? sum / ids.length : prevMean;
  }
  return { spotted: spottedIds.size, lostOk, lostEarly, backToSearch, maxGrowSec, ringOut, staggerRecovered, staggerBad, meanBumps, maxMeanBump, moved, hero: g.hero };
}

for (const seed of [1, 2, 3]) {
  test(`R1d / M2 / R1f seed ${seed}: 28 m/s で通りを渡り角を曲がる主人公を、見つけた軍勢は見えている間と見えなくなって loseSec の間は見失わない（それより早く search に戻らず、見える間は距離が増え続けず、掴む者は今の主人公の輪の内）`, () => {
    const r = run(seed);
    expect(r.moved).toBeGreaterThan(300); // 主人公はずっと動いていた（10 秒以上）
    expect(Math.hypot(r.hero.x, r.hero.z)).toBeGreaterThan(30);
    expect(r.spotted).toBeGreaterThan(10);
    expect(r.backToSearch).toBe(0);
    expect(r.maxGrowSec).toBeLessThanOrEqual(0.3); // 角の一瞬・よろめきから加速し直す間まで
    expect(r.ringOut).toBe(0);
    expect(r.staggerBad).toBe(0);
  if (seed === 1) expect(r.staggerRecovered).toBeGreaterThan(0); // よろめいた者がいた
    // 平均は増えない。例外は、よろめきから立ち直った者が横向きから主人公の方へ向き直り、加速し直す数フレームの小さなふくらみだけ
    // （主人公の一歩 28 m/s × 1/30 秒 ≈ 0.93 m より小さい）
    if (process.env.R1D_LOG) console.log(seed, r);
    expect(r.maxMeanBump).toBeLessThan(CONFIG.hero.speed * DT);
    expect(r.meanBumps).toBeLessThanOrEqual(10);
  });
}

test('R1d: 払いでよろめいた重い者は、よろめきが終わったそのフレームで chase へ戻り、動いている今の主人公へ突っ込み直す（探す道へそれない）', () => {
  const cfg = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 } } };
  const g = createGame({ seed: 7, cfg });
  g.begin(); g.pressStart();
  // 主人公の 6 m 先で突っ込んでくる重い者 3 人（x, z を直に置く）
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1;
    g.enemies.list.push({ id: 900 + k, kind: 'heavy', hp: 2, state: 'chase', x: Math.cos(a) * 6, z: Math.sin(a) * 6, heading: a + Math.PI, speed: 20, turn: 0, lane: [0, 0] });
  }
  g.power.add(50);
  for (let i = 0; i < 10; i++) g.update(DT);
  expect(g.puff()).toBe(true);
  let staggered = 0, recovered = 0;
  const last = new Map(), rec = new Map();
  for (let i = 0; i < 4 / DT; i++) {
    g.setMove(i < 60 ? 1 : 0, i < 60 ? 0 : 1); // 走って角を曲がる
    g.update(DT);
    for (const e of g.enemies.list) {
      if (e.id < 900) continue;
      const prev = last.get(e.id);
      if (e.state === 'stagger') staggered++;
      if (prev === 'stagger' && e.state !== 'stagger') {
        recovered++;
        expect(['chase', 'grab', 'cling']).toContain(e.state); // そのフレームで突っ込み直す
        rec.set(e.id, i);
      }
      if (rec.get(e.id) != null && i - rec.get(e.id) === 6) expect(reacquired(e, g.hero), `id ${e.id}`).toBe(true); // 0.2 秒で主人公の方を向く
      expect(e.state).not.toBe('search');
      last.set(e.id, e.state);
    }
  }
  expect(staggered).toBeGreaterThan(0);
  expect(recovered).toBe(3);
  // 最後はみな今の主人公を掴むか群がっている
  for (const e of g.enemies.list.filter((x) => x.id >= 900)) {
    expect(['grab', 'cling']).toContain(e.state);
    expect(Math.hypot(e.x - g.hero.x, e.z - g.hero.z)).toBeLessThanOrEqual(RING_MAX + 1e-6);
  }
});

// R1f（持ち主 19:47「撒けるようにしたらまだいいかも」）: 見えなくなって loseSec 秒を越えると見失い、最後に見た所を探す
const CH = CONFIG.enemy.chase;
const quietEnemy = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 } } };

test('R1f: 見失うまでの秒（約 2 秒）と、払ったよろめきの長さ（前の 0.55 秒の約 1.4 倍）は config', () => {
  expect(CH.loseSec).toBeGreaterThanOrEqual(1.5);
  expect(CH.loseSec).toBeLessThanOrEqual(2.5);
  expect(CONFIG.enemy.stagger.sec / 0.55).toBeGreaterThanOrEqual(1.3);
  expect(CONFIG.enemy.stagger.sec / 0.55).toBeLessThanOrEqual(1.5);
});

test('R1f: ビルの陰で見えなくなった追う者は、loseSec の間は追い続け（回り込む）、それを越えると見失って最後に見た所を探す。また見つけるにはライトが要る', () => {
  // 主人公 (0, 0)、長いビル（z 8〜12、x ±50）の向こう (0, 25) に追う者。回り込む道のりは 2 秒で走れる距離より長い
  const wall = { id: 1, x: 0, z: 10, w: 100, d: 4, h: 20 };
  const e = createEnemies(createRng(3), quietEnemy, { buildings: [wall] });
  const r = { id: 50, state: 'chase', x: 0, z: 25, heading: -Math.PI / 2, speed: 30, turn: 0, lane: [0, 0], dist: 25, angle: Math.PI / 2 };
  e.list.push(r);
  e.update(DT); // 見通しがない（最初のフレームを最後に見た時刻にする）
  expect(r.lastSeen).toMatchObject({ x: 0, z: 0 });
  let t = DT, lostAt = null;
  const inWall = (x, z) => Math.abs(x) < 50 && Math.abs(z - 10) < 2;
  for (; t < 4 && lostAt == null; t += DT) {
    e.update(DT);
    expect(inWall(r.x, r.z)).toBe(false);
    if (r.state === 'search') lostAt = t;
    else expect(r.state).toBe('chase');
  }
  expect(lostAt).not.toBeNull();
  expect(lostAt).toBeGreaterThanOrEqual(CH.loseSec - 2 * DT);
  expect(lostAt).toBeLessThanOrEqual(CH.loseSec + 3 * DT);
  expect(r.heard.x).toBeCloseTo(0, 6); expect(r.heard.z).toBeCloseTo(0, 6); // 最後に見た所を探す
  expect(e.lostCount).toBe(1);
  // 見失った者は、ライトの扇の外（真後ろ・ごく近くより遠く）からは見つけない
  const H = e.heroPos;
  H.x = r.x - Math.cos(r.heading) * 12; H.z = r.z - Math.sin(r.heading) * 12;
  e.update(DT); e.update(DT);
  expect(r.state).toBe('search');
});

test('R1f: 見えている間は見失わない。掴む者は（壁の陰に回っても）見失わない', () => {
  const e = createEnemies(createRng(3), quietEnemy, { buildings: [{ id: 1, x: 0, z: 40, w: 10, d: 4, h: 20 }] });
  const c = { id: 51, state: 'chase', x: 30, z: 0, heading: Math.PI, speed: 0, turn: 0, lane: [0, 0], dist: 30, angle: 0 };
  const gr = { id: 52, state: 'grab', x: 2.5, z: 0, heading: Math.PI / 2, speed: 15, turn: 0, lane: [0, 0], dist: 2.5, angle: 0, grabTime: 0 };
  e.list.push(c, gr);
  for (let t = 0; t < 3; t += DT) {
    e.update(DT);
    expect(c.state === 'chase' || c.state === 'grab' || c.state === 'cling').toBe(true);
    expect(['grab', 'cling']).toContain(gr.state);
  }
});

// fix1（見直し Important 3）: 見えない追う者は「最後に誰かが見た所」へ向かい（今の主人公は知らない）、そこで見えなければ行き過ぎて見失う。
// 街ごとに、角の内側にビルがあって角の向こうが見えない 2 つ角の道すじ（真っすぐ 1 区画 → 曲がって 1 区画 → 曲がり戻して 1 区画）を選び、
// 28〜34 m 後ろの追う者から逃げる。今日の街 12（120 日を 10 日おき）
import { citySeed } from '../../src/game/daily.js';
const P = 26;
const node = (i, j) => [(i + 0.5) * P, (j + 0.5) * P];
function twoCornerRoute(bs) {
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const blocked = (A, B, C) => { const a = node(...A), b = node(...B), c = node(...C); const u = [a[0] + (b[0] - a[0]) * 0.6, a[1] + (b[1] - a[1]) * 0.6], w = [b[0] + (c[0] - b[0]) * 0.5, b[1] + (c[1] - b[1]) * 0.5]; return !lineOfSight(u[0], u[1], bs, 0, w[0], w[1]); };
  for (let r = 1; r <= 3; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let a = 0; a < 4; a++) for (const turn of [1, 3]) {
    const d1 = D[a], d2 = D[(a + turn) % 4];
    const S = [i, j], C1 = [i + d1[0], j + d1[1]], C2 = [C1[0] + d2[0], C1[1] + d2[1]], E2 = [C2[0] + d1[0], C2[1] + d1[1]];
    if (blocked(S, C1, C2) && blocked(C1, C2, E2)) return { S, d1, d2 };
  }
  return null;
}
function shake(seed, gap) {
  const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 }, kinds: {} } };
  const g = createGame({ seed, cfg: quiet });
  g.begin(); g.pressStart();
  const rt = twoCornerRoute(g.city.buildings);
  if (!rt) return null;
  const [sx, sz] = node(...rt.S);
  g.hero.x = sx; g.hero.z = sz;
  const r = { id: 70, state: 'chase', x: sx - rt.d1[0] * gap, z: sz - rt.d1[1] * gap, heading: Math.atan2(rt.d1[1], rt.d1[0]), speed: 30, turn: 0, lane: [0, 0], dist: gap, angle: 0 };
  g.enemies.list.push(r);
  const legs = [rt.d1, rt.d2, rt.d1, rt.d2, rt.d1];
  for (let i = 0; i < 6 / DT && r.state === 'chase'; i++) {
    g.setMove(...legs[Math.min(legs.length - 1, Math.floor((i * DT * CONFIG.hero.speed) / P))]);
    g.power.add(1);
    g.update(DT);
  }
  return { state: r.state, lost: g.enemies.lostCount, heard: r.heard, known: g.enemies.known };
}
const DAILY12 = Array.from({ length: 12 }, (_, k) => { const d = new Date(Date.UTC(2026, 10, 1) + k * 10 * 864e5); return citySeed(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`); });

test('R1f fix1: 28〜34 m 後ろの追う者は、角を 2 つ曲がれば、たいていの街で撒ける（見失って最後に誰かが見た所を探す）', () => {
  expect(CH.loseSec).toBeCloseTo(1.5, 6);
  expect(CH.hearDist).toBeGreaterThanOrEqual(8);
  expect(CH.hearDist).toBeLessThanOrEqual(10);
  expect(CH.blindSpeed).toBeLessThan(CONFIG.hero.speed);
  for (const gap of [28, 34]) {
    const runs = DAILY12.map((s) => shake(s, gap)).filter(Boolean);
    expect(runs.length).toBe(12);
    const shaken = runs.filter((r) => r.state === 'search');
    expect(shaken.length, `gap ${gap}`).toBeGreaterThanOrEqual(7);
    for (const r of shaken) { expect(r.lost).toBe(1); expect(r.heard.x).toBeCloseTo(r.known.x, 6); expect(r.heard.z).toBeCloseTo(r.known.z, 6); }
  }
});

test('R1f fix1: 開けた所で 12 m 後ろの追う者は撒けない（見えている間は突っ込む 32 m/s で追いつく）', () => {
  const open = createEnemies(createRng(3), quietEnemy, { buildings: [] });
  const H = open.heroPos;
  for (const gap of [12, 20]) {
    H.x = 0; H.z = 0;
    const c = { id: 71 + gap, state: 'chase', x: -gap, z: 0, heading: 0, speed: 30, turn: 0, lane: [0, 0], dist: gap, angle: Math.PI };
    open.list.push(c);
    for (let t = 0; t < 10 && c.state === 'chase'; t += DT) { H.x += CONFIG.hero.speed * DT; open.update(DT); }
    expect(['grab', 'cling']).toContain(c.state);
  }
  expect(open.lostCount).toBe(0);
});
