import { formatYen } from './format.js';

// 街の画面の上端に重ねる HUD（破壊額・残り時間）と、手の帯の上端に沿う器の細い帯
export function createHud(root) {
  root.innerHTML = '<div class="hud-strip"><div class="hud-amount"></div><div class="hud-time"></div></div><div class="hud-reserve"><i></i></div>';
  const strip = root.querySelector('.hud-strip');
  const amount = root.querySelector('.hud-amount');
  const time = root.querySelector('.hud-time');
  const bar = root.querySelector('.hud-reserve');
  const fill = bar.querySelector('i');
  let shownAmount, shownTime, shownFill;
  return {
    // layout: layoutViews の戻り値、height: 画面の高さ（Rect は左下原点なので上端からの位置へ直す）
    place(layout, height) {
      const { hud, hand } = layout;
      Object.assign(strip.style, { left: hud.x + 'px', top: height - hud.y - hud.h + 'px', width: hud.w + 'px', height: hud.h + 'px' });
      Object.assign(bar.style, { left: hand.x + 'px', top: height - hand.y - hand.h + 'px', width: hand.w + 'px' });
    },
    setVisible(v) { root.style.visibility = v ? 'visible' : 'hidden'; },
    update({ total, remaining, reserve, max }) {
      const a = formatYen(total);
      if (a !== shownAmount) { amount.textContent = a; shownAmount = a; }
      const t = String(Math.ceil(remaining));
      if (t !== shownTime) { time.textContent = `残り ${t} 秒`; shownTime = t; }
      const f = Math.max(0, Math.min(1, reserve / max)).toFixed(3);
      if (f !== shownFill) { fill.style.transform = `scaleX(${f})`; shownFill = f; }
    },
  };
}
