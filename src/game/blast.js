import { CONFIG } from '../config.js';

// 球状に広がる爆発の前線。対象は dist の昇順に並べ、カーソルを進めるだけで判定する。
export function createBlast(shot, targets, cfg = CONFIG) {
  const sorted = targets.filter((t) => t.dist <= shot.radius).sort((a, b) => a.dist - b.dist);
  const vaporizeDist = shot.radius * cfg.blast.vaporizeRatio;
  let front = 0;
  let cursor = 0;
  return {
    update(dt) {
      front = Math.min(shot.radius, front + cfg.blast.speed * dt);
      const hits = [];
      while (cursor < sorted.length && sorted[cursor].dist <= front) {
        const t = sorted[cursor++];
        hits.push({ id: t.id, kind: t.dist < vaporizeDist ? 'vaporize' : 'push' });
      }
      return hits;
    },
    get front() { return front; },
    get done() { return front >= shot.radius; },
  };
}
