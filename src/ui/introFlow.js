import { createIntroTimeline } from '../render/introTimeline.js';

// 導入の流れ（S6）: 'gate'（最初の読み込み。小さな「TAP」。この操作で音を鳴らせるようになる）→ 'intro'（導入のアニメーション）→
// 'title'（「最後の一撃」と TAP START）→ 'game'。
// 画面のタップは、ゲームが始まるまで導入が受け取る（consumePointer）: gate では離したとき（release）に導入を始め、導入の途中では題字の終わりへ飛ばす。
// 長押しの押下にはならないので、貯めることも放つこともない。ゲームを始めるのは TAP START（start）だけで、一度きり。
// mode: 'full'（最初の読み込み）・'short'（?intro=short の撮影用。短い題字から）・'retry'（R1g リトライ: 導入も題字も説明もなく、すぐ遊べる）・'bypass'（撮影の ?debug。今までどおりすぐ遊べる）
// 最終レビュー C1: touch（タッチの端末）の読み直しのリトライは 'tap'（遊ぶ画面の上の案内。持ち主 2026-11-23 08:41 から小さな「タップでスタート」の一行で、
// ふだんのリトライはその場で遊び直すので通らない。その場の遊び直しが投げたときの控えだけ）から。読み直しでユーザーの操作の記録は消え、
// タッチの pointerdown は音を鳴らせるようにする操作に数えられないので、すぐ溜めにすると最初の操作らしい操作が最後の一撃の離す操作になり、
// 60 秒ずっと無音になる。'tap' を離した操作（pointerup / click / キー）で unlock してから 'game'（onPlay）。次の押下が溜め。
// マウスの pointerdown は操作に数えられるので、'tap' でもマウスで押せばそのまま 'game' にして溜めにする（PC は 'tap' を出さない）
export const RETRY_KEY = 'saigo-no-ichigeki:retry';

// 持ち主 2026-11-23 08:41: リトライはふだんその場で遊び直す（main.js の restartRound。読み直さない）。読み直しは、それが投げたときだけの控え。
// artifact の iframe（sandbox で別のオリジン）では sessionStorage が投げる・使えないことがあるので、そのときの印は URL の #retry（読んだら消す）
export const RETRY_HASH = '#retry';

// URL と sessionStorage（と #retry）から始め方を決める。リトライの印は一度読んだら消す（そのあとの読み直しは最初から）。
// page: { location, history }（#retry を読んで消す。省けば sessionStorage だけ）
export function introMode({ params, storage, page = null }) {
  const p = params.get('intro');
  if (p === 'short') return 'short';
  if (params.has('debug') && p === null) return 'bypass';
  let retry = false;
  try {
    retry = storage?.getItem(RETRY_KEY) === '1';
    if (retry) storage.removeItem(RETRY_KEY);
  } catch { /* 保存できない環境では #retry を見る */ }
  try {
    if (page?.location?.hash === RETRY_HASH) {
      retry = true;
      page.history.replaceState(page.history.state ?? null, '', page.location.pathname + page.location.search);
    }
  } catch { /* 消せなくても、遊び方は retry */ }
  return retry ? 'retry' : 'full';
}

// 読み直しの控えの直前に呼ぶ（読み直したページが導入も説明も飛ばす）。sessionStorage に置けて読み返せれば 'storage'、
// だめなら（投げる・無い・置いても読めない）URL の #retry（履歴は増やさない）で 'hash'。どちらもだめなら null（導入から）
export function markRetry(storage, page = null) {
  try {
    storage?.setItem(RETRY_KEY, '1');
    if (storage?.getItem(RETRY_KEY) === '1') return 'storage';
  } catch { /* #retry へ */ }
  try {
    if (page) {
      page.history.replaceState(page.history.state ?? null, '', page.location.pathname + page.location.search + RETRY_HASH);
      return 'hash';
    }
  } catch { /* 導入から */ }
  return null;
}

export function createIntroFlow({ mode = 'full', touch = false, onBegin = () => {}, onSkip = () => {}, onTitle = () => {}, onStart = () => {}, onPlay = () => {} } = {}) {
  const timeline = createIntroTimeline({ short: mode === 'short' });
  const retryTap = mode === 'retry' && touch;
  const direct = mode === 'bypass' || (mode === 'retry' && !touch);
  let state = direct ? 'game' : retryTap ? 'tap' : mode === 'short' ? 'intro' : 'gate';
  let time = 0, started = direct;
  // TAP の直後の準備（onBegin。同期で走るので、その間に押したタップはあとから届く）が終わった時刻。
  // 導入の間、これより前の timeStamp の入力は飛ばしに使わない
  let readyAt = -Infinity;
  const toTitle = () => { state = 'title'; onTitle(); };
  const play = () => { state = 'game'; started = true; onPlay(); };
  return {
    mode, timeline,
    get state() { return state; },
    get time() { return time; },
    get started() { return started; },
    // ゲームが始まるまで、画面の入力は導入のもの
    get blocksInput() { return state !== 'game'; },
    // 導入の絵（TAP の画面・導入・題字）を出している間。'tap'（リトライの TAP）は遊ぶ画面の上なので false
    get playsIntro() { return state === 'gate' || state === 'intro' || state === 'title'; },
    // 離した操作で先へ進む TAP の画面（最初の読み込みの 'gate' か、タッチのリトライの 'tap'）
    get awaitsTap() { return state === 'gate' || state === 'tap'; },
    get buttonVisible() { return state === 'title' && time >= timeline.buttonAt; },
    // onBegin の終わりに呼ぶ（performance.now()）
    markReady(t) { readyAt = t; },
    // 画面のタップ（pointerdown）。導入が受け取ったら true（長押しへ渡さない）。
    // timeStamp: 入力の時刻（event.timeStamp）。導入の間に readyAt より前のものは受け取るだけで何もしない。
    // TAP の画面では受け取るだけで、始めるのは離したとき（release）: タッチの pointerdown（touchstart）は、
    // iOS も Android の Chrome も音を鳴らせるようにする操作と見なさない（離した pointerup・touchend・click は見なす）
    // pointerType: 'tap' でマウスなら、その押下で遊び始めて溜めへ渡す（false）
    consumePointer(timeStamp = Infinity, pointerType = null) {
      if (state === 'game') return false;
      if (state === 'tap') {
        if (pointerType !== 'mouse') return true;
        play();
        return false;
      }
      if (state === 'gate') return true;
      if (state === 'intro' && timeStamp < readyAt) return true;
      if (state === 'intro') this.skip();
      // 'title': 題字の途中でも終わりの絵へ（ボタンを押すまでゲームは始めない）
      else if (time < timeline.total) time = timeline.total;
      return true;
    },
    // TAP の画面で離した（pointerup・click）・キーを押した: 導入を始める（音の unlock は呼ぶ側が先に済ませる）。
    // TAP の画面のときだけ。始めたら true。導入の間の pointerup・click は何もしない（飛ばすのは pointerdown だけ）
    // 'tap'（タッチのリトライ）では、遊び始める（onPlay）。次の押下が溜め
    release() {
      if (state === 'tap') { play(); return true; }
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
      if (state === 'game' || state === 'tap') return;
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
