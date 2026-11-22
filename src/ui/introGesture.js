// 導入の TAP と、音を鳴らせるようにする操作（持ち主 22:15「初めのムービー音出てない」）。
// ブラウザは「ユーザーの操作」の中でしか AudioContext を動かさない。その操作に数えるのは keydown・mousedown・
// マウスの pointerdown・タッチの pointerup・touchend・click で、タッチの pointerdown（touchstart）は数えない
// （HTML の activation triggering input event。iOS の WebKit は iOS 9 から touchstart を外した）。
// 前は TAP の pointerdown だけで unlock し、同じ pointerdown で導入を始めていたので、スマホでは導入が無音で流れていた。
// ここでは、鳴らせるまで操作のたびに unlock を呼び、TAP の画面は離した操作（pointerup / click）で、unlock を呼んでから導入を始める。
export const AUDIO_GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

// TAP の画面で始めるのは、主ボタン（左クリック・指。button 0）で、TAP の画面を押した指と同じ指（pointerId）を離したときだけ
// （右クリック・中クリック・二本目の指の離す操作では始めない）。pointerup が来ない環境のために、主ボタンの click でも始める
export function createIntroGesture({ audio, flow }) {
  // 鳴らせるまで、または iOS の音のセッションがまだのうちは、操作のたびに unlock
  const unlock = () => { if (!audio.running || audio.sessionPending) audio.unlock(); };
  let pressed = null; // TAP の画面を主ボタンで押した指（pointerId）
  const press = (e) => {
    if (!flow.awaitsTap) return;
    if (pressed == null && (e?.button ?? 0) === 0) pressed = e?.pointerId ?? null; // 先に押した指（二本目の指では置き換えない）
  };
  const cancel = (e) => { if (e?.pointerId === pressed) pressed = null; };
  // 画面の pointerup・click: TAP の画面なら、unlock してから導入を始める（同じ操作で音も絵も始まる）。e を省けば確かめない
  // 最終レビュー C1: タッチのリトライの TAP（'tap'）も同じ道（unlock してから遊び始める）
  const release = (e) => {
    if (!flow.awaitsTap) return false;
    if (e && (e.button ?? 0) !== 0) return false;
    if (e?.type === 'pointerup') {
      if (pressed == null || e.pointerId !== pressed) return false;
      pressed = null;
    }
    unlock();
    return flow.release();
  };
  return {
    unlock,
    release,
    // 導入の間の Space / Enter（画面のタップと同じ）: TAP START が出ていれば始め、TAP の画面なら導入を始め（リトライの TAP なら遊び始め）、導入の途中なら飛ばす
    key(timeStamp) {
      unlock();
      if (flow.start()) return;
      if (flow.awaitsTap) flow.release();
      else flow.consumePointer(timeStamp);
    },
    // win: 鳴らせるまで、どの操作でも unlock（キャプチャで、ほかの処理より先に）。target: TAP の画面を離した操作で導入を始める
    attach(win, target) {
      for (const type of AUDIO_GESTURES) win.addEventListener(type, unlock, { capture: true });
      target.addEventListener('pointerdown', press);
      target.addEventListener('pointercancel', cancel);
      target.addEventListener('pointerup', release);
      target.addEventListener('click', release);
    },
  };
}
