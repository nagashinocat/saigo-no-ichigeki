import * as THREE from 'three';
import { createGame } from './game/game.js';
import { TIERS, pickTier, nextTier, createFpsGovernor } from './render/quality.js';
import { createViews, CITY_CAMERA } from './render/views.js';
import { createHandView } from './render/handView.js';
import { buildHandModel } from './render/handModel.js';
import { CONFIG, SHARE_BASE_URL } from './config.js';
import { createStyle } from './render/style.js';
import { createCityView } from './render/cityView.js';
import { createDestruction } from './world/destruction.js';
import { createDebrisView } from './render/debrisView.js';
import { createRubbleView } from './render/rubbleView.js';
import { createExplosionView } from './render/explosionView.js';
import { createFrontTracker } from './render/sphereDeform.js';
import { createHeroAura } from './render/heroAura.js';
import { createEnemyView } from './render/enemyView.js';
import { buildHeroBody, createHeroBodyBuilder } from './render/heroBody.js';
import { createRiderBodyBuilder } from './render/riderBody.js';
import { createBodyPrep } from './render/bodyPrep.js';
import { createCinematic, leadFor } from './render/cinematic.js';
import { planFinale, snapshotEnemies, planRetreat } from './render/finalePlan.js';
import { createReplay } from './render/replay.js';
import { createBlackhole } from './render/blackhole.js';
import { createReplaySim, replayTargets } from './game/replaySim.js';
import { createRng } from './rng.js';
import { createControls, keyVector, MOVE_KEYS, screenToWorld } from './input/controls.js';
import { createJoystickView } from './ui/joystick.js';
import { createKeyTwice } from './input/keyTwice.js';
import { createPuffBuffer, secondFingerTaps } from './input/puffBuffer.js';
import { createMenu, retryRound } from './ui/menu.js';
import { createPause } from './ui/pause.js';
import { bindPageLeave } from './ui/pageLeave.js';
import { createHideMark, hideMarkState } from './ui/hideMark.js';
import { createLookout } from './game/lookout.js';
import { createLookoutView } from './ui/lookoutView.js';
import { createDashStreak } from './render/dashStreak.js';
import { createHideAction } from './render/hideAction.js';
import { createGuardRing } from './render/guardRing.js';
import { stickMarks } from './ui/stickMarks.js';
import { bindPointerInput, eventMs } from './input/bindDom.js';
import { clearThreshold } from './game/charge.js';
import { maxEnemyReachFrom } from './game/enemies.js';
import { reachNow } from './game/reach.js';
import { createReachRing } from './render/reachRing.js';
import { createHud, OUT_TEXT } from './ui/hud.js';
import { createTimeTicks } from './ui/timeLeft.js';
import { createResult, allowsNativeMenu, resultContent, shareText } from './ui/result.js';
import { createClipRecorder, createClipSession, createClipPanel, restoreReplayAfterClip, clipSize, planClip, planBlackholeClip, clipOverlay, deliverClip, clipFileName } from './share/clip.js';
import { INTRO_FONT } from './ui/introOverlay.js';
import { createAudio, finaleBoomOpts } from './audio/audio.js';
import { createHitFeed } from './audio/hitFeed.js';
import { screenPan, createRateLimit, GUARD_CUE_MAX_PER_SEC } from './audio/cues.js';
import { transitObstacles } from './world/transit.js';
import { transitMix } from './audio/transitSound.js';
import { createPatrolGlow, patrolGlowVisible } from './render/patrolGlow.js';
import { createBgm } from './audio/bgm.js';
import { createIntro } from './render/intro.js';
import { createIntroOverlay } from './ui/introOverlay.js';
import { createIntroFlow, introMode, markRetry } from './ui/introFlow.js';
import { scheduleIntroSfx, renderIntroAudio } from './audio/introSfx.js';
import { prepareIntroMusic, introMusicPlan } from './audio/introMusic.js';
import { createIntroClock } from './audio/introClock.js';
import { pickCity, cityLabel, cityLink, rememberRetryCity } from './game/daily.js';
import { settleRun } from './game/runResult.js';
import { createRecords } from './game/records.js';
import { createIntroGesture } from './ui/introGesture.js';
import { createDrainFx } from './ui/drainFx.js';
import { drainMulOf } from './game/enemies.js';
import { toLocal } from './render/blastFrame.js';

const MAX_FRAME_DT = 0.1;
const RETRY_TAP_TEXT = 'タップでスタート'; // 控えの読み直し（タッチの端末）の小さな案内
const GRABBED_STEADY = 0.15; // 掴まれている間の手の画面の光の安定（弱く瞬く）

const params = new URLSearchParams(location.search);
// R4: 縦動画を録っている間（と元へ戻す間）。ゲームの毎フレーム・画面の大きさの合わせ直し・入力を止める（share/clip.js）
let clipping = false;
// 撮影・計測用のフック（window.__debug など）は URL に ?debug があるときだけ公開する
const debugMode = params.has('debug');
// R3（spec §15 今日の街）: 種は ?seed=（撮影・試し）> ?city=YYYYMMDD（友達のリンク）> 今日の街（日本時間の日付）。
// 街の作り・軍勢の乱数・種類・見回り・演出の乱数のすべてがこの種から（game.js・下の各部品）
const session = (() => { try { return window.sessionStorage; } catch { return null; } })();
// fix1: もう一度の街（sessionStorage、日本時間の 0 時をまたいでも同じ街）を一度だけ使う
const cityPick = pickCity({ params, storage: session, hash: location.hash }); // 見直し Minor 2: sessionStorage が使えないときの #retry=<鍵>（introMode が読んで消す）
const seed = cityPick.seed;
// fix1: artifact の iframe の中なら、共有のリンクは正式な URL（SHARE_BASE_URL）。無ければリンクを出さない
const framedPage = (() => { try { return window.self !== window.top; } catch { return true; } })();
const cityInfo = { label: cityLabel(cityPick), share: cityLabel(cityPick).replace('（リンク）', ''), link: cityLink(cityPick, { loc: location, framed: framedPage, canonical: SHARE_BASE_URL }) };
// 自己ベストと称号は端末に（localStorage。使えなければ、そのページの間だけ）
// 端末の保存（localStorage）。使えない環境（プライベートモード・iframe の制限）では null。自己ベスト・称号と音量の両方が使う
const local = (() => { try { return window.localStorage; } catch { return null; } })();
const records = createRecords(local);
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches;
// タッチの端末（指の操作がある）。リトライの TAP（最終レビュー C1）と、blur の一時停止で使う
const touchDevice = (() => { try { return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0; } catch { return false; } })();
const tierParam = params.get('tier');
// 導入（S6）の始め方: 'full'（最初の読み込み: TAP → 導入 → 題字 → TAP START）・'retry'（リトライ: 導入も説明もなし。PC はすぐ遊べ、タッチの端末は遊ぶ画面の上の TAP を一つ。C1）・'short'（?intro=short 撮影用）・
// 'bypass'（撮影の ?debug で ?intro がないとき: 今までどおりすぐ遊べる）
// 持ち主 2026-11-23 08:41: sessionStorage が使えない iframe では、控えの読み直しの印は URL の #retry（読んだら消す）
const retryPage = { location, history };
const startMode = introMode({ params, storage: session, page: retryPage });
let tier = tierParam in TIERS ? tierParam : pickTier({ isMobile, deviceMemory: navigator.deviceMemory, cores: navigator.hardwareConcurrency });

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'high', stencil: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = TIERS[tier].shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;

// 録画用（?debug のときだけ）: ?pr=N で画素比の上限を上書きする（scripts/record-intro.mjs が 1080×1920 で撮る）
const prParam = debugMode ? Number.parseFloat(params.get('pr') ?? '') : NaN;
const applyPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Number.isFinite(prParam) ? prParam : TIERS[tier].pixelRatioMax));
applyPixelRatio();

const game = createGame({ seed });
const style = createStyle(tier);
const cityView = createCityView(game.city, style, tier);

const cityScene = new THREE.Scene();
cityScene.add(style.sky, ...style.lights, cityView.group);
// 手の画面: 主人公の右手はコードで組み立てる（読み込みを待たない）。low の段は粗い手にする
const handDetail = tier === 'high' ? 'high' : 'low';
// 左手は右手の形を鏡に映して使い回す（組み立ては1回ぶん）
const hand = createHandView({ right: buildHandModel({ detail: handDetail }), left: buildHandModel({ detail: handDetail, side: 'left' }) }, tier);
// 主人公の体（宙に浮く人影）もコードで組み立てる。最初のフレームを待たせないよう、起動時は粗い体（low）で始め、
// 画質の段の細かい体は最初のフレームのあと、手の空いた時間に区切りごとに組み立てて差し替える（heroUpgrade）
const heroBody = buildHeroBody({ detail: 'low' });
const heroBuilder = tier === 'low' ? null : createHeroBodyBuilder({ detail: tier });
// 最後の一発の軍勢の後ろのカットで、いちばん手前に映る軍勢の一人の体（riderBody.js）。主人公の細かい体のあと、手の空いた時間に組み立てる
// （low の段は粗い格子）。遅くとも最後の一発を放つときまでに組み立てて渡す
const riderBuilder = createRiderBodyBuilder({ detail: tier });

