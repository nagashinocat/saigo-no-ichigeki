// 命中を瓦礫の崩れる音へ渡す（main.js が使う。描画も Web Audio も知らない）。
//   - ゲームの命中（game の 'hit'）とリプレイの命中を、フレームごとにためる
//   - settle が一気に進めた命中は、すぐにリプレイが同じ街を起こし直すので音にしない（リプレイの始まりに鳴ってしまう）
//   - 演出の間は、白が晴れて爆発が始まってから横一線の光が消えるまでの段だけ鳴らす（音は画面に従う）
//   - 持ち主 23:01: 破片が落ちて止まった（瓦礫になった）瞬間も、その場所から重い崩れる音として鳴らす（settleHit。大きい破片だけ）
//   - drain で、今のカメラから見た大きさ・近さ・左右（collapseHitInfo）に直して空にする
import { collapseHitInfo } from './collapse.js';

export const COLLAPSE_STAGES = new Set(['swell', 'race', 'chase', 'space', 'flatten']);
// 落ちて止まった破片のうち、音にする大きさ（いちばん長い辺 m）の下限
export const SETTLE_MIN = 1.2;

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
    // 落ちて止まった破片（destruction の settled: { pos, dims, size }）。id は場所から決める（リプレイでも同じ破片は同じ音）
    settleHit(p) {
      if (!(p.size >= SETTLE_MIN)) return false;
      const id = 's' + Math.round(p.pos[0] * 4) + '_' + Math.round(p.pos[2] * 4);
      list.push({ hit: { id, kind: 'settle' }, target: { x: p.pos[0], z: p.pos[2], w: p.dims[0], d: p.dims[2], h: p.dims[1] } });
      return true;
    },
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
