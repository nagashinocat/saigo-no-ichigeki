import { CONFIG } from '../config.js';

// M1（持ち主 09:15）: 浮かぶジョイスティックの見た目（DOM の輪とつまみ。軽く）。controls.js の stick（{ cx, cy, kx, ky } の px か null）を毎フレーム映す
export function createJoystickView(el, cfg = CONFIG) {
  const ring = el.querySelector('.ring'), knob = el.querySelector('.knob');
  const R = cfg.controls.stickRadiusPx;
  Object.assign(ring.style, { width: 2 * R + 'px', height: 2 * R + 'px' });
  Object.assign(knob.style, { width: Math.round(R * 0.8) + 'px', height: Math.round(R * 0.8) + 'px' });
  let shown = '';
  return {
    update(stick) {
      const key = stick ? `${stick.cx}|${stick.cy}|${stick.kx.toFixed(1)}|${stick.ky.toFixed(1)}` : '';
      if (key === shown) return;
      shown = key;
      el.classList.toggle('on', !!stick);
      if (!stick) return;
      ring.style.left = stick.cx + 'px'; ring.style.top = stick.cy + 'px';
      knob.style.left = stick.kx + 'px'; knob.style.top = stick.ky + 'px';
    },
  };
}
