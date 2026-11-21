// 使い方: node scripts/balance-sim.mjs [root]
// 持ち主が選んだ釣り合い（「ギリギリのスリル」: 最善の操作で満タンが最後の数秒）を数で確かめる。
// root（既定はこのリポジトリ）の src/game/game.js を読み、
//  1) 軍勢が湧いてから掴むまでの秒の分布（払わず、掴む枠を無制限にして）
//  2) 自動の操作（ずっと長押し、近づいた者がいれば払う。払うきっかけの距離を変えて一番よいものを「最善」とする）で
//     力が満タン（power.max）になる時刻と、60 秒の終わりの力
//  3) 払わない操作（ずっと長押しするだけ）の 60 秒の力（「ギリギリのスリル」: 払わなければ満タンに届かない）
//  4) S9 の勝ち負け（放った一発で街の軍勢を全員倒せたら撃退成功）: 最善の操作で、力が L に届いた瞬間に放ったときの
//     撃退成功の割合（L ごと）。L=100 が「満タンで放つ」最善の操作の成功率（届かなければ時間切れ＝失敗）
// を、seed 1〜30 で出す。ENEMY='{...}' / PUFF='{...}' で CONFIG.enemy / CONFIG.puff の一部を差し替えられる。SEEDS=n で seed 1〜n（調整の下見用）。
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const { createGame } = await import(pathToFileURL(path.join(root, 'src/game/game.js')).href);
const { CONFIG: BASE } = await import(pathToFileURL(path.join(root, 'src/config.js')).href);
// ENEMY='{"speed":8}' で CONFIG.enemy の一部を差し替えて試せる
const CONFIG = { ...BASE, enemy: { ...BASE.enemy, ...JSON.parse(process.env.ENEMY ?? '{}') }, puff: { ...BASE.puff, ...JSON.parse(process.env.PUFF ?? '{}') } };
const DT = 1 / 30;
const SEEDS = Array.from({ length: Number(process.env.SEEDS ?? 30) }, (_, i) => i + 1);
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
const { spawnRateAt } = await import(pathToFileURL(path.join(root, 'src/game/enemies.js')).href);
let total = 0;
for (let t = 0; t < CONFIG.roundSeconds; t += 0.01) total += spawnRateAt(t + 0.005, CONFIG) * 0.01;
const rate = (t) => spawnRateAt(t, CONFIG).toFixed(2);
console.log(`60 秒で湧く数: ${total.toFixed(1)}（0〜40 秒 ${(() => { let a = 0; for (let t = 0; t < 40; t += 0.01) a += spawnRateAt(t + 0.005, CONFIG) * 0.01; return a.toFixed(1); })()}）  湧く速さ 0/20/40/45/50/55/60 秒: ${[0, 20, 40, 45, 50, 55, 60].map(rate).join(' / ')}`);

// 2) 最善の操作: ずっと長押しし、「掴まれている数が grab 以上」か「主人公から trigger m 以内に crowd 人以上」で払う（払わない操作も候補に入れる）。
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
const NO_PUFF = { grab: Infinity, trigger: 0, crowd: Infinity };
const strategies = [NO_PUFF];
for (const grab of [1, 2, 3, 4, 5, 6]) {
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
  const line = `${st === NO_PUFF ? '払わない（ずっと長押しだけ）: ' : ''}掴まれ${st.grab}人 or ${st.trigger}m以内に${st.crowd}人で払う: 満タンに届いた ${reached}/${runs.length}  満タンの時刻 p25=${q(fulls, 0.25).toFixed(1)} p50=${med.toFixed(1)} p75=${q(fulls, 0.75).toFixed(1)}  60秒の力 p50=${q(ends, 0.5).toFixed(1)}  払った回数 p50=${q(runs.map((r) => r.puffs), 0.5)}  掴まれた人秒 p50=${q(runs.map((r) => r.grabSec), 0.5).toFixed(1)}`;
  if (verbose || st === NO_PUFF) console.log(line);
  const score = reached * 1000 - (Number.isFinite(med) ? med : 999) + q(ends, 0.5) / 1000;
  if (!best || score > best.score) best = { score, line, st };
}
console.log('最善: ' + best.line);

// 4) 撃退成功の割合: 最善の操作で、力が level に届いた瞬間に離す（届かないまま時間切れならブラックホール＝失敗）
function playRelease(seed, st, level) {
  const g = createGame({ seed, cfg: CONFIG });
  g.pressStart();
  let t = 0;
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2) {
    const n = g.enemies.list.filter((e) => e.state !== 'dead' && e.dist <= st.trigger).length;
    if ((g.grabbing >= st.grab || n >= st.crowd)) g.puff();
    g.update(DT); t += DT;
    if (g.power.value >= level - 1e-6) {
      const amount = g.power.value;
      g.pressEnd(); g.settle();
      return { reached: true, t, amount, clear: g.outcome.clear, left: g.outcome.survivors.length, alive: g.outcome.total, patrolLeft: g.outcome.survivors.filter((s) => s.patrol).length };
    }
  }
  return { reached: false, clear: false };
}
console.log('撃退成功（最善の操作で、力が L に届いた瞬間に放つ）:');
for (const level of [40, 50, 60, 70, 75, 80, 85, 90, 95, 100]) {
  const runs = SEEDS.map((s) => playRelease(s, best.st, level));
  const got = runs.filter((r) => r.reached);
  const ok = got.filter((r) => r.clear).length;
  const lefts = got.map((r) => r.left);
  const extra = got.length ? `  放った時刻 p50=${q(got.map((r) => r.t), 0.5).toFixed(1)}  残り p50=${q(lefts, 0.5)} 最大=${Math.max(...lefts)}（うち見回る者 p50=${q(got.map((r) => r.patrolLeft), 0.5)}）  放った瞬間の軍勢 p50=${q(got.map((r) => r.alive), 0.5)}` : '';
  console.log(`  L=${String(level).padStart(3)}: 届いた ${got.length}/${runs.length}  撃退成功 ${ok}/${got.length}（全体 ${ok}/${runs.length}）${extra}`);
}
