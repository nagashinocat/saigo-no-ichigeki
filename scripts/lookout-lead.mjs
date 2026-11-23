// 使い方: node scripts/lookout-lead.mjs [root]
// 持ち主 10:02（「隠れるの矢印を押すタイミングがない」）: LOOK OUT! が、見つかる何秒前に出ているか（先に知らせる余裕 = lead）を今日の街で測る。
// 最善の操作の動き（bot.js steerBot、掴まれ 2 人で払う）で、隠れない（見つかる瞬間を数えるため）。見つかっていない → 見つかったに変わるたび、
// その直前のフレームで LOOK OUT! が出続けていた秒（出ていなければ 0）を数える。見つかった直後の猶予（lookout.graceSec）で矢印が出ていたかも数える。
// LOOKOUT='{...}' で CONFIG.lookout の一部を差し替え（前の値で比べる: LOOKOUT='{"nearK":1.4,"angleK":1.2,"predictSec":0.6,"checkEvery":0.2,"minShowSec":0.4,"graceSec":0}'）。
// DAYS（既定 40）・FROMS は daily-balance と同じ
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createGame } = await imp('src/game/game.js');
const { steerBot, actBot, POLICY } = await imp('src/game/bot.js');
const { CONFIG: BASE } = await imp('src/config.js');
const { createLookout, isSpotted } = await imp('src/game/lookout.js');
const { citySeed } = await imp('src/game/daily.js');
const CONFIG = { ...BASE, lookout: { ...BASE.lookout, ...JSON.parse(process.env.LOOKOUT ?? '{}') } };
const DT = 1 / 30;
const dayKeys = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)) + i * 864e5); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; });
const FROMS = (process.env.FROMS ?? '20260701,20261101,20270301').split(',');
const SEEDS = FROMS.flatMap((f) => dayKeys(f, Number(process.env.DAYS ?? 40)).map(citySeed));
// Fix round 1: 遊び方は最善（POLICY.best）の払い方で、隠れない（見つかる瞬間を数えるため）
const ST = { ...(POLICY?.best ?? { grab: 2, trigger: 0, crowd: Infinity }), hide: false, lookout: false };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

const leads = [], fresh = [], freshLock = [], freshFree = []; // fresh: その前の FRESH 秒、見つかっていなかった回（追われた直後・払った直後の見つかり直しを除く）
const FRESH = 1.5;
let graceShown = 0, graceArrow = 0, checkMs = 0, checks = 0, frames = 0;
for (const seed of SEEDS) {
  const g = createGame({ seed, cfg: CONFIG });
  const lo = createLookout(CONFIG);
  g.begin(); g.pressStart();
  let t = 0, lastSpotted = -Infinity, prevLock = false, prev = false, prevT = 0, prevShow = false, graceUntil = -1, graceSeen = false, graceArrowSeen = false;
  while (g.phase === 'playing' && t < CONFIG.roundSeconds - DT / 2) {
    steerBot(g, { cfg: CONFIG });
    actBot(g, ST, CONFIG);
    g.update(DT); t += DT;
    const c0 = lo.checks, t0 = performance.now();
    const out = lo.update(DT, { hero: g.hero, enemies: g.enemies.list, buildings: g.city.buildings, hideBlock: g.hideBlock, azimuthDeg: 0 });
    if (lo.checks > c0) { checkMs += performance.now() - t0; checks += lo.checks - c0; }
    frames++;
    const sp = isSpotted(g.enemies.list);
    if (sp && !prev && !g.hero.hidden && g.grabbing === 0) {
      leads.push(prevShow ? prevT : 0);
      if (t - lastSpotted > FRESH) { const v = prevShow ? prevT : 0; fresh.push(v); (prevLock ? freshLock : freshFree).push(v); }
      graceUntil = t + (CONFIG.lookout.graceSec ?? 0); graceSeen = false; graceArrowSeen = false;
    }
    if (sp && t <= graceUntil) { if (out.show) graceSeen = true; if (out.show && out.spot) graceArrowSeen = true; }
    if (graceUntil > 0 && t > graceUntil) { if (graceSeen) graceShown++; if (graceArrowSeen) graceArrow++; graceUntil = -1; }
    if (sp) lastSpotted = t;
    prevLock = g.hideBlock === 'cooldown';
    prev = sp; prevShow = out.show; prevT = out.t;
  }
}
if (process.env.HIST) { const h = {}; for (const x of leads) { const b = (Math.floor(x * 10) / 10).toFixed(1); h[b] = (h[b] ?? 0) + 1; } console.log(h); }
const n = leads.length;
const warned = leads.filter((x) => x > 0);
console.log(`街 ${SEEDS.length}（${FROMS.join('・')} から ${process.env.DAYS ?? 40} 日ずつ）  lookout ${JSON.stringify(CONFIG.lookout)}`);
console.log(`見つかった ${n} 回: 先に LOOK OUT! が出ていた ${warned.length}（${(100 * warned.length / n).toFixed(0)}%）`);
console.log(`  lead（出ていた回だけ） p25=${q(warned, 0.25).toFixed(2)} p50=${q(warned, 0.5).toFixed(2)} p75=${q(warned, 0.75).toFixed(2)} 秒`);
console.log(`  lead（全部、出ていなければ 0） p25=${q(leads, 0.25).toFixed(2)} p50=${q(leads, 0.5).toFixed(2)} p75=${q(leads, 0.75).toFixed(2)} 秒  1.0 秒以上 ${leads.filter((x) => x >= 1 - 1e-9).length}（${(100 * leads.filter((x) => x >= 1 - 1e-9).length / n).toFixed(0)}%）`);
const f1 = fresh.filter((x) => x >= 1 - 1e-9).length;
console.log(`  そのうち、その前の ${FRESH} 秒は見つかっていなかった回 ${fresh.length}: lead p25=${q(fresh, 0.25).toFixed(2)} p50=${q(fresh, 0.5).toFixed(2)} p75=${q(fresh, 0.75).toFixed(2)} 秒  1.0 秒以上 ${f1}（${(100 * f1 / fresh.length).toFixed(0)}%）  0.8 秒以上 ${fresh.filter((x) => x >= 0.8 - 1e-9).length}  出ていなかった ${fresh.filter((x) => x === 0).length}`);
// Fix round 1: 隠れられない待ち時間（払ったあと・隠れたあと）の間に見つかった回（字だけの LOOK OUT!）と、その外の回
for (const [name, xs] of [['待ち時間の間（字だけ）', freshLock], ['待ち時間の外（矢印あり）', freshFree]]) if (xs.length) console.log(`    ${name} ${xs.length}: lead p50=${q(xs, 0.5).toFixed(2)} 秒  1.0 秒以上 ${xs.filter((x) => x >= 1 - 1e-9).length}（${(100 * xs.filter((x) => x >= 1 - 1e-9).length / xs.length).toFixed(0)}%）  出ていなかった ${xs.filter((x) => x === 0).length}`);
console.log(`  見つかった直後の猶予で LOOK OUT! が出ていた ${graceShown}/${n}、矢印（押せる）まで出ていた ${graceArrow}/${n}`);
console.log(`確かめ 1 回 平均 ${(checkMs / Math.max(1, checks)).toFixed(3)} ms（${checks} 回、1 秒に ${(checks / (frames * DT)).toFixed(1)} 回）`);
