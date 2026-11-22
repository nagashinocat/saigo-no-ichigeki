import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { lineOfSight, seesHero } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// R1f（持ち主 18:14「たまにビルの横にいるだけで素通りするばしょがあったよ」→ 隠れていないのに、ビルのそばにいるだけで見つからない）。原因（task-R1f-report.md）:
//  見通しの確かめで建物の足元を sightMargin（0.8 m）広げていた。主人公は壁に触れると足元の縁から主人公の半径（1.2 m）の所に立つので、
//  壁に沿う向き・角の向こうから照らす見通しが、0.8 m 広げた足元の角をかすめて「さえぎられた」（seed 4 の広場のまわり 40 棟の壁のそばの格子で、
//  ライトの扇の内で本当は見えている 3454 件のうち 522 件、約 15%）。直したあと: 見通しは足元そのもの（sightMargin 0）。
//  もう一つの入口は、思わず隠れていたこと（R1e の 2 本目の指のシュッ。持ち主 18:14「払うが…スワイプと誤認識してるのか」）: 隠れた印は物陰から 3 m の内に
//  最大 12 秒残り、その間は M2 の決まり（真正面から 4 m の内でなければ見つからない）で見つからない。シュッはやめた（隠れるのは LOOK OUT! の矢印を
//  タップしたときだけ、派手な動きで。tests/input）。M2 の物陰の決まりはそのまま（brief: Keep all the M2 hide rules）
const E = CONFIG.enemy;
const R = CONFIG.hero.radius;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 主人公を壁に触れる所（足元の縁から主人公の半径）に置く: 各面に沿った点・角のすぐ外（路地の口）
function wallSpots(b) {
  const out = [];
  const hx = b.w / 2 + R, hz = b.d / 2 + R;
  for (const u of [-0.45, -0.2, 0, 0.2, 0.45]) {
    out.push({ x: b.x + u * b.w, z: b.z - hz }, { x: b.x + u * b.w, z: b.z + hz });
    out.push({ x: b.x - hx, z: b.z + u * b.d }, { x: b.x + hx, z: b.z + u * b.d });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push({ x: b.x + sx * hx, z: b.z + sz * (b.d / 2 + 0.3) }, { x: b.x + sx * (b.w / 2 + 0.3), z: b.z + sz * hz });
  return out;
}
const insideAny = (bs, x, z, pad) => bs.some((b) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad);

test('R1f: 壁に触れて立つ（隠れていない）主人公は、ライトの扇の内で見通しのある軍勢にはいつも見つかる', () => {
  const g = createGame({ seed: 4 });
  const bs = g.city.buildings;
  const rand = createRng(77);
  let cases = 0, missed = [];
  for (const b of bs.filter((x) => Math.hypot(x.x, x.z) < 140).slice(0, 40)) {
    for (const p of wallSpots(b)) {
      if (insideAny(bs, p.x, p.z, R - 1e-6)) continue; // となりの足元の内（立てない所）
      for (let k = 0; k < 12; k++) {
        const a = rand() * Math.PI * 2, d = 4 + rand() * (E.spotDist - 4.5);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (insideAny(bs, x, z, 0.8)) continue; // 軍勢は道・空き地の上
        if (!lineOfSight(x, z, bs, 0, p.x, p.z)) continue; // 見えない（本当の物陰）は別のテスト
        const heading = Math.atan2(p.z - z, p.x - x) + (rand() - 0.5) * 2 * E.spotHalfAngle * 0.95;
        cases++;
        if (!seesHero({ x, z, heading }, { ...p, hidden: false, dashing: null }, bs, CONFIG)) missed.push({ b: b.id, p, rider: { x, z } });
      }
    }
  }
  expect(cases).toBeGreaterThan(1000);
  expect(missed.slice(0, 5)).toEqual([]);
});

test('R1f: 本当の物陰（軍勢との間にビルがある）では、ライトの扇の内で近くても見つからない', () => {
  const g = createGame({ seed: 4 });
  const bs = g.city.buildings;
  let cases = 0;
  for (const b of bs.filter((x) => Math.hypot(x.x, x.z) < 140).slice(0, 40)) {
    // 主人公は北の壁に触れ、軍勢はビルをはさんで南の道（ビルの向こう）からこちらを向く
    const H = { x: b.x, z: b.z + b.d / 2 + R, hidden: false };
    const r = { x: b.x, z: b.z - b.d / 2 - 3, heading: Math.PI / 2 };
    if (Math.hypot(H.x - r.x, H.z - r.z) > E.spotDist) continue;
    cases++;
    expect(seesHero(r, H, bs, CONFIG)).toBe(false);
  }
  expect(cases).toBeGreaterThan(20);
});

test('R1f: 隠れていない主人公が壁のそばを歩いていて、通りの向こうからライトで照らす軍勢には見つかる（ゲームの中で。種 1〜6）', () => {
  const quiet = { ...CONFIG, enemy: { ...E, spawnPerSec: 0, patrol: { ...E.patrol, count: 0 }, kinds: {} } };
  let tried = 0, found = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = createGame({ seed, cfg: quiet });
    g.begin(); g.pressStart();
    const bs = g.city.buildings, H = g.hero;
    // 広場のそばのビルの東の壁に触れて立つ
    const b = bs.filter((x) => Math.hypot(x.x, x.z) > 30 && Math.hypot(x.x, x.z) < 90).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
    H.x = b.x + b.w / 2 + R; H.z = b.z;
    if (insideAny(bs, H.x, H.z, R - 1e-6)) continue;
    // 壁に沿う向き（北か南）の 20〜30 m 先から、主人公の方を向いて来る者（見通しのある方）
    let placed = null;
    for (const s of [1, -1]) for (const d of [30, 25, 20]) {
      const x = H.x + 0.6, z = H.z + s * d;
      if (!placed && !insideAny(bs, x, z, 1) && lineOfSight(x, z, bs, 0, H.x, H.z)) placed = { x, z, heading: s > 0 ? -Math.PI / 2 : Math.PI / 2 };
    }
    if (!placed) continue;
    tried++;
    const r = { id: 990, state: 'search', x: placed.x, z: placed.z, heading: placed.heading, speed: 0, turn: 0, searchTime: 0, lane: [0, 0], ni: 0, nj: 0, di: 0, dj: 1 };
    r.dist = Math.hypot(r.x - H.x, r.z - H.z); r.angle = Math.atan2(r.z - H.z, r.x - H.x);
    g.enemies.list.push(r);
    for (let i = 0; i < 12; i++) g.update(1 / 30);
    if (['chase', 'grab', 'cling'].includes(r.state)) found++;
  }
  expect(tried).toBeGreaterThanOrEqual(4);
  expect(found).toBe(tried);
});
