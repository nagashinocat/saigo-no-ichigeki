// R1f（持ち主 18:14「払うの反応を確実にする（取りこぼしをなくす）」）: 前の払うがまだ広がっている間（game.puffBlock === 'busy'。払うの一発は約 0.63 秒広がる）のタップは、
// 黙って捨てずに覚えておき、広がり終わったら（holdSec 秒の内なら）そのとき払う。足りない・使い切った（'short' / 'out'）は覚えない（ヒントを出す）。
// 描画もゲームも知らない（main.js が毎フレーム take を呼ぶ）
export function createPuffBuffer({ holdSec = 0.7 } = {}) {
  let pending = null; // { x, y, t }
  return {
    get pending() { return pending; },
    // タップを受けた: why は game.puffBlock（払えたなら null を渡さない）。覚えたら true
    push(x, y, t, why) {
      if (why !== 'busy') return false;
      pending = { x, y, t };
      return true;
    },
    // 毎フレーム: 覚えたタップがあり、今払えるなら（canPuff）その { x, y } を返して消す。古すぎるものは捨てる
    take(t, canPuff) {
      if (!pending) return null;
      if (t - pending.t > holdSec) { pending = null; return null; }
      if (!canPuff) return null;
      const p = pending;
      pending = null;
      return p;
    },
    clear() { pending = null; },
  };
}
