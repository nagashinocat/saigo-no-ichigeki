import { CONFIG } from '../config.js';
import { createRng } from '../rng.js';
import { generateCity, cityValue as totalValue } from '../world/cityGen.js';
import { createPower } from './power.js';
import { createCharge } from './charge.js';
import { createTimer } from './timer.js';
import { createScore, releaseBonus } from './score.js';
import { nearCount } from './reach.js';
import { rankFor } from './rank.js';
import { createBlast } from './blast.js';
import { createEnemies } from './enemies.js';
import { createHeroMotion } from './hero.js';
import { distFrom } from './centre.js';
import { findCover } from './cover.js';

export { heroSpeedFactor } from './hero.js';

const MAX_DT = 0.1;

// ゲーム全体の進行。描画や入力デバイスは知らず、pressStart/pressEnd/puff/update だけで動く。
// phase: 'ready' → 'playing'（長押しで力を貯める・小爆発で払う） → 'cinematic'（最後の一発を放った瞬間、演出の間は止まる）
//        → 'finale'（最後の一発が街を壊していく） → 'over'（'released': その一発の破壊額 / 'blackhole': 時間切れまで放たなかった）
// 勝ち負け（S9、持ち主 13:16）: 放った瞬間に生きている軍勢（見回る者を含む）を写し、一発が終わったとき全員倒れていれば
// 撃退成功（clear）、一人でも残れば撃退失敗。放ったあとは湧かず、あとから現れた者は数えない。破壊額は結果画面で「被害額」として小さく出す
// M1（持ち主 09:11 / 09:15、spec §16）: 主人公は溜めている間だけ setMove の向きへ動く（hero.js）。爆心は放った瞬間の主人公の位置
// （shot.centre）。払うの爆心も払った瞬間の主人公の位置。勝ち負けの「倒れたか」は、その爆心からの距離で決まる
export function createGame({ seed, cfg = CONFIG }) {
  const city = generateCity(seed, cfg);
  // R3: 街の壊せるものの値打ちの合計（称号の「被害額の大きさ」に使う）
  const cityValue = totalValue(city);
  // 主人公（hero.js）。hero は { x, z, vx, vz, heading, lean } の同じ物で、軍勢の heroPos にも渡す（動くたびに書き換わる）
  const motion = createHeroMotion(city, cfg);
  const hero = motion.hero;
  // 見回る者（S8）は別の乱数（探して掴みに来る者の湧き方・動きは前のまま）
  // R1: 種類（重い者・吸う者）と大物の乱数も別（typeRng）
  const enemies = createEnemies(createRng(seed + 1), cfg, { buildings: city.buildings, patrolRng: createRng((seed ^ 0x9a7b1) >>> 0), typeRng: createRng((seed * 0x2c1b3c6d + 0x51ed27) >>> 0), heroPos: hero });
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
  let drainedTotal = 0; // R1b: 掴まれて実際に吸われた力の合計（増えるだけ）
  let cinematicClock = 0;
  let pendingShot = null;
  let finalBlast = null;
  let blasts = []; // { id, shot, blast, values }
  let releaseIds = null; // 放った瞬間に生きていた軍勢の id
  let releaseInfo = null; // R2: 放った瞬間の残り時間・すぐそばの数（ギリギリのボーナス）と払った回数（ランク）
  let outcome = null; // { clear, total, survivors: [{ id, x, z, patrol }] }（最後の一発のときだけ）
  let nextBlastId = 1;
  let maxCombo = 0; // R3: 一度の払うで払った数のいちばん多い回（称号「一掃」）
  let draggedIds = null; // R3: 放った瞬間に主人公を掴んでいた大物の id（称号「道連れ」）

  // 小爆発は軍勢だけを払う（対象のビル・props はなし）。最後の一発はまだ壊れていないものすべて。距離は爆心（shot.centre）から
  function startBlast(shot) {
    const targets = [];
    if (!shot.small) for (const [id, t] of byKey) if (!destroyed.has(id)) targets.push({ id, dist: distFrom(t, shot.centre) });
    // hits: 払う（小爆発）がこれまでに当てた軍勢の数（R1 の「×k」）
    const b = { id: nextBlastId++, shot, blast: createBlast(shot, targets, cfg), values: [], hits: 0 };
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
      survivors.push({ id: e.id, x: e.x, z: e.z, patrol: !!e.patrol, ...(e.kind ? { kind: e.kind } : {}) });
    }
    // R3: 掴んでいた大物がその一撃で倒れた（称号「道連れ」）
    const dragged = draggedIds.size > 0 && enemies.list.some((e) => draggedIds.has(e.id) && e.state === 'dead');
    outcome = { clear: survivors.length === 0, total: releaseIds.size, survivors, ...releaseInfo.extra, cityValue, dragged };
    // R2: ランク（rank.js）。R3 fix1: 残り時間と払った回数の条件
    outcome.rank = rankFor({ clear: outcome.clear, timeLeft: releaseInfo.timeLeft, puffs: releaseInfo.puffsUsed });
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
      const n = enemies.applyBlastFront(b.blast.front, b.shot.small ? { id: b.id, small: true } : null, b.shot.centre);
      // R1: 一度の払うで k ≥ combo.from 体を払ったら「×k」を知らせる（数が増えるたびに。見せるだけで力は戻さない）
      if (b.shot.small && n > 0) {
        b.hits += n;
        maxCombo = Math.max(maxCombo, b.hits);
        if (b.hits >= (cfg.puff.combo?.from ?? Infinity)) emit('combo', { k: b.hits, blastId: b.id });
      }
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
    // R2（spec §15 ギリギリのボーナス）: 一発の被害額（基）に、放った瞬間の残り時間とすぐそばの数の倍率をかける
    const base = score.addShot(finalBlast.values);
    const bonus = { base, ...releaseBonus(releaseInfo) };
    const added = base + score.addBonus(base * (bonus.mul - 1));
    releaseInfo.extra = { bonus, puffsUsed: releaseInfo.puffsUsed };
    releaseInfo.damage = score.total;
    emit('shotScored', { added, total: score.total });
    judge();
    finish('released');
  }

  // 前の小爆発が広がり終わるまでは次を押せない（連打で力を無駄にせず、画面も跳ばない）
  // M2（持ち主 09:11、spec §16）: 払うは 1 回のゲームで puff.uses 回まで。払えない理由: 'out'（使い切った）・'short'（力が足りない）・
  // 'busy'（前の払うが広がっている間）。遊んでいる最中でなければ 'off'。払えるなら null
  let puffsLeft = cfg.puff.uses ?? Infinity;
  const puffBlock = () => {
    if (hidden || phase !== 'playing') return 'off';
    if (puffsLeft <= 0) return 'out';
    if (!power.canSpend(cfg.puff.cost)) return 'short';
    if (blasts.some((b) => b.shot.small)) return 'busy';
    return null;
  };
  const canPuff = () => puffBlock() === null;

  // M2（持ち主 15:20）: 隠れる。理由: 'off'（遊んでいない・溜めていない）・'grabbed'（掴まれている・群がられている）・'cooldown'（前の隠れるから
  // hide.cooldown 秒の内）・'dashing'（滑り込んでいる途中）。隠れられるなら null（物陰が見つかるかは hide が確かめる）
  let hideCool = 0;
  const hideBlock = () => {
    if (hidden || phase !== 'playing' || !charge.active) return 'off';
    if (grabbing > 0 || enemies.list.some((e) => e.state === 'cling' || e.state === 'grab')) return 'grabbed';
    if (hero.dashing != null) return 'dashing';
    if (hideCool > 0) return 'cooldown';
    return null;
  };

  return {
    city, enemies, power, charge, timer, score,
    // R3: 街の壊せるものの値打ちの合計（称号の「被害額の大きさ」）
    cityValue,
    // M1: 主人公の位置と速さ { x, z, vx, vz, heading, lean }（読むだけ。試しは x, z を直に置いてよい）
    hero,
    get phase() { return phase; },
    // M1: 動く向き（世界の x, z。長さ 1 で全速、0 で止まる）。動くのは遊んでいる最中に溜めている間だけ
    setMove(x, z) { motion.setMove(x, z); },
    // 今、主人公を掴んでいる軍勢の数
    get grabbing() { return grabbing; },
    // R3: 一度の払うで払った数のいちばん多い回（称号「一掃」）
    get maxCombo() { return maxCombo; },
    // R1b: 掴まれて実際に吸われた力の合計（増えるだけ。HUD の「−N」と吸われる音が、フレームごとの差を使う）
    get drainedTotal() { return drainedTotal; },
    // 今、街に生きている軍勢の数（見回る者を含む。HUD の「街の軍勢 N」）
    get aliveCount() { let n = 0; for (const e of enemies.list) if (e.state !== 'dead') n++; return n; },
    // 最後の一発の勝ち負け（over(released) のあと。それまでと時間切れは null）
    get outcome() { return outcome; },
    // 小爆発のボタンを押せるか（力が足りる・遊んでいる最中・前の小爆発が広がり終わった）
    get canPuff() { return canPuff(); },
    // M2: 残りの払える回数（HUD の 3 つの点）と、今払えない理由（'out' / 'short' / 'busy' / 'off'。払えるなら null）
    get puffsLeft() { return puffsLeft; },
    get puffBlock() { return puffBlock(); },
    // M2: 今隠れられない理由（'off' / 'grabbed' / 'cooldown' / 'dashing'。隠れられるなら null）と、次の隠れるまでの秒
    get hideBlock() { return hideBlock(); },
    get hideCooldown() { return Math.max(0, hideCool); },
    // 今の物陰にあと何秒いられるか（隠れていなければ 0）
    get hideLeft() { return hero.hidden ? Math.max(0, cfg.hide.holdSec - (hero.hideT ?? 0)) : 0; },
    // M2（持ち主 15:20）: 向き（世界の x, z）の先の物陰へシュッと滑り込んで隠れる。隠れられたら true（物陰がなければ 'nocover' を知らせて false）
    hide(dx, dz) {
      if (hideBlock() !== null) return false;
      // 見えなくなる相手は、今追っている者（chase・よろめいて戻ってくる者）
      const watchers = enemies.list.filter((e) => (e.state === 'chase' || e.state === 'approach' || e.state === 'stagger') && e.x != null);
      const spot = findCover(hero, { x: dx, z: dz }, city.buildings, watchers, cfg);
      if (!spot) { emit('hideFail', { reason: 'nocover' }); return false; }
      const from = { x: hero.x, z: hero.z };
      hero.lastSeen = from;
      hero.hidden = true;
      hero.hideSpot = spot;
      hero.hideT = 0;
      const lost = enemies.loseHero(from);
      motion.dash(spot, cfg.hide.dashSec);
      hideCool = cfg.hide.cooldown;
      emit('hide', { from, to: spot, lost });
      return true;
    },
    // 進行中の一発の読み取り専用の写し（描画が一発ごとに球を描くため）。小爆発は shot.small
    get blasts() {
      return Object.freeze(blasts.map((b) => Object.freeze({ id: b.id, shot: b.shot, front: b.blast.front })));
    },
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    setHidden(h) { hidden = h; },

    // 導入の TAP START（S6）: 遊びを始める（タイマーが進み、軍勢が湧く）。貯めはしない。'ready' のときだけ
    begin() {
      if (phase === 'ready') phase = 'playing';
    },

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
      draggedIds = new Set(enemies.list.filter((e) => e.kind === 'boss' && (e.state === 'grab' || e.state === 'cling')).map((e) => e.id));
      // M1: 爆心は放った瞬間の主人公の位置。ここから主人公は止まる
      shot.centre = { x: hero.x, z: hero.z };
      releaseInfo = { timeLeft: timer.remaining, near: nearCount(enemies.list, shot.centre), puffsUsed: Number.isFinite(cfg.puff.uses) ? cfg.puff.uses - puffsLeft : 0 };
      motion.stop();
      hero.hidden = false;
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
      puffsLeft--;
      const shot = { amount: cfg.puff.cost, radius: cfg.puff.radius, isBig: false, small: true, centre: { x: hero.x, z: hero.z } };
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
      hideCool -= dt;
      // M2: 物陰から leaveDist m より離れたら、もう隠れていない（見られれば、また見つかる）。同じ物陰にいられるのは holdSec 秒まで
      // （制作側の判断: ずっと隠れたまま満タンまで待つ、にしない。次の物陰へ移る）
      if (hero.hidden) {
        hero.hideT += dt;
        const left = hero.dashing == null && Math.hypot(hero.x - hero.hideSpot.x, hero.z - hero.hideSpot.z) > cfg.hide.leaveDist;
        if (left || hero.hideT > cfg.hide.holdSec) { hero.hidden = false; emit('unhide', { x: hero.x, z: hero.z, reason: left ? 'left' : 'time' }); }
      }
      // 主人公が先に動き、軍勢は今の主人公を追う（掴んでいる者はついてくる）。動くのは溜めている間だけ
      motion.update(dt, { active: charge.active, grabbing });
      grabbing = enemies.update(dt);
      // M2: 物陰で見つかった（照らされて追われる・掴まれた）ら、もう隠れていない
      if (hero.hidden && hero.dashing == null && enemies.list.some((e) => e.state === 'chase' || e.state === 'grab' || e.state === 'cling')) { hero.hidden = false; emit('found', { x: hero.x, z: hero.z }); }
      // 掴んでいる者の吸う力（R1: 吸う者 ×2.5、大物 ×4）
      const v0 = power.value;
      power.drain(enemies.drainLoad * cfg.enemy.drainPerSec * dt);
      drainedTotal += v0 - power.value;
      for (const a of enemies.takeArrivals()) emit('bossArrive', a);
      updateBlasts(dt);
      timer.update(dt);
      // 時間切れまで放たなければ、主人公はブラックホールになる（破壊額はつかない）
      if (timer.isOver()) finish('blackhole');
    },
  };
}