// 入力・HUD・結果・音
const audio = createAudio();
// BGM（打楽器とマリンバの民族音楽風）: 遊びが始まると鳴り、時間と貯めた力で層が増え、放った瞬間に止まる。
// リプレイと結果画面では同じ旋律をゆっくり静かに。時間切れ（ブラックホール）では引き伸ばされて消える
const bgm = createBgm(() => audio.bgmOutput);
// M1（持ち主 09:15）: 払うのボタンはなくした。溜めている間の 2 本目の指の短いタップ、PC は Space か右クリックで払う
const hud = createHud(document.getElementById('hud'), { total: CONFIG.roundSeconds });
// R1c: 残り 10 秒から 1 秒ごとの刻みの音（遊んでいる間だけ。演出・リプレイ・結末・導入では鳴らさない）
let timeTicks = createTimeTicks(); // その場のリトライで作り直す
// 払う。力が払える量に足りなければ、押した所（キーなら主人公の画面の位置）に小さく「足りない」（持ち主 08:24 の制作側の判断）。
// 溜めていない（1 本目の指がない）ときは払えない（spec §16 09:15）
// R1f（持ち主 18:14「払うの反応を確実に」）: 前の払うが広がっている間（busy）のタップは覚えておき、広がり終わったら払う（input/puffBuffer.js）
const puffBuffer = createPuffBuffer();
function tryPuff(x, y) {
  if (!controls.charging) return false;
  if (!(Number.isFinite(x) && Number.isFinite(y))) { const c = screenCue(game.hero.x, 2.5, game.hero.z); x = c.sx; y = c.sy; }
  if (game.puff()) { puffBuffer.clear(); return true; }
  // M2: 3 回使い切ったら「もう払えない」、力が足りなければ「足りない」（どちらも毎回出す）
  const why = game.puffBlock;
  if (puffBuffer.push(x, y, nowSec(), why, game.puffBusyLeft)) return false;
  if (why === 'out') hud.short(x, y, OUT_TEXT); else if (why === 'short') hud.short(x, y);
  return false;
}
// R1b（持ち主 08:24「吸われてる時をもっと分かりやすく」）: 掴まれて吸われている間の知らせ（画面の縁の脈打ち・力の数字・手の帯の球・吸われる音）
const drainFx = createDrainFx();
let drainedSeen = 0;
const startHint = document.getElementById('start');
const result = createResult(document.getElementById('result'), {
  // R3: 同じ街（今日の街・リンクの街・試しの種）にもう一度挑む。持ち主 2026-11-23 08:41: ページを読み直さず、その場で（requestRetry）
  onRetry() { requestRetry(); },
  // 最後の一発をもう一度見る（放つ直前の街へ戻して起こし直す。何度でも同じリプレイ）
  onReplay() { startReplay(); },
  // R4（spec §15）: その人の一撃を縦動画にして共有（共有できなければ保存）
  onClip(info) { startClip(info); },
});
const replayTag = document.getElementById('replay');
// M1（持ち主 09:15、spec §16）: 1 本目の指はどこでも溜め（離すと最後の一発）、溜めている間の 2 本目の指は長押しで浮かぶジョイスティック・
// 短いタップで払う（input/controls.js）。pointercancel・キャプチャが外れた・タブを隠した・blur は放たずに打ち切る
const controls = createControls({
  onChargeStart() { startHint.hidden = true; game.pressStart(); },
  onChargeEnd() { game.pressEnd(); },
  onChargeCancel() { game.pressCancel(); },
  // R1f（持ち主 18:14「LOOK OUT!の矢印をタップ」）: 2 本目の指のタップが LOOK OUT! の矢印の当たりに触れたら、その物陰へ隠れる（シュッはやめた）
  // 持ち主 22:47: 矢印のタップは払うの道を通らず、覚えておいた払うも捨てる（input/puffBuffer.js secondFingerTaps）
  ...secondFingerTaps({ buffer: puffBuffer, puff: (x, y) => tryPuff(x, y), hide: () => tryHideArrow() }),
  hideHit: (x, y) => lookoutView.hit(x, y),
});
// R1e（持ち主 16:55）: 見つかりそうなときの「LOOK OUT!」と、隠れられる物陰の向きの矢印（音は出さない）。R1f: 矢印は大きな当たり（タップで隠れる）
let lookout = createLookout(); // その場のリトライで作り直す
const lookoutView = createLookoutView(document.getElementById('lookout'));
let lookoutNow = null; // 今のフレームの LOOK OUT!（createLookout().update の戻り値の写し）
const hideMark = createHideMark(document.getElementById('hideMark')); // R1f fix1: 物陰にいる間の印
// M2（持ち主 15:20）: 隠れる。R1f から指は LOOK OUT! の矢印のタップ（tryHideArrow）、PC は向きのキーの 2 回押し（tryHide）か H キー（矢印が出ていれば）。
// d は画面の向き。上空カメラの向きで街の向きへ直す（screenToWorld。スティックの動く向きと同じ写し）。
// 掴まれている間・次まで待つ間・物陰がない向きは、主人公の上に短い知らせ
const HIDE_TEXT = { grabbed: '掴まれていて隠れられない', cooldown: 'まだ隠れられない', nocover: '隠れる物陰がない' };
function hideFailed(why) {
  const c = screenCue(game.hero.x, 2.5, game.hero.z);
  const reason = why ?? 'nocover';
  if (HIDE_TEXT[reason]) hud.short(c.sx, c.sy, HIDE_TEXT[reason]);
  return false;
}
function tryHide(d) {
  if (!controls.charging || game.phase !== 'playing') return false;
  const why = game.hideBlock;
  const w = screenToWorld(d.x, d.y, CITY_CAMERA.azimuthDeg);
  if (game.hide(w.x, w.z)) return true;
  return hideFailed(why);
}
// LOOK OUT! の矢印の物陰へ（矢印が出ていなければ何もしない）
function tryHideArrow() {
  if (!controls.charging || game.phase !== 'playing' || !lookoutNow?.show || !lookoutNow.spot) return false;
  const why = game.hideBlock;
  if (game.hideToward(lookoutNow.spot)) return true;
  return hideFailed(why);
}
const keyFlick = createKeyTwice();
const joystick = createJoystickView(document.getElementById('stick'));
// R1c（M1 の見直し Minor 1・2）: 指・マウスの配線は input/bindDom.js（入力の時刻も毎フレームの update も performance.now() の一つの時計。
// 溜めの指の離す操作は、どのボタンでも放つ）。PC の右クリックは溜めている間の払う
const pointerInput = bindPointerInput(canvas, {
  controls,
  puff: (x, y) => tryPuff(x, y),
  intercept(e, ms) {
    // 導入（S6）: ゲームが始まるまで、画面のタップは導入のもの（飛ばす。TAP の画面は受け取るだけで、始めるのは離したとき）。長押しにはならない
    // C1: タッチのリトライの TAP（遊ぶ画面の上）も受け取るだけ。マウスで押したら、そのまま溜め
    if (introFlow.consumePointer(ms, e.pointerType)) return true;
    // R1f: メニューが開いている（一時停止）間の画面のタップは何もしない（溜めにならない）
    if (menu.isOpen || pause.paused) return true;
    if (clipping) return true; // R4: 録画の間の画面のタップは何もしない（リプレイを飛ばさない）
    // リプレイの間は、画面のタップで飛ばして結果へ
    if (replay.active && !replay.finished) { skipReplay(); return true; }
    return false;
  },
});
const nowSec = pointerInput.now;
// PC: 矢印キーか WASD で動く（溜めている間だけ。押しているキーの集まり）
const keysDown = new Set();
window.addEventListener('blur', () => { controls.reset(); keysDown.clear(); });
// R1f（持ち主 18:14「一時停止、リトライ、音量調節ができるメニューボタン」「画面切り替えしたら一瞬ピープ音」）: 一時停止（ui/pause.js）とメニュー（ui/menu.js）。
// メニューを出せるのは遊んでいる間と演出・リプレイの間（導入・題字・結果では出さない）。開くと一時停止、つづけるで戻る。
// タブ・アプリを切り替えたら一時停止して（音は約 30 ms で 0 へ落としてから止め）、戻ったらメニューを出して待つ
// fix2: 演出・リプレイ・ブラックホールの間（遊びの外）は、メニューでも AudioContext を止める（ui/pause.js）
const pause = createPause({ game, controls, audio, bgm, keys: keysDown, cinematic: () => !inPlay() });
let previewAt = -1e9;
// 結果を出したあと（lastResult）は出さない。結果を待っている間（演出・リプレイ）は出してよい
const menuAvailable = () => !introFlow.blocksInput && !lastResult;
const menu = createMenu({ button: document.getElementById('menuBtn'), panel: document.getElementById('menu') }, {
  storage: local,
  onOpen() { pause.set('menu', true); },
  onClose() { pause.set('menu', false); },
  // R1f（R3 の見直しの持ち越し）: 同じ街で、導入も説明も飛ばしてすぐ遊び直す（持ち主 2026-11-23 08:41: その場で。requestRetry）
  onRetry() { requestRetry(); },
  // fix1（見直し Minor 6）: 動かしたスライダーの道で短い試し音（一時停止の間も聞こえる。0.15 秒に一度まで）
  onVolume(v, kind) {
    audio.setVolumes(v);
    const t = performance.now();
    if (kind && t - previewAt > 150) { previewAt = t; audio.preview(kind); }
  },
});
// 隠れる・切り替える: 押下を打ち切り（放たず、貯めた力は残る。ui/pause.js）、遊んでいる間ならメニューを開いておく（戻ったら「つづける」で再開）
function leavePage() { clipRestored(); if (clipSession.busy) clipSession.cancel(); // fix2: 戻す早送りの途中で隠れても、瓦礫の音の道は黙らせたままにしない
 if (menuAvailable()) { menu.setAvailable(true); menu.open(); } pause.set('tab', true); }
// タブを隠す・pagehide・window の blur で一時停止（ui/pageLeave.js）。最終レビュー I1: PC の blur（Alt+Tab・別のウィンドウ）も、
// 遊んでいる間と演出の間（メニューを出せる間）は止める。タッチの端末は今までどおりどの画面でも
bindPageLeave({ win: window, doc: document, touch: touchDevice, inPlay: menuAvailable, leave: leavePage, back: () => pause.set('tab', false) });
window.addEventListener('keyup', (e) => { keysDown.delete(e.code); if (MOVE_KEYS.includes(e.code)) { const v = keyVector(keysDown); keyFlick.push(v.x, v.y, nowSec()); } });
// PC はマウスで長押ししながら、もう片方の手の Space キーで小爆発
window.addEventListener('keydown', (e) => {
  // 導入の間: Space / Enter は画面のタップと同じ（TAP START が出ていれば始める）
  if (introFlow.blocksInput) {
    if (['Space', 'Enter'].includes(e.code)) {
      e.preventDefault();
      // キーでも音を鳴らせるように（unlock してから、TAP START・導入を始める・飛ばす）
      if (e.repeat) introGesture.unlock(); else introGesture.key(eventMs(e));
    }
    return;
  }
  // R4: 録画の間は Esc でやめる。ほかのキーは使わない（リプレイを飛ばさない・結果のボタンを押さない）
  if (clipping) { if (e.code === 'Escape') { e.preventDefault(); clipSession.cancel(); } return; }
  // R1f: Esc でメニュー（遊んでいる間）。開いている間は Esc で閉じ、ほかのキーは使わない
  if (menu.isOpen) { if (e.code === 'Escape') { e.preventDefault(); menu.close(); } return; }
  if (e.code === 'Escape' && menuAvailable() && !(replay.active && !replay.finished)) { e.preventDefault(); menu.open(); return; }
  // リプレイの間は Space / Enter / Esc で飛ばす
  if (replay.active && !replay.finished && ['Space', 'Enter', 'Escape'].includes(e.code)) { e.preventDefault(); skipReplay(); return; }
  // 結果画面では奪わない（ボタンを Space で押せる）
  if (game.phase === 'over') return;
  // R1f: H キーで、LOOK OUT! の矢印の物陰へ隠れる（矢印が出ているときだけ）
  if (e.code === 'KeyH') { e.preventDefault(); if (!e.repeat) tryHideArrow(); return; }
  if (MOVE_KEYS.includes(e.code)) {
    e.preventDefault(); keysDown.add(e.code);
    // M2: 向きのキーの 2 回押しで隠れる（押し続けの repeat は数えない）
    if (!e.repeat) { const v = keyVector(keysDown), h = keyFlick.push(v.x, v.y, nowSec()); if (h) tryHide(h); }
    return;
  }
  if (e.code !== 'Space') return;
  e.preventDefault();
  if (!e.repeat) tryPuff();
});
// fix2: 手で写す箱の中は長押しのメニューを止めない（携帯で選んでコピーできるように）
window.addEventListener('contextmenu', (e) => { if (!allowsNativeMenu(e.target)) e.preventDefault(); });
// 終わり: 最後の一発は、演出（cinematic）とリプレイが最後まで終わって（replay の 'replayEnd'）から結果。
// ブラックホール（時間切れ）は、その演出（blackhole）が暗転しきって 'end' を知らせてから結果
const RESULT_DELAY = 0.15;
const BLACKHOLE_DRONE_SEC = 7; // 唸りが上がりきるまで（何もない空間になる時刻）
let pendingResult = null;
let lastResult = null;
let finaleDone = false;
// S9: outcome は最後の一発の勝ち負け（撃退成功／撃退失敗と生き残り。時間切れは無い）
game.on('over', ({ reason, total, outcome = null }) => {
  audio.chargeHum(0); audio.rumble(0);
  // R3: 称号（初めては NEW）と、この街の自己ベスト（放った一発だけを出す。ブラックホールは前のベストを見せる）
  // R3 fix1: 称号は一つ（いちばん珍しいもの。並びはその回の種）。今日の初撃退・記録の塗り替え・日本時間の時刻も称号の元
  const { titles, best } = settleRun({ records, cityKey: cityPick.key, citySeed: seed, reason, outcome, stats: game.runStats, damage: total, cityValue: game.cityValue });
  pendingResult = { reason, total, outcome, wait: RESULT_DELAY, extra: { city: cityInfo, titles, best } };
  // リプレイが無いとき（ふつうは無い）は、終わった街の上空で生き残りの光を脈打たせる
  if (outcome && !outcome.clear && !replaySnap) patrolGlow.setSurvivors(survivorIds(outcome));
  // 時間切れ: 主人公がブラックホールになり、すべてを飲み込む（BGM と唸りの段取りは演出の cue）
  if (reason === 'blackhole') { finaleDone = false; blackhole.play(game.hero); } // M1: 黒い球は主人公のいる所
});
function updateResult(dt) {
  if (!pendingResult || (!finaleDone && (cinematic.active || replay.active || blackhole.active))) return;
  pendingResult.wait -= dt;
  if (pendingResult.wait > 0) return;
  result.show(pendingResult.total, pendingResult.reason, pendingResult.outcome, { replay: !!replaySnap, clip: canClip(pendingResult.reason), extra: pendingResult.extra });
  lastResult = pendingResult;
  pendingResult = null;
}

