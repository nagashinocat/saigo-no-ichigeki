import { CONFIG } from '../config.js';

const DEAD_KEEP_SEC = 3;

// 軍勢。外から中心へ近づき、近づいたら主人公を掴む。爆発の前線に触れると倒れる。
export function createEnemies(rng, cfg = CONFIG) {
  const E = cfg.enemy;
  let list = [];
  let nextId = 1;
  let acc = 0;

  return {
    get list() { return list; },
    update(dt) {
      for (const e of list) if (e.state === 'dead') e.deadTime += dt;
      list = list.filter((e) => e.state !== 'dead' || e.deadTime < DEAD_KEEP_SEC);

      let grabbing = list.reduce((n, e) => n + (e.state === 'grab' ? 1 : 0), 0);
      for (const e of list) {
        if (e.state !== 'approach') continue;
        e.dist = Math.max(E.grabRange, e.dist - E.speed * dt);
        if (e.dist <= E.grabRange && grabbing < E.maxGrabbing) { e.state = 'grab'; grabbing++; }
      }

      acc += E.spawnPerSec * dt;
      while (acc >= 1) {
        acc -= 1;
        list.push({
          id: nextId++,
          angle: rng() * Math.PI * 2,
          dist: E.spawnDist[0] + rng() * (E.spawnDist[1] - E.spawnDist[0]),
          state: 'approach',
        });
      }
      return grabbing;
    },
    applyBlastFront(front) {
      let killed = 0;
      for (const e of list) {
        if (e.state === 'dead' || e.dist > front) continue;
        e.state = 'dead';
        e.deadTime = 0;
        killed++;
      }
      return killed;
    },
  };
}
