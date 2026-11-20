import { CONFIG } from '../config.js';
import { createRng } from '../rng.js';
import { generateCity } from '../world/cityGen.js';
import { createReserve } from './reserve.js';
import { createCharge } from './charge.js';
import { createTimer } from './timer.js';
import { createScore } from './score.js';
import { createBlast } from './blast.js';
import { createEnemies } from './enemies.js';

const MAX_DT = 0.1;

// ゲーム全体の進行。描画や入力デバイスは知らず、pressStart/pressEnd/update だけで動く。
export function createGame({ seed, cfg = CONFIG }) {
  const city = generateCity(seed, cfg);
  const enemies = createEnemies(createRng(seed + 1), cfg);
  const reserve = createReserve(cfg.reserve);
  const charge = createCharge(reserve, cfg);
  const timer = createTimer(cfg.roundSeconds);
  const score = createScore(cfg.score);

  // 建物と props は id が別の連番なので、接頭辞を付けて一つの表にする
  const byKey = new Map();
  for (const b of city.buildings) byKey.set('b' + b.id, b);
  for (const p of city.props) byKey.set('p' + p.id, p);
  const destroyed = new Set();

  const listeners = {};
  const emit = (name, payload) => { for (const fn of listeners[name] ?? []) fn(payload); };

  let phase = 'ready';
  let hidden = false;
  let cinematicClock = 0;
  let pendingShot = null;
  let blasts = []; // { blast, values }

  function startBlast(shot) {
    const targets = [];
    for (const [id, t] of byKey) if (!destroyed.has(id)) targets.push({ id, dist: t.dist });
    blasts.push({ blast: createBlast(shot, targets, cfg), values: [] });
  }

  function finish(reason) {
    phase = 'over';
    charge.active = false;
    emit('over', { reason, total: score.total });
  }

  function updateBlasts(dt) {
    for (const b of blasts) {
      for (const hit of b.blast.update(dt)) {
        if (destroyed.has(hit.id)) continue;
        destroyed.add(hit.id);
        const target = byKey.get(hit.id);
        b.values.push(target.value);
        emit('hit', { hit, target });
      }
      enemies.applyBlastFront(b.blast.front);
    }
    const finished = blasts.filter((b) => b.blast.done);
    blasts = blasts.filter((b) => !b.blast.done);
    for (const b of finished) {
      const added = score.addShot(b.values);
      emit('shotScored', { added, total: score.total });
    }
  }

  return {
    city, enemies, reserve, charge, timer, score,
    get phase() { return phase; },
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    setHidden(h) { hidden = h; },

    pressStart() {
      if (hidden) return;
      if (phase === 'ready') phase = 'playing';
      if (phase !== 'playing' || timer.isOver()) return;
      if (!charge.active) charge.start();
    },

    pressEnd() {
      if (!charge.active) return;
      const shot = charge.release();
      if (!shot) return;
      emit('shot', shot);
      if (shot.isBig) {
        phase = 'cinematic';
        timer.pause();
        cinematicClock = 0;
        pendingShot = shot;
        emit('cinematicStart', shot);
      } else {
        startBlast(shot);
      }
    },

    update(rawDt) {
      if (hidden || phase === 'ready' || phase === 'over') return;
      const dt = Math.min(rawDt, MAX_DT);

      if (phase === 'cinematic') {
        cinematicClock += dt;
        if (cinematicClock >= cfg.cinematic.freezeSec) {
          emit('cinematicEnd');
          timer.resume();
          phase = 'playing';
          startBlast(pendingShot);
          pendingShot = null;
        }
        return;
      }

      reserve.regen(dt);
      charge.update(dt);
      const grabbing = enemies.update(dt);
      reserve.drain(grabbing * cfg.enemy.drainPerSec * dt);
      if (reserve.isEmpty()) { finish('drained'); return; }
      updateBlasts(dt);
      timer.update(dt);
      if (timer.isOver()) {
        charge.active = false; // 時間切れで貯めは打ち切る（新しい一発は撃てない）
        if (blasts.length === 0) finish('time');
      }
    },
  };
}
