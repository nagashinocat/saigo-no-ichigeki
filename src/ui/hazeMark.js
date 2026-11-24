// Fix round 2（まとめ役の裁定「閃光の残りを画面で見せる」）: 閃光の残り（game.haze）の間、主人公のそばに小さな残りの輪（--p、1 → 0）を出す。
// 主人公が閃光の範囲（払った所から r m）の外へ出たら out（薄く。外では見つかる）。CSS は index.html の #hazeMark
export function hazeMarkState({ haze, hero }) {
  if (!haze || !(haze.left > 0) || !hero) return { show: false, p: 0, out: false };
  const p = Math.min(1, Math.max(0, haze.left / Math.max(1e-6, haze.total || haze.left)));
  return { show: true, p, out: Math.hypot(hero.x - haze.x, hero.z - haze.z) > haze.r };
}

export function createHazeMark(el) {
  let on = false, key = '', outOn = false;
  return {
    // at: 主人公の画面の位置 { sx, sy } px
    update(s, at) {
      const show = !!(s.show && at);
      if (show !== on) { on = show; el.hidden = !show; }
      const out = show && !!s.out;
      if (out !== outOn) { outOn = out; el.classList?.toggle('out', out); }
      if (!show) return;
      const k = `${Math.round(at.sx)}|${Math.round(at.sy)}|${s.p.toFixed(3)}`;
      if (k === key) return;
      key = k;
      el.style.left = Math.round(at.sx) + 'px'; el.style.top = Math.round(at.sy) + 'px';
      el.style.setProperty('--p', s.p.toFixed(3));
    },
  };
}
