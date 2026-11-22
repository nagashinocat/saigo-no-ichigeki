// R1f（持ち主 18:14「一時停止…ができるメニューボタン」「画面切り替えしたら一瞬ピープ音」）: 一時停止のまとめ役。理由（'menu' メニューを開いた /
// 'tab' タブ・アプリを切り替えた）が一つでもあれば止める。止めるもの: ゲームの進み（game.setHidden: 時間・軍勢・吸われる・払う・溜め始め）、
// 指とキー（controls.reset: 溜めは放たずに打ち切り、スティックも消す）、BGM の先読み（bgm.pause）。演出・リプレイ・導入の時間は main.js が
// paused の間 simulate を呼ばないことで止まる。
// 音: 'tab' があれば AudioContext を止める（audio.suspend: 一番上の大きさを約 30 ms で 0 へ落としてから）。fix1（見直し Minor 6）: 'menu' だけなら
// 止めずに、世界の音と BGM を黙らせる（audio.mute。音量の試し音は聞こえる）。理由がすべて消えたら戻す。
// fix2（再見直し Important 1）: 演出・リプレイ・ブラックホールの間（cinematic() が true）は 'menu' でも AudioContext を止める（地響き・唸り・
// BGM の引き伸ばしは時刻表どおりに先まで予約してあるので、時計を止めないと戻ったときに音が絵より先にいる）
export function createPause({ game, controls, audio, bgm, keys = null, cinematic = () => false }) {
  const reasons = new Set();
  let mode = 'run'; // 'run' | 'mute' | 'suspend'
  function apply() {
    const want = reasons.has('tab') ? 'suspend' : reasons.size ? (cinematic() ? 'suspend' : 'mute') : 'run';
    if (want === mode) return;
    const prev = mode;
    mode = want;
    if (prev === 'run') {
      controls?.reset();
      keys?.clear?.();
      game?.setHidden(true);
      bgm?.pause();
    }
    if (want === 'suspend') {
      if (prev === 'run') audio?.mute?.(true);
      audio?.suspend();
    } else if (want === 'mute') {
      if (prev === 'suspend') audio?.resume();
      audio?.mute?.(true);
    } else {
      game?.setHidden(false);
      if (prev === 'suspend') audio?.resume();
      audio?.mute?.(false);
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
    get paused() { return mode !== 'run'; },
  };
}
