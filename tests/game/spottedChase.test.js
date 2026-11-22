import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { swarmRing } from '../../src/game/enemies.js';
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
      if (!r && SPOTTED.has(e.state)) rec.set(e.id, (r = { growSec: 0 }));
      if (!r) continue;
      if (e.state === 'search') { backToSearch++; continue; }
      const b = before.get(e.id);
      // 距離が増え続けた秒（よろめきは押し戻されるので除く）
      if (e.state !== 'stagger' && b && b.state !== 'stagger') {
        r.growSec = d > b.d + 1e-6 ? r.growSec + DT : 0;
        maxGrowSec = Math.max(maxGrowSec, r.growSec);
      }
      // よろめきが終わった: そのフレームで chase（か掴む・群がる）へ戻り、0.2 秒のうちに向きが今の主人公の方へ向く
      if (b && b.state === 'stagger' && e.state !== 'stagger') {
        if (['chase', 'grab', 'cling'].includes(e.state)) { staggerRecovered++; r.recoverAt = i; } else staggerBad++;
      }
      if (r.recoverAt != null && i - r.recoverAt === 6) {
        if (!reacquired(e, H)) staggerBad++;
        r.recoverAt = null;
      }
      // 掴む者・群がる者は今の主人公の群がる輪の内
      if ((e.state === 'grab' || e.state === 'cling') && d > RING_MAX + 1e-6) ringOut++;
      if (e.state !== 'stagger' && b && b.state !== 'stagger') { ids.push(e.id); sum += d; }
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
  return { spotted: rec.size, backToSearch, maxGrowSec, ringOut, staggerRecovered, staggerBad, meanBumps, maxMeanBump, moved, hero: g.hero };
}

for (const seed of [1, 2, 3]) {
  test(`R1d / M2 seed ${seed}: 28 m/s で通りを渡り角を曲がる主人公を、見つけた軍勢は見失わない（search に戻らず、距離は増え続けず、掴む者は今の主人公の輪の内）`, () => {
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
