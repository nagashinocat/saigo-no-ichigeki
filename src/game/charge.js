import { CONFIG } from '../config.js';

// 最後の一発の半径。貯めた力（power.max で 1）に対して、最大で街の端より先まで。
// R0 fix1（満タン近くでしか撃退できない）: t ≤ knee は min から kneeRadius へ t^exponent の形（前の曲線に近い）、
// knee から満タンまでで kneeRadius から max へ一気に広がる（最後の数 % を貯めきって初めて街の端の軍勢まで届く）
export function radiusFor(amount, cfg = CONFIG) {
  const { min, max, exponent, knee = 1, kneeRadius = max } = cfg.radius;
  const t = Math.min(1, Math.max(0, amount / cfg.power.max));
  if (t <= knee) return min + (kneeRadius - min) * Math.pow(t / knee, exponent);
  return kneeRadius + (max - kneeRadius) * (t - knee) / (1 - knee);
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
    // 放たずに打ち切る（貯めた力はそのまま）
    cancel() { c.active = false; },
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
