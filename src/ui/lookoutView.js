// R1e（持ち主 16:55「見つかりそうなときに隠れられそうな向きに矢印とLOOK OUT!」）: 主人公の頭の上に「LOOK OUT!」（太い字に縁取り・
// 傾き・弾む出方。新しい字体は読み込まない。CSS は index.html の #lookout）と、主人公のまわりに、隠れられる物陰の向きの矢印。
// R1f（持ち主 18:14「LOOK OUT!の矢印をタップ」）: 矢印は大きく押しやすい当たり（直径 2·HIT_R px の丸。72 px 四方以上）の中に描き、
// 「TAP」の印と脈打つ輪を付ける。丸は物陰の向きに、主人公の画面の位置から ARROW_R px の所。画面の端では画面の内へ寄せる。
// 当たりの判定（hit）は DOM では受けない（pointer-events: none のまま。溜め・スティックの指の知らせを奪わない）: input/controls.js の hideHit が
// 2 本目の指のタップの触れた所で呼ぶ。何を出すかは game/lookout.js が決める。ここは毎フレーム、変わったときだけ DOM を書き換える。音は出さない
export const LOOKOUT_TEXT = 'LOOK OUT!';
// 当たりの丸の半径 px（直径 88 px）と、主人公の画面の位置から丸の中心までの距離 px
export const HIT_R = 44;
export const ARROW_R = 92;
// 画面の縁からの余白 px
const EDGE = 4;
// 「LOOK OUT!」の真ん中を置く、主人公からの距離 px（矢印の反対の側。矢印が無ければ真上）
export const TEXT_PX = 70;
// 字の置き場所（主人公の画面の位置からの px）。矢印と重ならないよう、矢印の向きの反対へ
export function textOffset(deg) {
  if (deg == null) return { x: 0, y: -TEXT_PX };
  const r = (deg * Math.PI) / 180;
  // 横は字が長いので、左右へは少しだけずらす（画面の端からはみ出しにくく）
  return { x: Math.round(-Math.cos(r) * TEXT_PX * 0.6), y: Math.round(-Math.sin(r) * TEXT_PX) };
}

// 矢印の当たりの丸 { cx, cy, r }（画面の px）。at: 主人公の画面の位置 { sx, sy }、deg: 物陰の画面の角（右 0、下 90）、view: { w, h }。矢印が無ければ null
export function arrowTarget(at, deg, view) {
  if (deg == null || !at) return null;
  const r = (deg * Math.PI) / 180;
  let cx = at.sx + Math.cos(r) * ARROW_R, cy = at.sy + Math.sin(r) * ARROW_R;
  const lo = HIT_R + EDGE;
  cx = Math.min(Math.max(cx, lo), Math.max(lo, view.w - lo));
  cy = Math.min(Math.max(cy, lo), Math.max(lo, view.h - lo));
  return { cx, cy, r: HIT_R };
}

const viewport = () => (typeof window === 'undefined' ? { w: 390, h: 844 } : { w: window.innerWidth, h: window.innerHeight });

export function createLookoutView(el, { view = viewport } = {}) {
  const text = el.querySelector('.lo-text'), arrow = el.querySelector('.lo-arrow'), hitEl = el.querySelector('.lo-hit');
  if (text) text.textContent = LOOKOUT_TEXT;
  let on = false, key = '', target = null;
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
      if (!show) { target = null; return; }
      target = arrowTarget(at, s.deg, view());
      const k = `${Math.round(at.sx)}|${Math.round(at.sy)}|${s.deg == null ? '-' : Math.round(s.deg)}`;
      if (k === key) return;
      key = k;
      el.style.left = Math.round(at.sx) + 'px'; el.style.top = Math.round(at.sy) + 'px';
      const o = textOffset(s.deg);
      if (text) { text.style.left = o.x + 'px'; text.style.top = o.y + 'px'; }
      if (hitEl) {
        hitEl.hidden = !target;
        if (target) { hitEl.style.left = Math.round(target.cx - at.sx) + 'px'; hitEl.style.top = Math.round(target.cy - at.sy) + 'px'; }
      }
      if (!arrow) return;
      arrow.hidden = !target;
      // 矢印は当たりの丸の真ん中で、物陰の向きを指す
      if (target) arrow.style.transform = `translate(${Math.round(target.cx - at.sx)}px, ${Math.round(target.cy - at.sy)}px) rotate(${s.deg.toFixed(0)}deg)`;
    },
    // 画面の (x, y) が、出ている矢印の当たりの丸の内か
    hit(x, y) { return !!target && Math.hypot(x - target.cx, y - target.cy) <= target.r; },
    get target() { return target; },
  };
}
