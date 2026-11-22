// 使い方: node scripts/title-sim.mjs [root]
// R3 fix1（持ち主 19:03「称号はランダムっぽくなるように多めに」）: 今日の街 DAYS 日分（FROM から、既定 20261101 から 120 日）を、
// いくつかの遊び方（POLICIES: 最善の操作 + 放つ時刻・払い方の違い。隠れないボットは力を吸い尽くされて毎回ブラックホールになるので入れていない）で遊び、src/game/titles.js の称号が
// 取れた割合（earned）と、結果に出た割合（shown: 一回に一つ、いちばん珍しいもの）を出す。RAW=1 でその回の数を JSON で出す。
// 人の遊び方の代わりなので、割合は目安（ボットは放つ時刻がそろいやすい）
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createGame } = await imp('src/game/game.js');
const { steerBot, actBot, releaseBot, RELEASE } = await imp('src/game/bot.js');
const { citySeed } = await imp('src/game/daily.js');
const titlesMod = await imp('src/game/titles.js');
const DT = 1 / 30;

const dayKeys = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)) + i * 864e5); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; });
const DAYS = dayKeys(process.env.FROM ?? '20261101', Number(process.env.DAYS ?? 120));

// 遊び方: act は bot.js actBot の st、waitTo は「今なら全滅できる」から残り何秒まで待つか
export const POLICIES = [
  { name: '最善・最後まで待つ', act: { grab: 2, trigger: 0, crowd: Infinity, hide: true }, waitTo: 0.5 },
  { name: '最善・残り 2 秒', act: { grab: 2, trigger: 0, crowd: Infinity, hide: true }, waitTo: 2 },
  { name: '最善・早めに放つ', act: { grab: 2, trigger: 0, crowd: Infinity, hide: true }, waitTo: 8 },
  { name: '届いたらすぐ放つ', act: { grab: 2, trigger: 0, crowd: Infinity, hide: true }, waitTo: 20, lastCall: 1 },
  { name: '群れを払う', act: { grab: 3, trigger: 8, crowd: 5, hide: true }, waitTo: 4 },
  { name: '払わない', act: { grab: Infinity, trigger: 0, crowd: Infinity, hide: true }, waitTo: 0.8 },
];

export function playOne(seed, pol) {
  const g = createGame({ seed });
  g.begin(); g.pressStart();
  const R = { ...RELEASE, waitTo: pol.waitTo, ...(pol.lastCall != null ? { lastCall: pol.lastCall } : {}) };
  while (g.phase === 'playing') {
    steerBot(g, {}); actBot(g, pol.act); g.update(DT);
    if (releaseBot(g, { R })) break;
  }
  if (g.phase === 'cinematic' || g.phase === 'finale') g.settle();
  const reason = g.outcome ? 'released' : 'blackhole';
  return { seed, policy: pol.name, reason, outcome: g.outcome, total: g.score.total, cityValue: g.cityValue, stats: g.runStats };
}

const runs = [];
DAYS.forEach((k, i) => { for (const pol of POLICIES) runs.push(playOne(citySeed(k), pol)); });
// 端末ごと・日ごとのもの（初めての撃退・自己ベスト・時刻）は、遊んだ順に記録して決める（同じ端末で毎日 POLICIES を順に遊んだふり）
const bests = new Map();
runs.forEach((r, i) => {
  const key = r.seed;
  const prev = bests.get(key) ?? null;
  const clear = !!r.outcome?.clear;
  const firstClear = clear && !(prev?.clear);
  const newBest = !!(r.outcome && prev && prev.total < r.total && (clear || !prev.clear));
  if (r.outcome && (!prev || newBest || (clear && !prev.clear))) bests.set(key, { clear: clear || !!prev?.clear, total: Math.max(prev?.total ?? 0, r.total) });
  r.ctx = { firstClearToday: firstClear, newBest, hour: (i * 7) % 24 };
});

if (process.env.RAW) for (const r of runs) console.log(JSON.stringify({ p: r.policy, reason: r.reason, clear: r.outcome?.clear, rank: r.outcome?.rank, dmg: +(r.total / r.cityValue).toFixed(3), ...r.stats, kills: r.stats.kills, release: r.stats.release, dragged: r.outcome?.dragged, ctx: r.ctx }));

if (titlesMod.TITLES?.[0]?.rarity != null) {
  const N = runs.length;
  const earned = new Map(titlesMod.TITLES.map((t) => [t.id, 0])), shown = new Map(titlesMod.TITLES.map((t) => [t.id, 0]));
  let none = 0;
  for (const r of runs) {
    const ctx = { reason: r.reason, outcome: r.outcome, stats: r.stats, damage: r.total, cityValue: r.cityValue, ...r.ctx };
    for (const id of titlesMod.earnedTitles(ctx)) earned.set(id, earned.get(id) + 1);
    const pick = titlesMod.pickTitle(ctx, titlesMod.runSeed(ctx, r.seed));
    if (pick) shown.set(pick, shown.get(pick) + 1); else none++;
  }
  const pc = (n) => `${(100 * n / N).toFixed(1)}%`;
  console.log(`遊んだ回 ${N}（${DAYS.length} 日 × ${POLICIES.length} の遊び方）。称号なし ${none}（${pc(none)}）`);
  console.log('| 称号 | 珍しさ | 取れた | 出た |');
  console.log('|---|---|---|---|');
  for (const t of [...titlesMod.TITLES].sort((a, b) => earned.get(b.id) - earned.get(a.id))) console.log(`| ${t.name}（${t.id}） | ${t.rarity} | ${earned.get(t.id)}（${pc(earned.get(t.id))}） | ${shown.get(t.id)}（${pc(shown.get(t.id))}） |`);
  const maxE = Math.max(...earned.values()), maxS = Math.max(...shown.values());
  console.log(`いちばん多い: 取れた ${pc(maxE)}・出た ${pc(maxS)}`);
  for (const pol of POLICIES) {
    const rs = runs.filter((r) => r.policy === pol.name);
    console.log(`  ${pol.name}: 撃退成功 ${rs.filter((r) => r.outcome?.clear).length}/${rs.length}  ブラックホール ${rs.filter((r) => r.reason === 'blackhole').length}`);
  }
  const rankC = Object.fromEntries(['S', 'A', 'B', 'C'].map((k) => [k, runs.filter((r) => (r.outcome?.rank ?? 'C') === k).length]));
  console.log(`ランク（この遊び方の混ぜ方で）: ${Object.entries(rankC).map(([k, v]) => `${k} ${v}（${pc(v)}）`).join(' ')}`);
}
