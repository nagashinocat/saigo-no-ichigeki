import { CONFIG } from '../../src/config.js';

// Pass 2・Fix round 1（まとめ役、持ち主 10:06）より前の序盤の湧き方（0.5/秒・surgeMul 11）。追う・回り込む・道に沿うなど、湧き方によらない
// 仕組みのテストで、前と同じ数の軍勢を見るために使う（今は序盤が 0.1/秒で静かなので、そのままでは数が足りない）。
// 出荷する設定そのままでも、同じ仕組みのテストを別に流す（r0Move・spottedChase の「出荷の設定」）
export const PRE_PASS2_ENEMY = { spawnPerSec: 0.5, surgeStart: 40, surgeEnd: 52, surgeMul: 11 };
export const prePass2 = (cfg = CONFIG) => ({ ...cfg, enemy: { ...cfg.enemy, ...PRE_PASS2_ENEMY } });
