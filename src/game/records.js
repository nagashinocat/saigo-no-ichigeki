// R3（spec §15）: 今日の街の自己ベストと取った称号を端末に覚える（サーバーは持たない。順位表も作らない）。
// storage は localStorage（無い・投げる・壊れた中身でも止まらない。保存できないときは、そのページの間だけ覚える）
export const KEY_PREFIX = 'saigo-no-ichigeki:';
const RANKS = ['C', 'B', 'A', 'S'];
const bestKey = (city) => `${KEY_PREFIX}best:${city}`;
const TITLES_KEY = `${KEY_PREFIX}titles`;

// a は b より良いか: ランクが先、同じランクなら被害額（b が無ければ良い）
export function betterThan(a, b) {
  if (!b) return true;
  const ra = RANKS.indexOf(a.rank), rb = RANKS.indexOf(b.rank);
  return ra !== rb ? ra > rb : a.damage > b.damage;
}

const validBest = (v) => (v && RANKS.includes(v.rank) && Number.isFinite(v.damage) ? { rank: v.rank, damage: v.damage } : null);

export function createRecords(storage) {
  const mem = new Map(); // 保存できないときの代わり（そのページの間だけ）
  const read = (k) => {
    try {
      const raw = storage?.getItem(k);
      if (raw != null) return JSON.parse(raw);
    } catch { /* 読めない・壊れている */ }
    return mem.has(k) ? mem.get(k) : null;
  };
  const write = (k, v) => {
    mem.set(k, v);
    try { storage?.setItem(k, JSON.stringify(v)); } catch { /* 保存できない（容量・プライベートモード） */ }
  };

  return {
    // 街（'YYYYMMDD'）の自己ベスト { rank, damage }（無ければ null）
    best(city) { return city ? validBest(read(bestKey(city))) : null; },
    // 今回の結果を出す。良ければ覚える。{ best: 今のベスト, isNew: 今回がベストになった, prev: 前のベスト }。街の鍵が無い（試しの種）なら覚えない
    submitBest(city, result) {
      if (!city) return { best: null, isNew: false, prev: null };
      const prev = this.best(city);
      const cur = validBest(result);
      if (cur && betterThan(cur, prev)) { write(bestKey(city), cur); return { best: cur, isNew: true, prev }; }
      return { best: prev, isNew: false, prev };
    },
    // 取ったことのある称号の id
    titles() {
      const v = read(TITLES_KEY);
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    },
    // 今回取った称号を覚え、初めてのもの（NEW）だけを返す
    addTitles(ids) {
      const have = this.titles();
      const fresh = ids.filter((id) => !have.includes(id));
      if (fresh.length) write(TITLES_KEY, [...have, ...fresh]);
      return fresh;
    },
  };
}
