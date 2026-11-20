// mulberry32。0以上1未満の乱数を返す。
// reseed(s) で同じ関数のまま最初からやり直せる（同じ乱数を分け合う部品をまとめて巻き戻す。リプレイで使う）
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.reseed = (s = seed) => { a = s >>> 0; };
  return next;
}
