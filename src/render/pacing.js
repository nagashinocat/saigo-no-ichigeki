// 見せ方の速さの決まり（持ち主 2026-11-21 22:18）: 最後の一発の演出もリプレイも、ひとつの流れにそろえる。
//   爆発の始まりから少しふくらむ間（じわじわ期）はスローで、だんだん速くなり → 弾けた瞬間に現実の速さ → そのまま現実の速さ。
// 途中で止まったように見える間を作らない: 見せ方の時間の進み（爆発の秒 / 見せ方の秒）は、始まりから弾けるまで減らずに増え、
// 弾けたあとは 1 のまま（下がらない）。描画は知らない純粋な関数だけ。
//
// スローの間の進みの速さ: rate(u) = c·(q + (1 − q)·u²)（u は 0〜1、スローの始まりから終わりまで）。
//   q（slowStart）: 始まりの速さは終わりの速さのこの割合。c は「スローの間にちょうどじわじわ期の秒だけ爆発が進む」ように決まる。
//   スローの長さ: じわじわ期の秒 / slowAvg（平均の速さ）。ただし slowMin 秒より短くしない（小さな一発でもふくらむのが見える）。
// 終わりの速さ c は 1 未満（slowAvg / (q + (1 − q)/3) ≤ 0.6）なので、弾けた瞬間に速さは c から 1 へ跳ね上がる（下がらない）。
export const SWELL = { slowMin: 1.7, slowAvg: 0.32, slowStart: 0.3 };

// creep: じわじわ期の秒（爆発の時計）。戻り値の関数の x は、爆発が始まってからの見せ方の秒
export function createSwell(creep, S = SWELL) {
  const q = S.slowStart, norm = q + (1 - q) / 3;
  const L = Math.max(S.slowMin, creep / S.slowAvg);
  const c = creep / (L * norm);
  const part = (u) => creep * (q * u + (1 - q) * u * u * u / 3) / norm;
  const self = {
    sec: L,              // スローの長さ（見せ方の秒）。この瞬間に弾ける
    startRate: c * q,    // 始まりの進みの速さ
    endRate: c,          // 弾ける直前の進みの速さ
    creep,
    // 見せ方の x 秒での爆発の時計
    clock(x) {
      if (x <= 0) return 0;
      if (x >= L) return creep + (x - L);
      return part(x / L);
    },
    // 見せ方の x 秒での進みの速さ（爆発の秒 / 見せ方の秒）
    rate(x) {
      if (x < 0) return 0;
      if (x >= L) return 1;
      const u = x / L;
      return c * (q + (1 - q) * u * u);
    },
    // clock の逆: 爆発の時計 b に届く見せ方の秒
    inverse(b) {
      if (b <= 0) return 0;
      if (b >= creep) return L + (b - creep);
      let lo = 0, hi = 1;
      for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (part(m) < b) lo = m; else hi = m; }
      return L * (lo + hi) / 2;
    },
  };
  return self;
}
