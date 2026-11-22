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
    // R2: ギリギリのボーナスの分（被害額 × (倍率 − 1)）を足す
    addBonus(amount) { total += Math.max(0, amount); return Math.max(0, amount); },
    get total() { return total; },
  };
}

// R2（spec §15 ギリギリのボーナス）: 放ったときの残り時間 timeLeft 秒が少ないほど ×(1 + 0.5·clamp((10 − 残り)/10, 0, 1))（最大 ×1.5）
export const BONUS = { timeFrom: 10, timeMax: 0.5, closeStep: 0.04, closeMax: 0.4 };
export function timeBonus(timeLeft, B = BONUS) {
  return 1 + B.timeMax * Math.min(1, Math.max(0, (B.timeFrom - timeLeft) / B.timeFrom));
}
// 主人公のすぐそば（reach.js の NEAR_DIST m の内）まで迫った軍勢 near 体ごとに +4%、+40% で頭打ち
export function closeBonus(near, B = BONUS) {
  return 1 + Math.min(B.closeMax, B.closeStep * Math.max(0, near));
}
// 二つの倍率を掛け合わせる（結果画面の内訳に使う）
export function releaseBonus({ timeLeft, near }, B = BONUS) {
  const timeMul = timeBonus(timeLeft, B), closeMul = closeBonus(near, B);
  return { timeLeft, near, timeMul, closeMul, mul: timeMul * closeMul };
}
