import { CONFIG } from '../config.js';

const DEAD_KEEP_SEC = 3;

// 湧く速さ（体/秒）。始まりから rampSec 秒で spawnRamp 倍へ一直線に増え、その後は保つ
export function spawnRateAt(t, cfg = CONFIG) {
  const E = cfg.enemy;
  const k = Math.min(1, Math.max(0, t / E.rampSec));
  return E.spawnPerSec * (1 + (E.spawnRamp - 1) * k);
}

// 近づく速さ（m/s）。掴む手前の slowDist m で、なめらかに slowMin 倍まで落とす。距離は主人公からの水平の距離
export function approachSpeed(dist, cfg = CONFIG) {
  const E = cfg.enemy;
  const t = Math.min(1, Math.max(0, (dist - E.grabRange) / E.slowDist));
  return E.speed * (E.slowMin + (1 - E.slowMin) * t * t * (3 - 2 * t));
}

// 軍勢。外から中心へ近づき、近づいたら主人公を掴む。爆発の前線に触れると倒れる。時間がたつほど多く湧く。
export function createEnemies(rng, cfg = CONFIG) {
  const E = cfg.enemy;
  let list = [];
  let nextId = 1;
  let acc = 0;
  let time = 0;

  return {
    get list() { return list; },
    update(dt) {
      for (const e of list) if (e.state === 'dead') e.deadTime += dt;
      list = list.filter((e) => e.state !== 'dead' || e.deadTime < DEAD_KEEP_SEC);

      let grabbing = list.reduce((n, e) => n + (e.state === 'grab' ? 1 : 0), 0);
      for (const e of list) {
        if (e.state === 'grab') e.grabTime += dt; // 掴んでからの秒（見た目が主人公の横へ寄るのに使う）
        if (e.state !== 'approach') continue;
        e.dist = Math.max(E.grabRange, e.dist - approachSpeed(e.dist, cfg) * dt);
        if (e.dist <= E.grabRange && grabbing < E.maxGrabbing) { e.state = 'grab'; e.grabTime = 0; grabbing++; }
      }

      // 区間の真ん中の速さで足す（台形と同じで、刻み幅によらず同じ数が湧く）
      acc += spawnRateAt(time + dt / 2, cfg) * dt;
      time += dt;
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
