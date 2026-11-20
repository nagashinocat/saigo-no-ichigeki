import { CONFIG } from '../config.js';

// 爆発の前線は時間の関数: じわじわ期（ゆっくり加速して radius の creepFrac まで）→ 弾ける期（速さが跳ね上がり、
// はじめが最速で、最後は少しゆるむ ease-out で radius へ）。大きな一発ほど長い。
export function phaseTimes(radius, cfg = CONFIG) {
  const k = Math.sqrt(radius / cfg.radius.max);
  return {
    creep: Math.max(cfg.blast.creepMin, cfg.blast.creepSec * k),
    burst: Math.max(cfg.blast.burstMin, cfg.blast.burstSec * k),
  };
}

export function blastDuration(radius, cfg = CONFIG) {
  const p = phaseTimes(radius, cfg);
  return p.creep + p.burst;
}

// t: 爆発開始からの秒
export function frontAt(t, radius, cfg = CONFIG) {
  if (t <= 0) return 0;
  const { creep, burst } = phaseTimes(radius, cfg);
  const f0 = cfg.blast.creepFrac * radius;
  if (t < creep) { const u = t / creep; return f0 * u * u; }
  const u = Math.min(1, (t - creep) / burst);
  return f0 + (radius - f0) * (1 - (1 - u) ** 3);
}

// frontAt の逆（カメラが「あと何秒でどこまで届くか」を先読みするため）
export function timeAtFront(front, radius, cfg = CONFIG) {
  if (front <= 0) return 0;
  if (front >= radius) return blastDuration(radius, cfg);
  const { creep, burst } = phaseTimes(radius, cfg);
  const f0 = cfg.blast.creepFrac * radius;
  if (front < f0) return creep * Math.sqrt(front / f0);
  return creep + burst * (1 - (1 - (front - f0) / (radius - f0)) ** (1 / 3));
}

// 球状に広がる爆発の前線。対象は dist の昇順に並べ、カーソルを進めるだけで判定する。
export function createBlast(shot, targets, cfg = CONFIG) {
  const sorted = targets.filter((t) => t.dist <= shot.radius).sort((a, b) => a.dist - b.dist);
  const vaporizeDist = shot.radius * cfg.blast.vaporizeRatio;
  const { creep } = phaseTimes(shot.radius, cfg);
  const total = blastDuration(shot.radius, cfg);
  let time = 0;
  let front = 0;
  let cursor = 0;
  return {
    update(dt) {
      time += dt;
      front = frontAt(time, shot.radius, cfg);
      const hits = [];
      while (cursor < sorted.length && sorted[cursor].dist <= front) {
        const t = sorted[cursor++];
        hits.push({ id: t.id, kind: t.dist < vaporizeDist ? 'vaporize' : 'push' });
      }
      return hits;
    },
    get front() { return front; },
    get done() { return time >= total; },
    get phase() { return time >= total ? 'done' : time >= creep ? 'burst' : 'creep'; },
    burstAt: creep,
  };
}
