// 最初に触れた指（ポインタ）だけを数える長押しの追跡。2本目以降の down/up は無視する。
// up（指を離した）は onEnd（最後の一発を放つ）。cancel・reset（pointercancel、キャプチャが外れた、タブを隠した、
// ウィンドウが blur）は onCancel: 放たずに打ち切る（遊ぶ人が離していないのに一発でゲームが終わらないように）。
export function createPressTracker({ onStart, onEnd, onCancel = () => {} }) {
  let active = null;
  const finish = (id, fn) => {
    if (active === null || id !== active) return;
    active = null;
    fn();
  };
  const end = (id) => finish(id, onEnd);
  const cancel = (id) => finish(id, onCancel);
  return {
    down(id) {
      if (active !== null) return;
      active = id;
      onStart();
    },
    up: end,
    cancel,
    // タブやアプリが切り替わって up/cancel が来ないまま指の id が変わることがあるので、外から押下を打ち切る（放たない）
    reset() { if (active !== null) cancel(active); },
  };
}
