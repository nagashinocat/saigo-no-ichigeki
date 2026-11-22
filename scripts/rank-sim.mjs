// 使い方: node scripts/rank-sim.mjs [root]
// R2（spec §15 評価のランク）: 最善の操作（src/game/bot.js の steerBot・actBot、払うきっかけは balance-sim の最善「掴まれ 2 人で払う・隠れる」）と
// 放つ判断（releaseBot: 「今なら全滅できる」の間は残り waitTo 秒まで待つ・掴まれたらすぐ放つ）で seed 1〜SEEDS（既定 60）を遊び、
// 放ったときの残り時間・払った回数・すぐそばの数・倍率・被害額の分布と、src/game/rank.js のランクの分かれ方を出す。
// WAIT='8,4,2,0.5' で waitTo の候補を比べる（いちばん被害額の平均が高いものを「最善の放ち方」とし、その分布でランクの線を決めた）
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createGame } = await imp('src/game/game.js');
const { steerBot, actBot, releaseBot, RELEASE } = await imp('src/game/bot.js');
const { CONFIG } = await imp('src/config.js');
const rankMod = await imp('src/game/rank.js').catch(() => null);
const DT = 1 / 30;
const SEEDS = Array.from({ length: Number(process.env.SEEDS ?? 60) }, (_, i) => i + 1);
const BEST = { grab: 2, trigger: 0, crowd: Infinity, hide: true };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const yen = (v) => `${(v / 1e12).toFixed(2)}兆`;

export function playRanked(seed, R = RELEASE) {
  const g = createGame({ seed });
  g.begin(); g.pressStart();
  while (g.phase === 'playing') {
    steerBot(g, {}); actBot(g, BEST); g.update(DT);
    if (releaseBot(g, { R })) break;
  }
  if (g.phase === 'cinematic' || g.phase === 'finale') g.settle();
  const o = g.outcome;
  if (!o) return { seed, released: false, clear: false, total: 0, timeLeft: 0, puffs: CONFIG.puff.uses - g.puffsLeft };
  return { seed, released: true, clear: o.clear, total: g.score.total, base: o.bonus.base, mul: o.bonus.mul, timeLeft: o.bonus.timeLeft, near: o.bonus.near, puffs: o.puffsUsed, centre: Math.hypot(g.hero.x, g.hero.z) };
}

const waits = (process.env.WAIT ?? String(RELEASE.waitTo)).split(',').map(Number);
for (const w of waits) {
  const runs = SEEDS.map((s) => playRanked(s, { ...RELEASE, waitTo: w }));
  const clear = runs.filter((r) => r.clear), rel = runs.filter((r) => r.released);
  const totals = runs.map((r) => r.total);
  console.log(`--- waitTo=${w}: 撃退成功 ${clear.length}/${runs.length}（${(100 * clear.length / runs.length).toFixed(0)}%）  放った ${rel.length}  ブラックホール ${runs.length - rel.length}  被害額の平均 ${yen(totals.reduce((a, b) => a + b, 0) / runs.length)}`);
  console.log(`  被害額（全部の回）: p50=${yen(q(totals, 0.5))} p60=${yen(q(totals, 0.6))} p70=${yen(q(totals, 0.7))} p80=${yen(q(totals, 0.8))} p90=${yen(q(totals, 0.9))} 最大=${yen(Math.max(...totals))}`);
  const ct = clear.map((r) => r.total);
  console.log(`  被害額（撃退成功の回）: 最小=${yen(Math.min(...ct))} p25=${yen(q(ct, 0.25))} p50=${yen(q(ct, 0.5))} p75=${yen(q(ct, 0.75))} 最大=${yen(Math.max(...ct))}`);
  console.log(`  基（倍率の前、撃退成功）: 最小=${yen(Math.min(...clear.map((r) => r.base)))} p50=${yen(q(clear.map((r) => r.base), 0.5))} 最大=${yen(Math.max(...clear.map((r) => r.base)))}`);
  console.log(`  倍率（撃退成功）: p10=${q(clear.map((r) => r.mul), 0.1).toFixed(3)} p50=${q(clear.map((r) => r.mul), 0.5).toFixed(3)} p90=${q(clear.map((r) => r.mul), 0.9).toFixed(3)}  すぐそば p50=${q(clear.map((r) => r.near), 0.5)} 最大=${Math.max(...clear.map((r) => r.near))}`);
  console.log(`  残り時間（撃退成功）: p10=${q(clear.map((r) => r.timeLeft), 0.1).toFixed(2)} p50=${q(clear.map((r) => r.timeLeft), 0.5).toFixed(2)} p90=${q(clear.map((r) => r.timeLeft), 0.9).toFixed(2)}`);
  const pc = [0, 1, 2, 3].map((k) => clear.filter((r) => r.puffs === k).length);
  console.log(`  払った回数（撃退成功）: 0 回 ${pc[0]} / 1 回 ${pc[1]} / 2 回 ${pc[2]} / 3 回 ${pc[3]}`);
  const fail = rel.filter((r) => !r.clear).map((r) => r.total);
  if (fail.length) console.log(`  撃退失敗の被害額: ${fail.map(yen).join(', ')}`);
  if (rankMod) {
    const ranks = runs.map((r) => rankMod.rankFor({ clear: r.clear, timeLeft: r.timeLeft, puffs: r.puffs, damage: r.released ? r.total : 0, released: r.released }));
    const cnt = Object.fromEntries(['S', 'A', 'B', 'C'].map((k) => [k, ranks.filter((x) => x === k).length]));
    console.log(`  ランク: S ${cnt.S}（${(100 * cnt.S / runs.length).toFixed(0)}%） A ${cnt.A}（${(100 * cnt.A / runs.length).toFixed(0)}%） B ${cnt.B}（${(100 * cnt.B / runs.length).toFixed(0)}%） C ${cnt.C}（${(100 * cnt.C / runs.length).toFixed(0)}%）`);
  }
  if (process.env.VERBOSE) for (const r of runs) console.log('   ', JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toPrecision(4) : v)));
}
