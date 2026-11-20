// 使い方: node scripts/balance-sim.mjs [root]
// 持ち主が選んだ釣り合い（「ギリギリのスリル」: 最善の操作で満タンが最後の数秒）を数で確かめる。
// root（既定はこのリポジトリ）の src/game/game.js を読み、
//  1) 軍勢が湧いてから掴むまでの秒の分布（払わず、掴む枠を無制限にして）
//  2) 自動の操作（ずっと長押し、近づいた者がいれば払う。払うきっかけの距離を変えて一番よいものを「最善」とする）で
//     力が満タン（power.max）になる時刻と、60 秒の終わりの力
// を、seed 1〜30 で出す。ENEMY='{...}' で CONFIG.enemy の一部を差し替えられる。
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const { createGame } = await import(pathToFileURL(path.join(root, 'src/game/game.js')).href);
const { CONFIG: BASE } = await import(pathToFileURL(path.join(root, 'src/config.js')).href);
// ENEMY='{"speed":8}' で CONFIG.enemy の一部を差し替えて試せる
const CONFIG = { ...BASE, enemy: { ...BASE.enemy, ...JSON.parse(process.env.ENEMY ?? '{}') } };
const DT = 1 / 30;
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (xs) => `n=${xs.length} p10=${q(xs, 0.1).toFixed(1)} p25=${q(xs, 0.25).toFixed(1)} p50=${q(xs, 0.5).toFixed(1)} p75=${q(xs, 0.75).toFixed(1)} p90=${q(xs, 0.9).toFixed(1)} mean=${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)}`;

// 1) 届くまでの秒
const reach = [];
for (const seed of SEEDS) {
  const cfg = { ...CONFIG, enemy: { ...CONFIG.enemy, maxGrabbing: 1e9 } };
  const g = createGame({ seed, cfg });
  g.pressStart();
  const born = new Map();
  let t = 0;
  while (g.phase === 'playing' && t < 59) {
    g.update(DT); t += DT;
    for (const e of g.enemies.list) {
      if (!born.has(e.id)) born.set(e.id, t);
      if (e.state === 'grab' && born.get(e.id) != null && !e._seen) { e._seen = true; reach.push(t - born.get(e.id)); }
    }
  }
}
console.log('届くまでの秒（湧いてから掴むまで）:', fmt(reach));

// 2) 最善の操作: ずっと長押しし、「掴まれている数が grab 以上」か「主人公から trigger m 以内に crowd 人以上」で払う。
//    その組み合わせのうち、満タンに届く seed が多く、届く時刻が早いものを「最善」とする
function play(seed, { grab, trigger, crowd }) {
  const g = createGame({ seed, cfg: CONFIG });
  g.pressStart();
  let t = 0, full = Infinity, puffs = 0, grabSec = 0;
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2) {
    const n = g.enemies.list.filter((e) => e.state !== 'dead' && e.dist <= trigger).length;
    if ((g.grabbing >= grab || n >= crowd) && g.puff()) puffs++;
    g.update(DT); t += DT;
    grabSec += g.grabbing * DT;
    if (full === Infinity && g.power.value >= CONFIG.power.max - 1e-6) full = t;
  }
  return { full, end: g.power.value, puffs, grabSec };
}
const strategies = [];
for (const grab of [1, 2, 3]) {
  strategies.push({ grab, trigger: 0, crowd: Infinity });
  for (const trigger of [4, 8, 14, 22]) for (const crowd of [1, 2, 3, 5, 8]) strategies.push({ grab, trigger, crowd });
}
let best = null;
const verbose = process.env.VERBOSE;
for (const st of strategies) {
  const runs = SEEDS.map((s) => play(s, st));
  const fulls = runs.map((r) => r.full), ends = runs.map((r) => r.end);
  const reached = fulls.filter(Number.isFinite).length;
  const med = q(fulls, 0.5);
  const line = `掴まれ${st.grab}人 or ${st.trigger}m以内に${st.crowd}人で払う: 満タンに届いた ${reached}/${runs.length}  満タンの時刻 p25=${q(fulls, 0.25).toFixed(1)} p50=${med.toFixed(1)} p75=${q(fulls, 0.75).toFixed(1)}  60秒の力 p50=${q(ends, 0.5).toFixed(1)}  払った回数 p50=${q(runs.map((r) => r.puffs), 0.5)}  掴まれた人秒 p50=${q(runs.map((r) => r.grabSec), 0.5).toFixed(1)}`;
  if (verbose) console.log(line);
  const score = reached * 1000 - (Number.isFinite(med) ? med : 999) + q(ends, 0.5) / 1000;
  if (!best || score > best.score) best = { score, line };
}
console.log('最善: ' + best.line);
