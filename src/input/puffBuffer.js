// R1f（持ち主 18:14「払うの反応を確実にする（取りこぼしをなくす）」）: 前の払うがまだ広がっている間（game.puffBlock === 'busy'。払うの一発は約 0.63 秒広がる）の
// タップのうち、広がり終わる間際（残り windowSec 秒の内。game.puffBusyLeft）のものは捨てずに覚えておき、広がり終わったら払う。
// fix1（見直し Minor 5）: 広がり始めの直後の焦った 2 回目は覚えない（3 回しかない払うを、続けて叩いて 2 回使わない）。
// 足りない・使い切った（'short' / 'out'）は覚えない（ヒントを出す）。描画もゲームも知らない（main.js が毎フレーム take を呼ぶ）
export function createPuffBuffer({ windowSec = 0.25 } = {}) {
  let pending = null; // { x, y, t }
  return {
    get pending() { return pending; },
    get windowSec() { return windowSec; },
    // タップを受けた: why は game.puffBlock、busyLeft は game.puffBusyLeft（広がり終わるまでの残りの秒）。覚えたら true
    push(x, y, t, why, busyLeft = 0) {
      if (why !== 'busy' || !(busyLeft <= windowSec)) return false;
      pending = { x, y, t };
      return true;
    },
    // 毎フレーム: 覚えたタップがあり、今払えるなら（canPuff）その { x, y } を返して消す。古すぎるもの（windowSec + 0.15 秒より前）は捨てる
    take(t, canPuff) {
      if (!pending) return null;
      if (t - pending.t > windowSec + 0.15) { pending = null; return null; }
      if (!canPuff) return null;
      const p = pending;
      pending = null;
      return p;
    },
    clear() { pending = null; },
  };
}

// 持ち主 22:47「隠れるより先に払うが反応して爆発してる」: 溜めている間の 2 本目の指のタップの行き先（controls の onPuff / onHide）。
// 矢印のタップ（隠れる）は払うの道（puff と覚えておく払う）を通らず、覚えておいた払うも捨てる（隠れたあとに前のタップの払うが出ない）。
// 捨てるのは矢印に触れた瞬間（onArrowDown）と離したとき（onHide）
export function secondFingerTaps({ buffer, puff, hide }) {
  return {
    onPuff(x, y) { puff(x, y); },
    onHide(x, y) { buffer.clear(); hide(x, y); },
    // Fix round 1: 矢印に触れた瞬間にも捨てる（触れてから離すまでのフレームで、覚えておいた払うが出ない）
    onArrowDown() { buffer.clear(); },
  };
}
