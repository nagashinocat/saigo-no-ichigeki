import { CONFIG } from '../config.js';

export function radiusFor(amount, cfg = CONFIG) {
  const { min, max, exponent } = cfg.radius;
  const t = Math.min(1, Math.max(0, amount / cfg.charge.maxDraw));
  return min + (max - min) * Math.pow(t, exponent);
}

export function createCharge(reserve, cfg = CONFIG) {
  let drawn = 0;
  const c = {
    active: false,
    start() { c.active = true; drawn = 0; },
    update(dt) {
      if (!c.active) return;
      const want = Math.min(cfg.charge.ratePerSec * dt, cfg.charge.maxDraw - drawn);
      if (want > 0) drawn += reserve.draw(want);
    },
    release() {
      if (!c.active) return null;
      c.active = false;
      const amount = drawn;
      drawn = 0;
      return {
        amount,
        radius: radiusFor(amount, cfg),
        isBig: amount >= cfg.charge.maxDraw * cfg.bigShotRatio - 1e-9,
      };
    },
    level() { return drawn / cfg.charge.maxDraw; },
  };
  return c;
}
