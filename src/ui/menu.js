// R1f（持ち主 18:14「一時停止、リトライ、音量調節ができるメニューボタンを作って」）: 画面の隅のメニューボタン（≡）と、開くと出る一時停止のメニュー
// （つづける・リトライ・BGM と効果音の音量）。音量は端末に覚える（localStorage、名前に接頭辞、保存できなくても動く）。
// ボタンとメニューは canvas の上の DOM なので、触れても canvas の指の知らせ（溜め・スティック）にならない（pointerdown は伝えずに止める）。
// 一時停止そのものは ui/pause.js、リトライ（その場の遊び直し）は main.js の restartRound、控えの読み直しの街は game/daily.js の rememberRetryCity

export const VOLUME_KEYS = { bgm: 'saigo-no-ichigeki:vol-bgm', sfx: 'saigo-no-ichigeki:vol-sfx' };
const clamp = (v, d) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

// 覚えた音量 { bgm, sfx }（0〜1。無い・読めない・壊れていれば 1）
export function loadVolumes(storage) {
  const read = (k) => { try { const v = storage?.getItem(k); return v == null ? null : Number(v); } catch { return null; } };
  return { bgm: clamp(read(VOLUME_KEYS.bgm), 1), sfx: clamp(read(VOLUME_KEYS.sfx), 1) };
}
export function saveVolumes(storage, v) {
  try {
    storage?.setItem(VOLUME_KEYS.bgm, String(clamp(v.bgm, 1)));
    storage?.setItem(VOLUME_KEYS.sfx, String(clamp(v.sfx, 1)));
    return true;
  } catch { return false; }
}

// R1f（R3 の見直しの持ち越し）: メニューのリトライ（と結果の「もう一度」）は、同じ街で、導入も説明も飛ばしてすぐ遊び直す。
// 持ち主 2026-11-23 08:41: ふだんはページを読み直さず、その場で遊び直す（restart。音の許可が残るので TAP が要らない。sessionStorage にもよらない）。
// restart が投げたときだけ控えとして読み直す: 今日の街を覚え（rememberRetryCity）、導入を飛ばす印（markRetry）を置き、読み直す（この順）。
// 戻り値: 'inplace'（その場で）・'reload'（読み直した）・'busy'（録画の途中なので断った）
// busy: 断る間（録画の途中。録画の後始末があとから新しい一回の音を黙らせないように）なら 'busy' を返し、何もしない
export function retryRound({ busy = () => false, restart, onError = () => {}, session, cityPick, rememberRetryCity, markRetry, reload }) {
  if (busy()) return 'busy';
  try {
    restart();
    return 'inplace';
  } catch (e) {
    try { onError(e); } catch { /* 知らせられなくても読み直す */ }
    rememberRetryCity(session, cityPick);
    markRetry(session);
    reload();
    return 'reload';
  }
}

// els: { button, panel }（panel の中に [data-act="resume"]・[data-act="retry"]・input[name="bgm"]・input[name="sfx"]）。
// onOpen / onClose: 一時停止を入れる・外す。onRetry。onVolume({ bgm, sfx }, kind): 音量が変わった（すぐ音へ。kind は動かしたスライダー 'bgm' / 'sfx'、
// 開いたときの読み込みでは無し）。storage: 音量を覚える所
export function createMenu({ button, panel }, { onOpen = () => {}, onClose = () => {}, onRetry = () => {}, onVolume = () => {}, storage = null } = {}) {
  let open = false, available = false;
  const vol = loadVolumes(storage);
  const q = (sel) => panel.querySelector(sel);
  const sliders = { bgm: q('input[name="bgm"]'), sfx: q('input[name="sfx"]') };
  for (const k of ['bgm', 'sfx']) if (sliders[k]) sliders[k].value = String(Math.round(vol[k] * 100));
  // ボタン・メニューへの指は canvas へ伝えない（溜め・スティックにしない）
  const swallow = (e) => { e.stopPropagation?.(); };
  for (const el of [button, panel]) for (const t of ['pointerdown', 'pointermove', 'pointerup', 'touchstart']) el.addEventListener(t, swallow);
  const show = () => { panel.hidden = !open; button.hidden = !available || open; button.setAttribute?.('aria-expanded', String(open)); };
  const api = {
    get isOpen() { return open; },
    get volumes() { return { ...vol }; },
    // ボタンを出してよいか（遊んでいる間・演出の間。導入・題字・結果では出さない）
    setAvailable(v) { available = !!v; if (!available && open) api.close(); show(); },
    open() { if (open || !available) return false; open = true; show(); onOpen(); return true; },
    close() { if (!open) return false; open = false; show(); onClose(); return true; },
    setVolume(k, v) {
      vol[k] = clamp(v, vol[k]);
      if (sliders[k]) sliders[k].value = String(Math.round(vol[k] * 100));
      saveVolumes(storage, vol);
      onVolume({ ...vol }, k); // k: 動かしたスライダー（試し音をその道で鳴らす）
    },
  };
  button.addEventListener('click', (e) => { e.preventDefault?.(); api.open(); });
  q('[data-act="resume"]')?.addEventListener('click', (e) => { e.preventDefault?.(); api.close(); });
  q('[data-act="retry"]')?.addEventListener('click', (e) => { e.preventDefault?.(); onRetry(); });
  for (const k of ['bgm', 'sfx']) sliders[k]?.addEventListener('input', () => api.setVolume(k, Number(sliders[k].value) / 100));
  show();
  onVolume({ ...vol });
  return api;
}
