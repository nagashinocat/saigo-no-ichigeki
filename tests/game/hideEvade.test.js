import { test, expect } from 'vitest';
import { createGame } from '../../src/game/game.js';
import { CONFIG } from '../../src/config.js';

// Pass 2（まとめ役: LOOK OUT! の矢印に従って隠れる人を損させない）: 追われていない間の先回りの隠れる（だれも見失わせない）は、
// 次の隠れるまで hide.evadeCooldown 秒。追われていて撒いた隠れるは hide.cooldown 秒（前のまま長い）
const HC = CONFIG.hide;
const DT = 1 / 30;
const quiet = { ...CONFIG, enemy: { ...CONFIG.enemy, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...CONFIG.enemy.patrol, count: 0 }, kinds: {} } };
const chaser = (id, x, z) => ({ id, state: 'chase', x, z, heading: Math.atan2(-z, -x), speed: 30, turn: 0, lane: [0, 0], dist: Math.hypot(x, z), angle: Math.atan2(z, x) });
// 隠れられた向きで隠れ、次の隠れるができるようになるまでの秒（物陰から出しておく）
function cooldownAfterHide(g) {
  let ok = false;
  for (let k = 0; k < 16 && !ok; k++) { const a = (k / 16) * 2 * Math.PI; ok = g.hide(Math.cos(a), Math.sin(a)); }
  if (!ok) return null;
  let t = 0;
  while (g.hideBlock !== null && t < 20) { g.update(DT); t += DT; if (g.hero.hidden && g.hero.dashing == null) g.hero.hidden = false; }
  return t;
}

test('Pass 2: 先回りの隠れるの待ち時間は短く（evadeCooldown < cooldown）', () => {
  expect(HC.evadeCooldown).toBeGreaterThan(0);
  expect(HC.evadeCooldown).toBeLessThan(HC.cooldown);
});

test('Pass 2: 追われていない間の隠れるは evadeCooldown 秒、追われていて撒いた隠れるは cooldown 秒で次ができる', () => {
  let n = 0;
  for (const seed of [1, 2, 3, 4]) {
    const g = createGame({ seed, cfg: quiet });
    g.begin(); g.pressStart();
    const free = cooldownAfterHide(g);
    if (free == null) continue;
    expect(free).toBeGreaterThan(HC.evadeCooldown - 0.1);
    expect(free).toBeLessThan(HC.evadeCooldown + 0.2);
    const g2 = createGame({ seed, cfg: quiet });
    g2.begin(); g2.pressStart();
    g2.enemies.list.push(chaser(99, g2.hero.x + 40, g2.hero.z + 40));
    const chased = cooldownAfterHide(g2);
    if (chased == null) continue;
    expect(chased).toBeGreaterThan(HC.cooldown - 0.1);
    n++;
  }
  expect(n).toBeGreaterThanOrEqual(2);
});
