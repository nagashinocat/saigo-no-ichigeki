import { CONFIG } from '../config.js';
import { MARKS } from './stickMarks.js';

// M1（持ち主 09:15）: 浮かぶジョイスティックの見た目（DOM の輪とつまみ。軽く）。controls.js の stick（{ cx, cy, kx, ky } の px か null）を毎フレーム映す
// M2（持ち主 15:20「ジョイスティックの外側の丸に敵の方向マーク」）: 輪の外側に、近くの軍勢の向きの印（stickMarks.js の marks、最大 MARKS.max 個）。
// 印は前もって作った MARKS.max 個の <i> を、向き（rotate）・濃さ（opacity）・大きさ（scale）・種類の class だけ書き換える（毎フレーム DOM を作らない）。
// スティックが出ていないときは印も出さない（スティックは動かしている間だけの手元の道具。印は「どちらへ逃げるか」を決めるためのもので、
// 動かしていないときは街の画面そのものが軍勢を見せている。手の帯や街の画面に別の印を足すと、主人公のまわりが込み合う）
export function createJoystickView(el, cfg = CONFIG) {
  const ring = el.querySelector('.ring'), knob = el.querySelector('.knob');
  const R = cfg.controls.stickRadiusPx;
  Object.assign(ring.style, { width: 2 * R + 'px', height: 2 * R + 'px' });
  Object.assign(knob.style, { width: Math.round(R * 0.8) + 'px', height: Math.round(R * 0.8) + 'px' });
  const marks = [];
  if (typeof document !== 'undefined' && el.appendChild) {
    for (let i = 0; i < MARKS.max; i++) { const m = document.createElement('i'); m.className = 'mark'; m.style.display = 'none'; el.appendChild(m); marks.push(m); }
  }
  let shown = '', shownMarks = '';
  return {
    // list: stickMarks の戻り値（省けば印なし）
    update(stick, list = null) {
      const key = stick ? `${stick.cx}|${stick.cy}|${stick.kx.toFixed(1)}|${stick.ky.toFixed(1)}` : '';
      if (key !== shown) {
        shown = key;
        el.classList.toggle('on', !!stick);
        if (stick) {
          ring.style.left = stick.cx + 'px'; ring.style.top = stick.cy + 'px';
          knob.style.left = stick.kx + 'px'; knob.style.top = stick.ky + 'px';
        }
      }
      const ms = stick && list ? list : [];
      const mk = stick ? `${stick.cx}|${stick.cy}|` + ms.map((m) => `${Math.round(m.deg)}:${m.k.toFixed(2)}:${m.size.toFixed(2)}:${m.kind ?? ''}:${m.chase ? 1 : 0}`).join(',') : '';
      if (mk === shownMarks) return;
      shownMarks = mk;
      marks.forEach((m, i) => {
        const v = ms[i];
        if (!v) { m.style.display = 'none'; return; }
        m.style.display = '';
        m.className = 'mark' + (v.kind ? ' ' + v.kind : '') + (v.chase ? ' chase' : '');
        m.style.left = stick.cx + 'px'; m.style.top = stick.cy + 'px';
        m.style.opacity = v.k.toFixed(2);
        m.style.transform = `rotate(${v.deg.toFixed(1)}deg) translateX(${R + 9}px) rotate(45deg) scale(${v.size.toFixed(2)})`;
      });
    },
  };
}
