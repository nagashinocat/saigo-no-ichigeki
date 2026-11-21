// 導入の TAP と、音を鳴らせるようにする操作（持ち主 22:15「初めのムービー音出てない」）。
// ブラウザは「ユーザーの操作」の中でしか AudioContext を動かさない。その操作に数えるのは keydown・mousedown・
// マウスの pointerdown・タッチの pointerup・touchend・click で、タッチの pointerdown（touchstart）は数えない
// （HTML の activation triggering input event。iOS の WebKit は iOS 9 から touchstart を外した）。
// 前は TAP の pointerdown だけで unlock し、同じ pointerdown で導入を始めていたので、スマホでは導入が無音で流れていた。
// ここでは、鳴らせるまで操作のたびに unlock を呼び、TAP の画面は離した操作（pointerup / click）で、unlock を呼んでから導入を始める。
export const AUDIO_GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

export function createIntroGesture({ audio, flow }) {
  const unlock = () => { if (!audio.running) audio.unlock(); };
  // 画面の pointerup・click: TAP の画面なら、unlock してから導入を始める（同じ操作で音も絵も始まる）
  const release = () => {
    if (flow.state !== 'gate') return false;
    unlock();
    return flow.release();
  };
  return {
    unlock,
    release,
    // 導入の間の Space / Enter（画面のタップと同じ）: TAP START が出ていれば始め、TAP の画面なら導入を始め、導入の途中なら飛ばす
    key(timeStamp) {
      unlock();
      if (flow.start()) return;
      if (flow.state === 'gate') flow.release();
      else flow.consumePointer(timeStamp);
    },
    // win: 鳴らせるまで、どの操作でも unlock（キャプチャで、ほかの処理より先に）。target: TAP の画面を離した操作で導入を始める
    attach(win, target) {
      for (const type of AUDIO_GESTURES) win.addEventListener(type, unlock, { capture: true });
      target.addEventListener('pointerup', release);
      target.addEventListener('click', release);
    },
  };
}
