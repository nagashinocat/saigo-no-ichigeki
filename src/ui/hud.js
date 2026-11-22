// 街の画面の上端に重ねる HUD（残り時間・街の軍勢・M1 の「中心まで ◯ m」と街の中心への矢印）と、手の帯の上端の力の表示（太いゲージと大きな数字）、
// 吸われている間の画面の縁の脈打ち。M1（持ち主 09:15）: 払うのボタンはなくした（溜めている間の 2 本目の指の短いタップ、PC は Space か右クリック）
import { clearThreshold } from '../game/charge.js';
import { DRAIN_FX } from './drainFx.js';

// M1（spec §16）: 街の中心までの距離（m）。中心のそば（CENTRE_NEAR m 未満）では「街の中心」
export const CENTRE_NEAR = 5;
export const centreText = (d) => (d < CENTRE_NEAR ? '街の中心' : `中心まで ${Math.round(d)} m`);
// 主人公（hero: { x, z }）から街の中心（原点）への向きを、上空カメラの画面の角度（度。右が 0、時計回り）へ。
// 上空カメラは道路の格子にまっすぐ沿って見下ろす（-z が画面の上、+x が右。views.js の CITY_CAMERA.azimuthDeg = 0）
export const centreArrowDeg = (hero) => Math.atan2(-hero.z, -hero.x) * 180 / Math.PI;
// 「中心まで」の場所（画面の左上原点の px）: 上の帯の真ん中（左は R2 の場所に空け、右は残り時間と街の軍勢）
export function centreRect(layout, height) {
  const { hud } = layout;
  const width = Math.round(Math.min(220, hud.w * 0.4));
  return { left: Math.round(hud.x + (hud.w - width) / 2), top: height - hud.y - hud.h + Math.round(Math.max(6, hud.h * 0.12)), width };
}

export function powerText(power, max) {
  return `力 ${Math.floor(Math.max(0, Math.min(1, power / max)) * 100)}%`;
}

