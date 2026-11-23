import { CONFIG } from '../config.js';
import { frontAt, timeAtFront, phaseTimes, blastDuration } from '../game/blast.js';
import { createSwell } from './pacing.js';

// 最後の一発の演出の時間割（絵コンテ 1〜5、仕様 12 章。14 章: 広がりをゆっくりにして見せ場を作る）。描画は知らない純粋な関数だけ。
// t は放った瞬間からの演出の秒。
//   0〜hands        2画面のまま、手の画面で両手が玉を鷲掴みに握り込む
//   hands〜white    画面全体が真っ白（この間にゲームの時計を freezeSec 進め、白が晴れる瞬間に爆発が始まる）
//   （R0b、持ち主 22:15: ガラスの一拍はやめた。遠くの軍勢の後ろから、離れた所で起きた爆発が一気に広がり、軍勢を飲み込むのを撮る）
//   white〜burst    swell: 遠くの軍勢（見回る者）の後ろのカメラ。地平の爆心で爆発が始まり、少しふくらむ間（じわじわ期）は
//                   スロー（持ち主 22:18）。進みはだんだん速くなる（pacing.js の createSwell）
//   burst〜snap     race: 弾けた瞬間に現実の速さ。光の壁が街を走ってこちらへ迫り、ビル・高速・電車を飲み、軍勢を後ろから
//                   一気に飲む（engulf は撮る一人。そのあとカメラも飲まれ（camHit）白へ。snapLag 秒の白のあと追うカットへ）
//   snap〜chaseEnd  追ってくる爆発からカメラが引く。見せる期（ゆっくり進む光の壁）にビルが飲まれていくのを見せ、
//                   上へ・外へ引いて球の全体を見せる。前線が半径の spaceFront に来たら宇宙へ
//   chaseEnd〜flatten 宇宙のカメラ: 光の半球が街の前線の残りと同じくゆっくりゆるみながらふくらみ（domeAt。少なくとも
//                   domeMin 秒）、衝撃波の輪が雲の上を走る。ふくらみきった半球を spaceHold 秒見せる
//   flatten〜lineEnd 半球が両側から押しつぶされて縦に伸び、縦一線の光（光の柱。R1b）になり、細くなって消える
//   lineEnd〜rumble 無音
//   rumble〜end     低い地鳴り。end で結果へ渡す
// 見せ方の時間の進み（timeScale = 爆発の秒 / 演出の秒）は、爆発が始まってから弾けるまで減らずに増え、弾けたあとは 1 のまま
// （持ち主 22:18「初めから速い → ちょっと止まる → 速い」をやめる。途中で止まったような間を作らない）。
export const FINALE = {
  hands: 0.24,
  white: 0.44,
  passBeyond: 6,       // 追うカットへ切り替わるとき、光の壁はカメラのこの距離（m）先
  snapLag: 0.08,       // カメラが飲まれてから追うカットへ切り替わるまでの最短（白の間）
  riderFrac: 0.46,     // plan が乗り手の距離を渡さないときの、半径に対する割合
  camBack: 14,         // plan がカメラの距離を渡さないときの、乗り手からカメラまで（m）
  chaseMin: 1.5,       // 追われて引く最短の秒
  spaceFront: 0.8,     // 前線が半径のこの割合に来たら宇宙へ切り替わる（光の壁がまだ動いているうちに）
  domeMin: 2.2,        // 宇宙で半球がふくらむ最短の秒（前線が先に止まっていても、この秒をかけてゆっくりふくらむ）
  spaceHold: 0.5,      // 半球がふくらみきってから押しつぶされるまで
  spaceMin: 2.3,       // 宇宙のカットの最短の秒
  flattenSec: 1.0,
  thinSec: 0.5,
  silenceSec: 0.45,
  rumbleHold: 1.0,
};

// R1i（持ち主 2026-11-23 10:29）: 宇宙の段（最大・中・小）。段は放った一撃の半径で決める（CONFIG.spaceTier）。
// 宇宙へ切り替わる（chaseEnd）までは段によらない。宇宙からあと（半球のふくらみ・止まって見せる間・押しつぶし・細って消える・
// 無音・地鳴り）の秒を、小さい段ほど短くする（max は FINALE のまま）。spaceSound: 宇宙からあとの音の大きさ（最大に対する割合）
export const SPACE_BEATS = {
  max: { spaceSound: 1 },
  normal: { domeMin: 1.6, spaceHold: 0.35, spaceMin: 1.8, flattenSec: 0.8, thinSec: 0.4, silenceSec: 0.4, rumbleHold: 0.85, spaceSound: 0.6 },
  small: { domeMin: 0.8, spaceHold: 0.2, spaceMin: 1.1, flattenSec: 0.5, thinSec: 0.3, silenceSec: 0.3, rumbleHold: 0.6, spaceSound: 0.32 },
};
export function spaceTierFor(radius, cfg = CONFIG) {
  const T = cfg.spaceTier;
  if (!T) return 'max';
  return radius >= T.max ? 'max' : radius >= T.normal ? 'normal' : 'small';
}