const views = createViews(renderer, () => TIERS[tier]);
// CSS で決まったキャンバスの実寸に合わせる（スマホのアドレスバーで 100vh がずれる問題を避ける）
const resize = () => {
  if (clipping) return; // R4: 録画の間は動画の大きさのまま（終わったら合わせ直す）
  views.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  const r = views.layout.hand;
  hand.resize(r.w / Math.max(1, r.h));
  hud.place(views.layout, views.size.h);
};
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

// 壊れたものは破片になる（手前の物理の焦点は Task 11 で演出カメラに合わせる。null なら全部プール）
const destruction = createDestruction({ cityView, getTier: () => TIERS[tier], seed });
const debrisView = createDebrisView(style, destruction.pool, destruction.near, TIERS.high.debrisMax + TIERS.high.nearPhysicsMax);
cityScene.add(debrisView.mesh);
// 穴の底や斜面で止まった瓦礫（動かないので、置いた・消えたときだけ書き直す）
const rubbleView = createRubbleView(style.props.debris, destruction.rubble);
cityScene.add(rubbleView.mesh);

// 爆発の見た目（光の球・衝撃波・閃光・粉・光に溶ける建物）
const explosionView = createExplosionView(cityScene, tier, { sunDir: style.sunDir, seed });
// 画面へ直接描く段（low）と、画面効果のレンダーターゲットへ描く段（high/mid）では、同じ材質でも別のシェーダーになる
// （トーンマップの有無）。前もって作るときは両方を作る（演出やリプレイで初めて出る材質が、その瞬間に止まらないように）
const warmTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
function warmBoth(fn) {
  renderer.setRenderTarget(null);
  fn();
  renderer.setRenderTarget(warmTarget);
  fn();
  renderer.setRenderTarget(null);
}
warmBoth(() => explosionView.warmup(renderer, views.cityCamera));
// 街の材質（ビル・飾り・看板・光の溜まり）も両方の段の分を前もって作る（段が下がって描き方が変わった瞬間に止まらないように）
warmBoth(() => cityView.warmup(renderer, views.cityCamera, cityScene));
// 最後の一発: 放つ瞬間から、白が晴れて爆発が始まるまで世界の音は消える（音の段取りは演出が cue で知らせる）
game.on('shot', (shot) => {
  bgm.stop(); // 放った瞬間にぴたりと止める（演出の無音・爆音のため）
  // M1: 爆心は放った瞬間の主人公の位置。街のゆがみ・地面の穴・破片と瓦礫はそのまわり（リプレイでも同じ）
  cityView.setBlastCentre(shot.centre);
  destruction.setCentre(shot.centre);
  cityView.setDetail('fine'); // ビルを球の線に沿って曲がる細かい箱へ（遊んでいる間は粗い箱）
  explosionView.begin(shot); hand.release(shot);
});
// 小爆発: 両手が玉を鷲掴みに押さえ込んで弾け、主人公のまわりに小さな光の球（貯めの唸りは止めない）
// 足りずに離した: 放たず、両手がびくっと震え、ひとこと知らせる
game.on('fizzle', () => { hand.fizzle(); hud.hint('まだ足りない。もっと貯めてから離して'); });
game.on('puff', (shot) => { explosionView.begin(shot); hand.release(shot); });
// R1: まとめて払った「×k」を上空の画面の主人公の少し上に出し、主人公の画面の左右から澄んだ音（k が増えるたびに一段上がる）
const _cueV = new THREE.Vector3();
// 世界の点 (x, y, z) を、今の街のカメラの画面の px（左上原点）と、音の左右・近さへ
function screenCue(x, y, z) {
  const cam = cityCam();
  cam.updateMatrixWorld();
  const dist = _cueV.set(x, y, z).distanceTo(cam.position);
  _cueV.applyMatrix4(cam.matrixWorldInverse);
  const pan = screenPan(_cueV.x, _cueV.z);
  _cueV.set(x, y, z).project(cam);
  const { city } = views.layout, H = views.size.h;
  return { sx: city.x + (_cueV.x + 1) / 2 * city.w, sy: H - city.y - (_cueV.y + 1) / 2 * city.h, pan, dist };
}
game.on('combo', ({ k }) => {
  const c = screenCue(game.hero.x, 2.5, game.hero.z); // M1: 主人公の今の画面の位置
  hud.combo(k, c.sx, c.sy);
  audio.combo(k, c.pan);
});
// R1: 大物が来た: 街の画面に「大物が来る」が閃き、大物のいる側から遠い警笛と探照灯の点く音（探照灯の大きな振りは enemyView）
game.on('bossArrive', ({ x, z }) => {
  hud.announce();
  const c = screenCue(x, 3, z);
  audio.bossArrive(c.pan, Math.max(0, Math.min(1, 1 - c.dist / 220)));
});

// 軍勢と主人公の姿
const enemyView = createEnemyView(cityScene, tier, { sunDir: style.sunDir, heroBody });
// 軍勢・主人公の陰影と推進の光を、暗めの夕方の光に合わせる（材質どうしで共有している uniform の値を書き換える）
style.tintFigures(enemyView.mesh.material.uniforms);
// 細かい主人公の体と演出の一人の体の組み立て（bodyPrep.js）: 最初のフレームのあとの手の空いた時間と TAP を待つ画面（タッチのリトライの TAP も）で少しずつ、
// TAP の直後（画面は黒。リトライは TAP を離したとき）に残りを一度に。導入の再生中は手の空いた時間の組み立てを止める（音の時計に合わせた絵が飛ばない）。
// 導入のバイクの拍の近いバイクも、演出・リプレイ・時間切れの結末で近くに映る主人公も、かならず画質の段の体になる
const bodyPrep = createBodyPrep({
  heroBuilder, riderBuilder, enemyView,
  idle: (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 16)),
  paused: () => introFlow.state === 'intro',
});
// PC のリトライ（TAP の画面を通らず、すぐ遊ぶ）は手の空いた時間に組み、遅くとも最後の一発を放つとき（と時間切れのとき）までに
game.on('shot', () => bodyPrep.finish());
game.on('over', () => bodyPrep.finish());
// 街を見回る軍勢の光の点と、光の壁に飲まれた瞬間の火花（fix1。遠くの地区の軍勢も読める）
// S9: 撃退失敗の生き残りは、探す者も同じ点で目印にする（その分の余り）
const patrolGlow = createPatrolGlow(CONFIG.enemy.patrol.count, tier, { extra: 256 });
const survivorIds = (outcome) => new Set(outcome.survivors.map((s) => s.id));
cityScene.add(patrolGlow.points);
// R2（spec §15）: 届く範囲の輪（上空の画面だけ、主人公のまわりの地面。網 1 つ）
const reachRing = createReachRing(cityScene);
const heroAura = createHeroAura(tier); // 浮いている主人公のまわりの力のゆらぎ
cityScene.add(heroAura.group);

// ---- 導入（S6。持ち主 11:15 / 13:06 / 15:55）----
// 最初の読み込み: 黒に小さな「TAP」（このタップで音を鳴らせるようになる）→ 導入（バイク・カード・ライト・隠れる・手・白）→
// 「最後の一撃」が 1 文字ずつ十字の星から生まれる → TAP START でゲーム。導入の途中のタップは題字の終わりへ飛ばす（音はすぐ切る）。
// TAP START までゲームは動かさない（タイマーは 60 のまま、軍勢も湧かない）。リトライは短い題字から
const intro = createIntro({ views, scene: cityScene, cityView, enemyView, heroAura, patrolGlow, hand, city: game.city, tier, getTier: () => tier, seed });
// 2D の層の画素比は画質の段の上限まで（録画の ?pr はそれを上書き）。文字の光のにじみは段ごとに軽く
const overlay = createIntroOverlay(document.body, { dprMax: Number.isFinite(prParam) ? prParam : TIERS[tier].pixelRatioMax, glow: tier === 'high' ? 'full' : tier === 'mid' ? 'cheap' : 'none' });
let liftT = 0, introWarmed = false;
// TAP START: 主人公がふわりと浮き上がって（最大 up m）、いつもの宙の高さへ戻る。足は地面より下へ沈まない（y ≥ 0）
const HERO_LIFT = { up: 0.45, sec: 0.9 };
const introFlow = createIntroFlow({
  mode: startMode,
  touch: touchDevice,
  onBegin() {
    overlay.showGate(false);
    // 楽器の音がまだ全部できていなければ、ここで作り終えてから導入の 0 秒を決める（最初の拍を過去の時刻に予約しない）
    while (!prepareIntroMusic()) { /* 残りの楽器を作る */ }
    intro.finishPrepare(); // 主人公の導入の体も（ライトの拍で組み立てて止まらない）
    // 画質の段の主人公の体と乗り手の体も（バイクの拍の近いバイクが最初のフレームから乗り手の体。導入の再生中に組み立てない）
    bodyPrep.finish();
    warmIntro(); // 導入の材質と形も（導入の最初のフレームで止まらない）
    // 導入の 0 秒は、ここでは決めない: 音の時計が running になってから（introClock。TAP の操作で呼んだ resume は、すぐには効かない）
    const ready = performance.now();
    introClock.begin(ready);
    // ここまでの準備は同期で走り、その間の画面は止まって見える。その間に押したタップ・キーは導入を飛ばさない
    introFlow.markReady(ready);
  },
  onSkip() { introClock.cut(); },
  onStart() {
    introClock.cut();
    intro.end();
    overlay.fadeOut(0.55);
    game.begin(); // タイマーが 60 から進み、BGM が鳴りはじめる（updateAudio）
    startHint.hidden = false;
    liftT = HERO_LIFT.sec;
    resize();
  },
  // C1: タッチのリトライの TAP を離した（unlock は introGesture が先に済ませる）: TAP を消して遊ぶ。体の組み立ての残りはここで
  // （遊んでいる間や放つ瞬間に止まらない）。次の押下が溜め
  onPlay() {
    bodyPrep.finish();
    overlay.showGate(false);
    overlay.gate.classList.remove('retry');
  },
});
overlay.button.addEventListener('click', () => introFlow.start());
// 音を鳴らせるようにする操作と、TAP の画面を離した操作で導入を始めること（introGesture.js。持ち主 22:15）
const introGesture = createIntroGesture({ audio, flow: introFlow });
introGesture.attach(window, canvas);
if (introFlow.blocksInput) hud.setVisible(false); // HUD はゲームが始まってから
if (introFlow.state === 'gate') overlay.showGate(true);
// C1: タッチの端末の読み直しのリトライ（その場の遊び直しが投げたときの控えだけ）は、遊ぶ画面の上に小さな「タップでスタート」の一行
// （持ち主 2026-11-23 08:41「TAPの文字がかなりデカく」: 大きな TAP はやめた。導入・題字・遊び方の説明は出さない）
if (introFlow.state === 'tap') { overlay.gate.classList.add('retry', 'ready'); overlay.gate.firstElementChild.textContent = RETRY_TAP_TEXT; overlay.showGate(true); }
if (!introFlow.playsIntro) overlay.fadeOut(0);
// 遊び方の説明（#start）は HTML ではじめから隠してある（JS が動く前の暗い画面に出さない。持ち主 08:41）。出すのは TAP START（onStart）と撮影の bypass
if (startMode === 'bypass') startHint.hidden = false;
if (startMode === 'retry') startHint.hidden = true; // R1g: リトライは遊び方の説明も飛ばして、すぐ遊べる
// 浮き上がり: 0 から上がって（前半）ゆっくり宙の高さ 0 へ降りる。どの時刻も ≥ 0
const heroLiftAt = (u) => HERO_LIFT.up * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 2;
let overlayT = -1;
// 導入の音の時計（introClock.js）: running になってから 0 秒を決める。鳴らせないあいだは絵を dt で進め、
// あとで鳴らせるようになったら次の拍の頭から入る。?intro=short の撮影用の短い題字は TAP を通らない（begin しない）ので、はじめから dt。
// リトライは導入を通らない（タッチの端末は遊ぶ画面の上の TAP で unlock する。onPlay）
const introMusicGrid = (() => { const p = introMusicPlan(introFlow.timeline); return p ? { start: p.start, beatSec: 60 / p.tempo } : { start: 0, beatSec: 60 / 116 }; })();
const introClock = createIntroClock({
  getOutput: () => audio.introOutput,
  schedule: (ctx, dest, t0, opts) => scheduleIntroSfx(ctx, dest, t0, introFlow.timeline, opts),
  grid: introMusicGrid,
});
// 導入の時刻 t の絵（3D の拍は画面全体、カード・白・題字は 2D が覆う）
// alive: 題字が出きったあとも動き続けるもの（「の」の後ろのブラックホールの渦）の時刻。撮影は t をそのまま渡す
let introAlive = 0;
function renderIntroAt(t, { force = false, alive = t } = {}) {
  const tl = introFlow.timeline, b = tl.beatAt(t);
  intro.update(t, b);
  if (!overlay.covers(b)) intro.draw();
  // 題字の画面は渦が動き続けるので毎フレーム描く（それ以外は時刻が変わったときだけ）
  if (force || t !== overlayT || b.name === 'title') { overlay.draw(tl, t, b, { speed: intro.speed, vanish: intro.vanish }, alive); overlayT = t; }
  return b;
}
// 導入の材質と形を前もって作る（一度だけ）: 画面へ直接描く段とレンダーターゲットへ描く段の両方で compile し、
// 拍ごとに一度描いて、黒で塗り直す（TAP の画面は黒のまま）
function warmIntro() {
  if (introWarmed) return;
  introWarmed = true;
  const tgt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const focus = enemyView.focusMesh, focusVis = focus?.visible;
  if (focus) focus.visible = true; // 乗り手の体の形も送っておく
  cityView.setCloseView(true); // 導入の 3D の拍は近いカメラ（壁の飾りを出す）
  intro.warmup((scene, cam) => {
    for (const t of [null, tgt]) { renderer.setRenderTarget(t); renderer.compile(scene, cam); }
  });
  if (focus) focus.visible = focusVis;
  tgt.dispose();
  // 3D の拍と手の拍の最初の絵を、本番と同じ道すじで一度ずつ描く（画面効果の大きさ・形と画像の GPU への送り・
  // その拍で初めて出る物）。最後はバイクの拍（導入の最初のフレームと同じ姿）
  const tl = introFlow.timeline;
  for (const name of ['light', 'hide', 'hands', 'bikes']) {
    const B = tl.beat(name);
    if (!B) continue;
    const t = B.start + 0.05;
    intro.update(t, tl.beatAt(t));
    intro.draw();
  }
  renderer.setRenderTarget(null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, views.size.w, views.size.h);
  renderer.clear(true, true, true);
  // GPU の仕事が終わるまで待つ（1 画素を読む）: 前もって描いた分が、導入の 0 秒を決めたあとのフレームへずれこまない
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}
function introTick(dt) {
  // C1: タッチのリトライの TAP を待つ間は、体の組み立てを少しずつ（遊ぶ画面は simulate と draw が描く）
  if (introFlow.state === 'tap') { if (!bodyPrep.done) bodyPrep.step(); return; }
  // TAP を待つ間に、主人公の導入の体と、導入の音楽の楽器の音を少しずつ作っておく。両方できたら、画質の段の主人公の体と
  // 乗り手の体を区切り 1 つずつ、最後に導入の材質を前もって作る
  // （TAP が先に来ても、残りは TAP の直後、音の時計を決める前に作り終える）
  if (introFlow.state === 'gate') {
    if (!intro.prepared) intro.prepareStep();
    if (prepareIntroMusic() && intro.prepared) { if (!bodyPrep.done) bodyPrep.step(); else warmIntro(); }
    // 準備が全部終わったら「TAP」をはっきり出して脈打たせる（それまでは薄く。薄くてもタップは受け取る）
    if (introWarmed) overlay.gate.classList.add('ready');
    return;
  }
  if (introFlow.state === 'intro') {
    const c = introClock.tick(performance.now(), introFlow.time);
    if (c === 'dt') introFlow.update(dt);
    else if (c !== 'hold') introFlow.syncTo(c); // 'hold': 音の時計が動き出すのを少しだけ待つ（絵は 0 秒のまま）
  } else introFlow.update(dt); // 題字（title）
  if (bgm.state === 'off' && audio.running) bgm.prepare(); // 題字の間に楽器の音を作っておく
  introAlive = introFlow.time >= introFlow.timeline.total ? introAlive + dt : introFlow.time;
  renderIntroAt(introFlow.time, { alive: introAlive });
}

