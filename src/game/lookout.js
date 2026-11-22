import { CONFIG } from '../config.js';
import { lineOfSight, seesHero } from './enemies.js';
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
// 探す者 e のライトが、もうすぐ主人公 H に届くか。k: 広げる倍（出ている間のヒステリシスは lookout.holdK）
//  - spotDist × nearK × k m の内で、進む向きから spotHalfAngle × angleK × k rad の内（建物にさえぎられない）
//  - または predictSec 秒後のその者の位置（今の向きにまっすぐ e.speed m/s）から、ライト（seesHero）に入る
export function inDanger(e, H, buildings, cfg = CONFIG, k = 1) {
  if (e.state === 'dead' || e.x == null) return false;
  const E = cfg.enemy, L = cfg.lookout;
  const rx = H.x - e.x, rz = H.z - e.z, d = Math.hypot(rx, rz);
  const v = e.speed ?? 0, ahead = v * L.predictSec;
  if (d > Math.max(E.spotDist * L.nearK * k, E.spotDist + ahead)) return false; // どちらでも届かない（安い先の打ち切り）
  const h = e.heading ?? 0;
  if (d <= E.spotDist * L.nearK * k) {
    const off = Math.abs(wrap(Math.atan2(rz, rx) - h));
    if (off <= E.spotHalfAngle * L.angleK * k && lineOfSight(e.x, e.z, buildings, E.sightMargin, H.x, H.z)) return true;
  }
  if (ahead > 0) {
    const p = { ...e, x: e.x + Math.cos(h) * ahead, z: e.z + Math.sin(h) * ahead };
    if (seesHero(p, { x: H.x, z: H.z }, buildings, cfg)) return true;
  }
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
//  - 見つかった・隠れた・隠れられなくなった（掴まれた・待ち時間・溜めていない）ら、すぐ消す
//  - 危なくなくなったら、出てから minShowSec 秒を過ぎていれば消す。出ている間の危ないかは holdK 倍に広げて見る（ちらつかない）
// s: { hero, enemies, buildings, hideBlock, azimuthDeg }。戻り値: { show, deg（矢印の画面の角か null。毎フレーム今の主人公から物陰へ）,
// spot（矢印の先の物陰 { x, z } か null）, t（出てからの秒） }
export function createLookout(cfg = CONFIG) {
  const L = cfg.lookout;
  let show = false, shownT = 0, clock = 0, danger = false, arrow = null, checks = 0;
  const out = { show: false, deg: null, spot: null, t: 0 };
  const near = (H, bs) => bs.filter((b) => Math.abs(b.x - H.x) - b.w / 2 < L.nearBuildings && Math.abs(b.z - H.z) - b.d / 2 < L.nearBuildings);
  function check(s) {
    checks++;
    const bs = near(s.hero, s.buildings);
    const threats = [];
    for (const e of s.enemies) if (e.state === 'search' && inDanger(e, s.hero, bs, cfg, show ? L.holdK : 1)) threats.push(e);
    danger = threats.length > 0;
    // 矢印: 追っている者はいない（見つかっていない）ので、hide と同じく watchers は空
    arrow = danger ? lookoutArrow(s.hero, bs, [], s.azimuthDeg ?? 0, threats, cfg) : null;
  }
  return {
    // 危ないかを確かめた回数（テスト用）
    get checks() { return checks; },
    update(dt, s) {
      const blocked = s.hideBlock != null || s.hero.hidden || isSpotted(s.enemies);
      if (blocked) {
        show = false; danger = false; arrow = null; clock = 0;
      } else {
        clock -= dt;
        if (clock <= 0) { clock += L.checkEvery; if (clock <= 0) clock = L.checkEvery; check(s); }
        if (danger) { if (!show) shownT = 0; show = true; }
        else if (show && shownT >= L.minShowSec) show = false;
      }
      if (show) shownT += dt;
      // fix1: 物陰は checkEvery ごとに選び直すが、矢印の角は毎フレーム今の主人公の所からその物陰へ（安い。0.2 秒古い角にしない）
      const on = show && arrow;
      out.show = show; out.t = show ? shownT : 0;
      out.spot = on ? arrow.spot : null;
      out.deg = on ? screenBearingDeg(arrow.spot.x - s.hero.x, arrow.spot.z - s.hero.z, s.azimuthDeg ?? 0) : null;
      return out;
    },
  };
}
