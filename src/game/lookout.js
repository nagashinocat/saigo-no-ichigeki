import { CONFIG } from '../config.js';
import { lineOfSight, seesHero, roadNode } from './enemies.js';
import { findCover } from './cover.js';
import { screenToWorld } from '../input/controls.js';
import { screenBearingDeg } from '../ui/stickMarks.js';

// R1e（持ち主 16:55「見つかりそうなときに隠れられそうな向きに矢印とLOOK OUT!みたいなのをポップな字で出したら良いかも」）:
// 見つかりそうかの判断と、シュッで入れる物陰の向き（画面の角）。描画もDOMも知らない（ui/lookoutView.js が映す）。

const SPOTTED = new Set(['chase', 'approach', 'stagger', 'grab', 'cling']);
// もう見つかっている（追う・近づく・よろめいて戻る・掴む・群がる者がいる）
export function isSpotted(enemies) {
  for (const e of enemies) if (SPOTTED.has(e.state)) return true;
  return false;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// 先読みの道すじの上の一点から、ライト（seesHero）に入るか（毎回の写しを作らない）
const probe = { x: 0, z: 0, heading: 0 };
function seesFrom(x, z, h, H, buildings, cfg) { probe.x = x; probe.z = z; probe.heading = h; return seesHero(probe, H, buildings, cfg); }
// 探す者 e のライトが、もうすぐ主人公 H に届くか。k: 広げる倍（出ている間のヒステリシスは lookout.holdK）
//  - spotDist × nearK × k m の内で、進む向きから spotHalfAngle × angleK × k rad の内（建物にさえぎられない）
//  - または predictSec 秒の内（e.speed m/s で進む道すじの上、predictStep m ごと）のどこかから、ライト（seesHero）に入る
// 持ち主 10:02（「隠れるの矢印を押すタイミングがない」）: 道を走る者（ni・nj・di・dj のある者）の道すじは、次の交差点まで道に沿い、
// そこから先はまっすぐ・左・右のどれか（戻らない。enemies.js chooseNext と同じ）。角を曲がって照らす者も先に知らせる
// （前は今の向きのまっすぐ先の一点だけ。今日の街で見つかった回の多くは、角を曲がる・建物の陰から出る者で、知らせが 0.4 秒ほどしか先にならなかった）。
// 道を持たない者は今の向きのまっすぐ先
export function inDanger(e, H, buildings, cfg = CONFIG, k = 1) {
  if (e.state === 'dead' || e.x == null) return false;
  const E = cfg.enemy, L = cfg.lookout;
  const rx = H.x - e.x, rz = H.z - e.z, d = Math.hypot(rx, rz);
  const v = e.speed ?? 0, ahead = v * L.predictSec;
  // どちらでも届かない（安い先の打ち切り。道すじの長さは ahead までなので、その先の点から主人公までは d − ahead より遠い）
  if (d > Math.max(E.spotDist * L.nearK * k, E.spotDist + ahead)) return false;
  const h = e.heading ?? 0;
  if (d <= E.spotDist * L.nearK * k) {
    const off = Math.abs(wrap(Math.atan2(rz, rx) - h));
    if (off <= E.spotHalfAngle * L.angleK * k && lineOfSight(e.x, e.z, buildings, E.sightMargin, H.x, H.z)) return true;
  }
  if (!(ahead > 0)) return false;
  const step = L.predictStep ?? 6;
  // (x0, z0) から向き (cx, cz) へ len m 進む間（step m ごとと終わりの点）にライトに入るか
  const leg = (x0, z0, cx, cz, len) => {
    const hh = Math.atan2(cz, cx);
    for (let s = Math.min(step, len); len > 0; s = Math.min(s + step, len)) {
      if (seesFrom(x0 + cx * s, z0 + cz * s, hh, H, buildings, cfg)) return true;
      if (s >= len) break;
    }
    return false;
  };
  if (e.ni == null || e.nj == null || !(e.di || e.dj)) return leg(e.x, e.z, Math.cos(h), Math.sin(h), ahead);
  const [nx, nz] = roadNode(e.ni, e.nj);
  const tx = nx + (e.lane?.[0] ?? 0), tz = nz + (e.lane?.[1] ?? 0);
  const s1 = Math.min(ahead, Math.max(0, (tx - e.x) * e.di + (tz - e.z) * e.dj));
  if (leg(e.x, e.z, e.di, e.dj, s1)) return true;
  if (s1 >= ahead) return false;
  const x1 = e.x + e.di * s1, z1 = e.z + e.dj * s1;
  for (const [bi, bj] of [[e.di, e.dj], [-e.dj, e.di], [e.dj, -e.di]]) if (leg(x1, z1, bi, bj, ahead - s1)) return true;
  return false;
}

// シュッで入れる物陰の向き。画面の dirs 向きへ払ったときに M2 の hide（findCover。watchers は hide と同じ、追っている者）が選ぶ物陰を探し、
// その物陰の画面の角（主人公から見て）を矢印にする。その角へ払い直しても agreeDeg° の内の物陰へ入るものだけ（矢印の向きに払えばそこへ入る）。
// threats（ライトが届きそうな者）のライトがそこへはもうすぐ届かない物陰を先に、その中で近いもの。無ければ null。
// 戻り値: { deg（画面の角。右 0、下 90、時計回り）, spot（街の { x, z }）, safe（threats のライトがそこへはもうすぐ届かない） }
export function lookoutArrow(hero, buildings, watchers, azimuthDeg = 0, threats = [], cfg = CONFIG) {
  const L = cfg.lookout;
  let best = null;
  const seen = [];
  for (let k = 0; k < L.dirs; k++) {
    const a = (k / L.dirs) * 2 * Math.PI;
    const w = screenToWorld(Math.cos(a), Math.sin(a), azimuthDeg);
    const p = findCover(hero, w, buildings, watchers, cfg);
    if (!p || seen.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.5)) continue;
    seen.push(p);
    const deg = screenBearingDeg(p.x - hero.x, p.z - hero.z, azimuthDeg);
    // その角へ払い直す（M2 の hide と同じ探し方）と、同じ向きの物陰へ入るか
    const r = (deg * Math.PI) / 180, w2 = screenToWorld(Math.cos(r), Math.sin(r), azimuthDeg);
    const p2 = findCover(hero, w2, buildings, watchers, cfg);
    if (!p2) continue;
    const deg2 = screenBearingDeg(p2.x - hero.x, p2.z - hero.z, azimuthDeg);
    if (Math.abs(((deg2 - deg + 540) % 360) - 180) > L.agreeDeg) continue;
    // 安全: そこに立っても、どの threats のライトももうすぐ届かない（出し続けるときと同じ holdK 倍の広さで見る。遠い・見通しがない・後ろ）
    const safe = threats.every((t) => !inDanger(t, p2, buildings, cfg, L.holdK));
    const dist = Math.hypot(p2.x - hero.x, p2.z - hero.z);
    if (!best || (safe && !best.safe) || (safe === best.safe && dist < best.dist)) best = { deg, spot: p2, safe, dist };
  }
  return best && { deg: best.deg, spot: best.spot, safe: best.safe };
}

