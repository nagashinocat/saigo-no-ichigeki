import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { lineOfSight, seesHero } from '../../src/game/enemies.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

// R1f（持ち主 18:14「たまにビルの横にいるだけで素通りするばしょがあったよ」）。原因（task-R1f-report.md）:
//  1) 物陰の印（hero.hidden）が、隠れた所から leaveDist（3 m）の内にいる間は最大 holdSec（12 秒）残り、その間はライトが
//     真正面から seeDist（4 m）の内を照らさない限り誰にも見つからなかった。物陰はビルの壁のそば（wallDist 1.6 m の内）なので、
//     「ビルの横に立っているだけ」で、通りの向こうから照らす新しい軍勢にも見つからない（ボットの遊び 10 回で、見えているのに
//     素通りした 1241 件のうち 1230 件がこれ）
//  2) 見通しの確かめで建物の足元を sightMargin（0.8 m）広げていた。壁の角をかすめる見通しが、見えているのにさえぎられる（3 件）
// 直したあと: 見つかるかは見通し（建物の足元そのもの）とライトの扇だけで決まる。隠れる（M2）は、追っていた者が見失うことと、
// 物陰へ跳ぶ間（dashing）だけ見えないこと。本当の物陰（ライトとの間にビルがある）では今も見つからない
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

test('R1f: 壁に触れて立つ主人公（隠れた印が残っていても）は、ライトの扇の内で見通しのある軍勢にはいつも見つかる', () => {
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
        for (const hidden of [false, true]) {
          cases++;
          const H = { ...p, hidden, hideT: 1, dashing: null };
          if (!seesHero({ x, z, heading }, H, bs, CONFIG)) missed.push({ b: b.id, p, rider: { x, z }, hidden });
        }
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

test('R1f: 隠れたあと物陰に立ったままでも、通りの向こうからライトで照らす新しい軍勢には見つかる（隠れた印は消える）', () => {
  const quiet = { ...CONFIG, enemy: { ...E, spawnPerSec: 0, patrol: { ...E.patrol, count: 0 }, kinds: {} } };
  let tried = 0, found = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = createGame({ seed, cfg: quiet });
    g.begin(); g.pressStart();
    for (let i = 0; i < 10; i++) g.update(1 / 30);
    const ok = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, 0.7], [-0.7, 0.7]].some((d) => g.hide(d[0], d[1]));
    if (!ok) continue;
    for (let i = 0; i < 15; i++) g.update(1 / 30);
    expect(g.hero.hidden).toBe(true);
    expect(g.hero.dashing).toBeNull();
    // 見通しのある向きから、主人公の方を向いて来る者を置く（主人公から 20 m）
    const H = g.hero, bs = g.city.buildings;
    let placed = null;
    for (let k = 0; k < 64 && !placed; k++) {
      const a = (k / 64) * Math.PI * 2, x = H.x + Math.cos(a) * 20, z = H.z + Math.sin(a) * 20;
      if (!insideAny(bs, x, z, 1) && lineOfSight(x, z, bs, 0, H.x, H.z)) placed = { x, z, a };
    }
    if (!placed) continue;
    tried++;
    const r = { id: 990, state: 'search', x: placed.x, z: placed.z, heading: wrap(placed.a + Math.PI), speed: 0, turn: 0, searchTime: 0, lane: [0, 0], ni: 0, nj: 0, di: 1, dj: 0 };
    r.dist = 20; r.angle = placed.a;
    g.enemies.list.push(r);
    for (let i = 0; i < 12; i++) g.update(1 / 30);
    if (['chase', 'grab', 'cling'].includes(r.state)) found++;
    expect(g.hero.hidden).toBe(false);
  }
  expect(tried).toBeGreaterThanOrEqual(4);
  expect(found).toBe(tried);
});
