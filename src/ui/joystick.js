import { CONFIG } from '../config.js';
import { MARKS } from './stickMarks.js';

// M1（持ち主 09:15）: 浮かぶジョイスティックの見た目（DOM の輪とつまみ。軽く）。controls.js の stick（{ cx, cy, kx, ky } の px か null）を毎フレーム映す
// M2（持ち主 15:20「ジョイスティックの外側の丸に敵の方向マーク」）: 輪の外側に、近くの軍勢の向きの印（stickMarks.js の marks、最大 MARKS.max 個）。
// 印は前もって作った MARKS.max 個の <i> を、向き（rotate）・濃さ（opacity）・大きさ（scale）・種類の class だけ書き換える（毎フレーム DOM を作らない）。
// スティックが出ていないときは印も出さない（スティックは動かしている間だけの手元の道具。印は「どちらへ逃げるか」を決めるためのもので、
// 動かしていないときは街の画面そのものが軍勢を見せている。手の帯や街の画面に別の印を足すと、主人公のまわりが込み合う）
// R1e（持ち主 16:45「ジョイスティック周りの敵のレーダー用の輪っかをもう少し大きくしたい」）: 印の輪は controls.radar.radiusPx（M2 の 65 px の
// 約 1.5 倍）、印は markScale 倍。輪の大きさはスティックの輪（つまみが届く所 = 輪の縁 + つまみの半径）より外で、印がつまみに重ならない。
// 画面の端の近くでは、輪はスティックと同じ中心のまま、印が画面の内に収まるまで小さくなる（minRadiusPx まで）。
// 輪の中心をずらす（スティックは動かさず輪だけ寄せる）にしなかったわけ: 印は「つまみから見てどちらへ逃げるか」の向きなので、中心がずれると
// 端の側の印がつまみ（指の下）へ寄って隠れ、印の角もつまみから見てずれる。小さくするなら、向きはつまみから見て正しいまま
// いちばん大きい印（大物 14 px の四角を 45° 回し、近いと MARKS.maxSize × markScale 倍）の中心から縁まで（縁取り 2 px を足す）
export function markReachPx(cfg = CONFIG) {
  return 14 * cfg.controls.radar.markScale * MARKS.maxSize * Math.SQRT1_2 + 2;
}
// スティックの中心 (cx, cy) px での印の輪の半径 px（画面 w × h px）
export function radarRadius(cx, cy, w, h, cfg = CONFIG) {
  const RD = cfg.controls.radar;
  const room = Math.min(cx, w - cx, cy, h - cy) - markReachPx(cfg);
  return Math.max(RD.minRadiusPx, Math.min(RD.radiusPx, Math.floor(room)));
}

// 向き deg（画面の度）の印の中心 px。輪（半径 r）の上。それでも画面の外へ出る印（スティックが端から minRadiusPx + 印の縁 より近い）は、
// 画面の縁の内へ寄せる（向きは輪の上と同じ側のまま、見えなくならない）
export function markPos(cx, cy, deg, r, w, h, cfg = CONFIG) {
  const a = (deg * Math.PI) / 180, p = markReachPx(cfg);
  const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
  return { x: Math.min(w - p, Math.max(p, x)), y: Math.min(h - p, Math.max(p, y)) };
}

export function createJoystickView(el, cfg = CONFIG) {
  const ring = el.querySelector('.ring'), knob = el.querySelector('.knob');
  const R = cfg.controls.stickRadiusPx;
  Object.assign(ring.style, { width: 2 * R + 'px', height: 2 * R + 'px' });
  Object.assign(knob.style, { width: Math.round(R * 0.8) + 'px', height: Math.round(R * 0.8) + 'px' });
  const MS = cfg.controls.radar.markScale;
  const marks = [];
  // R1e: 印の輪の目安の薄い丸（一つの div。輪の大きさが目で分かるように）
  let guide = null;
  if (typeof document !== 'undefined' && el.appendChild) {
    guide = document.createElement('div'); guide.className = 'radar'; el.insertBefore?.(guide, el.firstChild) ?? el.appendChild(guide);
    for (let i = 0; i < MARKS.max; i++) { const m = document.createElement('i'); m.className = 'mark'; m.style.display = 'none'; el.appendChild(m); marks.push(m); }
  }
  let shown = '', shownMarks = '', radius = cfg.controls.radar.radiusPx, vw = 1e4, vh = 1e4;
  return {
    // 今の印の輪の半径 px（HUD の払うの点を輪の上に置くため）
    get radius() { return radius; },
    // list: stickMarks の戻り値（省けば印なし）。view: 画面の大きさ { w, h } px（省けば window）
    update(stick, list = null, view = null) {
      vw = view?.w ?? globalThis.innerWidth ?? 1e4; vh = view?.h ?? globalThis.innerHeight ?? 1e4;
      if (stick) radius = radarRadius(stick.cx, stick.cy, vw, vh, cfg);
      const key = stick ? `${stick.cx}|${stick.cy}|${stick.kx.toFixed(1)}|${stick.ky.toFixed(1)}|${radius}` : '';
      if (key !== shown) {
        shown = key;
        el.classList.toggle('on', !!stick);
        if (stick) {
          ring.style.left = stick.cx + 'px'; ring.style.top = stick.cy + 'px';
          knob.style.left = stick.kx + 'px'; knob.style.top = stick.ky + 'px';
          if (guide) Object.assign(guide.style, { left: stick.cx + 'px', top: stick.cy + 'px', width: 2 * radius + 'px', height: 2 * radius + 'px' });
        }
      }
      const ms = stick && list ? list : [];
      const mk = stick ? `${stick.cx}|${stick.cy}|${radius}|` + ms.map((m) => `${Math.round(m.deg)}:${m.k.toFixed(2)}:${m.size.toFixed(2)}:${m.kind ?? ''}:${m.chase ? 1 : 0}`).join(',') : '';
      if (mk === shownMarks) return;
      shownMarks = mk;
      marks.forEach((m, i) => {
        const v = ms[i];
        if (!v) { m.style.display = 'none'; return; }
        m.style.display = '';
        m.className = 'mark' + (v.kind ? ' ' + v.kind : '') + (v.chase ? ' chase' : '');
        const p = markPos(stick.cx, stick.cy, v.deg, radius, vw, vh, cfg);
        m.style.left = p.x.toFixed(1) + 'px'; m.style.top = p.y.toFixed(1) + 'px';
        m.style.opacity = v.k.toFixed(2);
        m.style.transform = `rotate(${(v.deg + 45).toFixed(1)}deg) scale(${(v.size * MS).toFixed(2)})`;
      });
    },
  };
}
