import { CONFIG } from '../config.js';
import { frontAt, timeAtFront, phaseTimes, blastDuration } from '../game/blast.js';
import { createSwell } from './pacing.js';

// リプレイの時間割（仕様 12 章の絵コンテ 6）。描画は知らない純粋な関数だけ。
// t はリプレイの秒（0 = 暗転から始まる）。爆発の時計 b（爆発が始まってからのゲームの秒）は t の単調な関数。
// 持ち主 22:18: 最後の一発の演出と同じひとつの流れにそろえる（前は「初めから速い → ちょっと止まる → 速い」だった）。
//   爆発の始まりから少しふくらむ間（じわじわ期）はスローで、だんだん速くなり（pacing.js の createSwell）→ 弾けた瞬間に現実の
//   速さ → 終わりまで現実の速さ。途中で止まったような間を作らない（見せ方の時間の進みは弾けるまで減らず、弾けたあと 1 のまま）。
// カットの境目は爆発の時計で決める（同じ一発を見続ける。境目で b はつながっている）:
//   intro   暗転（「リプレイ」）。爆発はまだ始まらない
//   street  通りから見上げる: 遠くで光がスローでふくらみ、弾けて、通りを光の壁が押し寄せ、目の前で呑み込まれる（白）
//   side    ずっと引いた斜め上から、光の球・穴の縁・街の端を収めたまま横へ流れる（R1b。前線が半径の sideEnd まで）
//   top     真上から: 光の円が街の端まで広がりきり、衝撃波の輪が外へ走り、光が引くと穴が現れる
//   hero    光の中心: 光の中に浮かぶ主人公の影。光が引き、穴の上にひとり浮かぶ姿が残る
export const REPLAY = {
  intro: 0.5,
  tick: 1 / 60,          // リプレイの時計の刻み（刻みの並びがいつも同じなので、同じ写しから同じ結果になる）
  streetStop: 3,         // street は、前線がカメラのこの手前（m）に来たところまで（呑まれて白）
  sideEnd: 0.86,         // side は、前線が半径のこの割合に来たところまで
  topAfter: 0.5,         // top は、前線が届ききってから球が消えるまでの時間（fadeSec）のこの割合まで
  heroAfter: 2.2,        // hero は、届ききってから fadeSec のこの倍まで（光が引いて、穴の上に浮かぶ影を見せる間）
};

const CUTS = ['street', 'side', 'top', 'hero'];

// radius: 一発の半径、streetDist: street のカメラの爆心からの距離（m）
export function createReplayTimeline({ radius, streetDist }, R = REPLAY, cfg = CONFIG) {
  const { creep } = phaseTimes(radius, cfg);
  const total = blastDuration(radius, cfg);
  const fade = cfg.blast.fadeSec;
  const swell = createSwell(creep);
  const f0 = frontAt(creep, radius, cfg);
  const fStreet = Math.min(radius * 0.8, Math.max(f0 + 2, streetDist - R.streetStop));
  const fSide = Math.max(fStreet + 1, radius * R.sideEnd);
  // カットの終わりの爆発の時計
  const ends = {
    street: timeAtFront(fStreet, radius, cfg),
    side: timeAtFront(fSide, radius, cfg),
    top: total + fade * R.topAfter,
    hero: total + fade * R.heroAfter,
  };
  // 爆発の時計 b に届くリプレイの秒
  const tOf = (b) => R.intro + swell.inverse(b);
  let t = R.intro, b0 = 0;
  const cuts = CUTS.map((name) => {
    const t1 = tOf(ends[name]);
    const c = { name, t0: t, t1, dur: t1 - t, b0, b1: ends[name] };
    t = t1; b0 = ends[name];
    return c;
  });
  const end = t;
  const burst = R.intro + swell.sec;
  const cutAt = (tt) => {
    for (const c of cuts) if (tt < c.t1) return c;
    return cuts[cuts.length - 1];
  };

  return {
    radius, total, creep, cuts, end, intro: R.intro, tick: R.tick, bStart: 0, burst, swell,
    streetFront: fStreet, sideFront: fSide,
    // リプレイの t での爆発の時計（intro の間は 0。end のあとは止まる）
    blastAt(tt) {
      if (tt <= R.intro) return 0;
      return Math.min(ends.hero, swell.clock(tt - R.intro));
    },
    // 見せ方の時間の進み（爆発の秒 / リプレイの秒）。intro の間と end のあとは 0
    timeScale(tt) { return tt <= R.intro || tt >= end ? 0 : swell.rate(tt - R.intro); },
    frontAt(tt) { return frontAt(this.blastAt(tt), radius, cfg); },
    // { name, u（カットの中の 0〜1） }。intro の間は name = 'intro'、終わったら 'done'
    cutAt(tt) {
      if (tt < R.intro) return { name: 'intro', u: tt / R.intro, cut: null };
      if (tt >= end) return { name: 'done', u: 1, cut: null };
      const c = cutAt(tt);
      return { name: c.name, u: (tt - c.t0) / c.dur, cut: c };
    },
    cut(name) { return cuts.find((c) => c.name === name); },
  };
}