// 一発ごとの時刻表。riderDist: 撮る一人（いちばん手前の乗り手）の爆心からの距離、firstDist: いちばん奥（爆心に近い）の乗り手
// （firstEngulf: その者が飲まれる時刻。firstEngulf〜camHit が、乗り手が光の壁を背にした影として順に飲まれていく間）、
// camDist: カメラの爆心からの距離（m。省けば riderFrac・camBack から）、tier: 宇宙の段（省けば半径から spaceTierFor）
export function createTimeline({ radius, riderDist = null, firstDist = null, camDist = null, tier = null }, F0 = FINALE, cfg = CONFIG) {
  const spaceTier = tier ?? spaceTierFor(radius, cfg);
  const F = { ...F0, ...SPACE_BEATS[spaceTier] };
  const freeze = cfg.cinematic.freezeSec;
  const { creep } = phaseTimes(radius, cfg);
  const total = blastDuration(radius, cfg);
  const swell = createSwell(creep);
  const f0 = frontAt(creep, radius, cfg);
  const cap = radius * 0.98;
  // 乗り手はじわじわ期の光の外（弾けてから飲まれる）、カメラはその後ろ、光の壁はカメラの passBeyond 先まで
  const dR = Math.min(cap - 1, Math.max(f0 + 1, riderDist ?? radius * F.riderFrac));
  const dC = Math.min(cap - 0.5, Math.max(dR + 0.5, camDist ?? dR + F.camBack));
  const dPass = Math.min(cap, dC + F.passBeyond);
  const dFirst = Math.min(dR, Math.max(f0 + 0.5, firstDist ?? dR));
  const burst = F.white + swell.sec;
  const at = (d) => burst + timeAtFront(d, radius, cfg) - creep; // 弾けてから前線が d に届く演出の時刻（現実の速さ）
  const engulf = at(dR), camHit = at(dC), firstEngulf = at(dFirst);
  const snap = Math.max(camHit + F.snapLag, at(dPass));
  const bSnap = creep + (snap - burst);
  // 前線が半径に届いて止まる（ゲームの一発が終わる）時刻
  const frontDone = burst + (total - creep);
  // 宇宙へ切り替わる: 前線が半径の spaceFront に来たとき（追われて引く最短の秒より短くはしない）
  const chaseEnd = Math.max(snap + F.chaseMin, at(F.spaceFront * radius));
  // 宇宙の半球がふくらみきる時刻: 前線が止まる時刻と、宇宙へ切り替わってから domeMin 秒の遅い方
  const domeEnd = Math.max(chaseEnd + F.domeMin, frontDone);
  const flatten = Math.max(chaseEnd + F.spaceMin, domeEnd + F.spaceHold);
  const lineEnd = flatten + F.flattenSec + F.thinSec;
  const rumble = lineEnd + F.silenceSec;
  const end = rumble + F.rumbleHold;

  // 爆発の時計 b（爆発が始まってからのゲームの秒）。白の間に止まっていた freezeSec を進め、白が晴れた瞬間が 0
  function blastClock(t) {
    if (t <= F.white) return t <= F.hands ? -freeze : -freeze * (1 - (t - F.hands) / (F.white - F.hands));
    return swell.clock(t - F.white);
  }
  // 見せ方の時間の進み（爆発の秒 / 演出の秒）。白の間は 0
  const timeScale = (t) => (t <= F.white ? 0 : swell.rate(t - F.white));

  // 宇宙の半球のふくらみ（0 → 1）: 街の前線の残り（宇宙へ切り替わったときの前線 fCut から半径まで）の進みと、
  // chaseEnd〜domeEnd を見せる期と同じゆるみ方（1 − (1 − u)^showPow）で進む時計の、遅い方
  const fCut = frontAt(Math.max(0, blastClock(chaseEnd)), radius, cfg);
  const domePow = cfg.finalBlast.showPow;
  function domeAt(t) {
    if (t <= chaseEnd) return 0;
    if (t >= domeEnd) return 1;
    const pt = 1 - (1 - (t - chaseEnd) / (domeEnd - chaseEnd)) ** domePow;
    if (radius - fCut < 1e-6) return pt;
    const pf = (frontAt(Math.max(0, blastClock(t)), radius, cfg) - fCut) / (radius - fCut);
    return Math.max(0, Math.min(pt, pf));
  }

  return {
    // R1i: 宇宙の段と、その段の押しつぶし・細る秒、宇宙からあとの音の大きさ
    tier: spaceTier, flattenSec: F.flattenSec, thinSec: F.thinSec, spaceSound: F.spaceSound,
    radius, riderDist: dR, firstDist: dFirst, camDist: dC, creepFront: f0, bSnap, total, swell,
    hands: F.hands, white: F.white, erupt: F.white, burst, resume: burst, firstEngulf, engulf, camHit, snap,
    chaseEnd, frontDone, domeEnd, flatten, lineEnd, rumble, end,
    blastClock, timeScale, domeAt, fCut,
    // 放ってからのゲームの時計（freezeSec の止まった間を含む）
    gameClock: (t) => freeze + blastClock(t),
    // 演出の t0 → t1 の間に、ゲームを進める秒
    gameDt: (t0, t1) => Math.max(0, blastClock(t1) - blastClock(t0)),
    front: (t) => frontAt(Math.max(0, blastClock(t)), radius, cfg),
    // 前線が d に届く演出の時刻（爆発が始まる前なら白の終わり）
    timeAtFront: (d) => F.white + swell.inverse(timeAtFront(Math.max(0, d), radius, cfg)),
    // 世界（破片・粉・球の模様）の時間の進み: ゲームの時計と同じ割合（白の間は止める）
    worldRate(t, dt) {
      if (t < F.white || dt <= 0) return 0;
      return Math.max(0, (blastClock(t) - blastClock(Math.max(F.white, t - dt))) / dt);
    },
    // いまの段: hands | white | swell | race | chase | space | flatten | silence | rumble | done
    stage(t) {
      if (t < F.hands) return 'hands';
      if (t < F.white) return 'white';
      if (t < burst) return 'swell';
      if (t < snap) return 'race';
      if (t < chaseEnd) return 'chase';
      if (t < flatten) return 'space';
      if (t < lineEnd) return 'flatten';
      if (t < rumble) return 'silence';
      if (t < end) return 'rumble';
      return 'done';
    },
  };
}
