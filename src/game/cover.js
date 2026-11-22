import { CONFIG } from '../config.js';
import { lineOfSight } from './enemies.js';

// M2（持ち主 15:20「物陰にシュッと入る」）: 隠れる先の物陰を探す。主人公（hero: { x, z }）から向き dir（世界の x, z）の先、
// hide.range m の内で、
//  - ビルの足元（主人公の半径だけ広げた四角）の外・街の中（cityRadius − edgePad の内）
//  - そこまでの通り道がビルにさえぎられない（壁を抜けて滑り込まない）
//  - ビルの壁のそば（足元の縁から hero.radius + hide.wallDist m の内。ビルの陰・路地・くぼみ）
//  - 見張る者（watchers: 追っている者・近くの者 { x, z }）の誰からも、建物にさえぎられて見えない
// のうち、近くて向きのずれが小さい所（距離 + offW × ずれ rad が一番小さい）を返す。無ければ null
const OFFS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9];
export function findCover(hero, dir, buildings, watchers, cfg = CONFIG) {
  const C = cfg.hide, R = cfg.hero.radius;
  const m = Math.hypot(dir.x, dir.z);
  if (!(m > 1e-6)) return null;
  const base = Math.atan2(dir.z / m, dir.x / m);
  const maxR = cfg.cityRadius - cfg.hero.edgePad;
  const near = buildings.filter((b) => Math.abs(b.x - hero.x) - b.w / 2 < C.range + 4 && Math.abs(b.z - hero.z) - b.d / 2 < C.range + 4);
  const watch = watchers.filter((w) => Math.hypot(w.x - hero.x, w.z - hero.z) < C.range + cfg.enemy.spotDist + 20);
  let best = null;
  for (const off of OFFS) {
    const a = base + off, cx = Math.cos(a), cz = Math.sin(a);
    for (let d = C.minDist; d <= C.range + 1e-9; d += C.step) {
      const x = hero.x + cx * d, z = hero.z + cz * d;
      const score = d + C.offW * Math.abs(off);
      if (best && score >= best.score) break;
      if (Math.hypot(x, z) > maxR) break;
      let inside = false, wall = Infinity;
      for (const b of near) {
        const ex = Math.abs(x - b.x) - b.w / 2, ez = Math.abs(z - b.z) - b.d / 2;
        if (ex < R && ez < R) { inside = true; break; }
        wall = Math.min(wall, Math.hypot(Math.max(ex, 0), Math.max(ez, 0)));
      }
      if (inside) continue;
      if (!lineOfSight(hero.x, hero.z, near, R * 0.8, x, z)) break; // ここから先は壁の向こう
      if (wall > R + C.wallDist) continue;
      if (watch.some((w) => lineOfSight(w.x, w.z, near, 0, x, z))) continue;
      best = { x, z, score };
    }
  }
  return best && { x: best.x, z: best.z };
}
