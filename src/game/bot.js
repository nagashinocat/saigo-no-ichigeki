// 釣り合いを数で確かめる自動の操作（scripts/balance-sim.mjs と tests/game/balance.test.js が同じものを使う。ゲームの本体は読まない）。
// M1 の steerBot（街の中心へ寄り、突っ込んでくる者を横へかわす）に、M2 で
//  - 探す者のライト（前向きの扇）の先から横へ外れる（見つからないように）
//  - 払う（3 回まで）: 掴まれている数が grab 以上、または主人公から trigger m 以内に crowd 人以上
//  - 隠れる（持ち主 15:20）: 払ったあと掴まれていなければ、追っている者から見えない物陰へ（向きは追う者の反対・中心の向き・横を順に試す）
// を足した「最善の操作」（best play = 動くボット）。centreAt: 寄る先（既定は街の中心。M2 の「中心から離れて放つ」操作は遠い点）
import { CONFIG } from '../config.js';
import { reachNow } from './reach.js';

export const BOT = { holdDist: 45, centreSlack: 6, dodgeDist: 16, dodgeW: 1.6, coneW: 1.2, coneSlack: 8 };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function steerBot(g, { centreAt = null, cfg = CONFIG, B = BOT } = {}) {
  const h = g.hero, E = cfg.enemy;
  const cx = centreAt?.x ?? 0, cz = centreAt?.z ?? 0;
  let mx = 0, mz = 0;
  // M2: 物陰に隠れている間は、近く（holdDist m の内）に軍勢がいるうちは動かない（出れば見つかる）
  if (h.hidden && Math.hypot(h.x - cx, h.z - cz) < 40 && g.enemies.list.some((e) => e.state !== 'dead' && e.x != null && (!e.patrol || e.hunting) && Math.hypot(e.x - h.x, e.z - h.z) < (B.holdDist ?? 0))) { g.setMove(0, 0); return; }
  const r = Math.hypot(h.x - cx, h.z - cz);
  if (r > B.centreSlack) { mx -= (h.x - cx) / r; mz -= (h.z - cz) / r; }
  for (const e of g.enemies.list) {
    if (e.x == null || e.state === 'dead') continue;
    const rx = h.x - e.x, rz = h.z - e.z, d = Math.hypot(rx, rz);
    if (e.state === 'chase' && d <= B.dodgeDist) {
      const hx = Math.cos(e.heading), hz = Math.sin(e.heading);
      if (hx * rx + hz * rz <= 0) continue; // こちらへ向かっていない
      const side = Math.sign(hx * rz - hz * rx) || 1;
      const w = B.dodgeW * (1 - d / B.dodgeDist);
      mx += -hz * side * w; mz += hx * side * w;
      continue;
    }
    // M2: 探す者のライトの先（扇の少し外まで）にいたら、扇の縁の近い側へ外れる
    if (e.state === 'search' && (!e.patrol || e.hunting || d < E.spotDist) && d < E.spotDist + B.coneSlack && d > 0.1) {
      const off = wrap(Math.atan2(rz, rx) - e.heading);
      if (Math.abs(off) > (E.spotHalfAngle ?? Math.PI) + 0.25) continue;
      const side = Math.sign(off) || 1;
      const w = B.coneW * (1 - d / (E.spotDist + B.coneSlack));
      const a = e.heading + side * Math.PI / 2;
      mx += Math.cos(a) * w; mz += Math.sin(a) * w;
    }
  }
  const m = Math.hypot(mx, mz);
  g.setMove(m > 1 ? mx / m : mx, m > 1 ? mz / m : mz);
}

// 払う・隠れるの判断（毎フレーム、update の前に呼ぶ）。st: { grab, trigger, crowd, hide, wait }。払ったら 'puff'、隠れたら 'hide'、何もしなければ null
//  払う: 掴まれている数が grab 以上、または主人公から trigger m 以内に crowd 人以上。wait（既定 true）なら、掴まれているのが grab 未満でも
//   隠れるがすぐできないとき（次まで待つ間）は、掴む者が maxGrabbing に届くまで払わない（払っても隠れられず、すぐまた掴まれるので）
//  隠れる: 掴まれていなくて、追う者が hideAt 人以上いる（払った直後も）
export function actBot(g, st) {
  if (st.grab === 'spam') return g.puff() ? 'puff' : null;
  const n = st.crowd < Infinity ? g.enemies.list.filter((e) => e.state !== 'dead' && e.dist <= st.trigger).length : 0;
  if ((g.grabbing >= st.grab || n >= st.crowd) && g.puff()) return 'puff';
  if (st.hide && g.hideBlock === null) {
    const chasers = g.enemies.list.filter((e) => (e.state === 'chase' || e.state === 'stagger') && e.x != null && e.dist < 80);
    // 物陰にいられる時間が切れそうなら、次の物陰へ（追う者がいなくても）
    const moveOn = g.hero.hidden && g.hideLeft < 0.4;
    if (chasers.length >= (st.hideAt ?? 1) || moveOn) {
      // 追う者の重心の反対・中心の向き・その横を順に試す
      let ax = 0, az = 0;
      for (const e of chasers) { ax += g.hero.x - e.x; az += g.hero.z - e.z; }
      const base = Math.atan2(az, ax), toC = Math.atan2(-g.hero.z, -g.hero.x);
      for (const a of [base, toC, base + Math.PI / 2, base - Math.PI / 2, toC + Math.PI / 2, toC - Math.PI / 2, base + Math.PI]) {
        if (g.hide(Math.cos(a), Math.sin(a))) return 'hide';
      }
    }
  }
  return null;
}

// R2（spec §15 ギリギリのボーナス・ランク）: 放つ判断（毎フレーム、update のあとに呼ぶ）。放ったら true。
//  「今なら全滅できる」（reach.js の届かない数が 0）のあいだは、残り waitTo 秒まで待つ（終わり間際ほど被害額の倍率が上がる）。
//  ただし掴まれたら（力が吸われて輪が縮む前に）すぐ放つ。届かないまま残り lastCall 秒になったら、足りる力があれば放つ（ブラックホールより被害額が付く）
//  sim（scripts/rank-sim.mjs、seed 1〜30）: waitTo 0.5 が被害額も撃退成功もいちばん良い（「最善の放ち方」）
export const RELEASE = { waitTo: 0.5, onGrab: true, lastCall: 0.1 };
export function releaseBot(g, { R = RELEASE, cfg = CONFIG } = {}) {
  if (g.phase !== 'playing') return false;
  const reachLeft = reachNow(g, cfg).left;
  const tl = g.timer.remaining;
  const go = reachLeft === 0 ? (tl <= R.waitTo || (R.onGrab && g.grabbing >= 1)) : (tl <= R.lastCall && g.power.value >= cfg.power.minRelease);
  if (!go) return false;
  g.pressEnd();
  return g.phase !== 'playing';
}