// 最後の一発の演出（画面全体、仕様 12 章の絵コンテ 1〜5）: 白 → 遠くの軍勢の後ろから、地平の爆発がスローでふくらみ、弾けて
// 光の壁が街を走り軍勢とカメラを一気に飲む（R0b）→ 弾ける爆発から逃げる → 宇宙から見た光の半球と衝撃波の輪 → 縦一線の光 → 無音と地鳴り（cinematic.js）
// 画質の段は演出を始めるたびに読む（途中で段が下がっていれば、その段の重さで演じる）
const cinematic = createCinematic(views, enemyView, explosionView, { renderer, scene: cityScene, sunDir: style.sunDir, tier, getTier: () => tier, lights: { sun: style.lights[0], fill: style.lights[2] }, veilBuilding: (id, on) => cityView.veilBuilding(id, on) });
warmBoth(() => cinematic.warmup(renderer, views.cityCamera));

// 時間切れの結末（仕様 12 章「時間切れの結末」）: 手の中の球がつぶれて両手が引き込まれ、画面全体で重力レンズが育ち、
// 街、続いて夕焼けの空・雲・夕日・地平線が渦を巻いて飲み込まれ、黒い球と光の輪だけが残って暗転（blackhole.js）
const blackhole = createBlackhole(views, hand, { renderer, scene: cityScene, sky: style.sky, sunDir: style.sunDir, buildings: game.city.buildings, tier, getTier: () => tier });
// 場面はレンダーターゲットへ、ゆがめる段は画面へ描く。どちらも両方の描き先で前もって作る（low の段の街は、ふだん画面へ直接
// 描くのでレンダーターゲット向けがまだ無い。手の場面も同じ）
warmBoth(() => blackhole.warmup());
warmTarget.dispose();
blackhole.on('cue', ({ name }) => {
  if (clipping) return; // R4: 録画の間（と戻す間）の音は録画が段取りする
  if (name === 'collapse') audio.blackholeDrone(BLACKHOLE_DRONE_SEC);
  // 飲み込みが始まると、BGM は音程が下がりながら引き伸ばされ、渦に吸い込まれるように消える（何もない空間の手前で）
  else if (name === 'cut') bgm.stretchOut(blackhole.timeline.stretchSec);
  else if (name === 'void') audio.droneCut(); // 何もない空間は無音
});
// 暗転しきった: 結果（「ブラックホールになった」）。結果画面では同じ旋律をゆっくり静かに
blackhole.on('end', () => { finaleDone = true; bgm.quiet(); });
const shotRng = createRng(seed ^ 0xc1a3e);
const standing = new Set(game.city.buildings.map((b) => b.id)); // まだ壊れていないビル
// 撮る場所の計算を一度空回しして JIT を温めておく（放つ瞬間、両手が玉を握り込む間に止まらないように）。乱数は別のものを使う
{
  const warm = { radius: CONFIG.radius.max };
  // fix4: 屋上の飾り（props: 撮る一人の背後の確かめ）と縦横比（縦長で撮る一人が入るか）も渡し、その道も温める
  planFinale({ shot: warm, rng: createRng(seed ^ 0x5eed), lead: leadFor(warm.radius), buildings: game.city.buildings, enemies: game.enemies.list, props: cityView.roofProps, aspect: views.size.w / Math.max(1, views.size.h) });
}
let finalBlastSize = 0;
const transitObs = game.city.transit ? transitObstacles(game.city.transit) : [];
game.on('cinematicStart', (shot) => {
  takeReplaySnapshot(shot);
  // fix3: 撮る場所（planFinale）は放つ瞬間（両手が玉を握り込む一拍）ではなく、白を描いた次のフレームで決める（重い計算の間、
  // 画面は白のまま）。白の間にゲームは進むので、放つ瞬間の軍勢の写しから決める（どの fps でも同じ答え）。
  // 重い逃げる道の計算はスローでふくらむ間に回す
  // M1: 撮る場所は爆心（shot.centre）を原点として解く（blastFrame.js）。演出は世界へ戻して描く
  const C = shot.centre;
  const buildings = toLocal(game.city.buildings.filter((b) => standing.has(b.id)), C), crater = fronts.crater, lead = leadFor(shot.radius);
  const enemiesAtRelease = toLocal(snapshotEnemies(game.enemies.list), C);
  const props = toLocal(cityView.roofProps.filter((o) => standing.has(o.bid)), C); // 屋上の飾り（撮る一人の背後に飾りがない所を選ぶ）
  finalBlastSize = Math.sqrt(shot.radius / CONFIG.radius.max);
  // 逃げる道は高架の橋桁もよける（S8）
  // fix4: 縦横比は撮る場所を決めるフレームの画面のもの（縦長では撮る一人がまるごと入る横のずれ・左右・レンズを選ぶ）
  cinematic.play(() => planFinale({ shot, rng: shotRng, crater, lead, buildings, enemies: enemiesAtRelease, props, retreat: false, aspect: views.size.w / Math.max(1, views.size.h) }), shot,
    { buildings, enemies: () => game.enemies.list, retreat: () => planRetreat(cinematic.plan, { buildings: [...buildings, ...toLocal(transitObs, C)], crater, radius: shot.radius, lead, city: { x: -C.x, z: -C.z } }) });
});
game.on('cinematicEnd', () => cinematic.end());
// 演出の音の段取り
cinematic.on('cue', ({ name, arg }) => {
  if (name === 'silence') audio.silence();
  else if (name === 'erupt') {
    // 白が晴れて地平で爆発が始まる: 世界の音が戻り、遠い地鳴りが時刻表どおりにふくらみ（スローの間）、弾けて光の壁が届くと最大、
    // 宇宙でこもり、縦一線の光とともに消える
    audio.unsilence();
    audio.finaleRumble(cinematic.timeline);
  } else if (name === 'burst') audio.boom(finalBlastSize, finaleBoomOpts(cinematic.timeline)); // 弾けた瞬間に爆発の音が開く
  else if (name === 'space') audio.muffle(1.4);
  else if (name === 'rumble') audio.deepRumble(cinematic.timeline?.spaceSound ?? 1); // R1i: 宇宙の段の大きさ
});
// 演出が最後まで終わった: そのままリプレイへ（写しがなければ、最後の絵のまま結果を重ねる）
cinematic.on('end', () => {
  bgm.quiet(); // リプレイと結果画面: 同じ旋律をゆっくり静かに（地鳴りの尾の下からふくらむ）
  // 演出が一発より先に終わった（ふつうは起きない）: 一発を最後まで進めて over にする（結果がかならず出る）
  if (game.phase !== 'over') game.settle();
  if (replaySnap) startReplay(); else finaleDone = true;
});

