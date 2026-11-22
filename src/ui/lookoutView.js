// R1e（持ち主 16:55「見つかりそうなときに隠れられそうな向きに矢印とLOOK OUT!」）: 主人公の頭の上に「LOOK OUT!」（太い字に縁取り・
// 傾き・弾む出方。新しい字体は読み込まない。CSS は index.html の #lookout）と、主人公のまわりに、シュッで入れる物陰の向きの矢印。
// 何を出すかは game/lookout.js が決める。ここは毎フレーム、変わったときだけ DOM を書き換える。音は出さない
export const LOOKOUT_TEXT = 'LOOK OUT!';
// 矢印を置く、主人公の画面の位置からの距離 px
export const ARROW_PX = 60;
// 「LOOK OUT!」の真ん中を置く、主人公からの距離 px（矢印の反対の側。矢印が無ければ真上）
export const TEXT_PX = 70;
// 字の置き場所（主人公の画面の位置からの px）。矢印と重ならないよう、矢印の向きの反対へ
export function textOffset(deg) {
  if (deg == null) return { x: 0, y: -TEXT_PX };
  const r = (deg * Math.PI) / 180;
  // 横は字が長いので、左右へは少しだけずらす（画面の端からはみ出しにくく）
  return { x: Math.round(-Math.cos(r) * TEXT_PX * 0.6), y: Math.round(-Math.sin(r) * TEXT_PX) };
}

export function createLookoutView(el) {
  const text = el.querySelector('.lo-text'), arrow = el.querySelector('.lo-arrow');
  if (text) text.textContent = LOOKOUT_TEXT;
  let on = false, key = '';
  return {
    // s: createLookout().update の戻り値。at: 主人公の画面の位置 { sx, sy } px
    update(s, at) {
      const show = !!(s && s.show && at);
      if (show !== on) {
        on = show;
        el.hidden = !show;
        el.classList.remove('pop');
        if (show) { void el.offsetWidth; el.classList.add('pop'); } // 出るたびに弾む
      }
      if (!show) return;
      const k = `${Math.round(at.sx)}|${Math.round(at.sy)}|${s.deg == null ? '-' : Math.round(s.deg)}`;
      if (k === key) return;
      key = k;
      el.style.left = Math.round(at.sx) + 'px'; el.style.top = Math.round(at.sy) + 'px';
      const o = textOffset(s.deg);
      if (text) { text.style.left = o.x + 'px'; text.style.top = o.y + 'px'; }
      if (!arrow) return;
      arrow.hidden = s.deg == null;
      if (s.deg != null) arrow.style.transform = `rotate(${s.deg.toFixed(0)}deg) translateX(${ARROW_PX}px)`;
    },
  };
}
