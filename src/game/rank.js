// R2（spec §15 評価のランク）: 撃退の成否・放ったときの残り時間・払った回数・被害額から S〜C を付ける。
//  腕前の点 = 被害額 × (1 + puffStep × 使わなかった払う)（払わずに隠れて溜めるほど上。被害額には残り時間とすぐそばの倍率がもう入っている）
//  S: 撃退成功・残り S.timeLeft 秒以内に放った・点が S.points 以上
//  A: 撃退成功・点が A.points 以上
//  B: 撃退成功
//  C: 撃退失敗・ブラックホール（被害額がいくら大きくても）
// 線は scripts/rank-sim.mjs（最善の操作 + 最善の放ち方 releaseBot、seed 1〜60）の分布から（制作側の判断。持ち主が直せる）:
//  撃退成功 41/60。点の 6 番目 2.882兆・7 番目 2.854兆 → S 2.87兆（6/60 = 10%）。24 番目 2.626兆・25 番目 2.608兆 → A 2.62兆
//  （S と A で 24/60 = 40%）。B 17/60（28%）、C 19/60（32%）
export const RANK = { S: { points: 2.87e12, timeLeft: 3 }, A: { points: 2.62e12 }, puffStep: 0.04, puffUses: 3 };

export function rankPoints({ damage, puffs }, R = RANK) {
  const unused = Math.max(0, R.puffUses - Math.max(0, puffs ?? R.puffUses));
  return damage * (1 + R.puffStep * unused);
}

export function rankFor({ clear, timeLeft, puffs, damage }, R = RANK) {
  if (!clear) return 'C';
  const p = rankPoints({ damage, puffs }, R);
  if (p >= R.S.points && timeLeft <= R.S.timeLeft) return 'S';
  if (p >= R.A.points) return 'A';
  return 'B';
}