// R1b（持ち主 08:24「力のパーセントをもう少しわかりやすくしよう」）: 大きな数字（切り捨ての整数）
export const powerPct = (power, max) => Math.floor(Math.max(0, Math.min(1, power / max)) * 100);
// 力の段: 撃退ライン（threshold、charge.js の clearThreshold）未満は low（琥珀）、以上は ready（白熱）、満タンは full（脈打つ）
export function powerStage(power, max, threshold) {
  if (power >= max - 1e-9) return 'full';
  return power >= threshold - 1e-9 ? 'ready' : 'low';
}
// 大きな数字（画面の左上原点の px、文字の大きさ、「力 100%」の幅の目安）: 手の帯の上端の一列の左（両手の指先より上）。
// 動く主人公（M1）に左右されないよう、画面と手の帯だけで決める
export function pctRect(layout, height) {
  const { hand } = layout;
  const margin = Math.round(Math.max(12, hand.w * 0.04));
  const fontSize = Math.round(Math.min(52, Math.max(30, Math.min(hand.h * 0.15, hand.w * 0.11))));
  return { left: hand.x + margin, top: height - hand.y - hand.h + 6, fontSize, width: Math.round(fontSize * 2.8) };
}
// 太いゲージ（画面の左上原点の px）: 同じ列の、数字の右から手の帯の右の余白まで。数字の真ん中の高さ
export function gaugeRect(layout, height) {
  const { hand } = layout;
  const n = pctRect(layout, height);
  const margin = n.left - hand.x;
  const h = Math.round(Math.min(18, Math.max(12, Math.min(hand.h, hand.w) * 0.045)));
  const left = n.left + n.width + Math.round(n.fontSize * 0.25);
  return { left, top: Math.round(n.top + n.fontSize * 0.55 - h / 2), width: hand.x + hand.w - margin - left, height: h };
}
// 吸われた量（力の単位 = %）。10 より小さければ小数 1 桁
export const lostText = (n) => `−${n < 10 ? (Math.round(n * 10) / 10).toFixed(1) : Math.round(n)}`;
// 払える量に足りないときに、押した所に小さく出す
export const SHORT_TEXT = '足りない';
export function shortPos(layout, height, x, y) {
  const W = layout.hand.x + layout.hand.w;
  return { x: Math.min(W - 40, Math.max(40, x)), y: Math.min(height - 20, Math.max(20, y - 40)) };
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

// 段ごとの数字・ゲージの色（RGB）と、吸われている間に混ぜる赤紫
const STAGE_RGB = { low: [255, 190, 92], ready: [255, 250, 236], full: [255, 255, 255] };
const DRAIN_RGB = [255, 70, 190];
const mixRgb = (a, b, k) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;

export function createHud(root, { threshold = clearThreshold() } = {}) {
  // 上の帯: 左は空けておく（R2 の「届かない軍勢 あと N 体」の場所）、右に残り時間と街の軍勢
  root.innerHTML = '<div class="hud-drain"></div>'
    + '<div class="hud-strip"><div class="hud-left"></div><div class="hud-right"><div class="hud-time"></div><div class="hud-army"></div></div></div>'
    + '<div class="hud-centre"><i class="hud-arrow"></i><span></span></div>'
    + '<div class="hud-gauge low" role="meter" aria-label="力" aria-valuemin="0" aria-valuemax="100"><div class="hud-track"><i class="hud-ghost"></i><i class="hud-fill"></i><i class="hud-pulse"></i></div>'
    + '<div class="hud-tick"></div><div class="hud-tick-label">撃退ライン</div><div class="hud-lost"></div></div>'
    + '<div class="hud-pct low"><small>力</small><b>0</b><em>%</em></div>'
    + '<div class="hud-hint"></div>'
    + '<div class="hud-short"></div>'
    + '<div class="hud-combo"><b></b></div>'
    + '<div class="hud-announce"><span></span></div>';
  const strip = root.querySelector('.hud-strip');
  const time = root.querySelector('.hud-time');
  const army = root.querySelector('.hud-army');
  const gauge = root.querySelector('.hud-gauge');
  const fill = gauge.querySelector('.hud-fill'), ghost = gauge.querySelector('.hud-ghost'), pulseEl = gauge.querySelector('.hud-pulse');
  const tick = gauge.querySelector('.hud-tick'), tickLabel = gauge.querySelector('.hud-tick-label');
  const pct = root.querySelector('.hud-pct'), pctNum = pct.querySelector('b'), lostEl = gauge.querySelector('.hud-lost');
  const vignette = root.querySelector('.hud-drain');
  const centreEl = root.querySelector('.hud-centre'), centreArrow = centreEl.querySelector('.hud-arrow'), centreSpan = centreEl.querySelector('span');
  const hintEl = root.querySelector('.hud-hint');
  const shortEl = root.querySelector('.hud-short');
  const comboEl = root.querySelector('.hud-combo'), comboK = comboEl.querySelector('b');
  const annEl = root.querySelector('.hud-announce'), annText = annEl.querySelector('span');
  let comboTimer = 0, annTimer = 0, shortTimer = 0, layoutNow = null, heightNow = 0;
  // 光の点滅を控える設定（prefers-reduced-motion）: 縁の脈打ちをやめ、赤紫の濃さだけで知らせる
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // CSS の animation を頭から（同じ class を付け直す）
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  let hintTimer = 0;
  let lineAt = threshold;
  tick.style.left = tickLabel.style.left = `${threshold}%`;
  let shownPct, shownTime, shownFill, shownArmy, shownStage, shownGhost, shownLost, shownColor, shownVig, shownGk, shownCentre, shownDeg, shownLine;
  let ghostF = 0;
  return {
    // 今の撃退ライン（M1: 主人公が中心から離れるほど上がる。main.js が update に渡す）
    get threshold() { return lineAt; },
    // layout: layoutViews の戻り値、height: 画面の高さ（Rect は左下原点なので上端からの位置へ直す）
    place(layout, height) {
      const { hud, hand, city } = layout;
      layoutNow = layout; heightNow = height;
      Object.assign(annEl.style, { left: city.x + 'px', width: city.w + 'px', top: height - city.y - city.h + city.h * 0.24 + 'px' });
      Object.assign(strip.style, { left: hud.x + 'px', top: height - hud.y - hud.h + 'px', width: hud.w + 'px', height: hud.h + 'px' });
      const g = gaugeRect(layout, height);
      Object.assign(gauge.style, { left: g.left + 'px', top: g.top + 'px', width: g.width + 'px', height: g.height + 'px' });
      const n = pctRect(layout, height);
      Object.assign(pct.style, { left: n.left + 'px', top: n.top + 'px', fontSize: n.fontSize + 'px' });
      const c = centreRect(layout, height);
      Object.assign(centreEl.style, { left: c.left + 'px', top: c.top + 'px', width: c.width + 'px' });
      // ひとことの知らせは、手の帯のすぐ上（街の画面の下端）
      Object.assign(hintEl.style, { left: hand.x + 'px', width: hand.w + 'px', top: height - hand.y - hand.h - 44 + 'px' });
    },
    // 短い知らせ（例: 足りずに離したとき）を sec 秒だけ出す
    hint(text, sec = 1.4) {
      hintEl.textContent = text;
      hintEl.classList.add('show');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hintEl.classList.remove('show'), sec * 1000);
    },
    // R1b: 払える量に足りない: 押した所（x, y px。省けば街の画面の真ん中。PC のキーは main.js が主人公の画面の位置を渡す）に小さく「足りない」
    short(x, y) {
      if (!layoutNow) return;
      if (!(Number.isFinite(x) && Number.isFinite(y))) { const { city } = layoutNow; x = city.x + city.w / 2; y = heightNow - city.y - city.h / 2; }
      const p = shortPos(layoutNow, heightNow, x, y);
      shortEl.textContent = SHORT_TEXT;
      Object.assign(shortEl.style, { left: p.x + 'px', top: p.y + 'px' });
      restart(shortEl, 'show');
      clearTimeout(shortTimer);
      shortTimer = setTimeout(() => shortEl.classList.remove('show'), 900);
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
    // alive: 街に生きている軍勢の数（省けば出さない）。drain: 吸われている間の知らせ（drainFx の状態。省けば無し）、dt: 秒
    // hero（M1）: 主人公の位置 { x, z }（「中心まで ◯ m」と矢印。省けば出さない）。line（M1）: 今の撃退ライン（力の %。省けば作ったときの値）
    update({ remaining, power, max, alive = null, drain = null, dt = 0, hero = null, line = null }) {
      if (line != null && Math.abs(line - lineAt) > 1e-6) lineAt = line;
      const ls = lineAt.toFixed(2);
      if (ls !== shownLine) { tick.style.left = tickLabel.style.left = `${ls}%`; shownLine = ls; }
      const ct = hero ? centreText(Math.hypot(hero.x, hero.z)) : '';
      if (ct !== shownCentre) { centreSpan.textContent = ct; centreEl.classList.toggle('near', !!hero && Math.hypot(hero.x, hero.z) < CENTRE_NEAR); centreEl.style.visibility = hero ? 'visible' : 'hidden'; shownCentre = ct; }
      const deg = hero ? Math.round(centreArrowDeg(hero)) : 0;
      if (deg !== shownDeg) { centreArrow.style.transform = `rotate(${deg}deg)`; shownDeg = deg; }
      if (alive !== shownArmy) { army.textContent = alive == null ? '' : armyText(alive); shownArmy = alive; }
      const n = powerPct(power, max);
      if (n !== shownPct) { pctNum.textContent = String(n); gauge.setAttribute('aria-valuenow', String(n)); shownPct = n; }
      const t = String(Math.ceil(remaining));
      if (t !== shownTime) { time.textContent = `残り ${t} 秒`; shownTime = t; }
      const stage = powerStage(power, max, lineAt);
      if (stage !== shownStage) {
        for (const el of [gauge, pct]) { el.classList.remove('low', 'ready', 'full'); el.classList.add(stage); }
        shownStage = stage;
      }
      const fv = Math.max(0, Math.min(1, power / max));
      const f = fv.toFixed(3);
      if (f !== shownFill) { fill.style.transform = pulseEl.style.transform = `scaleX(${f})`; shownFill = f; }
      // 減った分は赤紫の影として少し残り、遅れて縮む（吸われて減っていくのが見える）
      ghostF = fv >= ghostF ? fv : ghostF + (fv - ghostF) * (1 - Math.exp(-Math.max(0, dt) / 0.45));
      const gs = ghostF.toFixed(3);
      if (gs !== shownGhost) { ghost.style.transform = `scaleX(${gs})`; shownGhost = gs; }
      // 吸われている間: 画面の縁の赤紫の脈打ち、数字とゲージ（赤紫の層 .hud-pulse の不透明度 --drain）が脈打ちに合わせて赤紫へ、
      // 吸われた量の「−N」。脈打ちは drainFx の pulse（なめらかな cos、3 回/秒より少ない）。光の点滅を控える設定では一定の濃さ
      const dk = drain ? drain.level * (reduce ? 0.7 : 0.25 + 0.75 * drain.pulse) : 0;
      const color = dk > 0.01 ? mixRgb(STAGE_RGB[stage], DRAIN_RGB, Math.min(1, dk * 1.4)) : '';
      if (color !== shownColor) { pct.style.color = color; shownColor = color; }
      const gk = dk > 0.01 ? Math.min(0.9, dk * 1.2).toFixed(2) : '0';
      if (gk !== shownGk) { gauge.style.setProperty('--drain', gk); shownGk = gk; }
      pct.classList.toggle('draining', !!drain?.active);
      const vig = drain ? (reduce ? 0.6 * drain.level * DRAIN_FX.vignetteMax : drain.vignette).toFixed(3) : '0.000';
      if (vig !== shownVig) { vignette.style.opacity = vig; shownVig = vig; }
      const lost = drain && drain.lostShow > 0 && drain.lost >= 0.05 ? lostText(drain.lost) : '';
      if (lost !== shownLost) { lostEl.textContent = lost; shownLost = lost; }
      lostEl.style.opacity = drain && drain.lostShow > 0 ? String(Math.min(1, drain.lostShow / 0.4)) : '0';
    },
  };
}
