import { CONFIG } from '../config.js';
import { frontAt, timeAtFront, phaseTimes, blastDuration } from '../game/blast.js';

// 最後の一発の演出の時間割（絵コンテ 1〜5、仕様 12 章）。描画は知らない純粋な関数だけ。
// t は放った瞬間からの演出の秒。
//   0〜hands        2画面のまま、手の画面で両手が組み合わさる
//   hands〜white    画面全体が真っ白（この間にゲームの時計を「前線がビルの手前に来たところ」まで進める）
//   white〜contact  軍勢の一人の目線: 前線がビルに届き、窓ガラスが砕ける。時間がだんだん止まっていく
//   contact〜beatEnd 体感時間がほぼ止まる。宙に浮いたガラス片に目が映り、ゆっくり見開く。音は心臓の鼓動だけ
//   beatEnd〜snap   瞳の光が画面を満たす（白）→ 時間が戻り一気に弾ける（戻った直後は burstRate から現実の速さへ）
//   snap〜chaseEnd  追ってくる爆発からカメラが引く
//   chaseEnd〜flatten 宇宙のカメラ: 夕暮れの地球の丸みの上で光の半球がふくらみ、衝撃波の輪が雲の上を走る
//   flatten〜lineEnd 半球が地平に沿って押しつぶされ、横一線の光になり、細くなって消える
//   lineEnd〜rumble 無音
//   rumble〜end     低い地鳴り。end で結果へ渡す
export const FINALE = {
  hands: 0.28,
  white: 0.52,
  contact: 1.34,
  beatEnd: 4.02,
  snapSec: 0.12,
  chaseMin: 1.5,       // 追われて引く最短の秒
  chaseTail: 0.4,      // 前線が半径に届いてから宇宙へ切り替わるまで
  spaceSec: 3.1,
  flattenSec: 1.15,
  thinSec: 0.55,
  silenceSec: 0.55,
  rumbleHold: 1.1,
  slowRate: 0.012,
  burstRate: 0.32,     // 時間が戻った直後の進み（弾けた光の壁が通りを走るのが見える速さ）。burstRamp 秒で現実の速さへ
  burstRamp: 0.75,     // ほぼ止まった時間の進み（体感時間に対する現実の時間の割合）
  approachFrac: 0.5,   // 白が晴れたとき、前線はビルの手前までの距離のこの割合
  crawl: 1.0,          // 止まった一拍の間に前線が進む距離（m）。どの大きさの一発でも同じ見え方に
  beats: [1.52, 2.42, 3.3], // 心臓の鼓動（演出の秒）
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const easeOutCubic = (x) => 1 - (1 - clamp01(x)) ** 3;

// 体感時間（小道具の時計）の進む速さ: 白が晴れたときは現実と同じ、contact へ向けてなめらかに slowRate まで落ち、
// 一拍の間はそのまま、snap で現実に戻る
export function timeScaleAt(t, F = FINALE) {
  if (t < F.white) return 1;
  if (t < F.contact) return 1 - (1 - F.slowRate) * smooth((t - F.white) / (F.contact - F.white));
  if (t < F.beatEnd) return F.slowRate;
  return 1;
}

// timeScaleAt の積分（白が晴れた瞬間を 0 とする体感の秒）
export function perceivedTime(t, F = FINALE) {
  if (t <= F.white) return t - F.white;
  const L = F.contact - F.white, k = 1 - F.slowRate;
  const u = Math.min(t, F.contact) - F.white, s = u / L;
  // ∫(1 − k·smoothstep) = u − k·L·(s³ − s⁴/2)
  let p = u - k * L * (s ** 3 - s ** 4 / 2);
  if (t <= F.contact) return p;
  p += F.slowRate * (Math.min(t, F.beatEnd) - F.contact);
  if (t <= F.beatEnd) return p;
  return p + (t - F.beatEnd);
}

// 一発ごとの時刻表。hitDist: 前線が狙うビルに届く距離（m）
export function createTimeline({ radius, hitDist }, F = FINALE, cfg = CONFIG) {
  const freeze = cfg.cinematic.freezeSec;
  const { creep } = phaseTimes(radius, cfg);
  const total = blastDuration(radius, cfg);
  const dHit = Math.min(Math.max(hitDist, 1), radius * 0.98);
  const bHit = timeAtFront(dHit, radius, cfg);
  const b0 = Math.min(bHit, timeAtFront(dHit * F.approachFrac, radius, cfg));
  const dEnd = Math.min(radius, dHit + F.crawl);
  const bEnd = timeAtFront(dEnd, radius, cfg);
  // 時間が戻った瞬間、じわじわ期が残っていればそこまで一気に進める（戻った瞬間が弾ける瞬間）
  const bSnap = Math.max(bEnd, creep);
  const snap = F.beatEnd + F.snapSec;
  // 時間が戻った直後は burstRate から現実の速さへ上がる: 戻ってから x 秒で進む爆発の時間
  const r0 = F.burstRate, L = F.burstRamp;
  const after = (x) => {
    if (x <= 0) return 0;
    const u = Math.min(x, L) / L;
    return r0 * x + (1 - r0) * (L * (u ** 3 - u ** 4 / 2) + Math.max(0, x - L));
  };
  // 爆発が終わるまでの、戻ってからの秒（after の逆。after は単調に増える）
  const need = total - bSnap;
  let lo = 0, hi = need / r0 + L;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (after(m) < need) lo = m; else hi = m; }
  const chaseEnd = snap + Math.max(F.chaseMin, hi + F.chaseTail);
  const flatten = chaseEnd + F.spaceSec;
  const lineEnd = flatten + F.flattenSec + F.thinSec;
  const rumble = lineEnd + F.silenceSec;
  const end = rumble + F.rumbleHold;

  // 爆発の時計 b（爆発が始まってからのゲームの秒）
  function blastClock(t) {
    if (t <= F.white) return t <= F.hands ? -freeze : -freeze + (freeze + b0) * (t - F.hands) / (F.white - F.hands);
    if (t <= F.contact) return b0 + (bHit - b0) * easeOutCubic((t - F.white) / (F.contact - F.white));
    // 一拍の間は前線が一定の速さで crawl m だけ這う（じわじわ期と弾ける期の境をまたいでも跳ばない）
    if (t <= F.beatEnd) return timeAtFront(dHit + (dEnd - dHit) * (t - F.contact) / (F.beatEnd - F.contact), radius, cfg);
    if (t <= snap) return bEnd + (bSnap - bEnd) * smooth((t - F.beatEnd) / F.snapSec);
    return bSnap + after(t - snap);
  }

  const self = {
    radius, hitDist: dHit, bHit, b0, bEnd, bSnap, total,
    hands: F.hands, white: F.white, contact: F.contact, beatEnd: F.beatEnd, snap, chaseEnd, flatten, lineEnd, rumble, end,
    beats: F.beats,
    blastClock,
    // 放ってからのゲームの時計（freezeSec の止まった間を含む）
    gameClock: (t) => freeze + blastClock(t),
    // 演出の t0 → t1 の間に、ゲームを進める秒
    gameDt: (t0, t1) => Math.max(0, freeze + blastClock(t1) - (freeze + blastClock(t0))),
    front: (t) => frontAt(Math.max(0, blastClock(t)), radius, cfg),
    // 世界（破片・粉・球の模様）の時間の進み: ゲームの時計と同じ割合（白の間は止める）
    worldRate(t, dt) {
      if (t < F.white || dt <= 0) return 0;
      return Math.max(0, (blastClock(t) - blastClock(Math.max(F.white, t - dt))) / dt);
    },
    // いまの段: hands | white | contact | beat | snap | chase | space | flatten | silence | rumble | done
    stage(t) {
      if (t < F.hands) return 'hands';
      if (t < F.white) return 'white';
      if (t < F.contact) return 'contact';
      if (t < F.beatEnd) return 'beat';
      if (t < snap) return 'snap';
      if (t < chaseEnd) return 'chase';
      if (t < flatten) return 'space';
      if (t < lineEnd) return 'flatten';
      if (t < rumble) return 'silence';
      if (t < end) return 'rumble';
      return 'done';
    },
  };
  return self;
}
