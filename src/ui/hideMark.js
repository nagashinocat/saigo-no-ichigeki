// R1f fix1（見直し Minor 1・持ち主 18:14「ビルの横にいるだけで素通り」の残り）: 物陰にいる間（M2: 真正面から近くを照らされない限り見つからない）であることを、
// 主人公の上の小さな「かくれ中」と、その物陰にいられる残り（hide.holdSec）を示す細い輪で見せる。CSS は index.html の #hideMark
// s: { hero, hideLeft, holdSec }。跳んでいる間（dashing）は出さない（跳ぶ動きの飾りが出ている）
// Fix round 3: warn（lookout の coverWarn。物陰に近づく者がいる）なら印を赤く脈打たせる
export function hideMarkState({ hero, hideLeft, holdSec, warn = false }) {
  const show = !!hero?.hidden && hero.dashing == null;
  return { show, p: show ? Math.min(1, Math.max(0, hideLeft / holdSec)) : 0, warn: show && !!warn };
}

export function createHideMark(el) {
  let on = false, key = '', warnOn = false;
  return {
    // at: 主人公の画面の位置 { sx, sy } px
    update(s, at) {
      const show = !!(s.show && at);
      if (show !== on) { on = show; el.hidden = !show; }
      const warn = show && !!s.warn;
      if (warn !== warnOn) { warnOn = warn; el.classList?.toggle('warn', warn); }
      if (!show) return;
      const k = `${Math.round(at.sx)}|${Math.round(at.sy)}|${s.p.toFixed(3)}`;
      if (k === key) return;
      key = k;
      el.style.left = Math.round(at.sx) + 'px'; el.style.top = Math.round(at.sy) + 'px';
      el.style.setProperty('--p', s.p.toFixed(3));
    },
  };
}
