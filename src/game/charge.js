import { CONFIG } from '../config.js';
import { maxEnemyReach } from './enemies.js';

// 最後の一発の半径。貯めた力（power.max で 1）に対して、最大で街の端より先まで。
// R0 fix1（満タン近くでしか撃退できない）: t ≤ knee は min から kneeRadius へ t^exponent の形（前の曲線に近い）、
// knee から満タンまでで kneeRadius から max へ一気に広がる（最後の数 % を貯めきって初めて街の端の軍勢まで届く）
export function radiusFor(amount, cfg = CONFIG) {
  const { min, max, exponent, knee = 1, kneeRadius = max } = cfg.radius;
  const t = Math.min(1, Math.max(0, amount / cfg.power.max));
  if (t <= knee) return min + (kneeRadius - min) * Math.pow(t / knee, exponent);
  return kneeRadius + (max - kneeRadius) * (t - knee) / (1 - knee);
}

// R1b（持ち主 08:24「力のパーセントをもう少しわかりやすく」）: 撃退ライン。半径（radiusFor）が reach m に届く、いちばん少ない力
// （power.max と同じ単位）。reach の既定は街の軍勢が行きうる一番遠い所（maxEnemyReach）。最大の半径でも届かなければ power.max。
// HUD の力のゲージの目盛り（約 98.6%）
export function clearThreshold(cfg = CONFIG, reach = maxEnemyReach(cfg)) {
  const { min, max, exponent, knee = 1, kneeRadius = max } = cfg.radius;
  const M = cfg.power.max;
  if (reach >= max) return M;
  if (reach <= min) return 0;
  const t = reach <= kneeRadius
    ? knee * Math.pow((reach - min) / (kneeRadius - min), 1 / exponent)
    : knee + (1 - knee) * (reach - kneeRadius) / (max - kneeRadius);
  // 浮動小数の丸めで半径が reach をわずかに下回らないよう、届くまで少しずつ上げる
  let L = Math.min(M, t * M);
  for (let i = 0; i < 8 && radiusFor(L, cfg) < reach; i++) L = Math.min(M, L + 1e-9 * M * 2 ** i);
  return L;
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
