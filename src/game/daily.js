// R3（spec §15 今日の街・リンクで挑戦）: 日本時間の日付（YYYYMMDD）で全員が同じ街を遊ぶ。サーバーは持たない（GitHub Pages・artifact のまま）。
//  どの街か: ?seed=（撮影・試しの種）> ?city=YYYYMMDD（友達の共有したリンク）> 今日の街。
//  種は街の作り（cityGen）・軍勢の乱数・種類の乱数・見回りのすべての元（game.js が種から分けて作る）。大物の来る時刻は種によらない（CONFIG）

const JST_OFFSET_MS = 9 * 3600 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');

// その時刻の日本時間の日付 'YYYYMMDD'
export function jstDayKey(nowMs = Date.now()) {
  const d = new Date(nowMs + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

// ?city= の値。実在する日付の 'YYYYMMDD' だけを受ける（それ以外は null）
export function parseCityKey(s) {
  if (typeof s !== 'string' || !/^\d{8}$/.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  if (y < 2000 || m < 1 || m > 12 || d < 1) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : null;
}

// 日付から街の種（31 bit の整数）。そのまま数にすると、game.js の「種 + 1」（軍勢の乱数）が翌日の街の種と重なるので混ぜる
export function citySeed(key) {
  let h = (Number(key) ^ 0x5a1e1c5e) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) & 0x7fffffff;
}

// どの街で遊ぶか。{ source: 'debug' | 'link' | 'daily', key: 'YYYYMMDD' | null, seed, today }
// 今日の日付のリンクは今日の街と同じ（見出しも「今日の街」）
export function pickCity({ params, now = Date.now() }) {
  const today = jstDayKey(now);
  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  if (Number.isFinite(seedParam)) return { source: 'debug', key: null, seed: seedParam, today };
  const link = parseCityKey(params.get('city'));
  if (link && link !== today) return { source: 'link', key: link, seed: citySeed(link), today };
  return { source: 'daily', key: today, seed: citySeed(today), today };
}

const md = (key, today) => {
  const y = +key.slice(0, 4), m = +key.slice(4, 6), d = +key.slice(6, 8);
  return today && key.slice(0, 4) === today.slice(0, 4) ? `${m}/${d}` : `${y}/${m}/${d}`;
};

// 結果に出す街の名前: 「今日の街 11/21」・「11/20の街（リンク）」（年が違えば「2025/11/20の街（リンク）」）
export function cityLabel(c) {
  if (c.source === 'debug') return `試しの街（seed ${c.seed}）`;
  if (c.source === 'link') return `${md(c.key, c.today)}の街（リンク）`;
  return `今日の街 ${md(c.key, c.key)}`;
}

// 共有するリンク: 今のページ（origin + pathname）に ?city= だけ（ほかの引数は付けない）。試しの種は ?seed=
export function cityLink(c, loc = typeof location === 'undefined' ? { origin: '', pathname: '' } : location) {
  const base = loc.origin + loc.pathname;
  return c.key ? `${base}?city=${c.key}` : `${base}?seed=${c.seed}`;
}
