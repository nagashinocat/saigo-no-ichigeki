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

// R3 fix1（点検 Minor 1）: 「もう一度」は日本時間の 0 時をまたいでも同じ街。今日の街の鍵を sessionStorage に置いて読み直し、
// 次の pickCity が一度だけ使う（?seed= と ?city= は URL に残るので覚えない）。保存できなければ、ふつうの今日の街
export const RETRY_CITY_KEY = 'saigo-no-ichigeki:retry-city';
export function rememberRetryCity(storage, c) {
  if (c?.source !== 'daily' || !c.key) return;
  try { storage?.setItem(RETRY_CITY_KEY, c.key); } catch { /* 保存できない */ }
}
function takeRetryCity(storage) {
  try {
    const v = storage?.getItem(RETRY_CITY_KEY);
    if (v != null) storage.removeItem(RETRY_CITY_KEY);
    return parseCityKey(v);
  } catch { return null; }
}

// どの街で遊ぶか。{ source: 'debug' | 'link' | 'daily', key: 'YYYYMMDD' | null, seed, today }
// 今日の日付のリンクは今日の街と同じ（見出しも「今日の街」）。storage: sessionStorage（もう一度の街を一度だけ使う。?seed=・?city= が先）
// hash: location.hash。控えの読み直しで sessionStorage が使えないときの印 '#retry=<鍵>'（introFlow の markRetry が置き、introMode が読んで消す）
export function pickCity({ params, now = Date.now(), storage = null, hash = '' }) {
  const today = jstDayKey(now);
  const m = typeof hash === 'string' ? /^#retry=(\d{8})$/.exec(hash) : null;
  const retry = takeRetryCity(storage) ?? (m ? parseCityKey(m[1]) : null); // 先に読んで消す（?seed=・?city= のときも残さない）
  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  if (Number.isFinite(seedParam)) return { source: 'debug', key: null, seed: seedParam, today };
  const link = parseCityKey(params.get('city'));
  if (link && link !== today) return { source: 'link', key: link, seed: citySeed(link), today };
  if (!link && retry) return { source: 'daily', key: retry, seed: citySeed(retry), today };
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

// R3 fix1（点検 Important 1）: 共有するリンクの元（origin + pathname）。artifact では iframe の中のアドレス（別のオリジン）になり、
// 友達が開けないので出さない。canonical: 正式な URL（config.js の SHARE_BASE_URL。まだ無ければ null）。
//  - 今の場所が正式な URL と同じ（引数・# は比べない）か、上の窓で正式な URL が無い → 今の場所
//  - iframe の中か、正式な URL と違う場所 → 正式な URL（あれば）
//  - iframe の中で正式な URL が無い → null（リンクを出さない。共有の文は街の名前だけ）
const baseOf = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return null; } };
export function shareBase({ loc, framed, canonical }) {
  const here = loc.origin + loc.pathname;
  const canon = canonical ? baseOf(canonical) : null;
  if (canon && here === canon) return here;
  if (canon) return canon;
  return framed ? null : here;
}

// 共有するリンク: リンクの元に ?city= だけ（ほかの引数は付けない）。試しの種は ?seed=。元が無ければ null
export function cityLink(c, { loc = typeof location === 'undefined' ? { origin: '', pathname: '' } : location, framed = false, canonical = null } = {}) {
  const base = shareBase({ loc, framed, canonical });
  if (!base) return null;
  return c.key ? `${base}?city=${c.key}` : `${base}?seed=${c.seed}`;
}