// 出す・消すの決まり（毎フレーム update。危ないかと矢印は checkEvery 秒ごと）:
//  - 出すのは、見つかっていない・隠れていない・隠れられる（hideBlock が null）・危ない者がいるとき
//  - 隠れた・隠れられなくなった（掴まれた・溜めていない）ら、すぐ消す。待ち時間（hideBlock: cooldown。隠れたあと・払ったあと）の間は字だけ（矢印なし）
//  - 危なくなくなったら、出てから minShowSec 秒を過ぎていれば消す。出ている間の危ないかは holdK 倍に広げて見る（ちらつかない）
//  - 持ち主 10:02（「隠れるの矢印を押すタイミングがない」）: 見つかった直後（見つかっていない → 見つかったに変わってから graceSec 秒）は、
//    掴まれていない（掴む・群がる者がいない）・隠れられるなら、矢印を出し続ける（押せば M2 の hide と同じく、追う者は見失って最後に見た所を探す）。
//    矢印の物陰は hide と同じく、追っている者（chase・approach・stagger）から見えない所。押せる物陰がなければ出さない。猶予を過ぎたら、すぐ消す
// s: { hero, enemies, buildings, hideBlock, azimuthDeg }。戻り値: { show, deg（矢印の画面の角か null。毎フレーム今の主人公から物陰へ）,
// spot（矢印の先の物陰 { x, z } か null）, t（出てからの秒）, grace（見つかった直後の猶予で出ているか） }
const WATCH = new Set(['chase', 'approach', 'stagger']); // game.js hide の watchers と同じ
const GRABBED = new Set(['grab', 'cling']);
export function createLookout(cfg = CONFIG) {
  const L = cfg.lookout;
  let show = false, shownT = 0, clock = 0, danger = false, arrow = null, checks = 0;
  // Fix round 1: 物陰を選んでからの秒と、選んだ回数（テスト用）。物陰は arrowEvery 秒ごとに選び直す（一番重い所）
  let arrowAge = Infinity, arrowPicks = 0;
  let spottedPrev = false, graceLeft = 0, graceArrow = null, graceClock = 0;
  const out = { show: false, deg: null, spot: null, t: 0, grace: false };
  const near = (H, bs) => bs.filter((b) => Math.abs(b.x - H.x) - b.w / 2 < L.nearBuildings && Math.abs(b.z - H.z) - b.d / 2 < L.nearBuildings);
  function check(s, textOnly = false) {
    checks++;
    const bs = near(s.hero, s.buildings);
    const threats = [];
    for (const e of s.enemies) if (e.state === 'search' && inDanger(e, s.hero, bs, cfg, show ? L.holdK : 1)) threats.push(e);
    danger = threats.length > 0;
    // 矢印: 追っている者はいない（見つかっていない）ので、hide と同じく watchers は空
    // Fix round 1: 待ち時間の間（textOnly）は矢印を探さない（字だけ）
    if (!danger || textOnly) { arrow = null; arrowAge = Infinity; return; }
    if (arrow && arrowAge < (L.arrowEvery ?? 0)) return;
    arrow = lookoutArrow(s.hero, bs, [], s.azimuthDeg ?? 0, threats, cfg);
    arrowAge = 0; arrowPicks++;
  }
  // 見つかった直後の矢印: 追っている者から見えない物陰（hide と同じ watchers）。ライトがもうすぐ届く探す者のライトが届かない所を先に
  function checkGrace(s) {
    checks++;
    const bs = near(s.hero, s.buildings);
    const watchers = s.enemies.filter((e) => WATCH.has(e.state) && e.x != null);
    const threats = s.enemies.filter((e) => e.state === 'search' && inDanger(e, s.hero, bs, cfg, L.holdK));
    graceArrow = lookoutArrow(s.hero, bs, watchers, s.azimuthDeg ?? 0, threats, cfg);
    arrowPicks++;
  }
  return {
    // 危ないかを確かめた回数（テスト用）
    get checks() { return checks; },
    get arrowPicks() { return arrowPicks; },
    update(dt, s) {
      arrowAge += dt;
      const spotted = isSpotted(s.enemies);
      if (spotted && !spottedPrev) { graceLeft = L.graceSec ?? 0; graceClock = 0; graceArrow = null; }
      spottedPrev = spotted;
      if (!spotted) graceLeft = 0; else graceLeft -= dt;
      const grabbedNow = s.enemies.some((e) => GRABBED.has(e.state));
      const canHide = s.hideBlock == null && !s.hero.hidden && !grabbedNow;
      // Fix round 1（まとめ役の裁定）: 隠れられない待ち時間（隠れたあと・払ったあと）の間も、LOOK OUT! は字だけ出す（矢印・当たりなし。タップは払う）
      const textOnly = !canHide && s.hideBlock === 'cooldown' && !s.hero.hidden && !grabbedNow;
      let grace = false;
      if (spotted && graceLeft > 0 && canHide) {
        graceClock -= dt;
        if (graceClock <= 0) { graceClock += L.checkEvery; if (graceClock <= 0) graceClock = L.checkEvery; checkGrace(s); }
        grace = !!graceArrow;
      }
      if (grace) {
        if (!show) shownT = 0;
        show = true; arrow = graceArrow; danger = false; clock = 0; arrowAge = Infinity;
      } else if (spotted || !(canHide || textOnly)) {
        show = false; danger = false; arrow = null; clock = 0; arrowAge = Infinity;
      } else {
        clock -= dt;
        if (clock <= 0) { clock += L.checkEvery; if (clock <= 0) clock = L.checkEvery; check(s, textOnly); }
        if (textOnly) arrow = null;
        if (danger) { if (!show) shownT = 0; show = true; }
        else if (show && shownT >= L.minShowSec) show = false;
      }
      if (show) shownT += dt;
      // fix1: 物陰は checkEvery ごとに選び直すが、矢印の角は毎フレーム今の主人公の所からその物陰へ（安い。checkEvery 秒古い角にしない）
      const on = show && arrow;
      out.show = show; out.t = show ? shownT : 0; out.grace = show && grace;
      out.spot = on ? arrow.spot : null;
      out.deg = on ? screenBearingDeg(arrow.spot.x - s.hero.x, arrow.spot.z - s.hero.z, s.azimuthDeg ?? 0) : null;
      return out;
    },
  };
}
