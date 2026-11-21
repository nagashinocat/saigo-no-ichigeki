import { CONFIG } from '../config.js';
import { createRng } from '../rng.js';
import { generateCity } from '../world/cityGen.js';
import { createPower } from './power.js';
import { createCharge } from './charge.js';
import { createTimer } from './timer.js';
import { createScore } from './score.js';
import { createBlast } from './blast.js';
import { createEnemies } from './enemies.js';

const MAX_DT = 0.1;

// ゲーム全体の進行。描画や入力デバイスは知らず、pressStart/pressEnd/puff/update だけで動く。
// phase: 'ready' → 'playing'（長押しで力を貯める・小爆発で払う） → 'cinematic'（最後の一発を放った瞬間、演出の間は止まる）
//        → 'finale'（最後の一発が街を壊していく） → 'over'（'released': その一発の破壊額 / 'blackhole': 時間切れまで放たなかった）
// 勝ち負け（S9、持ち主 13:16）: 放った瞬間に生きている軍勢（見回る者を含む）を写し、一発が終わったとき全員倒れていれば
// 撃退成功（clear）、一人でも残れば撃退失敗。放ったあとは湧かず、あとから現れた者は数えない。破壊額はおまけの点数
export function createGame({ seed, cfg = CONFIG }) {
  const city = generateCity(seed, cfg);
  // 見回る者（S8）は別の乱数（探して掴みに来る者の湧き方・動きは前のまま）
  const enemies = createEnemies(createRng(seed + 1), cfg, { buildings: city.buildings, patrolRng: createRng((seed ^ 0x9a7b1) >>> 0) });
  const power = createPower(cfg.power);
  const charge = createCharge(power, cfg);
  const timer = createTimer(cfg.roundSeconds);
  const score = createScore(cfg.score);

  // 建物と props は id が別の連番なので、接頭辞を付けて一つの表にする
  const byKey = new Map();
  for (const b of city.buildings) byKey.set('b' + b.id, b);
  for (const p of city.props) byKey.set('p' + p.id, p);
  // 高架の橋桁の一区間（S8。'x' 高速 / 'r' 線路。id にもう接頭辞が付いている）
  for (const s of city.transit?.segments ?? []) byKey.set(s.id, s);
  const destroyed = new Set();

  const listeners = {};
  const emit = (name, payload) => { for (const fn of listeners[name] ?? []) fn(payload); };

  let phase = 'ready';
  let hidden = false;
  let grabbing = 0;
  let cinematicClock = 0;
  let pendingShot = null;
  let finalBlast = null;
  let blasts = []; // { id, shot, blast, values }
  let releaseIds = null; // 放った瞬間に生きていた軍勢の id
  let outcome = null; // { clear, total, survivors: [{ id, x, z, patrol }] }（最後の一発のときだけ）
  let nextBlastId = 1;

  // 小爆発は軍勢だけを払う（対象のビル・props はなし）。最後の一発はまだ壊れていないものすべて
  function startBlast(shot) {
    const targets = [];
    if (!shot.small) for (const [id, t] of byKey) if (!destroyed.has(id)) targets.push({ id, dist: t.dist });
    const b = { id: nextBlastId++, shot, blast: createBlast(shot, targets, cfg), values: [] };
    blasts.push(b);
    return b;
  }

  function finish(reason) {
    blasts = [];
    phase = 'over';
    charge.active = false;
    emit('over', outcome ? { reason, total: score.total, outcome } : { reason, total: score.total });
  }

  // 一発が終わった: 放った瞬間に生きていた者のうち、まだ倒れていない者が生き残り
  function judge() {
    const survivors = [];
    for (const e of enemies.list) {
      if (!releaseIds.has(e.id) || e.state === 'dead') continue;
      survivors.push({ id: e.id, x: e.x, z: e.z, patrol: !!e.patrol });
    }
    outcome = { clear: survivors.length === 0, total: releaseIds.size, survivors };
  }

  // settled: settle が一気に進めた分の命中（描く側は見た目を作らなくてよい）
  function updateBlasts(dt, settled = false) {
    for (const b of blasts) {
      for (const hit of b.blast.update(dt)) {
        if (destroyed.has(hit.id)) continue;
        destroyed.add(hit.id);
        const target = byKey.get(hit.id);
        b.values.push(target.value);
        emit('hit', settled ? { hit, target, settled } : { hit, target });
      }
      enemies.applyBlastFront(b.blast.front);
    }
    blasts = blasts.filter((b) => !b.blast.done);
  }

  function beginFinale() {
    emit('cinematicEnd');
    phase = 'finale';
    finalBlast = startBlast(pendingShot);
    pendingShot = null;
  }
  function scoreFinale() {
    const added = score.addShot(finalBlast.values);
    emit('shotScored', { added, total: score.total });
    judge();
    finish('released');
  }

  // 前の小爆発が広がり終わるまでは次を押せない（連打で力を無駄にせず、画面も跳ばない）
  const canPuff = () => !hidden && phase === 'playing' && power.canSpend(cfg.puff.cost) && !blasts.some((b) => b.shot.small);

  return {
    city, enemies, power, charge, timer, score,
    get phase() { return phase; },
    // 今、主人公を掴んでいる軍勢の数
    get grabbing() { return grabbing; },
    // 今、街に生きている軍勢の数（見回る者を含む。HUD の「街の軍勢 N」）
    get aliveCount() { let n = 0; for (const e of enemies.list) if (e.state !== 'dead') n++; return n; },
    // 最後の一発の勝ち負け（over(released) のあと。それまでと時間切れは null）
    get outcome() { return outcome; },
    // 小爆発のボタンを押せるか（力が足りる・遊んでいる最中・前の小爆発が広がり終わった）
    get canPuff() { return canPuff(); },
    // 進行中の一発の読み取り専用の写し（描画が一発ごとに球を描くため）。小爆発は shot.small
    get blasts() {
      return Object.freeze(blasts.map((b) => Object.freeze({ id: b.id, shot: b.shot, front: b.blast.front })));
    },
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    setHidden(h) { hidden = h; },

    pressStart() {
      if (hidden) return;
      if (phase === 'ready') phase = 'playing';
      if (phase !== 'playing') return;
      if (!charge.active) charge.start();
    },

    // 離す: 貯めた力が minRelease 以上なら最後の一発（ここでゲームの進行は終わり、演出 → 爆発 → 結果）
    pressEnd() {
      if (phase !== 'playing' || !charge.active) return;
      const shot = charge.release();
      // 足りない: 放たない。手の画面とヒントで「まだ足りない」を知らせる
      if (!shot) { emit('fizzle', { power: power.value, need: cfg.power.minRelease }); return; }
      releaseIds = new Set(enemies.list.filter((e) => e.state !== 'dead').map((e) => e.id));
      emit('shot', shot);
      phase = 'cinematic';
      timer.pause();
      cinematicClock = 0;
      pendingShot = shot;
      emit('cinematicStart', shot);
    },

    // 最後の一発を放ったあと（演出の止まった間・爆発の途中）なら、その一発を一気に最後まで進めて over(released) にする
    // （演出が先に終わってしまっても、リプレイの前に必ず結果が決まるように）。それ以外のときは何もしない
    settle() {
      if (phase !== 'cinematic' && phase !== 'finale') return;
      if (phase === 'cinematic') beginFinale();
      for (let i = 0; i < 100000 && !finalBlast.blast.done; i++) updateBlasts(MAX_DT, true);
      scoreFinale();
    },

    // 指を離していないのに押下が途切れた（タブを隠した・blur・pointercancel）: 放たずに貯めを止める。力は残る
    pressCancel() { charge.cancel(); },

    // 小爆発のボタン: 力を cost 使って主人公のまわりの軍勢を払う。押せたら true
    puff() {
      if (!canPuff()) return false;
      power.spend(cfg.puff.cost);
      const shot = { amount: cfg.puff.cost, radius: cfg.puff.radius, isBig: false, small: true };
      startBlast(shot);
      emit('puff', shot);
      return true;
    },

    update(rawDt) {
      if (hidden || phase === 'ready' || phase === 'over') return;
      let dt = Number.isFinite(rawDt) ? Math.min(Math.max(rawDt, 0), MAX_DT) : 0;

      if (phase === 'cinematic') {
        cinematicClock += dt;
        if (cinematicClock < cfg.cinematic.freezeSec) return;
        beginFinale();
        // 止まった間を越えた残りの時間は、そのまま爆発に渡す（捨てると前線が演出の時刻表より遅れる）
        dt = cinematicClock - cfg.cinematic.freezeSec;
        if (dt <= 0) return;
      }

      // 最後の一発の間は、爆発・命中・採点だけが進む（タイマー・軍勢・力は止まったまま）
      if (phase === 'finale') {
        updateBlasts(dt);
        if (finalBlast.blast.done) scoreFinale();
        return;
      }

      charge.update(dt);
      grabbing = enemies.update(dt);
      power.drain(grabbing * cfg.enemy.drainPerSec * dt);
      updateBlasts(dt);
      timer.update(dt);
      // 時間切れまで放たなければ、主人公はブラックホールになる（破壊額はつかない）
      if (timer.isOver()) finish('blackhole');
    },
  };
}
