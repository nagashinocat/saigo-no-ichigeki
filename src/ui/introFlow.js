import { createIntroTimeline } from '../render/introTimeline.js';

// 導入の流れ（S6）: 'gate'（最初の読み込み。小さな「TAP」。この操作で音を鳴らせるようになる）→ 'intro'（導入のアニメーション）→
// 'title'（「最後の一撃」と TAP START）→ 'game'。
// 画面のタップは、ゲームが始まるまで導入が受け取る（consumePointer）: gate では離したとき（release）に導入を始め、導入の途中では題字の終わりへ飛ばす。
// 長押しの押下にはならないので、貯めることも放つこともない。ゲームを始めるのは TAP START（start）だけで、一度きり。
// mode: 'full'（最初の読み込み）・'short'（?intro=short の撮影用。短い題字から）・'retry'（R1g リトライ: 導入も題字も説明もなく、すぐ遊べる）・'bypass'（撮影の ?debug。今までどおりすぐ遊べる）
export const RETRY_KEY = 'saigo-no-ichigeki:retry';

// URL と sessionStorage から始め方を決める。リトライの印は一度読んだら消す（そのあとの読み直しは最初から）
export function introMode({ params, storage }) {
  const p = params.get('intro');
  if (p === 'short') return 'short';
  if (params.has('debug') && p === null) return 'bypass';
  let retry = false;
  try {
    retry = storage?.getItem(RETRY_KEY) === '1';
    if (retry) storage.removeItem(RETRY_KEY);
  } catch { /* 保存できない環境では毎回最初から */ }
  return retry ? 'retry' : 'full';
}

// リトライの直前に呼ぶ（読み直したページが導入を飛ばす）
export function markRetry(storage) {
  try { storage?.setItem(RETRY_KEY, '1'); } catch { /* 保存できなければ導入から */ }
}

export function createIntroFlow({ mode = 'full', onBegin = () => {}, onSkip = () => {}, onTitle = () => {}, onStart = () => {} } = {}) {
  const timeline = createIntroTimeline({ short: mode === 'short' });
  const direct = mode === 'bypass' || mode === 'retry';
  let state = direct ? 'game' : mode === 'short' ? 'intro' : 'gate';
  let time = 0, started = direct;
  // TAP の直後の準備（onBegin。同期で走るので、その間に押したタップはあとから届く）が終わった時刻。
  // 導入の間、これより前の timeStamp の入力は飛ばしに使わない
  let readyAt = -Infinity;
  const toTitle = () => { state = 'title'; onTitle(); };
  return {
    mode, timeline,
    get state() { return state; },
    get time() { return time; },
    get started() { return started; },
    // ゲームが始まるまで、画面の入力は導入のもの
    get blocksInput() { return state !== 'game'; },
    get buttonVisible() { return state === 'title' && time >= timeline.buttonAt; },
    // onBegin の終わりに呼ぶ（performance.now()）
    markReady(t) { readyAt = t; },
    // 画面のタップ（pointerdown）。導入が受け取ったら true（長押しへ渡さない）。
    // timeStamp: 入力の時刻（event.timeStamp）。導入の間に readyAt より前のものは受け取るだけで何もしない。
    // TAP の画面では受け取るだけで、始めるのは離したとき（release）: タッチの pointerdown（touchstart）は、
    // iOS も Android の Chrome も音を鳴らせるようにする操作と見なさない（離した pointerup・touchend・click は見なす）
    consumePointer(timeStamp = Infinity) {
      if (state === 'game') return false;
      if (state === 'gate') return true;
      if (state === 'intro' && timeStamp < readyAt) return true;
      if (state === 'intro') this.skip();
      // 'title': 題字の途中でも終わりの絵へ（ボタンを押すまでゲームは始めない）
      else if (time < timeline.total) time = timeline.total;
      return true;
    },
    // TAP の画面で離した（pointerup・click）・キーを押した: 導入を始める（音の unlock は呼ぶ側が先に済ませる）。
    // TAP の画面のときだけ。始めたら true。導入の間の pointerup・click は何もしない（飛ばすのは pointerdown だけ）
    release() {
      if (state !== 'gate') return false;
      state = 'intro'; time = 0; onBegin();
      return true;
    },
    skip() {
      if (state !== 'intro') return;
      time = timeline.skipTarget;
      toTitle();
      onSkip();
    },
    update(dt) {
      if (state !== 'intro' && state !== 'title') return;
      if (!(dt > 0)) return;
      time = Math.min(time + dt, timeline.total);
      if (state === 'intro' && time >= timeline.total) toTitle();
    },
    // 音の時計に合わせる（時刻を直接置く。戻さない）
    syncTo(t) {
      if (state !== 'intro' || !(t > time)) return;
      time = Math.min(t, timeline.total);
      if (time >= timeline.total) toTitle();
    },
    // 撮影・録画用: 時刻を直接置く
    seek(t) {
      if (state === 'game') return;
      time = Math.min(Math.max(0, t), timeline.total);
      state = time >= timeline.total ? 'title' : 'intro';
    },
    // TAP START: 題字の終わり（ボタンが出た）からだけ、一度きり
    start() {
      if (started || state !== 'title' || time < timeline.buttonAt) return false;
      started = true;
      state = 'game';
      onStart();
      return true;
    },
  };
}
