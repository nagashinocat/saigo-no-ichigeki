import { CONFIG } from '../config.js';

// 爆発の前線は時間の関数。大きな一発ほど長い（最大の一発での秒数を sqrt(radius / max) で縮める）。
//   払う（小爆発、small）: じわじわ期（ゆっくり加速して radius の creepFrac まで）→ 弾ける期（速さが跳ね上がり、
//     はじめが最速で、最後は少しゆるむ ease-out で radius へ）。
//   最後の一発: じわじわ期（払うと同じ）→ 弾ける期（一気に radius の burstFrac まで。はじめが最速で、終わりは
//     見せる期のはじめの速さへなめらかに落ちる）→ 見せる期（光の壁が街を飲みながらゆっくり進み、ゆるんで radius で止まる。
//     ビルが飲まれていく様子・球の全体・宇宙での半球を見せる間）。
// small を省くと最後の一発の曲線。

// S8: 払う（small）の秒は、前の最大の半径 blast.smallRef m を基準に縮める（最大の半径を広げても、払うの広がり方・
// 釣り合いは前のまま）。最後の一発は今の最大の半径（radius.max）が基準
export function phaseTimes(radius, cfg = CONFIG, small = false) {
  const k = Math.sqrt(radius / (small ? cfg.blast.smallRef ?? cfg.radius.max : cfg.radius.max));
  const creep = Math.max(cfg.blast.creepMin, cfg.blast.creepSec * k);
  if (small) return { creep, burst: Math.max(cfg.blast.burstMin, cfg.blast.burstSec * k), show: 0 };
  const F = cfg.finalBlast;
  return { creep, burst: Math.max(F.burstMin, F.burstSec * k), show: Math.max(F.showMin, F.showSec * k) };
}

export function blastDuration(radius, cfg = CONFIG, small = false) {
  const p = phaseTimes(radius, cfg, small);
  return p.creep + p.burst + p.show;
}

// 最後の一発の弾ける期の形: 0〜1 の u で 0〜1 へ進む。ease-out（1 − (1 − u)^n）と一定の速さを (1 − e) : e で混ぜる。
// 速さははじめが最速（(1 − e)·n + e）で、終わりの e（見せる期のはじめの速さ）まで一度も上がらずに落ちる
const burstCurve = (u, n, e) => (1 - e) * (1 - (1 - u) ** n) + e * u;

function shape(radius, cfg, small) {
  const p = phaseTimes(radius, cfg, small);
  const f0 = cfg.blast.creepFrac * radius;
  if (small) return { ...p, f0, f1: radius };
  const F = cfg.finalBlast;
  const f1 = F.burstFrac * radius;
  // 見せる期: f1 + (radius − f1)·(1 − (1 − u)^pow)。はじめの速さ pow·(radius − f1)/show
  const v1 = F.showPow * (radius - f1) / p.show;
  const e = Math.min(1, v1 * p.burst / Math.max(1e-9, f1 - f0));
  return { ...p, f0, f1, n: F.burstPow, e, pow: F.showPow };
}

// t: 爆発開始からの秒
export function frontAt(t, radius, cfg = CONFIG, small = false) {
  if (t <= 0) return 0;
  // 終わったら半径ちょうど（f1 + (radius − f1) の浮動小数の足し算は radius にわずかに届かないことがあり、
  // 半径ちょうどの者が生き残ってしまう。S9 fix1）
  if (t >= blastDuration(radius, cfg, small)) return radius;
  const s = shape(radius, cfg, small);
  if (t < s.creep) { const u = t / s.creep; return s.f0 * u * u; }
  if (small) {
    const u = Math.min(1, (t - s.creep) / s.burst);
    return s.f0 + (radius - s.f0) * (1 - (1 - u) ** 3);
  }
  if (t < s.creep + s.burst) return s.f0 + (s.f1 - s.f0) * burstCurve((t - s.creep) / s.burst, s.n, s.e);
  const u = Math.min(1, (t - s.creep - s.burst) / s.show);
  return s.f1 + (radius - s.f1) * (1 - (1 - u) ** s.pow);
}

// frontAt の逆（カメラが「あと何秒でどこまで届くか」を先読みするため）
export function timeAtFront(front, radius, cfg = CONFIG, small = false) {
  if (front <= 0) return 0;
  if (front >= radius) return blastDuration(radius, cfg, small);
  const s = shape(radius, cfg, small);
  if (front < s.f0) return s.creep * Math.sqrt(front / s.f0);
  if (small) return s.creep + s.burst * (1 - (1 - (front - s.f0) / (radius - s.f0)) ** (1 / 3));
  if (front < s.f1) {
    // 弾ける期の形は単調なので二分法で解く
    const g = (front - s.f0) / (s.f1 - s.f0);
    let lo = 0, hi = 1;
    for (let i = 0; i < 48; i++) { const m = (lo + hi) / 2; if (burstCurve(m, s.n, s.e) < g) lo = m; else hi = m; }
    return s.creep + s.burst * (lo + hi) / 2;
  }
  return s.creep + s.burst + s.show * (1 - (1 - (front - s.f1) / (radius - s.f1)) ** (1 / s.pow));
}

// 球状に広がる爆発の前線。対象は dist の昇順に並べ、カーソルを進めるだけで判定する。
// shot.small（払う）は払うの曲線、それ以外は最後の一発の曲線
export function createBlast(shot, targets, cfg = CONFIG) {
  const small = !!shot.small;
  const sorted = targets.filter((t) => t.dist <= shot.radius).sort((a, b) => a.dist - b.dist);
  const vaporizeDist = shot.radius * cfg.blast.vaporizeRatio;
  const { creep, burst } = phaseTimes(shot.radius, cfg, small);
  const total = blastDuration(shot.radius, cfg, small);
  let time = 0;
  let front = 0;
  let cursor = 0;
  return {
    update(dt) {
      time += dt;
      front = frontAt(time, shot.radius, cfg, small);
      const hits = [];
      while (cursor < sorted.length && sorted[cursor].dist <= front) {
        const t = sorted[cursor++];
        hits.push({ id: t.id, kind: t.dist < vaporizeDist ? 'vaporize' : 'push' });
      }
      return hits;
    },
    get front() { return front; },
    get done() { return time >= total; },
    // creep → burst → show（最後の一発だけ）→ done
    get phase() { return time >= total ? 'done' : time >= creep + burst && !small ? 'show' : time >= creep ? 'burst' : 'creep'; },
    burstAt: creep,
  };
}
