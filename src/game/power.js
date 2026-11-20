import { CONFIG } from '../config.js';

// 貯めた力。長押しで増え（max まで）、小爆発で使い、掴まれると減る。最後の一発は残りを全部使う。
export function createPower(cfg = CONFIG.power) {
  let value = 0;
  return {
    get value() { return value; },
    get level() { return value / cfg.max; },
    // max を超えない分だけ増やし、実際に増えた量を返す
    add(amount) {
      const got = Math.max(0, Math.min(amount, cfg.max - value));
      value += got;
      return got;
    },
    canSpend(amount) { return value >= amount; },
    // 足りるときだけ使う
    spend(amount) {
      if (value < amount) return false;
      value -= amount;
      return true;
    },
    drain(amount) { value = Math.max(0, value - Math.max(0, amount)); },
    take() { const v = value; value = 0; return v; },
  };
}
