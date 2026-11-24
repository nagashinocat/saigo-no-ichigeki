import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';
import { prePass2 } from './prePass2.js';

// R1f fix1（見直し Important 1）: R0（主人公から 25 m の内の軍勢は、どのフレームでも 6 m/s 以上で動く）を、主人公が動く・壁に沿って滑る・
// 追う者が見失う・払ってよろめく場面で確かめる（enemies.test.js の R0 は主人公を広場の真ん中に止めたまま）。
// 掴む者・群がる者は主人公と一緒に動くので、主人公に対する動き（相対位置の変わり方）で測る。ほかの者は世界での動き
const DT = 1 / 30;
const LEGS = [[0, -1], [1, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [0.7, 0.7], [0, 1], [-1, 0], [0, -1], [-0.7, 0.7], [1, 0]];
function runR0(cfg) {
  const bad = [], seen = { lose: 0, stagger: 0, grab: 0, cling: 0, wall: 0 };
  let frames = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = createGame({ seed, cfg });
    g.begin(); g.pressStart();
    const prev = new Map();
    for (let i = 0; i < 45 / DT && g.phase === 'playing'; i++) {
      const [mx, mz] = LEGS[Math.floor((i * DT) / 1.5) % LEGS.length];
      g.setMove(mx, mz);
      if (g.grabbing >= 2) g.puff();
      const hx = g.hero.x, hz = g.hero.z, lost0 = g.enemies.lostCount;
      g.update(DT);
      seen.lose += g.enemies.lostCount - lost0;
      if (Math.hypot(g.hero.x - hx, g.hero.z - hz) < 0.6 * CONFIG.hero.speed * DT) seen.wall++; // 壁に当たって遅くなったフレーム
      for (const e of g.enemies.list) {
        if (e.state === 'dead' || e.x == null) { prev.delete(e.id); continue; }
        const p = prev.get(e.id);
        prev.set(e.id, { x: e.x, z: e.z, hx: g.hero.x, hz: g.hero.z, state: e.state });
        if (!p || e.dist > 25) continue;
        frames++;
        // 掴む・群がる者（と、そこから払われてよろめき始めたフレーム: 前のフレームは主人公と一緒に動いていた）は主人公に対する動きで測る
        const orbit = (p.state === 'grab' || p.state === 'cling') && (e.state === 'grab' || e.state === 'cling' || e.state === 'stagger');
        const moved = orbit
          ? Math.hypot((e.x - g.hero.x) - (p.x - p.hx), (e.z - g.hero.z) - (p.z - p.hz)) / DT
          : Math.hypot(e.x - p.x, e.z - p.z) / DT;
        if (e.state in seen) seen[e.state]++;
        if (e.speed < 6 || moved < 6) bad.push(`seed ${seed} t=${(i * DT).toFixed(2)} id ${e.id} ${p.state}->${e.state} speed ${e.speed.toFixed(1)} moved ${moved.toFixed(1)} dist ${e.dist.toFixed(1)}`);
      }
    }
  }
  return { frames, seen, bad };
}

test('R1f fix1: 動く主人公（通りを渡り角を曲がり、壁に沿って滑る）でも、25 m の内の軍勢はどのフレームでも 6 m/s 以上（見失う・よろめく・掴む・群がるも）', () => {
  // Pass 2: 軍勢の数・払うの守りは前のまま（tests/game/prePass2.js。確かめるのは動きの速さで、同じ数の軍勢を見る）
  const { frames, seen, bad } = runR0(prePass2({ ...CONFIG, puff: { ...CONFIG.puff, uses: Infinity, guardSec: 0 } }));
  expect(frames).toBeGreaterThan(5000);
  expect(seen.stagger).toBeGreaterThan(0);
  expect(seen.grab).toBeGreaterThan(500);
  expect(seen.wall).toBeGreaterThan(30);
  expect(bad.slice(0, 6)).toEqual([]);
}, 120000);

// Fix round 1（見直し Important 6）: 出荷する設定そのまま（払うの守りあり・序盤 0.1/秒）でも R0 を守る。守りで弾かれた者はよろめく（spin 以上）か倒れる
test('Fix round 1: 出荷の設定（払うの守りあり）でも、25 m の内の軍勢はどのフレームでも 6 m/s 以上', () => {
  const { frames, seen, bad } = runR0({ ...CONFIG, puff: { ...CONFIG.puff, uses: Infinity } });
  if (process.env.R0_LOG) console.log(frames, seen);
  // Fix round 2（払うの前線 40 m・衝撃波・閃光の残り）: 25 m の内に来る者が減り、数えたフレームは 2919（前は 3000 より多い）。下限 3000 → 2500
  expect(frames).toBeGreaterThan(2500);
  expect(seen.grab).toBeGreaterThan(100);
  expect(seen.wall).toBeGreaterThan(30);
  expect(bad.slice(0, 6)).toEqual([]);
}, 120000);