// 光に溶ける対象の見た目の箱（隠す前に色と位置を読む）
function vaporTarget({ hit, target }) {
  const id = Number(hit.id.slice(1));
  if (hit.id[0] === 'b') return { x: target.x, z: target.z, w: target.w, d: target.d, h: target.h, color: cityView.getBuildingColor(id) };
  if (hit.id[0] === 'x' || hit.id[0] === 'r') return { x: target.x, z: target.z, w: Math.min(target.w, target.len), d: Math.min(target.d, target.len), h: target.y, color: [0.42, 0.42, 0.44] };
  const vis = cityView.getPropVisual(id);
  return { x: vis?.x ?? target.x, z: vis?.z ?? target.z, w: 2.6, d: 2.6, h: 2.2, color: vis?.color };
}
// 命中を描く側へ（光に溶ける・つぶれて破片になる）。ゲームの一発とリプレイの一発の両方が使う
function showHit(e) {
  if (e.hit.kind === 'vaporize') explosionView.vaporize(vaporTarget(e));
  destruction.onHit(e);
}
game.on('hit', (e) => {
  if (e.hit.id[0] === 'b') standing.delete(e.target.id);
  // settle が一気に進めた分は、すぐリプレイが街を戻すので描かず、音にもしない
  if (e.settled && replaySnap) return;
  showHit(e);
  hitFeed.gameHit(e, { replayPending: !!replaySnap });
});
// このフレームの命中（瓦礫の崩れる音へ。小爆発（払う）はビルを壊さないので、ここには来ない）
let hitFeed = createHitFeed(); // その場のリトライで作り直す
const burstSeen = new Set();

// S8: 高架で起きたこと（電車が脱線した・溶けた・落ちた）: 溶ける見た目、落ちた車両の破片、崩れる音（画面の出来事の位置から）
function onTransit(events) {
  destruction.onTransit(events);
  for (const e of events) {
    if (e.kind === 'vaporize') explosionView.vaporize(e.target);
    const hit = { hit: { id: e.target.id + e.kind[0], kind: e.kind }, target: e.target };
    if (replay.active) hitFeed.replayHit(hit); else hitFeed.gameHit(hit, { replayPending: !!replaySnap });
  }
}

// ---- リプレイ（仕様 12 章の絵コンテ 6〜7）----
// 最後の一発の直前の街を覚えておき、同じ一発を決まった刻みで起こし直す（同じ種なら同じリプレイ。何度でも見せ直せる）。
// 街の姿（ビルと props の置き場所・つぶれ）は、最後の一発より前には変わらない（小爆発は軍勢だけを払う）ので、
// 起動したときに写しておく（放つ瞬間に写すと、両手が玉を握り込む間に止まる）。念のため、変わっていたら放つ瞬間に写し直す。
// 持ち主 2026-11-23 08:41: その場のリトライは、この起動したときの街（pristineCity。変えない）へ戻す
const pristineCity = cityView.snapshot();
let citySnap = pristineCity;
const _focusAt = [0, 0, 0]; // 手前の物理の焦点（毎フレーム使い回す。destruction は値を写して持つ）
let replaySnap = null; // { shot, targets, enemies, buildings }
let replaySim = null;
function takeReplaySnapshot(shot) {
  const base = standing.size !== game.city.buildings.length ? cityView.snapshot() : citySnap;
  citySnap = { ...base, transit: cityView.transitState() }; // 高速の車と電車は、放った瞬間の位置から（リプレイでも同じ所を走っている）。起動したときの写しは変えない
  replaySnap = {
    shot,
    targets: replayTargets(game.city, shot.centre), // M1: 距離は爆心から
    enemies: game.enemies.list.map((e) => ({ ...e })),
    buildings: game.city.buildings.filter((b) => standing.has(b.id)),
  };
}
const replay = createReplay(views, {
  scene: cityScene,
  lights: { sun: style.lights[0], fill: style.lights[2] },
  fog: style.uniforms.uFogStart,
  blastLight: explosionView.light,
  dust: explosionView.group?.getObjectByName?.('dust') ?? null,
  // 放つ直前へ戻す: 街の姿・破片と瓦礫・爆発の見た目・地面のえぐれ。爆発と軍勢は写しから起こし直す
  onRestore() {
    cityView.restore(citySnap);
    patrolGlow.reset();
    patrolGlow.setSurvivors(null); // 生き残りの目印は、リプレイを最後まで見せてから
    destruction.reset();
    explosionView.reset();
    fronts.reset();
    replaySim = createReplaySim({ shot: replaySnap.shot, targets: replaySnap.targets, enemies: replaySnap.enemies });
    debrisView.update();
    rubbleView.update();
  },
  // 爆発を dt 秒進め、命中を描く側へ渡し、世界をそのカメラで進める
  onTick(dt, cam) {
    for (const e of replaySim.step(dt)) { showHit(e); hitFeed.replayHit(e); } // リプレイでも同じ崩落に音
    stepWorld(dt, replaySim.blasts, replaySim.enemies, cam, cam.position.toArray(_focusAt), 1 - replay.silhouette);
  },
});
replay.warmup(renderer, views.cityCamera);
// 音: リプレイの間は世界の音を鳴らさない（BGM は 'replayStart' で静かな変奏になり、結果画面でもそのまま続く）
replay.on('replayStart', () => { if (clipping) return; replayTag.hidden = false; bgm.quiet(); audio.debrisMode('replay'); }); // R4: 録画の間は録画が段取りする
// S9: 撃退失敗: リプレイの最後は生き残りの引きの絵。その絵と結果の後ろで、生き残りの光が赤と緑に脈打つ。
// 結果（replayEnd）は、その絵が明けきって少し見せてから（replay.js の AFTERMATH_TIMING。タップで先へ飛ばせる）
replay.on('aftermath', () => {
  clipRestored();
  replayTag.hidden = true;
  const o = game.outcome;
  if (o && !o.clear) patrolGlow.setSurvivors(survivorIds(o));
});
replay.on('replayEnd', () => { clipRestored(); replayTag.hidden = true; finaleDone = true; });
replay.on('skip', () => { replayTag.hidden = true; });
function startReplay() {
  if (!replaySnap) return;
  cinematic.stop();
  result.hide();
  if (lastResult) pendingResult = { ...lastResult, wait: RESULT_DELAY };
  finaleDone = false;
  const o = game.outcome;
  replay.play({ shot: replaySnap.shot, buildings: replaySnap.buildings, heroYaw: enemyView.heroYaw, survivors: o && !o.clear ? o.survivors : null });
}
function skipReplay() { replay.skip(); }

// ---- R4（spec §15 爆発の短い縦動画・珍しい結末の短い動画）----
// 結果画面の「動画で共有」: その人の一撃を、リプレイの写し（replaySnap）と演出の時刻表（cinematic.timeline）から描き直して 6〜10 秒の縦動画にする
// （爆発の寄り → 見せ場 → 宇宙 → 縦一線の光。share/clip.js の planClip）。時間切れはブラックホールの結末（planBlackholeClip）。
// 9:16 の大きさ（画質の段の画素、mid / low は 720×1280 まで）で同じ renderer に描き、2D の canvas へ写して文字を重ね、MediaRecorder で録る。
// 音は master の出口の写し（audio.tap）。終わったら（やめても）大きさ・リプレイの最後の絵（暗くして早送り）・ブラックホールの暗転・BGM を元へ戻す
const clipPanel = createClipPanel(document.getElementById('clip'));
const replayArgs = () => { const o = game.outcome; return { shot: replaySnap.shot, buildings: replaySnap.buildings, heroYaw: enemyView.heroYaw, survivors: o && !o.clear ? o.survivors : null }; };
let clipKind = null, clipSparks = null, clipTap = null;
let clipRestoring = false; // fix1（M1）: 録画のあとリプレイを最後の絵へ戻している間（瓦礫の音を黙らせる）
function clipRestored() { if (!clipRestoring) return; clipRestoring = false; audio.debrisMode('replay'); }
const clipHost = {
  get canvas() { return renderer.domElement; },
  begin(kind, size) {
    clipping = true; clipKind = kind;
    bgm.stop(); audio.rumbleStop(); audio.droneCut(); audio.silence();
    renderer.setPixelRatio(1);
    views.resize(size.w, size.h);
    cityView.setCloseView(true);
    if (kind === 'blackhole') {
      blackhole.play(game.hero);
      const plan = planBlackholeClip(blackhole.timeline);
      blackhole.update(plan.segments[0].from);
      return plan;
    }
    replay.play(replayArgs());
    const plan = planClip({ replay: replay.timeline, finale: cinematic.timeline });
    replay.seek(plan.segments[0].from); // 寄りの始まりまで（ふつうの再生と同じ刻み）
    audio.debrisMode('off');
    clipSparks = new Map();
    return plan;
  },
  frame(at) {
    if (at.src === 'replay') {
      replay.seek(at.t, { maxFine: 8 });
      audio.collapse(collapseHits());
      views.renderFull(cityScene, replay.camera, replay.screen);
    } else if (at.src === 'finale') {
      const v = cinematic.spaceShot(at.t, { shot: replaySnap.shot, timeline: cinematic.timeline, enemies: replaySnap.enemies, sparks: clipSparks });
      views.renderFull(v.scene, v.camera, v.screen);
    } else {
      blackhole.update(Math.max(0, at.t - blackhole.time));
      blackhole.draw();
    }
  },
  // 音の合図（音は画面に従う。持ち主 13:06）: 寄りの始まりで世界の音と地鳴り、弾けた瞬間に爆発の音、宇宙でこもる。ブラックホールは唸りと無音
  cue(name, plan) {
    if (name === 'erupt') { audio.unsilence(); audio.debrisMode('replay'); audio.finaleRumble(plan.audio); }
    else if (name === 'burst') audio.boom(Math.sqrt(replaySnap.shot.radius / CONFIG.radius.max), finaleBoomOpts(plan.audio));
    else if (name === 'space') audio.muffle(1.4);
    else if (name === 'drone') audio.blackholeDrone(Math.max(0.5, BLACKHOLE_DRONE_SEC - blackhole.timeline.cut));
    else if (name === 'void') audio.droneCut();
  },
  audioStream() { clipTap = audio.tap(); return clipTap?.stream ?? null; },
  shouldStop: () => document.hidden || pause.paused,
  // fix1（見直し I-1）: どこかが投げても、録画の旗（clipping）は必ず下ろす（ゲームの毎フレーム・入力・大きさの合わせ直しが戻る）
  end() {
    const kind = clipKind;
    try {
      try { clipTap?.release(); } finally { clipTap = null; clipSparks = null; }
      audio.rumbleStop(); audio.droneCut(); audio.silence(); audio.debrisMode('replay');
      applyPixelRatio();
      clipping = false; resize(); clipping = true;
      if (kind === 'blackhole') blackhole.update(blackhole.timeline.end + 0.05 - blackhole.time); // 暗転のまま（結果の後ろ）
      else if (kind === 'blast' && replaySnap) {
        // 結果の後ろの最後の絵へ（暗くして早送り）。fix1（M1）: 早送りの間の瓦礫の音は鳴らさない（画面に出ていない。'aftermath' か 'replayEnd' で戻す）。
        // 撃退失敗の生き残りの光はすぐ戻す（早送りが終わるのを待たない）
        // fix2: 失敗したら瓦礫の音の道を戻してから投げ直す（restoreReplayAfterClip）
        const o = game.outcome;
        clipRestoring = restoreReplayAfterClip({ audio, replay, args: replayArgs(), onSurvivors: o && !o.clear ? () => patrolGlow.setSurvivors(survivorIds(o)) : null });
      }
      bgm.quiet();
    } finally {
      clipping = false; clipKind = null;
      last = performance.now();
    }
  },
};
const clipRec = createClipRecorder(clipHost);
// 動画にできるか: 録画できる端末で、最後の一発（リプレイの写しと演出の時刻表がある）かブラックホールの結末
const canClip = (reason) => clipRec.supported && (reason === 'blackhole' || (!!replaySnap && !!cinematic.timeline));
const debugClipH = debugMode ? Number.parseInt(params.get('cliph') ?? '', 10) : NaN; // 撮影用: 動画の高さを上書き
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
// fix1（見直し I-2・M3・M6・M7）: 押した瞬間（書体の読み込みを待つ前）に二度目を断り、結果画面を押せなくし、知らせを開く（share/clip.js の createClipSession）
const clipSession = createClipSession({
  recorder: clipRec, panel: clipPanel, result, debug: debugMode,
  canClip: (reason) => canClip(reason),
  async prepare({ total, outcome, reason, extra }) {
    const kind = reason === 'blackhole' ? 'blackhole' : 'blast';
    const size = Number.isFinite(debugClipH) && debugClipH >= 160
      ? { w: 2 * Math.floor(debugClipH * 9 / 32), h: 2 * Math.round(debugClipH / 2) }
      : clipSize({ tier, viewW: window.innerWidth, viewH: window.innerHeight, dpr: window.devicePixelRatio || 1 });
    const overlay = clipOverlay(resultContent(total, reason, outcome, extra));
    // 題字は同梱の明朝（「最後の一撃」の字が入っている）。読めなければ太いシステムの字
    let titleFont = null;
    try { await document.fonts.load(`900 40px "${INTRO_FONT}"`, overlay.title); titleFont = document.fonts.check(`900 40px "${INTRO_FONT}"`, overlay.title) ? INTRO_FONT : null; } catch { titleFont = null; }
    return { kind, size, overlay, titleFont };
  },
  share(r, { total, outcome, reason, extra }) {
    const file = new File([r.blob], clipFileName(new Date(), r.ext), { type: r.blob.type });
    const text = shareText(total, outcome, extra?.city ? (extra.city.link ?? null) : null, { reason, city: extra?.city ?? null, titles: extra?.titles ?? [] });
    let canShareFile = false;
    try { canShareFile = typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] }); } catch { canShareFile = false; }
    return { file, text, label: canShareFile ? '共有する' : '保存する' };
  },
  deliver: (file, text) => deliverClip(file, { nav: navigator, text, download: downloadFile, framed: framedPage }),
});
const startClip = (info) => { clipRestored(); return clipSession.start(info); }; // fix2: 遅くとも次の録画の前に瓦礫の音の道を戻す

