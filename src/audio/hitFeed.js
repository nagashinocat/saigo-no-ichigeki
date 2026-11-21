// 命中を瓦礫の崩れる音へ渡す（main.js が使う。描画も Web Audio も知らない）。
//   - ゲームの命中（game の 'hit'）とリプレイの命中を、フレームごとにためる
//   - settle が一気に進めた命中は、すぐにリプレイが同じ街を起こし直すので音にしない（リプレイの始まりに鳴ってしまう）
//   - 演出の間は、時間が戻ってから横一線の光が消えるまでの段だけ鳴らす（ガラスの一拍は鼓動だけ）
//   - drain で、今のカメラから見た大きさ・近さ・左右（collapseHitInfo）に直して空にする
import { collapseHitInfo } from './collapse.js';

export const COLLAPSE_STAGES = new Set(['snap', 'chase', 'space', 'flatten']);

export function createHitFeed() {
  let list = [];
  return {
    // ゲームの命中。replayPending: このあとリプレイが同じ一発を見せ直す（写しがある）。ためたら true
    gameHit(e, { replayPending = false } = {}) {
      if (e.settled && replayPending) return false;
      list.push(e);
      return true;
    },
    replayHit(e) { list.push(e); },
    get pending() { return list.length; },
    // project(target) → { camX, camZ, dist }。stage: 演出の段（演出でなければ null）
    drain(project, { stage = null } = {}) {
      const hits = list;
      list = [];
      if (stage !== null && !COLLAPSE_STAGES.has(stage)) return [];
      return hits.map(({ hit, target }) => collapseHitInfo({ id: hit.id, w: target.w, d: target.d, h: target.h }, project(target)));
    },
  };
}
