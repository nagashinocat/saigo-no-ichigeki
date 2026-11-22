// R2（spec §15 評価のランク）→ R3 fix1（持ち主 19:03「ランクは条件にしよう」）: 点の線をやめ、はっきりした条件で決める。
//  S: 撃退成功・残り S.timeLeft（1）秒以内に放った・払う S.puffs（0）回
//  A: 撃退成功・残り A.timeLeft（3）秒以内に放った・払う A.puffs（1）回以下
//  B: 撃退成功
//  C: それ以外（撃退失敗・ブラックホール。被害額がいくら大きくても）
// 被害額・街の値打ちはランクに使わない（被害額は結果の数字・たとえ・称号で見せる）
export const RANK = { S: { timeLeft: 1, puffs: 0 }, A: { timeLeft: 3, puffs: 1 } };

export function rankFor({ clear, timeLeft, puffs }, R = RANK) {
  if (!clear) return 'C';
  const p = puffs ?? Infinity;
  if (timeLeft <= R.S.timeLeft && p <= R.S.puffs) return 'S';
  if (timeLeft <= R.A.timeLeft && p <= R.A.puffs) return 'A';
  return 'B';
}
