// 街の画面の上端に重ねる HUD（貯めた力・残り時間）と、手の帯の上端に沿う「貯めた力」の細い帯、
// 手の帯の右下の小爆発のボタン（長押しの指とは別の指で押す。PC では Space キーでも押せる）

// 小爆発のボタンの位置（画面の左上原点の px）。手の帯の右下、帯の短い辺の約 1/4 の丸（56〜80px）
export function puffButtonRect(layout, height) {
  const { hand } = layout;
  const size = Math.round(Math.min(80, Math.max(56, Math.min(hand.w, hand.h) * 0.24)));
  const margin = Math.round(Math.max(10, size * 0.22));
  return { left: hand.x + hand.w - margin - size, top: height - hand.y - margin - size, size };
}

export function powerText(power, max) {
  return `力 ${Math.floor(Math.max(0, Math.min(1, power / max)) * 100)}%`;
}

// S9: 一発で街じゅうの軍勢を全員倒せばクリア。街に生きている軍勢の数（小さく、残り時間の下に）
export const armyText = (n) => `街の軍勢 ${n}`;

// R1: 一度の払うで k 体を払った「×k」
export const comboText = (k) => `×${k}`;
// 大物が来た知らせ（R1）
export const BOSS_TEXT = '大物が来る';
// 「×k」の位置（画面の左上原点の px、文字の中心）: 主人公の画面の位置（sx, sy）の少し上（群がる軍勢に重ねない）。街の画面の内に収める
export function comboPos(layout, height, sx, sy) {
  const { city } = layout;
  const top = height - city.y - city.h, bottom = height - city.y;
  const lift = Math.min(110, Math.max(56, city.h * 0.16)); // 払うの光の球（半径 22 m）の上の縁より上
  const x = Math.min(city.x + city.w - 40, Math.max(city.x + 40, sx));
  const y = Math.min(bottom - 30, Math.max(top + 70, sy - lift));
  return { x, y };
}

export function createHud(root, { onPuff } = {}) {
  root.innerHTML = '<div class="hud-strip"><div class="hud-power-text"></div><div class="hud-right"><div class="hud-time"></div><div class="hud-army"></div></div></div>'
    + '<div class="hud-power"><i></i></div>'
    + '<button type="button" class="hud-puff off" aria-disabled="true"><b>払う</b><small>Space</small></button>'
    + '<div class="hud-hint"></div>'
    + '<div class="hud-combo"><b></b></div>'
    + '<div class="hud-announce"><span></span></div>';
  const strip = root.querySelector('.hud-strip');
  const label = root.querySelector('.hud-power-text');
  const time = root.querySelector('.hud-time');
  const army = root.querySelector('.hud-army');
  const bar = root.querySelector('.hud-power');
  const fill = bar.querySelector('i');
  const button = root.querySelector('.hud-puff');
  const hintEl = root.querySelector('.hud-hint');
  const comboEl = root.querySelector('.hud-combo'), comboK = comboEl.querySelector('b');
  const annEl = root.querySelector('.hud-announce'), annText = annEl.querySelector('span');
  let comboTimer = 0, annTimer = 0, layoutNow = null, heightNow = 0;
  // CSS の animation を頭から（同じ class を付け直す）
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  let hintTimer = 0;
  // 押した瞬間に払う（click は指を離すまで来ない）。押せないときの押下も、ここで受け止めて長押しにはしない
  button.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onPuff?.(); });
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  let shownLabel, shownTime, shownFill, shownOn, shownArmy;
  return {
    // layout: layoutViews の戻り値、height: 画面の高さ（Rect は左下原点なので上端からの位置へ直す）
    place(layout, height) {
      const { hud, hand, city } = layout;
      layoutNow = layout; heightNow = height;
      Object.assign(annEl.style, { left: city.x + 'px', width: city.w + 'px', top: height - city.y - city.h + city.h * 0.24 + 'px' });
      Object.assign(strip.style, { left: hud.x + 'px', top: height - hud.y - hud.h + 'px', width: hud.w + 'px', height: hud.h + 'px' });
      Object.assign(bar.style, { left: hand.x + 'px', top: height - hand.y - hand.h + 'px', width: hand.w + 'px' });
      const r = puffButtonRect(layout, height);
      // ひとことの知らせは、手の帯のすぐ上（街の画面の下端）
      Object.assign(hintEl.style, { left: hand.x + 'px', width: hand.w + 'px', top: height - hand.y - hand.h - 44 + 'px' });
      Object.assign(button.style, { left: r.left + 'px', top: r.top + 'px', width: r.size + 'px', height: r.size + 'px', fontSize: Math.round(r.size * 0.3) + 'px' });
    },
    // 短い知らせ（例: 足りずに離したとき）を sec 秒だけ出す
    hint(text, sec = 1.4) {
      hintEl.textContent = text;
      hintEl.classList.add('show');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hintEl.classList.remove('show'), sec * 1000);
    },
    setVisible(v) { root.style.visibility = v ? 'visible' : 'hidden'; },
    // R1: 「×k」を主人公の画面の位置（sx, sy px）の少し上に出す（同じ払うで数が増えれば書き換えて跳ねる）
    combo(k, sx, sy) {
      if (!layoutNow) return;
      const p = comboPos(layoutNow, heightNow, sx, sy);
      comboK.textContent = comboText(k);
      Object.assign(comboEl.style, { left: p.x + 'px', top: p.y + 'px' });
      restart(comboEl, 'show');
      clearTimeout(comboTimer);
      comboTimer = setTimeout(() => comboEl.classList.remove('show'), 1100);
    },
    // R1: 大物が来た知らせ（街の画面の上の方に大きく、sec 秒）
    announce(text = BOSS_TEXT, sec = 2.4) {
      annText.textContent = text;
      restart(annEl, 'show');
      clearTimeout(annTimer);
      annTimer = setTimeout(() => annEl.classList.remove('show'), sec * 1000);
    },
    // alive: 街に生きている軍勢の数（省けば出さない）
    update({ remaining, power, max, canPuff, alive = null }) {
      if (alive !== shownArmy) { army.textContent = alive == null ? '' : armyText(alive); shownArmy = alive; }
      const p = powerText(power, max);
      if (p !== shownLabel) { label.textContent = p; shownLabel = p; }
      const t = String(Math.ceil(remaining));
      if (t !== shownTime) { time.textContent = `残り ${t} 秒`; shownTime = t; }
      const f = Math.max(0, Math.min(1, power / max)).toFixed(3);
      if (f !== shownFill) { fill.style.transform = `scaleX(${f})`; shownFill = f; }
      if (canPuff !== shownOn) {
        button.classList.toggle('off', !canPuff);
        button.setAttribute('aria-disabled', String(!canPuff));
        shownOn = canPuff;
      }
    },
  };
}
