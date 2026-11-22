import { CONFIG } from '../config.js';

// M2（持ち主 15:20「ジョイスティックを同じ向きに2回入力で隠れる」）: スティック（または PC の向きのキー）を同じ向きに素早く 2 回倒したか。
// 倒した量が release より浅く戻ってから mag より深く倒すと「1 回」。前の 1 回から window 秒の内で、向きのずれが angleDeg 以内なら
// 2 回目として、その向き（長さ 1、画面の x 右・y 下）を返す。それ以外は null。2 回で一度返したら数え直す
export function createFlick(c = CONFIG.controls.flick) {
  const cosMax = Math.cos((c.angleDeg * Math.PI) / 180);
  let armed = true, last = null;
  return {
    push(x, y, t) {
      const m = Math.hypot(x, y);
      if (!(m > c.release)) { armed = true; return null; }
      if (!armed || m < c.mag) return null;
      armed = false;
      const u = { x: x / m, y: y / m, t };
      if (last && t - last.t <= c.window && u.x * last.x + u.y * last.y >= cosMax) { last = null; return { x: u.x, y: u.y }; }
      last = u;
      return null;
    },
    reset() { armed = true; last = null; },
  };
}
