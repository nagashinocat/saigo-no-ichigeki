// 使い方: node scripts/balance-sim.mjs [root]
// 持ち主が選んだ釣り合い（「ギリギリのスリル」: 最善の操作で満タンが最後の数秒）を数で確かめる。
// root（既定はこのリポジトリ）の src/game/game.js を読み、
//  1) 軍勢が湧いてから掴むまでの秒の分布（払わず、掴む枠を無制限にして）
//  2) 自動の操作（ずっと長押し、近づいた者がいれば払う。払うきっかけを変えて一番よいものを「最善」とする）で
//     力が満タン（power.max）になる時刻（p25/p50/p75 は満タンに届いた回だけで数える。R0 fix1 の定義）と、60 秒の終わりの力
//  3) 払わない操作（ずっと長押しするだけ）と、払い続ける操作（払える力があればいつでも払う）の 60 秒の力
//  4) S9 の勝ち負け（放った一発で街の軍勢を全員倒せたら撃退成功）: 最善の操作で、力が L（85〜100）に届いた瞬間に放ったときの
//     撃退成功の割合（L ごと）と、そのうち一番よい L（最善の放ち方）の成功率。放つと遊びは止まるので、一回の流れの中で
//     L に届いた瞬間ごとに「生きている軍勢がみな radiusFor(力) の内か」を見る（game.settle と同じ判定。tests/game/balance.test.js で確かめる）
// を、seed 1〜30 で出す。ENEMY='{...}' / PUFF='{...}' / RADIUS='{...}' / POWER='{...}' で CONFIG の一部を差し替えられる。SEEDS=n で seed 1〜n（調整の下見用）。
// QUICK=1 で最善の操作の候補を、よく選ばれる数通りに絞る（調整の下見用）
// R1: 軍勢の種類（重い者・吸う者・大物）は game.js の中で動く。各操作の行に、×3 以上の払いの回数（p50）も出す。
//  KINDS='{...}' で CONFIG.enemy.kinds の一部を差し替えられる
// M2（§16）: 最善の操作は動くボット（src/game/bot.js の steerBot・actBot: 街の中心へ寄り、ライトの先から外れ、突っ込んでくる者をかわし、
//  払う（3 回まで）・隠れる）。動かない操作の節はやめた。払うきっかけの候補ごとに満タンの時刻と撃退成功を出し、
//  「中心から離れて放つ」操作（FAR m 先、既定 200 m へ寄る）と、満タンで中心のそばで放ったときの撃退成功も出す
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const { createGame } = await import(pathToFileURL(path.join(root, 'src/game/game.js')).href);
const { steerBot, actBot } = await import(pathToFileURL(path.join(root, 'src/game/bot.js')).href);
const { CONFIG: BASE } = await import(pathToFileURL(path.join(root, 'src/config.js')).href);
// ENEMY='{"speed":8}' で CONFIG.enemy の一部を差し替えて試せる
const CONFIG = { ...BASE, enemy: { ...BASE.enemy, ...JSON.parse(process.env.ENEMY ?? '{}') }, puff: { ...BASE.puff, ...JSON.parse(process.env.PUFF ?? '{}') }, radius: { ...BASE.radius, ...JSON.parse(process.env.RADIUS ?? '{}') }, power: { ...BASE.power, ...JSON.parse(process.env.POWER ?? '{}') }, hide: { ...BASE.hide, ...JSON.parse(process.env.HIDE ?? '{}') } };
if (process.env.KINDS) { const k = JSON.parse(process.env.KINDS); CONFIG.enemy.kinds = Object.fromEntries(Object.entries(BASE.enemy.kinds ?? {}).map(([n, v]) => [n, { ...v, ...(k[n] ?? {}) }])); }
const { radiusFor } = await import(pathToFileURL(path.join(root, 'src/game/charge.js')).href);
const DT = 1 / 30;
const SEEDS = Array.from({ length: Number(process.env.SEEDS ?? 30) }, (_, i) => i + 1);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fin = (xs) => xs.filter(Number.isFinite);
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

