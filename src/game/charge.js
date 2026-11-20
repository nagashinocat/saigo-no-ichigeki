import { CONFIG } from '../config.js';

// 最後の一発の半径。貯めた力（power.max で 1）に対して、最大で街の端より先まで
export function radiusFor(amount, cfg = CONFIG) {
  const { min, max, exponent } = cfg.radius;
  const t = Math.min(1, Math.max(0, amount / cfg.power.max));
  return min + (max - min) * Math.pow(t, exponent);
}

// 長押し: 押している間だけ力が貯まる。離すと、minRelease 以上貯まっていれば全部使って最後の一発を返す
// （足りなければ放たず、貯めた力はそのまま残る）。
export function createCharge(power, cfg = CONFIG) {
  const c = {
    active: false,
    start() { c.active = true; },
    update(dt) {
      if (c.active) power.add(cfg.power.chargePerSec * dt);
    },
    release() {
      if (!c.active) return null;
      c.active = false;
      if (power.value < cfg.power.minRelease) return null;
      const amount = power.take();
      return { amount, radius: radiusFor(amount, cfg), isBig: true };
    },
  };
  return c;
}
