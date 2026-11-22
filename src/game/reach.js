import { CONFIG } from '../config.js';
import { radiusFor } from './charge.js';
import { riderDist } from './centre.js';

// R2（spec §15 届く範囲の輪）: 今の力で今の主人公の所から放ったら、どこまで届くか。勝ち負け（S9）と同じ決まりで数える:
// 放った瞬間に生きている軍勢（見回る者・大物を含む）のうち、爆心（放った瞬間の主人公）から radiusFor(力) より遠い者が生き残る。
// 放ったあとは軍勢は動かず、前線は最後に半径ちょうどまで届く（blast.frontAt）。距離は前線と同じ riderDist。
// だから「届かない軍勢 あと N 体」の N は、その瞬間に放った一発の生き残りの数とちょうど同じ（tests/game/reach.test.js）

// ギリギリのボーナス（spec §15）の「主人公のすぐそば」（m）
export const NEAR_DIST = 15;

// 輪の半径（m）: 今の力で放った一発の半径（charge.release と同じ）
export const reachRadius = (power, cfg = CONFIG) => radiusFor(power, cfg);

// 生きている者のうち、爆心 centre から radius m より遠い者の数
export function unreachedCount(list, centre, radius) {
  let n = 0;
  for (const e of list) if (e.state !== 'dead' && riderDist(e, centre) > radius) n++;
  return n;
}

// 生きている者のうち、爆心 centre から dist m の内にいる者の数
export function nearCount(list, centre, dist = NEAR_DIST) {
  let n = 0;
  for (const e of list) if (e.state !== 'dead' && riderDist(e, centre) <= dist) n++;
  return n;
}

// ゲーム（createGame）の今: { radius: 輪の半径 m, left: 届かない数 }
export function reachNow(g, cfg = CONFIG) {
  const radius = reachRadius(g.power.value, cfg);
  return { radius, left: unreachedCount(g.enemies.list, g.hero, radius) };
}
