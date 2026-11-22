// 使い方: node scripts/daily-balance.mjs [root]
// R1f（持ち主 19:47「一回見つかって払うとほぼ詰む」・R3 の今日の街）: 釣り合いの見出しの数を、今日の街の DAYS 日分（FROM から、既定 20261101 から 120 日。
// daily.js の citySeed）で出す。CITIES=ints で seed 1〜SEEDS（既定 30）。
//  - 最善の操作（bot.js steerBot・actBot、掴まれ 2 人で払う・隠れる）: 満タンに届いた数・満タンの時刻（届いた回）の p50、
//    力が L（95〜100）に届いた瞬間に放ったときの撃退成功（全体に対して。届かない回は失敗）と、その一番よい L（best clear）
//  - 満タンで放った回（中心のそば）がみな撃退成功か・放った所の中心からの距離の最大
//  - 立て直し（recovery）: 掴まれた（掴む者がいた）ときに払い、そのあと力が 80 以上に届いた回 / 掴まれて払った回
//  - 払わない・隠れない（動くだけ）: 満タンに届いた数（0 のはず）と 60 秒の力の最大
//  - 見つかった回数・見失わせた回数（追う者が見失った）の p50
// ENEMY / HIDE / POWER='{...}' で CONFIG の一部を差し替えられる（balance-sim と同じ）
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createGame } = await imp('src/game/game.js');
const { steerBot, actBot } = await imp('src/game/bot.js');
const { CONFIG: BASE } = await imp('src/config.js');
const { radiusFor } = await imp('src/game/charge.js');
const { citySeed } = await imp('src/game/daily.js');
const J = (k) => JSON.parse(process.env[k] ?? '{}');
const CONFIG = { ...BASE, enemy: { ...BASE.enemy, ...J('ENEMY') }, hide: { ...BASE.hide, ...J('HIDE') }, power: { ...BASE.power, ...J('POWER') }, puff: { ...BASE.puff, ...J('PUFF') } };
const DT = 1 / 30;
const dayKeys = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)) + i * 864e5); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; });
const SEEDS = process.env.CITIES === 'ints'
  ? Array.from({ length: Number(process.env.SEEDS ?? 30) }, (_, i) => i + 1)
  : dayKeys(process.env.FROM ?? '20261101', Number(process.env.DAYS ?? 120)).map(citySeed);
const BEST = { grab: 2, trigger: 0, crowd: Infinity, hide: true };
const NO = { grab: Infinity, trigger: 0, crowd: Infinity, hide: false };
const LEVELS = [95, 96, 97, 98, 99, 100];
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

function run(seed, st) {
  const g = createGame({ seed, cfg: CONFIG });
  let lost = 0;
  g.on('lose', (e) => { lost += e?.n ?? 1; });
  g.begin(); g.pressStart();
  let t = 0, li = 0, full = Infinity, grabPuffAt = null, recovered = false;
  const lv = [];
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2) {
    steerBot(g, { cfg: CONFIG });
    const grabbed = g.grabbing > 0;
    const a = actBot(g, st);
    if (a === 'puff' && grabbed && grabPuffAt == null) grabPuffAt = t;
    g.update(DT); t += DT;
    if (grabPuffAt != null && t > grabPuffAt && g.power.value >= 80) recovered = true;
    if (full === Infinity && g.power.value >= CONFIG.power.max - 1e-6) full = t;
    while (li < LEVELS.length && g.power.value >= LEVELS[li] - 1e-6) {
      const r = radiusFor(g.power.value, CONFIG);
      const clear = g.enemies.list.every((e) => e.state === 'dead' || Math.hypot(e.x - g.hero.x, e.z - g.hero.z) <= r);
      lv[li++] = { clear, centre: Math.hypot(g.hero.x, g.hero.z) };
    }
  }
  const rs = g.runStats;
  return { full, end: g.power.value, lv, grabPuff: grabPuffAt != null, recovered, spotted: rs.spotted, hides: rs.hides, lost };
}

const t0 = Date.now();
const best = SEEDS.map((s) => run(s, BEST));
const no = SEEDS.map((s) => run(s, NO));
const N = SEEDS.length;
const got = best.map((r) => r.full).filter(Number.isFinite);
console.log(`街 ${N}（${process.env.CITIES === 'ints' ? `seed 1〜${N}` : `今日の街 ${process.env.FROM ?? '20261101'} から ${N} 日`}）`);
console.log(`最善: 満タンに届いた ${got.length}/${N}（${(100 * got.length / N).toFixed(0)}%）  満タンの時刻（届いた回） p25=${q(got, 0.25)?.toFixed(1)} p50=${q(got, 0.5)?.toFixed(1)} p75=${q(got, 0.75)?.toFixed(1)}`);
let bestL = null;
for (const [i, L] of LEVELS.entries()) {
  const ok = best.filter((r) => r.lv[i]?.clear).length;
  console.log(`  L=${L}: 届いた ${best.filter((r) => r.lv[i]).length}  撃退成功 ${ok}/${N}（${(100 * ok / N).toFixed(0)}%）`);
  if (!bestL || ok > bestL.ok) bestL = { L, ok };
}
console.log(`best clear: L=${bestL.L} で ${bestL.ok}/${N}（${(100 * bestL.ok / N).toFixed(0)}%）`);
const at100 = best.map((r) => r.lv[LEVELS.indexOf(100)]).filter(Boolean);
console.log(`満タンで放った回 ${at100.length}: 撃退成功 ${at100.filter((r) => r.clear).length}  中心からの距離 最大 ${at100.length ? Math.max(...at100.map((r) => r.centre)).toFixed(1) : '-'} m`);
const gp = best.filter((r) => r.grabPuff);
console.log(`立て直し: 掴まれて払った回 ${gp.length}、そのあと力 80 以上 ${gp.filter((r) => r.recovered).length}（${gp.length ? (100 * gp.filter((r) => r.recovered).length / gp.length).toFixed(0) : '-'}%）`);
console.log(`見つかった回数 p50=${q(best.map((r) => r.spotted), 0.5)}  隠れた回数 p50=${q(best.map((r) => r.hides), 0.5)}  見失わせた（lose）p50=${q(best.map((r) => r.lost), 0.5)}`);
console.log(`払わない・隠れない: 満タンに届いた ${no.filter((r) => Number.isFinite(r.full)).length}/${N}  60 秒の力 p50=${q(no.map((r) => r.end), 0.5).toFixed(1)} 最大=${Math.max(...no.map((r) => r.end)).toFixed(1)}`);
console.log(`（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
