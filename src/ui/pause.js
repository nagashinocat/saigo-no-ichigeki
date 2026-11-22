// R1f（持ち主 18:14「一時停止…ができるメニューボタン」「画面切り替えしたら一瞬ピープ音」）: 一時停止のまとめ役。理由（'menu' メニューを開いた /
// 'tab' タブ・アプリを切り替えた）が一つでもあれば止める。止めるもの: ゲームの進み（game.setHidden: 時間・軍勢・吸われる・払う・溜め始め）、
// 指とキー（controls.reset: 溜めは放たずに打ち切り、スティックも消す）、BGM の先読み（bgm.pause）、音（audio.suspend: 一番上の大きさを約 30 ms で
// 0 へ落としてから AudioContext を止める）。演出・リプレイ・導入の時間は main.js が paused の間 simulate を呼ばないことで止まる。
// 理由がすべて消えたら戻す（音は 0 のまま鳴らし直して上げる）
export function createPause({ game, controls, audio, bgm, keys = null }) {
  const reasons = new Set();
  let on = false;
  function apply() {
    const want = reasons.size > 0;
    if (want === on) return;
    on = want;
    if (on) {
      controls?.reset();
      keys?.clear?.();
      game?.setHidden(true);
      bgm?.pause();
      audio?.suspend();
    } else {
      game?.setHidden(false);
      audio?.resume();
      bgm?.resume();
    }
  }
  return {
    // reason の一時停止を入れる・外す
    set(reason, value) {
      if (value) reasons.add(reason); else reasons.delete(reason);
      apply();
    },
    has: (reason) => reasons.has(reason),
    get paused() { return on; },
  };
}
