// 最初に触れた指（ポインタ）だけを数える長押しの追跡。2本目以降の down/up は無視する。
export function createPressTracker({ onStart, onEnd }) {
  let active = null;
  const end = (id) => {
    if (active === null || id !== active) return;
    active = null;
    onEnd();
  };
  return {
    down(id) {
      if (active !== null) return;
      active = id;
      onStart();
    },
    up: end,
    cancel: end,
    // タブやアプリが切り替わって up/cancel が来ないまま指の id が変わることがあるので、外から押下を打ち切る
    reset() { if (active !== null) end(active); },
  };
}
