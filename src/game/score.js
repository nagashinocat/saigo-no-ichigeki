import { CONFIG } from '../config.js';

export function createScore(cfg = CONFIG.score) {
  let total = 0;
  return {
    addShot(values) {
      const n = values.length;
      if (n === 0) return 0;
      const mult = Math.min(1 + cfg.comboStep * (n - 1), cfg.comboMax);
      const gained = values.reduce((a, b) => a + b, 0) * mult;
      total += gained;
      return gained;
    },
    get total() { return total; },
  };
}
