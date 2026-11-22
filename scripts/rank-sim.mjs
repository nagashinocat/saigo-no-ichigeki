// 使い方: node scripts/rank-sim.mjs [root]
// R2（spec §15 評価のランク）: 最善の操作（src/game/bot.js の steerBot・actBot、払うきっかけは balance-sim の最善「掴まれ 2 人で払う・隠れる」）と
// 放つ判断（releaseBot: 「今なら全滅できる」の間は残り waitTo 秒まで待つ・掴まれたらすぐ放つ）で seed 1〜SEEDS（既定 60）を遊び、
// 放ったときの残り時間・払った回数・すぐそばの数・倍率・被害額の分布と、src/game/rank.js のランクの分かれ方を出す。
// WAIT='8,4,2,0.5' で waitTo の候補を比べる（いちばん被害額の平均が高いものを「最善の放ち方」とした。R2 ではその分布でランクの線を決めたが、
// R3 fix1 で線はやめ、今は条件での分かれ方を見るだけ）
// R3（今日の街）: 既定は今日の街の DAYS 日分（FROM=YYYYMMDD から、既定 20261101 から 120 日）の種（daily.js の citySeed）。
// CITIES=ints で前の seed 1〜SEEDS。R3 fix1: ランクは条件（rank.js）なので、条件での S〜C の分かれ方と BLOCK 回ごとの数を出す
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createGame } = await imp('src/game/game.js');
const { steerBot, actBot, releaseBot, RELEASE } = await imp('src/game/bot.js');
const { CONFIG } = await imp('src/config.js');
const rankMod = await imp('src/game/rank.js').catch(() => null);
const DT = 1 / 30;
const { citySeed } = await imp('src/game/daily.js');
const dayKeys = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)) + i * 864e5); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; });
const SEEDS = process.env.CITIES === 'ints'
  ? Array.from({ length: Number(process.env.SEEDS ?? 60) }, (_, i) => i + 1)
  : dayKeys(process.env.FROM ?? '20261101', Number(process.env.DAYS ?? 120)).map(citySeed);
const BLOCK = Number(process.env.BLOCK ?? 30);
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
  if (!o) return { seed, released: false, clear: false, total: 0, timeLeft: 0, cityValue: g.cityValue, puffs: CONFIG.puff.uses - g.puffsLeft };
  return { seed, released: true, clear: o.clear, total: g.score.total, cityValue: g.cityValue, base: o.bonus.base, mul: o.bonus.mul, timeLeft: o.bonus.timeLeft, near: o.bonus.near, puffs: o.puffsUsed, centre: Math.hypot(g.hero.x, g.hero.z) };
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
  const cvs = runs.map((r) => r.cityValue);
  console.log(`  街の値打ちの合計: 最小=${yen(Math.min(...cvs))} p50=${yen(q(cvs, 0.5))} 最大=${yen(Math.max(...cvs))}（最大/最小 ${(Math.max(...cvs) / Math.min(...cvs)).toFixed(3)}）`);
  if (rankMod) {
    // R3 fix1（持ち主 19:03）: ランクは条件（rank.js。残り時間と払った回数）。線は引かないので、分かれ方を出すだけ（目標へ寄せない）
    const rankOf = (r) => rankMod.rankFor({ clear: r.clear, timeLeft: r.timeLeft, puffs: r.puffs });
    const ranks = runs.map(rankOf);
    const cnt = Object.fromEntries(['S', 'A', 'B', 'C'].map((k) => [k, ranks.filter((x) => x === k).length]));
    console.log(`  ランク（条件 ${JSON.stringify(rankMod.RANK)}）: S ${cnt.S}（${(100 * cnt.S / runs.length).toFixed(0)}%） A ${cnt.A}（${(100 * cnt.A / runs.length).toFixed(0)}%） B ${cnt.B}（${(100 * cnt.B / runs.length).toFixed(0)}%） C ${cnt.C}（${(100 * cnt.C / runs.length).toFixed(0)}%）`);
    const blocks = [];
    for (let i = 0; i < runs.length; i += BLOCK) { const b = ranks.slice(i, i + BLOCK); blocks.push(`S ${b.filter((x) => x === 'S').length} A ${b.filter((x) => x === 'A').length} B ${b.filter((x) => x === 'B').length} C ${b.filter((x) => x === 'C').length}`); }
    console.log(`  ${BLOCK} 回ごと: ${blocks.join(' | ')}`);
    const hi = runs.filter((r) => r.cityValue >= q(cvs, 0.5)), lo = runs.filter((r) => r.cityValue < q(cvs, 0.5));
    console.log(`  値打ちの大きな街の半分: S ${hi.map(rankOf).filter((x) => x === 'S').length}/${hi.length}  小さな街の半分: S ${lo.map(rankOf).filter((x) => x === 'S').length}/${lo.length}`);
  }
  if (process.env.VERBOSE) for (const r of runs) console.log('   ', JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toPrecision(4) : v)));
}