// 2) 動くボットで遊ぶ。st: { grab, trigger, crowd, hide }（bot.js の actBot）。centreAt: 寄る先（省けば街の中心）
function play(seed, st, centreAt = null) {
  const g = createGame({ seed, cfg: CONFIG });
  const combos = new Set();
  g.on('combo', (c) => combos.add(c.blastId));
  g.begin(); g.pressStart();
  let t = 0, full = Infinity, puffs = 0, hides = 0, grabSec = 0, centreSum = 0, centreN = 0, p60 = 0;
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2) {
    steerBot(g, { centreAt, cfg: CONFIG });
    const a = actBot(g, st);
    if (a === 'puff') puffs++; else if (a === 'hide') hides++;
    g.update(DT); t += DT;
    centreSum += Math.hypot(g.hero.x, g.hero.z); centreN++;
    grabSec += g.grabbing * DT;
    if (full === Infinity && g.power.value >= CONFIG.power.max - 1e-6) full = t;
  }
  return { full, end: g.power.value, puffs, hides, grabSec, combos: combos.size, centre: centreN ? centreSum / centreN : 0 };
}
const NO_PUFF = { grab: Infinity, trigger: 0, crowd: Infinity, hide: false, name: '払わない・隠れない（動くだけ）' };
const NO_PUFF_HIDE = { grab: Infinity, trigger: 0, crowd: Infinity, hide: true, name: '払わない（隠れるだけ）' };
const SPAM = { grab: 'spam', trigger: 0, crowd: Infinity, name: '払い続ける（払える力があればいつでも）' };
const name = (st) => st.name ?? `掴まれ${st.grab}人${st.crowd < Infinity ? ` or ${st.trigger}m以内に${st.crowd}人` : ''}で払う${st.hide ? '・隠れる' : ''}`;
const strategies = [];
for (const grab of [1, 2, 3, 4, 6]) for (const hide of [true, false]) strategies.push({ grab, trigger: 0, crowd: Infinity, hide });
if (!process.env.QUICK) for (const [grab, trigger, crowd] of [[1, 8, 1], [2, 8, 2], [2, 14, 3]]) strategies.push({ grab, trigger, crowd, hide: true });
const summary = (st, runs) => {
  const fulls = runs.map((r) => r.full), ends = runs.map((r) => r.end), got = fin(fulls);
  const pq = (p) => (got.length ? q(got, p).toFixed(1) : '-');
  return { reached: got.length, med: got.length ? q(got, 0.5) : Infinity,
    line: `${name(st)}: 満タンに届いた ${got.length}/${runs.length}  満タンの時刻（届いた回） p25=${pq(0.25)} p50=${pq(0.5)} p75=${pq(0.75)}  60秒の力 p50=${q(ends, 0.5).toFixed(1)}  払った回数 p50=${q(runs.map((r) => r.puffs), 0.5)}（×3 以上 p50=${q(runs.map((r) => r.combos), 0.5)}）  隠れた回数 p50=${q(runs.map((r) => r.hides), 0.5)}  掴まれた人秒 p50=${q(runs.map((r) => r.grabSec), 0.5).toFixed(1)}  中心からの平均の距離 p50=${q(runs.map((r) => r.centre), 0.5).toFixed(1)} m` };
};
for (const st of [NO_PUFF, NO_PUFF_HIDE, SPAM]) console.log(summary(st, SEEDS.map((s) => play(s, st))).line);
let best = null;
for (const st of strategies) {
  const sm = summary(st, SEEDS.map((s) => play(s, st)));
  if (process.env.VERBOSE) console.log('  ' + sm.line);
  const score = sm.reached * 1000 - (Number.isFinite(sm.med) ? sm.med : 999);
  if (!best || score > best.score) best = { score, line: sm.line, st };
}
console.log('最善（動くボット）: ' + best.line);

