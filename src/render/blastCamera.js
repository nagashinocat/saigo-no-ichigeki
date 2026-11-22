import { CONFIG } from '../config.js';
import { frontAt, timeAtFront, phaseTimes } from '../game/blast.js';

// 爆発に合わせた上空カメラの「いいとこ取り」: 弾けた直後は近いまま、速く広がる前線を見せ、
// 前線が半径の wideFrontFrac に届くか wideDelay 秒たったら（早い方）、球の全体（最後の半径）が画面に収まる
// 遠めの位置へなめらかに引く（球が消える前に着くように）。爆発が終わったら、球が消えきるまで holdSec 秒保ってから、
// 近い上空カメラへ戻る。小さな一発（smallRadius 以下）は引かない。
// カメラは視線に沿って後ろ（上）へ t だけ下がるだけ（向きは変えない）。
export const BLAST_CAM = {
  ratio: 1.3,         // 球の今の半径 × ratio より中心に近づくことは決してない（球に飲み込まれない）
  lookahead: 0.25,    // 近いままの間も、この秒数のうちに前線が届く大きさへは先に動き出す（押されて急に跳ばない）
  smallRadius: 60,    // この半径以下の一発では引かない
  wideDelay: 0.6,     // 弾けてから、全体が見える位置へ引き始めるまでの秒（の上限）
  wideFrontFrac: 0.55, // 前線が半径のこの割合に届いたら、wideDelay を待たずに引き始める
  holdSec: CONFIG.blast.fadeSec, // 爆発が終わってから、遠めの位置で保つ秒（球が消えきるまで）
  margin: 0.9,        // 全体が収まる: 球の見かけの端が、画面の端までの割合のこの内側
  outRate: 6,         // 引くばねの速さ（1/秒）
  targetRate: 12,     // 目標そのものも、この速さ（1/秒）でなめらかに動かす（引き始めの加速を 0 から立ち上げる）
  backRate: 1.6,      // 戻るばねの速さ（1/秒）
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// 視線 dir（単位ベクトル）と逆向きに t 下がると、原点からの距離が minDist 以上になる最小の t（0 以上）。
export function pullbackDistance(pos, dir, minDist) {
  const pp = dot(pos, pos);
  if (pp >= minDist * minDist) return 0;
  const pd = dot(pos, dir);
  // |pos - t dir|² = minDist² を t について解く（大きい方の根）
  return pd + Math.sqrt(pd * pd - pp + minDist * minDist);
}

// 地面の上に出ている球（原点が中心、半径 radius の上半分）の上の点。13 段 × 48 方位
// （近い上空カメラは見下ろす角度が深く、球の見かけの端が点の間に来やすいので細かめ）
const DOME_EL = 12, DOME_AZ = 48;
const DOME = [];
for (let i = 0; i <= DOME_EL; i++) {
  const el = (i / DOME_EL) * Math.PI / 2;
  for (let j = 0; j < (i === DOME_EL ? 1 : DOME_AZ); j++) {
    const az = (j / DOME_AZ) * Math.PI * 2;
    DOME.push([Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]);
  }
}

// 球の全体が画面に収まるよう、視線 dir と逆向きに下がる最小の t（0 以上）。
// カメラは pos にあり dir を向き、横に傾いていない（上は世界の上）。tanV / tanH は縦・横の半画角の tan。
// 下がっても点の横・縦の位置（視線に直交する成分）は変わらず、奥行きだけが t 増えるので、点ごとに解ける。
export function wholeFitPullback(radius, pos, dir, tanV, tanH, margin = BLAST_CAM.margin) {
  if (radius <= 0) return 0;
  const right = normalize([-dir[2], 0, dir[0]]); // dir × 世界の上
  const up = [right[1] * dir[2] - right[2] * dir[1], right[2] * dir[0] - right[0] * dir[2], right[0] * dir[1] - right[1] * dir[0]];
  let t = 0;
  for (const d of DOME) {
    const v = [d[0] * radius - pos[0], d[1] * radius - pos[1], d[2] * radius - pos[2]];
    const need = Math.max(Math.abs(dot(v, right)) / (tanH * margin), Math.abs(dot(v, up)) / (tanV * margin));
    t = Math.max(t, need - dot(v, dir));
  }
  return t;
}

// 弾けてからの秒（じわじわ期は負）。front は今の前線の半径
// small: 払う（小爆発）の曲線
export function sinceBurstOf(front, radius, cfg = CONFIG, small = false) {
  return timeAtFront(front, radius, cfg, small) - phaseTimes(radius, cfg, small).creep;
}

// 弾けてから何秒で全体の位置へ引き始めるか（前線が wideFrontFrac に届く時刻と wideDelay の早い方）
export function wideStartOf(radius, c = BLAST_CAM, cfg = CONFIG) {
  return Math.min(c.wideDelay, sinceBurstOf(c.wideFrontFrac * radius, radius, cfg));
}

// 一発ごとの記録 { radius, sinceBurst } から、カメラがどうしたいか。
//   'wide': 全体が見える位置へ（radius はその中で一番大きい一発）
//   'stay': 引く一発が弾けたばかり（またはじわじわ期）。今の位置のまま（戻る途中なら、その場で止まる）
//   'near': 近い上空カメラへ
// waiting: 弾けたばかりの一発がある（'wide' のときも、その一発のために今より戻らない）
export function cameraIntent(records, c = BLAST_CAM, cfg = CONFIG) {
  let wide = 0, waiting = false;
  for (const r of records) {
    if (r.radius <= c.smallRadius) continue;
    if (r.sinceBurst >= wideStartOf(r.radius, c, cfg)) wide = Math.max(wide, r.radius);
    else waiting = true;
  }
  if (wide > 0) return { mode: 'wide', radius: wide, waiting };
  return { mode: waiting ? 'stay' : 'near', radius: 0, waiting };
}

// 上空カメラが視線に沿って下がる量 t を、臨界減衰のばねで動かす（動き出しの速さは 0、大きな dt でも振動しない）。
// update(dt, { pos, dir, tanV, tanH, blasts, front, hold }):
//   blasts: 今の一発 [{ id, radius, front, small }]（small: 払う）（終わった一発は来なくなる）、front: 見えている球の一番大きい半径、
//   hold: true の間は、終わった一発の「保つ」時間を進めない（大きな一発の演出が遠めの構図で止まっている間）
export function createCameraFollow(c = BLAST_CAM, cfg = CONFIG) {
  let t = 0, v = 0, goal = 0;
  const records = new Map(); // id -> { radius, sinceBurst, endedAgo }（endedAgo は終わってからの秒、続いている間は -1）
  let fitKey = '', fitT = 0;
  return {
    get t() { return t; },
    get mode() { return cameraIntent(records.values(), c, cfg).mode; },
    // 持ち主 2026-11-23 08:41: その場のリトライ。新しく作ったときと同じ姿へ（下がった距離・ばねの速さ・ねらい・覚えた一発）
    reset() { t = 0; v = 0; goal = 0; records.clear(); fitKey = ''; fitT = 0; },
    update(dt, { pos, dir, tanV, tanH, blasts = [], front = 0, hold = false }) {
      let soon = front;
      const seen = new Set();
      for (const b of blasts) {
        seen.add(b.id);
        let r = records.get(b.id);
        if (!r) records.set(b.id, (r = { radius: b.radius, sinceBurst: 0, endedAgo: -1 }));
        r.sinceBurst = sinceBurstOf(b.front, b.radius, cfg, !!b.small);
        soon = Math.max(soon, frontAt(timeAtFront(b.front, b.radius, cfg, !!b.small) + c.lookahead, b.radius, cfg, !!b.small));
      }
      for (const [id, r] of records) {
        if (seen.has(id)) continue;
        r.sinceBurst += dt;
        if (r.endedAgo < 0) r.endedAgo = 0; else if (!hold) r.endedAgo += dt;
        if (r.endedAgo >= c.holdSec && r.sinceBurst >= wideStartOf(r.radius, c, cfg)) records.delete(id);
      }
      const need = pullbackDistance(pos, dir, front * c.ratio);
      const intent = cameraIntent(records.values(), c, cfg);
      let want = pullbackDistance(pos, dir, soon * c.ratio);
      if (intent.mode === 'wide') {
        const key = `${intent.radius}|${tanV}|${tanH}|${pos}|${dir}`;
        if (key !== fitKey) { fitKey = key; fitT = wholeFitPullback(intent.radius, pos, dir, tanV, tanH, c.margin); }
        want = Math.max(want, fitT);
      }
      if (intent.waiting) want = Math.max(want, t);
      if (dt > 0) {
        goal += (want - goal) * (1 - Math.exp(-c.targetRate * dt));
        if (intent.waiting) goal = Math.max(goal, t);
        const w = goal >= t ? c.outRate : c.backRate;
        v = (v + w * w * (goal - t) * dt) / (1 + 2 * w * dt + w * w * dt * dt);
        t += v * dt;
      }
      if (t < need) { t = need; v = Math.max(v, 0); }
      if (t < 0) { t = 0; v = 0; }
      if (goal < t && intent.waiting) goal = t;
      return t;
    },
  };
}
