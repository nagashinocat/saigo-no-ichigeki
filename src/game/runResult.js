// R3 fix1: 結果を出すときに一度だけ呼ぶ（main.js の 'over'）。この街の自己ベストを出し、今日の初撃退・記録の塗り替え・日本時間の時刻を
// 決め、結果に出す称号を一つ選ぶ（titles.js pickTitle。並びはその回の種）。初めて出た称号は NEW。端末に覚えるのは出した称号だけ
import { pickTitle, runSeed, TITLES } from './titles.js';

export const jstHour = (nowMs) => new Date(nowMs + 9 * 3600 * 1000).getUTCHours();

export function settleRun({ records, cityKey, citySeed, reason, outcome, stats, damage, cityValue, now = Date.now() }) {
  const released = reason === 'released' && !!outcome;
  const prev = records.best(cityKey);
  const clear = released && outcome.clear;
  // 今日の初撃退: その日の街で、前に撃退成功（C でないベスト）が無い。試しの種（鍵なし）は付けない
  const firstClearToday = !!cityKey && clear && !(prev && prev.rank !== 'C');
  const best = released ? records.submitBest(cityKey, { rank: outcome.rank, damage }) : { best: prev, isNew: false, prev };
  const newBest = released && best.isNew && !!prev;
  const ctx = { reason, outcome: released ? outcome : null, stats, damage, cityValue, firstClearToday, newBest, hour: jstHour(now) };
  const id = pickTitle(ctx, runSeed(ctx, citySeed));
  const fresh = id ? records.addTitles([id]) : [];
  const t = id ? TITLES.find((x) => x.id === id) : null;
  return { best, ctx, titles: t ? [{ id: t.id, name: t.name, rarity: t.rarity, isNew: fresh.includes(id) }] : [] };
}
