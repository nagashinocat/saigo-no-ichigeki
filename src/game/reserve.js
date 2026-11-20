import { CONFIG } from '../config.js';

export function createReserve(cfg = CONFIG.reserve) {
  return {
    value: cfg.start,
    regen(dt) { this.value = Math.min(cfg.max, this.value + cfg.regenPerSec * dt); },
    // minLeft を残して最大 amount まで引き出し、実際の量を返す
    draw(amount) {
      const got = Math.max(0, Math.min(amount, this.value - cfg.minLeft));
      this.value -= got;
      return got;
    },
    drain(amount) { this.value = Math.max(0, this.value - amount); },
    isEmpty() { return this.value <= 0; },
  };
}
