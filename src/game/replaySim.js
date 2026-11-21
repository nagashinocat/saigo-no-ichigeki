import { CONFIG } from '../config.js';
import { createBlast } from './blast.js';

// リプレイの爆発（描画は知らない）。放つ直前の街（targets）と軍勢の写しから、同じ一発をもう一度起こす。
// ゲームの採点や状態には触れない。命中は前線の距離だけで決まるので、刻み方によらず本物と同じ順に起きる。

const REPLAY_BLAST_ID = 1e6; // 描く側が球を一発ごとに見分ける id（ゲームの一発とは重ならない）

// 街の全部の対象（ビルと props）。最後の一発の前に壊れるものはない（小爆発は軍勢だけを払う）ので、これが直前の街
export function replayTargets(city) {
  const out = [];
  for (const b of city.buildings) out.push({ id: 'b' + b.id, dist: b.dist, target: b });
  for (const p of city.props) out.push({ id: 'p' + p.id, dist: p.dist, target: p });
  for (const s of city.transit?.segments ?? []) out.push({ id: s.id, dist: s.dist, target: s });
  return out;
}

// shot: 最後の一発、targets: replayTargets の戻り値、enemies: 放つ直前の軍勢（写して使う）
export function createReplaySim({ shot, targets, enemies = [], cfg = CONFIG }) {
  const byKey = new Map(targets.map((t) => [t.id, t.target]));
  const blast = createBlast(shot, targets.map(({ id, dist }) => ({ id, dist })), cfg);
  // 止まった姿で写す（リプレイの間、軍勢は動かないので、速さで描く推進光の尾や曲がりの傾きを残さない）
  const list = enemies.map((e) => ({ ...e, speed: 0, turn: 0, lean: 0 }));
  let time = 0;
  const live = [{ id: REPLAY_BLAST_ID, shot, front: 0 }];

  return {
    get time() { return time; },
    get front() { return blast.front; },
    get done() { return blast.done; },
    // game.blasts と同じ形（終わった一発は消える）
    get blasts() { return blast.done ? [] : live; },
    get enemies() { return list; },
    // dt 秒進める。起きた命中を game の 'hit' と同じ形（{ hit, target }）で返す
    step(dt) {
      if (!(dt > 0)) return [];
      time += dt;
      const hits = blast.done ? [] : blast.update(dt);
      live[0].front = blast.front;
      // 倒れた者は吹き飛ぶ時間が進む（本物の最後の一発の間は止まっていたが、リプレイでは飛んでいくのを見せる）
      for (const e of list) if (e.state === 'dead') e.deadTime = (e.deadTime ?? 0) + dt;
      for (const e of list) {
        if (e.state === 'dead' || e.dist > blast.front) continue;
        e.state = 'dead';
        e.deadTime = 0;
      }
      return hits.map((hit) => ({ hit, target: byKey.get(hit.id) }));
    },
  };
}