// 3) 撃退成功: 最善の操作で、力が L に届いた瞬間に放つ（届かないまま時間切れならブラックホール＝失敗）。放つと遊びは止まるので、
//    一回の流れの中で L ごとに「届いた瞬間に生きている軍勢がみな radiusFor(力) の内か（今の主人公＝爆心から）」を見る（game.settle と同じ判定）
const FAR = Number(process.env.FAR ?? 200);
const LEVELS = Array.from({ length: 16 }, (_, i) => 85 + i);
function releaseRun(seed, st, centreAt = null) {
  const g = createGame({ seed, cfg: CONFIG });
  g.begin(); g.pressStart();
  let t = 0, li = 0;
  const out = [];
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2 && li < LEVELS.length) {
    steerBot(g, { centreAt, cfg: CONFIG });
    actBot(g, st);
    g.update(DT); t += DT;
    while (li < LEVELS.length && g.power.value >= LEVELS[li] - 1e-6) {
      const alive = g.enemies.list.filter((e) => e.state !== 'dead');
      const r = radiusFor(g.power.value, CONFIG);
      const left = alive.filter((e) => Math.hypot(e.x - g.hero.x, e.z - g.hero.z) > r);
      // 同じ瞬間に、爆心だけを街の中心から FAR m の所へずらしたら（半径の届き方だけを比べる）
      const fx = FAR, fz = 0;
      const clearFar = alive.every((e) => Math.hypot(e.x - fx, e.z - fz) <= r);
      out[li++] = { t, clear: left.length === 0, clearFar, left: left.length, patrolLeft: left.filter((e) => e.patrol).length, alive: alive.length, centre: Math.hypot(g.hero.x, g.hero.z) };
    }
  }
  return out;
}
function releaseTable(label, st, centreAt) {
  const rel = SEEDS.map((s) => releaseRun(s, st, centreAt));
  console.log(`撃退成功（${label}。力が L に届いた瞬間に放つ。半径は radiusFor(L)）:`);
  let bestL = null;
  for (const [i, level] of LEVELS.entries()) {
    const got = rel.map((r) => r[i]).filter(Boolean);
    const ok = got.filter((r) => r.clear).length;
    const extra = got.length ? `  放った時刻 p50=${q(got.map((r) => r.t), 0.5).toFixed(1)}  放った所の中心からの距離 p50=${q(got.map((r) => r.centre), 0.5).toFixed(1)} m 最大=${Math.max(...got.map((r) => r.centre)).toFixed(1)} m  残り p50=${q(got.map((r) => r.left), 0.5)} 最大=${Math.max(...got.map((r) => r.left))}（うち見回る者 p50=${q(got.map((r) => r.patrolLeft), 0.5)}）` : '';
    console.log(`  L=${String(level).padStart(3)}（半径 ${radiusFor(level, CONFIG).toFixed(0)} m）: 届いた ${got.length}/${SEEDS.length}  撃退成功 ${ok}/${got.length}（全体 ${ok}/${SEEDS.length}）${extra}`);
    if (!bestL || ok > bestL.ok) bestL = { level, ok };
  }
  // どの L で放ってもよい、の一番よい回ごとの成功（「どこかで放てば勝てた」回の数）
  const any = rel.filter((r) => r.some((x) => x?.clear)).length;
  console.log(`${label}の最善の放ち方: L=${bestL.level} で撃退成功 ${bestL.ok}/${SEEDS.length}（${(100 * bestL.ok / SEEDS.length).toFixed(0)}%）  どこかの L で勝てた回 ${any}/${SEEDS.length}`);
  return { rel, bestL };
}
const centre = releaseTable('最善の操作・街の中心のそば', best.st, null);
// 満タン（L=100）で放った回は中心のそばなら必ず撃退成功
const i100 = LEVELS.indexOf(100);
const at100 = centre.rel.map((r) => r[i100]).filter(Boolean);
console.log(`満タンで中心のそばで放った回: ${at100.length} 回、撃退成功 ${at100.filter((r) => r.clear).length}、中心からの距離 最大 ${at100.length ? Math.max(...at100.map((r) => r.centre)).toFixed(1) : '-'} m`);
console.log(`  同じ瞬間に爆心だけを中心から ${FAR} m へずらすと: 撃退成功 ${at100.filter((r) => r.clearFar).length}/${at100.length}`);
console.log(`--- 中心から離れて放つ（中心から ${FAR} m の所へ寄る。同じ払う・隠れる） ---`);
console.log(summary({ ...best.st, name: `中心から ${FAR} m` }, SEEDS.map((s) => play(s, best.st, { x: FAR, z: 0 }))).line);
releaseTable(`中心から ${FAR} m`, best.st, { x: FAR, z: 0 });