// ---- その場のリトライ（持ち主 2026-11-23 08:41「リトライ押したら暗い画面に操作説明が出てる」「TAPの文字がかなりデカく出てるのは仕様？」）----
// メニューのリトライと結果の「もう一度」は、ページを読み直さず、同じ街（同じ種）の新しい一回をその場で始める。AudioContext はそのまま
// （音の許可が残るので TAP が要らない）、sessionStorage にもよらない（artifact の iframe で投げても同じ）。導入・題字・遊び方の説明は出さない。
// 新しい一回は、読み直したページの同じ街と同じ（game.restart。軍勢の湧き方・種類・見回り・演出の乱数まで）。最初の押下が溜め。
// 作り直すのは一回ぶんの状態だけで、GPU の形・材質・描き先は作らない（街は起動したときの写し pristineCity へ restore。何度リトライしても増えない）
function restartRound() {
  if (debugMode && debugHooks.failRestart) throw new Error('debug: failRestart'); // 撮影・試し: 控えの読み直しを起こす
  // 演出・リプレイ・結末・結果を閉じる（録画の途中のリトライは requestRetry が断る。見直し Minor 1）
  clipRestoring = false; clipKind = null;
  cinematic.stop(); replay.stop(); blackhole.stop();
  result.hide(); replayTag.hidden = true;
  pendingResult = null; lastResult = null; finaleDone = false;
  replaySnap = null; replaySim = null; finalBlastSize = 0; whiteWarmed = false;
  // 音: 前の一回の音と予約を止める（唸り・吸われる・無音とこもり・地響き・地鳴り・ブラックホールの唸り・爆発・BGM）。BGM は最初の押下で鳴り始める
  audio.resetRound(); bgm.reset();
  timeTicks = createTimeTicks(); hitFeed = createHitFeed(); burstSeen.clear();
  // ゲーム（同じ種の新しい一回。'ready' で、最初の押下で始まる）と、演出の撮る場所の乱数
  game.restart();
  shotRng.reseed();
  standing.clear(); for (const b of game.city.buildings) standing.add(b.id);
  // 街: 粗い箱・爆心なし・起動したときの姿（つぶれ・隠し・高架の車と電車）。破片・瓦礫・地面のえぐれ・爆発の見た目・生き残りの光
  cityView.setDetail('coarse'); cityView.setBlastCentre(null); cityView.restore(pristineCity); citySnap = pristineCity;
  destruction.reset(); destruction.setCentre(null); destruction.setPhysicsFocus(null);
  explosionView.reset(); fronts.reset();
  patrolGlow.reset(); patrolGlow.setSurvivors(null);
  debrisView.update(); rubbleView.update();
  // 主人公と手の見た目、上空カメラ
  enemyView.resetRound(); enemyView.setFocus?.(null); enemyView.setHeroYaw(0); enemyView.setHeroLift(0); enemyView.setHeroLean(0); enemyView.setHeroCrouch(0); enemyView.setHeroHop(0);
  heroMoved = false; liftT = 0;
  hand.reset(); hand.setCollapse(0);
  dashStreak.update(game.hero, 1e3); hideAction.update({ ...game.hero, action: null }, 1e3); // 滑り込みの筋・跳ぶ見た目を消しきる
  guardRing.reset();
  views.resetCamera(game.hero);
  // 入力・HUD・知らせ
  controls.reset(); keysDown.clear(); keyFlick.reset(); puffBuffer.clear();
  lookout = createLookout(); lookoutNow = null;
  drainFx.reset(); drainedSeen = 0; lineKey = NaN;
  hud.clearNotices();
  startHint.hidden = true;
  if (menu.isOpen) menu.close(); // 一時停止を外す（音を戻し、BGM・ゲームが動く）
  last = performance.now();
}
// その場で遊び直す。投げたら（ふつうは起きない）控えとして、同じ街を覚えて導入を飛ばす印を置き、読み直す
// （印は sessionStorage、だめなら URL の #retry。タッチの端末は小さな「タップでスタート」の一行だけ）
function requestRetry() {
  return retryRound({
    busy: () => clipping || clipSession.busy, // 録画の途中は断る（後始末の clipHost.end が新しい一回を無音にしない）
    restart: restartRound,
    onError: (e) => console.error('その場のリトライに失敗したので読み直す', e),
    session, cityPick, rememberRetryCity,
    markRetry: (s) => markRetry(s, retryPage, cityPick.source === 'daily' ? cityPick.key : null), // #retry=<今日の街の鍵>（0 時をまたいでも同じ街）
    reload: () => location.reload(),
  });
}

// 画質の自動調整。ここでは画素比だけを下げる（破片数などの他の値は後の Task が TIERS[tier] から読む）
const governor = createFpsGovernor({ target: isMobile ? 30 : 55 });
function lowerTier() {
  const next = nextTier(tier);
  if (next === tier) return;
  tier = next;
  if (debugMode) window.__tier = tier;
  heroAura.setTier(tier);
  enemyView.setTier(tier);
  cityView.setTier(tier); // 看板のちらつき（low では止める）と明るさ（bloom がなくなる）
  style.tintFigures(enemyView.mesh.material.uniforms, tier); // low へ下がったら推進の光を飽和した緑へ（bloom がなくても緑に読める）
  applyPixelRatio();
  resize();
}

// 地面のえぐれ（爆発が終わっても残る）と、今の球の半径。ビルのつぶれ・地面・破片が同じものを使う
const fronts = createFrontTracker();

// 撮影用に手の画面への入力を固定する（null で実際のゲームの値に戻す）
let handInput = null;

// 今描いている街のカメラ（演出の間は画面全体の演出のカメラ）と、1m を光の粒の画素の大きさへ直す係数
const cityCam = () => (replay.active ? replay.camera : blackhole.fullscreen ? blackhole.camera : cinematic.fullscreen ? cinematic.camera : views.cityCamera);
const fullscreen = () => replay.active || cinematic.fullscreen || blackhole.fullscreen;
const pointScaleFor = (cam) => (fullscreen() ? views.size.h : views.layout.city.h) * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));

// M1: 主人公の体（向き・傾き）と、まわりの力のゆらぎを主人公の位置へ。上空カメラは主人公についていく
let heroMoved = false;
function syncHero() {
  const h = game.hero;
  heroAura.group.position.x = h.x; heroAura.group.position.z = h.z;
  // 放ったあと（演出・リプレイ・結末）は傾けずに浮かぶ
  if (game.phase !== 'playing') { enemyView.setHeroLean(0); return; }
  // 動き出すまでは今までどおりカメラの方を向く。動いたら進む向き（heading は x 軸から z 軸へ → 体の向き yaw は z 軸から x 軸へ）
  if (Math.hypot(h.vx, h.vz) > 0.5) heroMoved = true;
  if (heroMoved) enemyView.setHeroYaw(Math.atan2(Math.cos(h.heading), Math.sin(h.heading)));
  enemyView.setHeroLean(h.lean);
}
// M2: 隠れるの滑り込みの光の筋と、物陰でしゃがむ・足元の影（毎フレーム）
const dashStreak = createDashStreak(cityScene);
// R1f（持ち主 18:14「派手でかっこいいアクション」）: 物陰へ跳ぶ見た目（残像・光の尾・高さ・着地の輪と十字）と着地の音。M2 の筋は跳ぶ動きの間は出さない
const hideAction = createHideAction(cityScene, { heroGeometry: enemyView.heroBody.geometry });
function syncHide(dt) {
  const playing = game.phase === 'playing';
  const fx = hideAction.update(playing ? game.hero : { ...game.hero, action: null }, dt);
  const h = playing ? (game.hero.action ? { ...game.hero, dashing: null } : game.hero) : { ...game.hero, hidden: false, dashing: null };
  enemyView.setHeroCrouch(Math.max(dashStreak.update(h, dt), fx.crouch));
  enemyView.setHeroHop(playing ? fx.y : 0);
  if (fx.landed) audio.hideCue('land', screenCue(game.hero.x, 1, game.hero.z).pan);
}
game.on('hide', () => audio.hideCue('jump', screenCue(game.hero.x, 1, game.hero.z).pan));
// Fix round 1（見直し Important 5）: 払うの守りの輪（守りの間だけ、主人公のまわりの地面）と、弾いた瞬間の脈・音
const guardRing = createGuardRing(cityScene);
const guardCueLimit = createRateLimit(GUARD_CUE_MAX_PER_SEC); // Fix round 3: 弾く音は 1 秒に 6 回まで
game.on('guardHit', (h) => { guardRing.hit(); if (guardCueLimit(performance.now() / 1000)) audio.guardCue(screenCue(h.x, 1, h.z).pan); });
views.follow(game.hero, { snap: true });

// ゲームを gdt 秒進める（一度に進めるのは最大 0.1 秒ずつ。演出は時間を一気に進めることがある）
function stepGame(gdt) {
  let left = gdt;
  do { const d = Math.min(left, 0.1); game.update(d); left -= d; } while (left > 1e-9);
}

