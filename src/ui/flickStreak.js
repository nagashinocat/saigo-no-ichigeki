// R1e（持ち主 16:45「2本目の指をシュッと払う」）: シュッの知らせ。払った線に沿って、短い光の筋を一度だけ流す（DOM の div 一つ。
// CSS の animation を付け直すだけで、毎回 DOM を作らない）。世界の中の滑り込みの筋としゃがむ形は M2 の dashStreak・heroBody のまま
// 筋の長さ px（払った長さを少し伸ばし、短すぎ・長すぎにしない）と角（度。画面の右 0、下 90）
export function streakGeom(s, { minPx = 70, maxPx = 180, k = 1.6 } = {}) {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
  const len = Math.max(minPx, Math.min(maxPx, Math.hypot(dx, dy) * k));
  return { x: s.x0, y: s.y0, len, deg: (Math.atan2(dy, dx) * 180) / Math.PI };
}

export function createFlickStreak(el) {
  return {
    // s: controls の onHide の 2 つ目（{ x0, y0, x1, y1 } px）
    show(s) {
      const g = streakGeom(s);
      Object.assign(el.style, { left: g.x + 'px', top: g.y + 'px', width: g.len + 'px', transform: `rotate(${g.deg.toFixed(1)}deg)` });
      el.classList.remove('on');
      void el.offsetWidth; // animation を頭からやり直す
      el.classList.add('on');
    },
  };
}
