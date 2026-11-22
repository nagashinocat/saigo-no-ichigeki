// R2（spec §15 評価のランク）: 撃退の成否・放ったときの残り時間・払った回数・被害額から S〜C を付ける。
// R3（今日の街）: 街ごとに壊せるものの値打ちの合計が違う（今日の街 240 日分で 0.40〜0.46兆、最大/最小 1.16）ので、点は街の値打ちで割る。
//  腕前の点 = 被害額 × (1 + puffStep × 使わなかった払う) ÷ 街の値打ちの合計（街の何倍ぶんの被害か。被害額には残り時間とすぐそばの倍率がもう入っている）
//  S: 撃退成功・残り S.timeLeft 秒以内に放った・点が S.points 以上
//  A: 撃退成功・点が A.points 以上
//  B: 撃退成功
//  C: 撃退失敗・ブラックホール（被害額がいくら大きくても）
// 線は scripts/rank-sim.mjs（最善の操作 + 最善の放ち方 releaseBot、今日の街 20261101 から 240 日分）の分布から（制作側の判断。持ち主が直せる）。
//  撃退成功の回は街をほぼ壊し切るので、点は 3（一発の倍率の上限）× ギリギリの倍率 × 払うの分 の段に並ぶ:
//  6.946（全部の回の 11.3%）・6.748（13.3%）… → S 6.85（段の間。27/240 = 11%）。6.152（41.3%）・6.124（42.5%）→ A 6.14（S と A で 41%）。
//  B 19%、C 40%（撃退成功 144/240）
export const RANK = { S: { points: 6.85, timeLeft: 3 }, A: { points: 6.14 }, puffStep: 0.04, puffUses: 3 };

export function rankPoints({ damage, puffs, cityValue }, R = RANK) {
  const unused = Math.max(0, R.puffUses - Math.max(0, puffs ?? R.puffUses));
  return damage * (1 + R.puffStep * unused) / cityValue;
}

export function rankFor({ clear, timeLeft, puffs, damage, cityValue }, R = RANK) {
  if (!clear) return 'C';
  const p = rankPoints({ damage, puffs, cityValue }, R);
  if (p >= R.S.points && timeLeft <= R.S.timeLeft) return 'S';
  if (p >= R.A.points) return 'A';
  return 'B';
}