// 世界（破片・粉・ビルのつぶれ・爆発の見た目・軍勢・主人公のまわり）を wdt 秒進める。
// live: game.blasts と同じ形の一発の一覧、enemies: 軍勢の一覧、cam: 今描いているカメラ、focus: 手前の物理の焦点（null なら全部プール）
// glowScale: 軍勢と主人公が爆発の光で白く光る強さの倍率（リプレイの最後のカットは影絵にするので 0 へ）
const _frustum = new THREE.Frustum(), _projView = new THREE.Matrix4(), _sph = new THREE.Sphere(), _sphC = new THREE.Vector3(), _shown = [];
function stepWorld(wdt, live, enemies, cam, focus, glowScale = 1) {
  const ps = pointScaleFor(cam);
  destruction.setPhysicsFocus(focus);
  // 小爆発は光の球と軍勢を払うだけで、地面をえぐらず、ビルをゆがめず、破片も押さない（広場が穴に沈まない）
  const shaping = live.some((b) => b.shot.small) ? live.filter((b) => !b.shot.small) : live;
  const list = fronts.update(shaping);
  destruction.pool.setCrater(fronts.crater);
  _frustum.setFromProjectionMatrix(_projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  if (wdt > 0) {
    explosionView.dust(destruction.update(wdt, list));
    // 落ちて止まった大きな破片: 画面に入っているものだけ、瓦礫の崩れる音へ（画面の出来事の場所から。持ち主 23:01）
    for (const p of destruction.lastSettled) if (_frustum.containsPoint(_sphC.fromArray(p.pos))) hitFeed.settleHit(p);
  }
  debrisView.update();
  rubbleView.update();
  explosionView.update(wdt, live, cam, ps, fronts.crater);
  // 最後の一発の前線（高架の電車が触れたら脱線する）
  const big = live.find((b) => !b.shot.small);
  const transitEvents = cityView.update(wdt, { fronts: list, heat: explosionView.ground.heat, ember: explosionView.ground.ember, front: big?.front ?? 0, radius: big?.shot.radius ?? 0 });
  if (transitEvents.length) onTransit(transitEvents);
  // 光が弱まった分だけ、主人公は光を背にした影絵になる（リプレイの最後のカット）
  // 最後の一発の演出・リプレイ・時間切れの結末の間は、上空カメラ用の補助表示（目印・透かし）を出さない
  const aids = !(debugCam || cinematic.active || replay.active || blackhole.active);
  // 街を見回る者（S8）は、今のカメラの画面に入る者だけ描く（遠くの見えないバイクの頂点を描かない）。毎フレーム同じ配列を使う
  _shown.length = 0;
  for (const e of enemies) if (!e.patrol || _frustum.intersectsSphere(_sph.set(_sphC.set(e.x, 3, e.z), 12))) _shown.push(e);
  patrolGlow.update(enemies, { pixelRatio: renderer.getPixelRatio(), dt: wdt, time: performance.now() / 1000, visible: patrolGlowVisible({ overhead: aids, over: game.phase === 'over' }) });
  enemyView.sync(_shown, { fronts: list, pointScale: ps, glow: explosionView.ground.heat * glowScale, dt: wdt, pixelRatio: renderer.getPixelRatio(), silhouette: 1 - glowScale, aids, heroPos: game.enemies.heroPos });
  heroAura.update(wdt, ps, 1 - glowScale);
}

function simulate(dt) {
  if (introFlow.playsIntro) return; // 導入の間はゲームを進めない（描くのは introTick）。リトライの TAP の間は遊ぶ画面を描く（ゲームは 'ready' のまま）
  // TAP START のあと: 主人公が下から浮き上がる
  if (liftT > 0) { liftT = Math.max(0, liftT - dt); enemyView.setHeroLift(heroLiftAt(1 - liftT / HERO_LIFT.sec)); }
  if (replay.active) {
    // リプレイの間: 世界はリプレイの刻みで進む（onTick）。ゲームは終わっている
    replay.update(dt);
    finishFrame(dt, []);
    return;
  }
  // 最後の一発の演出の間は、ゲームの時計（爆発の前線の進み）も、描画側の世界（破片・粉・ビルのつぶれ・爆発の見た目）の時間も、
  // 演出の時刻表が決める（白の間に進め、スローでじわじわふくらみ、弾けた瞬間から現実の速さ）。
  cinematic.update(dt);
  // 時間切れの結末: 演出を先に進める（始まったフレームは進めない）。ゲームは終わっていて、世界と軍勢の見た目だけが動く
  blackhole.update(dt);
  if (replay.active) { finishFrame(dt, []); return; } // 演出が終わってリプレイが始まった（そのフレームは描くだけ）
  const cdt = cinematic.gameDt;
  // M1: 動く向き（スティックか矢印キー・WASD。画面の右 = 世界の +x、画面の下 = 世界の +z。上空カメラは格子にまっすぐ沿って見下ろす）。
  // ゲームは溜めている間だけ動かす
  controls.update(nowSec());
  const stick = controls.stick ? controls.dir : keyVector(keysDown);
  const mv = screenToWorld(stick.x, stick.y, CITY_CAMERA.azimuthDeg);
  game.setMove(mv.x, mv.z);
  if (cdt === null) game.update(dt); else stepGame(cdt);
  syncHero();
  syncHide(dt);
  guardRing.update(dt, game.hero, game.phase === 'playing' ? game.guardLeft : 0, CONFIG.puff.guardSec);
  const wdt = cinematic.active ? cinematic.worldDt : dt;
  explosionView.setBirthScale(cinematic.active ? cinematic.blastBirthScale : 1);
  explosionView.setCoreScale(cinematic.active ? cinematic.blastCoreScale : 1);
  explosionView.setWall(cinematic.active ? cinematic.blastWall : 0); // R0b fix3: 軍勢の後ろのカットの間は不透明な光の壁
  const cam = cityCam();
  const live = game.blasts;
  // 手前の物理は、演出の間は演出のカメラの近くの破片だけ（ふだんは null で全部プール）
  stepWorld(wdt, live, game.enemies.list, cam, cinematic.active ? cam.position.toArray(_focusAt) : null, cinematic.active ? cinematic.glowScale : 1);
  // R0b: 遠くの軍勢の後ろのカットの間は、爆心の光が近くの街まで真っ白に照らさないよう上限を当てる
  if (cinematic.active) explosionView.light.intensity = Math.min(explosionView.light.intensity, cinematic.blastLightCap);
  // 上空カメラは、ゲームが動いている間はいつも進める（演出の終わりにこの姿勢へなじむ）
  // 大きな一発の演出の間は、終わった一発の「保つ」時間を進めない（演出が全体の構図で止まったあと、2画面でも保ってから戻る）
  if (!cinematic.frozen) views.updateCamera(dt, explosionView.cameraInfo, live, cinematic.active);
  finishFrame(dt, live);
}

// 最終レビュー Minor 2: 「遊んでいる間か」の判定を一つに（場面が増えたときの抜けを防ぐ）。
// 全画面の演出（最後の一発の演出・リプレイ・時間切れの結末）の外か
function finaleOff() { return !cinematic.active && !replay.active && !blackhole.active; }
// 遊んでいる間: ゲームが 'playing' で、導入（リトライの TAP も）の間でも、全画面の演出の間でもない
function inPlay() { return game.phase === 'playing' && !introFlow.blocksInput && finaleOff(); }
// 手の画面・HUD・音・結果（毎フレーム）
function finishFrame(dt, live) {
  // 手の中の球の大きさは貯めた力。掴まれている間は、光が弱く不安定に瞬く
  const h = handInput ?? { level: game.power.level, active: game.charge.active, steady: game.grabbing > 0 ? GRABBED_STEADY : 1 };
  const drain = updateDrain(dt);
  hand.setDrain(drain);
  hand.update(dt, h.level, h.active, h.steady);
  const stickNow = inPlay() ? controls.stick : null;
  // M1: 浮かぶジョイスティック（遊んでいる間だけ）。M2: 輪の外側に近くの軍勢の向きの印（スティックが出ている間だけ数える）。
  // R1e: 印の輪は約 1.5 倍、画面の端では同じ中心のまま小さく（joystick.radius）。払うの点はその輪の印の上
  joystick.update(stickNow, stickNow ? stickMarks(game.hero, game.enemies.list, { azimuthDeg: CITY_CAMERA.azimuthDeg }) : null, { w: innerWidth, h: innerHeight });
  // R2: 届く範囲の輪と「届かない軍勢 あと N 体」（勝ち負けと同じ数え方。遊んでいる間の上空の画面だけ）
  const reach = inPlay() ? reachNow(game) : null;
  const ring = reachRing.update({ hero: game.hero, radius: reach?.radius ?? 0, left: reach?.left ?? 0, visible: !!reach && (!debugCam || debugRing), dt, camera: debugCam ?? views.cityCamera, viewPx: debugCam ? views.size.h : views.layout.city.h });
  hud.update({ remaining: game.timer.remaining, power: game.power.value, max: CONFIG.power.max, alive: game.aliveCount, drain, dt, hero: game.hero, line: clearLine(), puffs: game.puffsLeft, stick: stickNow, stickR: joystick.radius + 12, reach: reach?.left ?? null, edge: reach && !debugCam && ring.offscreen ? { on: true, pulse: ring.pulse, ready: ring.ready } : null });
  // R1f: 覚えておいた払う（前の払うが広がり終わったら）
  if (game.phase === 'playing' && controls.charging) { if (puffBuffer.take(nowSec(), game.canPuff)) game.puff(); } else puffBuffer.clear();
  // R1e（持ち主 16:55）: LOOK OUT!（遊んでいる間だけ。危ないかの確かめは lookout.checkEvery 秒ごと）
  const lo = inPlay() && !debugCam
    ? lookout.update(dt, { hero: game.hero, enemies: game.enemies.list, buildings: game.city.buildings, hideBlock: game.hideBlock, azimuthDeg: CITY_CAMERA.azimuthDeg })
    : null;
  lookoutNow = lo?.show ? { show: true, spot: lo.spot ? { ...lo.spot } : null, deg: lo.deg } : null;
  lookoutView.update(lo, lo?.show ? screenCue(game.hero.x, 1.2, game.hero.z) : null);
  // R1f fix1: 物陰にいる間の「かくれ中」と残りの輪
  const hm = inPlay() && !debugCam ? hideMarkState({ hero: game.hero, hideLeft: game.hideLeft, holdSec: CONFIG.hide.holdSec, warn: !!lo?.coverWarn }) : { show: false, p: 0 };
  hideMark.update(hm, hm.show ? screenCue(game.hero.x, 1.2, game.hero.z) : null);
  // 最後の一発を放ってから結果までずっと HUD は出さない（両手が玉を握り込む間も、リプレイの間も）
  hud.setVisible(!debugCam && !introFlow.blocksInput && finaleOff()); // C1: リトライの TAP の間も出さない
  updateAudio(live, dt);
  updateResult(dt);
}

// M1: 撃退ライン（力の %）は、今の主人公の所で放ったときに街じゅうの軍勢へ届く力（中心から離れるほど上がる。1 m ごとに求め直す）
let lineKey = NaN, lineVal = hud.threshold;
function clearLine() {
  const d = Math.round(Math.hypot(game.hero.x, game.hero.z));
  if (d !== lineKey) { lineKey = d; lineVal = clearThreshold(CONFIG, maxEnemyReachFrom(CONFIG, d)); }
  return lineVal;
}
// 吸われている間の知らせ（遊んでいる間だけ）。左右は掴んでいる者の今の画面の位置から、吸う力の重みで（音は画面に従う）
const _grabPans = [];
function updateDrain(dt) {
  const total = game.drainedTotal, drained = total - drainedSeen;
  drainedSeen = total;
  const live = inPlay() && !debugCam;
  _grabPans.length = 0;
  if (live && game.enemies.drainLoad > 0) {
    for (const e of game.enemies.list) if (e.state === 'grab') _grabPans.push({ pan: screenCue(e.x, 2, e.z).pan, w: drainMulOf(e) });
  }
  return drainFx.update(dt, { load: live ? game.enemies.drainLoad : 0, drained: live ? drained : 0, grabbers: _grabPans });
}

// 音: 貯めの唸り、じわじわ期の脈動、弾けた瞬間の爆発、崩落
const _camV = new THREE.Vector3(), _camXZ = { x: 0, z: 0 };
let _transitCam = null;
// 音源の位置を今のカメラの空間へ（毎フレーム同じ関数と同じ物を使う。transitMix は値を読むだけ）
const transitToCam = (p) => { _camV.set(p.x, p.y ?? 0, p.z).applyMatrix4(_transitCam.matrixWorldInverse); _camXZ.x = _camV.x; _camXZ.z = _camV.z; return _camXZ; };
function updateAudio(live, dt = 0) {
  audio.chargeHum(game.charge.active && !game.chargeHeld ? game.power.level : 0); // 持ち主 19:50: 掴まれて貯まらない間は唸らない（吸われる音だけ）
  audio.drain(drainFx.state); // 吸われる音（はがれたらその場で止まる）
  // 電車と高速（S8）: 今の画面のカメラから見た一番近い車両・高速の点の距離と左右。演出・リプレイ・結末の間は鳴らさない
  if (cityView.transit && finaleOff() && audio.running) {
    const cam = cityCam();
    cam.updateMatrixWorld();
    const src = cityView.transit.sources(cam.position);
    _transitCam = cam;
    audio.transit(transitMix(src, transitToCam), dt);
  } else audio.transit(null, dt);
  // BGM: 最初のタップで鳴らせるようになり、遊びが始まったら鳴らしはじめる（一度だけ）。その前のフレームで楽器の音を作っておく
  if (bgm.state === 'off') bgm.prepare();
  if (game.phase === 'playing' && audio.running) bgm.start();
  bgm.update({ elapsed: CONFIG.roundSeconds - game.timer.remaining, power: game.power.level, holding: game.charge.active });
  for (const n of timeTicks.update(game.timer.remaining, inPlay())) audio.timeTick(n);
  // リプレイの間は世界の音を鳴らさない（瓦礫の崩れる音だけは、同じ崩落に合わせて鳴らす）
  if (replay.active) {
    audio.rumble(0);
    audio.collapse(collapseHits());
    return;
  }
  // 最後の一発の音は演出が段取りする（cue）。瓦礫の崩れる音は時間が戻ったあと（宇宙ではこもって）鳴る
  if (cinematic.active) {
    audio.rumble(0);
    for (const b of live) burstSeen.add(b.id);
    audio.collapse(collapseHits(cinematic.stage));
    return;
  }
  let creep = 0;
  for (const b of live) {
    const k = Math.sqrt(b.shot.radius / CONFIG.radius.max);
    if (b.front >= CONFIG.blast.creepFrac * b.shot.radius) {
      if (!burstSeen.has(b.id)) { burstSeen.add(b.id); audio.boom(k); }
    } else creep = Math.max(creep, k);
  }
  audio.rumble(creep);
  audio.collapse(collapseHits()); // ためた命中も、間隔が空いたら鳴らす
}
// このフレームの命中を、今のカメラから見た大きさ・近さ・左右へ（使ったら空にする）。stage: 演出の段（hitFeed が鳴らす段を選ぶ）
const _hitV = new THREE.Vector3();
function collapseHits(stage = null) {
  if (!hitFeed.pending) return [];
  const cam = cityCam();
  cam.updateMatrixWorld();
  return hitFeed.drain((t) => {
    _hitV.set(t.x, (t.h ?? 3) * 0.5, t.z);
    const dist = _hitV.distanceTo(cam.position);
    _hitV.applyMatrix4(cam.matrixWorldInverse);
    return { camX: _hitV.x, camZ: _hitV.z, dist };
  }, { stage });
}
// 白の間の最初のフレームで、そのあとの画面全体の描画を温める（白から街への切り替わりで止まらない）
let whiteWarmed = false;
let debugCam = null; // 撮影用（?debug の __debug.look）: 画面全体を決まったカメラで描く
let debugRing = false; // 撮影用（__debug.ringInLook）: 決まったカメラでも届く範囲の輪を描く（遠くから輪の全体を撮る）
function draw() {
  if (introFlow.playsIntro) return; // 導入の間の絵は introTick が描く
  // mid / low: 壁と道の細かい飾りは、近いカメラ（演出の全画面・リプレイ・結末）のときだけ描く
  cityView.setCloseView(!!debugCam || blackhole.active || replay.active || cinematic.white || cinematic.fullscreen);
  if (!cinematic.white) whiteWarmed = false;
  if (debugCam) views.renderFull(cityScene, debugCam, explosionView.screen);
  else if (blackhole.active) blackhole.draw();
  else if (replay.active) views.renderFull(cityScene, replay.camera, replay.screen);
  else if (cinematic.white) {
    views.renderWhite(whiteWarmed ? null : { scene: cinematic.renderScene ?? cityScene, camera: cinematic.camera, fx: cinematic.screen });
    whiteWarmed = true;
  } else if (cinematic.fullscreen) views.renderFull(cinematic.renderScene ?? cityScene, cinematic.camera, cinematic.screen);
  else views.render(cityScene, hand.scene, cinematic.screen ?? explosionView.screen, hand.camera);
}

let last = performance.now();
let paused = false;
let firstFrameMs = null; // ページを開いてから最初のフレームを描き終えるまで（ms。計測用）
// 最初のフレームのあと: 主人公の細かい体 → 演出の一人の体の順に、手の空いた時間に区切り 1 つずつ組み立てる（bodyPrep）
function onFirstFrame() { bodyPrep.startIdle(); }
function frame(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_FRAME_DT);
  last = now;
  // R4: 録画の間は、録画（share/clip.js）が自分で描く。ゲームの毎フレームは止める
  if (!paused && !clipping) {
    // R1f: メニューを出せるか（遊んでいる間・演出の間）
    menu.setAvailable(menuAvailable());
    // R1f: 一時停止（メニュー・タブの切り替え）の間は進めず、今の絵を描くだけ
    if (!pause.paused) {
      // 画質の自動調整は遊んでいる間だけ（TAP の画面・導入・題字の重いフレームで段を下げない。段は下がるだけ）
      if (governor.sample(dt, !introFlow.blocksInput) === 'down') lowerTier();
      if (introFlow.blocksInput) introTick(dt);
      simulate(dt);
    }
    draw();
  }
  if (firstFrameMs === null) { firstFrameMs = performance.now(); onFirstFrame(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 撮影スクリプト用: 実時間を止め、決まった dt で進めてから描く（ヘッドレスは実時間より遅いため）
const debugHooks = {
  failRestart: false, // 撮影・試し: true でその場のリトライを投げさせる（控えの読み直し）
  retry() { return requestRetry(); }, // メニューのリトライと同じ
  pause() { paused = true; },
  resume() { paused = false; last = performance.now(); },
  // sec 秒ぶん dt 刻みで進め、最後に1回描く。1フレームあたりの JS の時間（ms、描画は最後の1回）を返す
  step(sec, dt = 1 / 60) {
    const n = Math.max(1, Math.round(sec / dt));
    const t0 = performance.now();
    for (let i = 0; i < n; i++) simulate(dt);
    const t1 = performance.now();
    draw();
    return { simMs: (t1 - t0) / n, drawMs: performance.now() - t1 };
  },
  draw,
  // 導入（S6）: 時刻 t（導入の秒）の絵を描く（撮影・録画。音は鳴らさない）。gate なら導入へ進める
  introSeek(t) {
    if (!introFlow.playsIntro) return null;
    if (introFlow.state === 'gate') overlay.showGate(false);
    introFlow.seek(t);
    const b = renderIntroAt(introFlow.time, { force: true, alive: t });
    return { state: introFlow.state, beat: b.name, local: +b.local.toFixed(3), total: introFlow.timeline.total };
  },
  get introFlow() { return introFlow; },
  // 導入の音（調べる用）: 音の時計の段（wait・audio・dt・done）、AudioContext の状態、導入の音の出口の今の最大の振れ幅
  get introClock() { return { mode: introClock.mode, t0: introClock.t0, ctx: audio.introOutput?.ctx.state ?? 'none', ctxTime: audio.introOutput?.ctx.currentTime ?? null }; },
  introPeak() {
    const an = audio.introAnalyser();
    if (!an) return 0;
    const d = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(d);
    let p = 0;
    for (const x of d) p = Math.max(p, Math.abs(x));
    return p;
  },
  // 導入の音を書き出す（録画用）。16 bit の WAV を base64 で返す
  async introAudio(sampleRate = 48000) {
    const r = await renderIntroAudio(introFlow.timeline, { sampleRate });
    const n = r.left.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true);
    v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, r.left[i])) * 32767, true);
      v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r.right[i])) * 32767, true);
    }
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { wav: btoa(bin), peak: r.peak, rawPeak: r.rawPeak, seconds: n / sampleRate };
  },
  // 画面全体を決まったカメラで描く（撮影用）: { pos: [x, y, z], look: [x, y, z], fov }。null で戻す
  look(o) {
    if (!o) { debugCam = null; return; }
    debugCam = new THREE.PerspectiveCamera(o.fov ?? 60, views.size.w / Math.max(1, views.size.h), 1, 6000);
    debugCam.position.fromArray(o.pos);
    debugCam.lookAt(new THREE.Vector3().fromArray(o.look));
    debugCam.updateMatrixWorld();
  },
  // R4: 縦動画を録る（撮影用。結果画面の「動画で共有」と同じ）。戻り値 { ok, type, bytes, ms, plan } と、__debug.clipData() で base64
  async clip() {
    if (!lastResult) return { ok: false, why: 'no result' };
    const t0 = performance.now();
    const { total, reason, outcome, extra } = lastResult;
    const r = await startClip({ total, reason, outcome, extra });
    if (r === null) return { ok: false, why: 'busy' };
    return { ok: !!r?.blob, why: r?.error ? String(r.error?.message ?? r.error) : r?.cancelled ? 'cancelled' : null, type: r?.blob?.type ?? null, mime: r?.mimeType ?? null, bytes: r?.blob?.size ?? 0, ms: performance.now() - t0, total: r?.plan?.total ?? null, segments: r?.plan?.segments ?? null };
  },
  async clipData() {
    const clipLast = clipSession.last;
    if (!clipLast?.blob) return null;
    const bytes = new Uint8Array(await clipLast.blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  get clipSupported() { return clipRec.supported; },
  // R2: 決まったカメラ（look）でも届く範囲の輪を描く（撮影用）
  ringInLook(on) { debugRing = !!on; },
  // 手の画面の入力を固定する: { level, active, steady }（steady は光の安定 0〜1）。null で戻す
  hand(input) { handInput = input ? { level: 0, active: false, steady: 1, ...input } : null; },
  // 手の画面だけに、放つ瞬間を起こす（shot = { amount, isBig }。isBig でなければ小爆発）
  handRelease(shot) { hand.release(shot); },
  // 実際のフレームと同じく毎フレーム進めて描いたときの時間 (ms)。
  // js: simulate+draw の JS の時間, sim: そのうち simulate の時間, gpu: 前のフレームの描画が終わるのを待った時間。
  // gl.finish だけでは Chrome は描画の完了を待ち切らず、ソフトウェア描画の遅れが次のフレームの JS に混ざる。
  // そこで 1 画素を読み出して、本当に完了するまで待ってから測る。
  timeFrames(count, dt = 1 / 60) {
    const js = [], sim = [], gpu = [];
    const gl = renderer.getContext(), px = new Uint8Array(4);
    for (let i = 0; i < count; i++) {
      const g0 = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      gpu.push(t0 - g0);
      simulate(dt);
      const t1 = performance.now();
      draw();
      js.push(performance.now() - t0);
      sim.push(t1 - t0);
    }
    return { js, sim, gpu };
  },
};

// 撮影スクリプトや調査用（?debug のときだけ）
if (debugMode) {
  window.__debug = debugHooks;
  window.__game = game;
  window.__city = { ...cityPick, ...cityInfo }; // R3: どの街か（撮影で確かめる）
  window.__tier = tier;
  window.__cityView = cityView;
  window.__renderer = renderer; // 描画の回数・三角形の数を測る（renderer.info）
  window.__destruction = destruction;
  window.__explosionView = explosionView;
  window.__views = views;
  window.__hand = hand;
  window.__enemyView = enemyView;
  window.__patrolGlow = patrolGlow;
  window.__controls = controls; // M1: 撮影で指の操作を起こす（down / move / up / update）
  window.__lookout = lookout; // R1e: 撮影で LOOK OUT! の確かめた回数を見る
  window.__lookoutTarget = () => lookoutView.target; // R1f: 撮影で矢印の当たりの丸 { cx, cy, r } を見る
  window.__reachRing = reachRing; // R2: 撮影で届く範囲の輪の状態を見る
  Object.defineProperty(window, '__firstFrameMs', { get: () => firstFrameMs });
  window.__cinematic = cinematic;
  window.__replay = replay;
  window.__blackhole = blackhole;
  window.__bgm = bgm;
  window.__intro = intro;
  window.__audio = audio; // その場のリトライ: AudioContext が running のままか（撮影で確かめる）
  window.__pristineCity = pristineCity; // その場のリトライ: 戻す先の街の写し（撮影で確かめる）
  window.__bgmState = () => bgm.state;
}
