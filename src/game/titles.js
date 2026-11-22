// R3（spec §15 珍しい結末の称号）: 結果の称号のバッジ。端末に一度でも取った称号を覚え、初めて取ったときは NEW（records.js）。
//  すべてを飲み込んだ者: ブラックホールの結末（時間切れまで放たなかった）
//  ギリギリの英雄: 残り 1 秒以内に放って撃退成功
//  払わぬ者: 払うを 1 回も使わずに撃退成功（持ち主 16:36 の隠れながら溜める遊び方で届く。最善の操作のボットでも多い）
//  一掃: 一度の払うで 6 体以上を払った（結末によらない）
//  道連れ: 放った瞬間に主人公を掴んでいた大物が、その一撃で倒れた（撃退の成否によらない）
export const TITLES = [
  { id: 'blackhole', name: 'すべてを飲み込んだ者' },
  { id: 'closeCall', name: 'ギリギリの英雄' },
  { id: 'noPuff', name: '払わぬ者' },
  { id: 'sweep', name: '一掃' },
  { id: 'dragged', name: '道連れ' },
];
export const TITLE_RULES = { closeCallSec: 1, sweepFrom: 6 };

export const titleName = (id) => TITLES.find((t) => t.id === id)?.name ?? id;

// その回に取った称号の id（TITLES の順）。reason: 'released' | 'blackhole'、outcome: game.outcome（時間切れは null）、stats: { maxCombo }
export function earnedTitles({ reason, outcome, stats = {} }, R = TITLE_RULES) {
  const got = new Set();
  if (reason === 'blackhole') got.add('blackhole');
  if (reason === 'released' && outcome) {
    if (outcome.clear && outcome.bonus && outcome.bonus.timeLeft <= R.closeCallSec) got.add('closeCall');
    if (outcome.clear && outcome.puffsUsed === 0) got.add('noPuff');
    if (outcome.dragged) got.add('dragged');
  }
  if ((stats.maxCombo ?? 0) >= R.sweepFrom) got.add('sweep');
  return TITLES.map((t) => t.id).filter((id) => got.has(id));
}
