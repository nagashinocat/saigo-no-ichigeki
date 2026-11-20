import { CONFIG } from '../config.js';
import { frontAt, timeAtFront, phaseTimes, blastDuration } from '../game/blast.js';

// リプレイの時間割（仕様 12 章の絵コンテ 6）。描画は知らない純粋な関数だけ。
// t はリプレイの秒（0 = 暗転から始まる）。爆発の時計 b（爆発が始まってからのゲームの秒）は t の単調な関数で、
// カットごとに伸び縮みする（ゆっくり → 一気に → ほとんど止まる）。カットの境目では b はつながっている（同じ一発を見続ける）。
//   intro   暗転（「リプレイ」）。この間に b を street の始まりまで先に進めておく
//   street  通りから見上げる: 遠くで唸る光が弾け、通りを光の壁が押し寄せ、目の前でほとんど止まり、呑み込まれる（白）
//   side    前線に沿って横へ流れる: 光の壁と並んで走り、ビルが壁に押しつぶされていく
//   top     真上から: 光の円が街の端まで広がりきり、衝撃波の輪が外へ走り、光が引くと穴が現れる
//   hero    光の中心: 光の中に浮かぶ主人公の影。光が引き、穴の上にひとり浮かぶ姿が残る
// 前線の距離で決めるカット（space: 'front'）は、壁が画面の中でどう動くかを直接決める（b は timeAtFront で求める）。
export const REPLAY = {
  intro: 0.5,
  tick: 1 / 60,          // リプレイの時計の刻み（刻みの並びがいつも同じなので、同じ写しから同じ結果になる）
  // knots: [u, 速さ]（カットの中の 0〜1 の位置と、相対的な進む速さ。折れ線で、カット全体の進みが決まった量になるよう縮める）
  // street の最後 tail の間に、止まりかけた壁が一気にカメラへ来る（呑まれて白）
  street: { dur: 2.9, tail: 0.1, knots: [[0, 0.1], [0.27, 0.1], [0.33, 1.0], [0.51, 0.6], [0.64, 0.05], [1, 0.02]] },
  side: { dur: 2.6, knots: [[0, 0.5], [0.12, 0.13], [0.8, 0.11], [1, 0.45]] },
  top: { dur: 2.7, knots: [[0, 0.3], [0.3, 0.55], [0.55, 1.0], [1, 0.75]] },
  hero: { dur: 3.8, knots: [[0, 0.55], [0.45, 0.32], [0.8, 0.12], [1, 0.05]] },
  streetStart: 0.7,      // street は、じわじわ期のこの割合の時刻から
  streetStop: 3,         // street は、前線がカメラのこの手前（m）に来たところまで
  streetHold: [0.2, 18, 34], // 壁がほとんど止まるのはカメラの手前 [距離の割合, 最小, 最大] m（近すぎると画面が白いだけになる）
  sideEnd: 0.86,         // side は、前線が半径のこの割合に来たところまで
  topAfter: 0.5,         // top は、前線が届ききってから球が消えるまでの時間（fadeSec）のこの割合まで
  heroAfter: 1.45,       // hero は、届ききってから fadeSec のこの倍まで
};

const CUTS = ['street', 'side', 'top', 'hero'];

// 折れ線の速さ knots の、0〜u の積分を 0〜1 の積分で割ったもの（単調に 0 → 1）
export function createWarp(knots) {
  const area = (u) => {
    let s = 0;
    for (let i = 0; i + 1 < knots.length; i++) {
      const [u0, r0] = knots[i], [u1, r1] = knots[i + 1];
      if (u <= u0) break;
      const e = Math.min(u, u1), k = (e - u0) / (u1 - u0);
      const re = r0 + (r1 - r0) * k;
      s += (e - u0) * (r0 + re) / 2;
    }
    return s;
  };
  const total = area(1);
  const rateAt = (u) => {
    for (let i = 0; i + 1 < knots.length; i++) {
      const [u0, r0] = knots[i], [u1, r1] = knots[i + 1];
      if (u <= u1) return r0 + (r1 - r0) * Math.max(0, (u - u0) / (u1 - u0));
    }
    return knots[knots.length - 1][1];
  };
  return {
    at: (u) => area(Math.min(1, Math.max(0, u))) / total,
    // 0〜1 の進みの、u あたりの速さ（at の微分）
    rate: (u) => rateAt(Math.min(1, Math.max(0, u))) / total,
  };
}

// radius: 一発の半径、streetDist: street のカメラの爆心からの距離（m）
export function createReplayTimeline({ radius, streetDist }, R = REPLAY, cfg = CONFIG) {
  const { creep } = phaseTimes(radius, cfg);
  const total = blastDuration(radius, cfg);
  const fade = cfg.blast.fadeSec;
  // 小さな一発ほど少し短く
  const scale = 0.78 + 0.22 * Math.sqrt(radius / cfg.radius.max);
  const f0 = frontAt(creep * R.streetStart, radius, cfg);
  const fStreet = Math.min(radius * 0.8, Math.max(f0 + 2, streetDist - R.streetStop));
  const [hk, hmin, hmax] = R.streetHold;
  const fHold = Math.min(fStreet - 0.5, Math.max(f0 + 1, streetDist - Math.min(hmax, Math.max(hmin, hk * streetDist))));
  const fSide = Math.max(fStreet + 1, radius * R.sideEnd);
  const bTop = total + fade * R.topAfter;
  const bHero = total + fade * R.heroAfter;
  const spans = {
    street: { space: 'front', a: f0, b: fHold, tailTo: fStreet },
    side: { space: 'front', a: fStreet, b: fSide },
    top: { space: 'blast', a: timeAtFront(fSide, radius, cfg), b: bTop },
    hero: { space: 'blast', a: bTop, b: bHero },
  };
  let t = R.intro;
  const cuts = CUTS.map((name) => {
    const dur = R[name].dur * scale;
    const c = { name, t0: t, t1: t + dur, dur, tail: R[name].tail ?? 0, ...spans[name], warp: createWarp(R[name].knots) };
    t += dur;
    return c;
  });
  const end = t;

  const cutAt = (tt) => {
    for (const c of cuts) if (tt < c.t1) return c;
    return cuts[cuts.length - 1];
  };
  // カットの中の値（前線の距離か爆発の時計）。tail があれば、最後の tail の間に b から tailTo へ加速して進む
  const valueIn = (c, tt) => {
    const u = (tt - c.t0) / c.dur;
    if (!c.tail) return c.a + (c.b - c.a) * c.warp.at(u);
    const head = 1 - c.tail;
    if (u <= head) return c.a + (c.b - c.a) * c.warp.at(u / head);
    const k = Math.min(1, (u - head) / c.tail);
    return c.b + (c.tailTo - c.b) * k * k;
  };
  const toBlast = (c, v) => (c.space === 'front' ? timeAtFront(v, radius, cfg) : v);
  const bStart = timeAtFront(f0, radius, cfg);

  return {
    radius, total, creep, cuts, end, intro: R.intro, tick: R.tick, bStart,
    streetFront: fStreet, sideFront: fSide,
    // リプレイの t での爆発の時計（intro の間は street の始まり。end のあとは止まる）
    blastAt(tt) {
      if (tt <= R.intro) return bStart;
      if (tt >= end) return toBlast(cuts[cuts.length - 1], spans.hero.b);
      const c = cutAt(tt);
      return toBlast(c, valueIn(c, tt));
    },
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
