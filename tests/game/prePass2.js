import { CONFIG } from '../../src/config.js';

// Pass 2（まとめ役、持ち主 10:06）より前の軍勢の湧き方・知らせ・加わり方。追う・回り込む・道に沿うなど、湧き方によらない仕組みのテストで、
// 前と同じ数の軍勢を見るために使う（Pass 2 は序盤を静かにし、群れを終わりの 10 秒へ寄せたので、そのままでは数が足りない）
export const PRE_PASS2_ENEMY = {
  spawnPerSec: 0.5, surgeStart: 40, surgeEnd: 52, surgeMul: 11,
  alert: { ...CONFIG.enemy.alert, radius: 120, hops: 2 },
  patrol: { ...CONFIG.enemy.patrol, joinAt: 40 },
};
export const prePass2 = (cfg = CONFIG) => ({ ...cfg, enemy: { ...cfg.enemy, ...PRE_PASS2_ENEMY } });
