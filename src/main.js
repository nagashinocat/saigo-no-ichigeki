import * as THREE from 'three';
import { createGame } from './game/game.js';
import { TIERS, pickTier, nextTier, createFpsGovernor } from './render/quality.js';
import { createViews } from './render/views.js';
import { createHandView } from './render/handView.js';
import { buildHandModel } from './render/handModel.js';
import { CONFIG } from './config.js';
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
import { createCinematic, leadFor } from './render/cinematic.js';
import { FINALE } from './render/finaleTimeline.js';
import { planFinale, planRetreat } from './render/finalePlan.js';
import { createReplay } from './render/replay.js';
import { createBlackhole } from './render/blackhole.js';
import { createReplaySim, replayTargets } from './game/replaySim.js';
import { createRng } from './rng.js';
import { createPressTracker } from './input/press.js';
import { createHud } from './ui/hud.js';
import { createResult } from './ui/result.js';
import { createAudio, finaleBoomOpts } from './audio/audio.js';
import { createHitFeed } from './audio/hitFeed.js';
import { transitObstacles } from './world/transit.js';
import { transitMix } from './audio/transitSound.js';
import { createPatrolGlow, patrolGlowVisible } from './render/patrolGlow.js';
import { createBgm } from './audio/bgm.js';

const MAX_FRAME_DT = 0.1;
const GRABBED_STEADY = 0.15; // 掴まれている間の手の画面の光の安定（弱く瞬く）

const params = new URLSearchParams(location.search);
// 撮影・計測用のフック（window.__debug など）は URL に ?debug があるときだけ公開する
const debugMode = params.has('debug');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : Math.floor(Math.random() * 2 ** 31);
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches;
const tierParam = params.get('tier');
let tier = tierParam in TIERS ? tierParam : pickTier({ isMobile, deviceMemory: navigator.deviceMemory, cores: navigator.hardwareConcurrency });

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'high', stencil: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = TIERS[tier].shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;

const applyPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[tier].pixelRatioMax));
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
// 最後の一発の肩越しのカットで大きく映る軍勢の一人の体（riderBody.js）。主人公の細かい体のあと、手の空いた時間に組み立てる
// （low の段は粗い格子）。遅くとも最後の一発を放つときまでに組み立てて渡す
const riderBuilder = createRiderBodyBuilder({ detail: tier });

// 入力・HUD・結果・音
const audio = createAudio();
// BGM（打楽器とマリンバの民族音楽風）: 遊びが始まると鳴り、時間と貯めた力で層が増え、放った瞬間に止まる。
// リプレイと結果画面では同じ旋律をゆっくり静かに。時間切れ（ブラックホール）では引き伸ばされて消える
const bgm = createBgm(() => audio.bgmOutput);
// 小爆発のボタン（長押しの指とは別の指で押す）。ボタンの上の押下はボタンだけが受け、キャンバスの長押しにはならない
const hud = createHud(document.getElementById('hud'), { onPuff() { game.puff(); } });
const startHint = document.getElementById('start');
const result = createResult(document.getElementById('result'), {
  // 壊れた街や地面のえぐれは作り直せないので、新しい種でページを読み直す
  onRetry() {
    const q = new URLSearchParams(location.search);
    q.set('seed', String(Math.floor(Math.random() * 2 ** 31)));
    location.search = q.toString();
  },
  // 最後の一発をもう一度見る（放つ直前の街へ戻して起こし直す。何度でも同じリプレイ）
  onReplay() { startReplay(); },
});
const replayTag = document.getElementById('replay');
const press = createPressTracker({
  onStart() { startHint.hidden = true; game.pressStart(); },
  onEnd() { game.pressEnd(); },
  // 離していないのに押下が途切れた（pointercancel・キャプチャが外れた・タブを隠した・blur）: 放たずに打ち切る
  onCancel() { game.pressCancel(); },
});
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // リプレイの間は、画面のタップで飛ばして結果へ
  if (replay.active && !replay.finished) { skipReplay(); return; }
  // キャプチャに失敗しても（もう離した指・一部のブラウザ）押下は始める
  try { canvas.setPointerCapture?.(e.pointerId); } catch { /* キャプチャなしで続ける */ }
  press.down(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => press.up(e.pointerId));
canvas.addEventListener('pointercancel', (e) => press.cancel(e.pointerId));
// キャプチャが外れたら押下を打ち切る（離した後に来る分は何もしない。放つのは pointerup だけ）
canvas.addEventListener('lostpointercapture', (e) => press.cancel(e.pointerId));
window.addEventListener('blur', () => press.reset());
// PC はマウスで長押ししながら、もう片方の手の Space キーで小爆発
window.addEventListener('keydown', (e) => {
  // リプレイの間は Space / Enter / Esc で飛ばす
  if (replay.active && !replay.finished && ['Space', 'Enter', 'Escape'].includes(e.code)) { e.preventDefault(); skipReplay(); return; }
  // 結果画面では奪わない（ボタンを Space で押せる）
  if (e.code !== 'Space' || game.phase === 'over') return;
  e.preventDefault();
  if (!e.repeat) game.puff();
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
// iOS では最初の1回で running にならないことがあるので、鳴らせるまで毎回呼ぶ
window.addEventListener('pointerdown', () => { if (!audio.running) audio.unlock(); }, { capture: true });
document.addEventListener('visibilitychange', () => {
  // 隠れる前に押下を打ち切る（放たず、貯めた力は残る。戻ってきたとき指が引っかかったままにならない）
  if (document.hidden) press.reset();
  game.setHidden(document.hidden);
  if (document.hidden) { bgm.pause(); audio.suspend(); } else { audio.resume(); bgm.resume(); }
});
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
  pendingResult = { reason, total, outcome, wait: RESULT_DELAY };
  // リプレイが無いとき（ふつうは無い）は、終わった街の上空で生き残りの光を脈打たせる
  if (outcome && !outcome.clear && !replaySnap) patrolGlow.setSurvivors(survivorIds(outcome));
  // 時間切れ: 主人公がブラックホールになり、すべてを飲み込む（BGM と唸りの段取りは演出の cue）
  if (reason === 'blackhole') { finaleDone = false; blackhole.play(); }
});
function updateResult(dt) {
  if (!pendingResult || (!finaleDone && (cinematic.active || replay.active || blackhole.active))) return;
  pendingResult.wait -= dt;
  if (pendingResult.wait > 0) return;
  result.show(pendingResult.total, pendingResult.reason, pendingResult.outcome, { replay: !!replaySnap });
  lastResult = pendingResult;
  pendingResult = null;
}

const views = createViews(renderer, () => TIERS[tier]);
// CSS で決まったキャンバスの実寸に合わせる（スマホのアドレスバーで 100vh がずれる問題を避ける）
const resize = () => {
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
// 最後の一発: 放つ瞬間から、時間が戻るまで世界の音は消える（鳴るのは心臓の鼓動だけ。音の段取りは演出が cue で知らせる）
game.on('shot', (shot) => {
  bgm.stop(); // 放った瞬間にぴたりと止める（演出の無音・鼓動・爆音のため）
  cityView.setDetail('fine'); // ビルを球の線に沿って曲がる細かい箱へ（遊んでいる間は粗い箱）
  explosionView.begin(shot); hand.release(shot);
});
// 小爆発: 両手が玉を鷲掴みに押さえ込んで弾け、主人公のまわりに小さな光の球（貯めの唸りは止めない）
// 足りずに離した: 放たず、両手がびくっと震え、ひとこと知らせる
game.on('fizzle', () => { hand.fizzle(); hud.hint('まだ足りない。もっと貯めてから離して'); });
game.on('puff', (shot) => { explosionView.begin(shot); hand.release(shot); });

// 軍勢と主人公の姿
const enemyView = createEnemyView(cityScene, tier, { sunDir: style.sunDir, heroBody });
// 軍勢・主人公の陰影と推進の光を、暗めの夕方の光に合わせる（材質どうしで共有している uniform の値を書き換える）
style.tintFigures(enemyView.mesh.material.uniforms);
// 細かい主人公の体は、遅くとも最後の一発を放つとき（と時間切れのとき）までに差し替える（まだなら残りをここで一度に組み立てる）。
// 演出・リプレイ・時間切れの結末で近くに映る主人公は、かならず画質の段の体になる
function ensureHeroBody() {
  if (heroBuilder && enemyView.heroBody !== heroBuilder.finish()) enemyView.setHeroBody(heroBuilder.body);
}
game.on('shot', ensureHeroBody);
game.on('shot', () => { if (enemyView.focusMesh?.geometry !== riderBuilder.finish().geometry) enemyView.setRiderBody(riderBuilder.body); });
game.on('over', ensureHeroBody);
// 街を見回る軍勢の光の点と、光の壁に飲まれた瞬間の火花（fix1。遠くの地区の軍勢も読める）
// S9: 撃退失敗の生き残りは、探す者も同じ点で目印にする（その分の余り）
const patrolGlow = createPatrolGlow(CONFIG.enemy.patrol.count, tier, { extra: 256 });
const survivorIds = (outcome) => new Set(outcome.survivors.map((s) => s.id));
cityScene.add(patrolGlow.points);
const heroAura = createHeroAura(tier); // 浮いている主人公のまわりの力のゆらぎ
cityScene.add(heroAura.group);

// 最後の一発の演出（画面全体、仕様 12 章の絵コンテ 1〜5）: 白 → 軍勢の一人の肩越しのガラスの一拍（飛んでくるガラスに映った目と
// 目が合う）→ 時間が戻りその一人が飲まれる → 弾ける爆発から逃げる → 宇宙から見た光の半球と衝撃波の輪 → 横一線の光 → 無音と地鳴り（cinematic.js）
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
  planFinale({ shot: warm, rng: createRng(seed ^ 0x5eed), lead: leadFor(warm.radius), buildings: game.city.buildings, enemies: game.enemies.list });
}
let finalBlastSize = 0;
const transitObs = game.city.transit ? transitObstacles(game.city.transit) : [];
game.on('cinematicStart', (shot) => {
  takeReplaySnapshot(shot);
  // 放つ瞬間は撮る場所だけを決め、重い逃げる道の計算は演出の止まった一拍の間に回す（必要になるのは約 4 秒後）
  const buildings = game.city.buildings.filter((b) => standing.has(b.id)), crater = fronts.crater, lead = leadFor(shot.radius);
  const plan = planFinale({ shot, rng: shotRng, crater, lead, buildings, enemies: game.enemies.list, retreat: false });
  finalBlastSize = Math.sqrt(shot.radius / CONFIG.radius.max);
  // 逃げる道は高架の橋桁もよける（S8）
  cinematic.play(plan, shot, { buildings, enemies: () => game.enemies.list, retreat: () => planRetreat(plan, { buildings: [...buildings, ...transitObs], crater, radius: shot.radius, lead }) });
});
game.on('cinematicEnd', () => cinematic.end());
// 演出の音の段取り
cinematic.on('cue', ({ name, arg }) => {
  if (name === 'silence') audio.silence();
  else if (name === 'heart') audio.heartbeat(arg);
  else if (name === 'snap') {
    audio.unsilence();
    audio.boom(finalBlastSize, finaleBoomOpts(cinematic.timeline, FINALE.burstRamp));
    audio.finaleRumble(cinematic.timeline); // 地響き: 時刻表どおりにふくらみ、宇宙でこもり、横一線の光とともに消える
  }
  else if (name === 'space') audio.muffle(1.4);
  else if (name === 'rumble') audio.deepRumble();
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
const hitFeed = createHitFeed();
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
let citySnap = cityView.snapshot();
let replaySnap = null; // { shot, targets, enemies, buildings }
let replaySim = null;
function takeReplaySnapshot(shot) {
  if (standing.size !== game.city.buildings.length) citySnap = cityView.snapshot();
  citySnap.transit = cityView.transitState(); // 高速の車と電車は、放った瞬間の位置から（リプレイでも同じ所を走っている）
  replaySnap = {
    shot,
    targets: replayTargets(game.city),
    enemies: game.enemies.list.map((e) => ({ ...e })),
    buildings: game.city.buildings.filter((b) => standing.has(b.id)),
  };
}
const replay = createReplay(views, {
  scene: cityScene,
  lights: { sun: style.lights[0], fill: style.lights[2] },
  fog: style.uniforms.uFogStart,
  blastLight: explosionView.light,
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
    stepWorld(dt, replaySim.blasts, replaySim.enemies, cam, cam.position.toArray(), 1 - replay.silhouette);
  },
});
replay.warmup(renderer, views.cityCamera);
// 音: リプレイの間は世界の音を鳴らさない（BGM は 'replayStart' で静かな変奏になり、結果画面でもそのまま続く）
replay.on('replayStart', () => { replayTag.hidden = false; bgm.quiet(); audio.debrisMode('replay'); });
// S9: 撃退失敗: リプレイの最後は生き残りの引きの絵。その絵と結果の後ろで、生き残りの光が赤と緑に脈打つ。
// 結果（replayEnd）は、その絵が明けきって少し見せてから（replay.js の AFTERMATH_TIMING。タップで先へ飛ばせる）
replay.on('aftermath', () => {
  replayTag.hidden = true;
  const o = game.outcome;
  if (o && !o.clear) patrolGlow.setSurvivors(survivorIds(o));
});
replay.on('replayEnd', () => { replayTag.hidden = true; finaleDone = true; });
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
  if (wdt > 0) explosionView.dust(destruction.update(wdt, list));
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
  _frustum.setFromProjectionMatrix(_projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  _shown.length = 0;
  for (const e of enemies) if (!e.patrol || _frustum.intersectsSphere(_sph.set(_sphC.set(e.x, 3, e.z), 12))) _shown.push(e);
  patrolGlow.update(enemies, { pixelRatio: renderer.getPixelRatio(), dt: wdt, time: performance.now() / 1000, visible: patrolGlowVisible({ overhead: aids, over: game.phase === 'over' }) });
  enemyView.sync(_shown, { fronts: list, pointScale: ps, glow: explosionView.ground.heat * glowScale, dt: wdt, pixelRatio: renderer.getPixelRatio(), silhouette: 1 - glowScale, aids });
  heroAura.update(wdt, ps, 1 - glowScale);
}

function simulate(dt) {
  if (replay.active) {
    // リプレイの間: 世界はリプレイの刻みで進む（onTick）。ゲームは終わっている
    replay.update(dt);
    finishFrame(dt, []);
    return;
  }
  // 最後の一発の演出の間は、ゲームの時計（爆発の前線の進み）も、描画側の世界（破片・粉・ビルのつぶれ・爆発の見た目）の時間も、
  // 演出の時刻表が決める（白の間に進め、体感時間の一拍の間はほとんど止め、時間が戻ると一気に弾ける）。
  cinematic.update(dt);
  // 時間切れの結末: 演出を先に進める（始まったフレームは進めない）。ゲームは終わっていて、世界と軍勢の見た目だけが動く
  blackhole.update(dt);
  if (replay.active) { finishFrame(dt, []); return; } // 演出が終わってリプレイが始まった（そのフレームは描くだけ）
  const cdt = cinematic.gameDt;
  if (cdt === null) game.update(dt); else stepGame(cdt);
  const wdt = cinematic.active ? cinematic.worldDt : dt;
  const cam = cityCam();
  const live = game.blasts;
  // 手前の物理は、演出の間は演出のカメラの近くの破片だけ（ふだんは null で全部プール）
  stepWorld(wdt, live, game.enemies.list, cam, cinematic.active ? cam.position.toArray() : null);
  // 上空カメラは、ゲームが動いている間はいつも進める（演出の終わりにこの姿勢へなじむ）
  // 大きな一発の演出の間は、終わった一発の「保つ」時間を進めない（演出が全体の構図で止まったあと、2画面でも保ってから戻る）
  if (!cinematic.frozen) views.updateCamera(dt, explosionView.cameraInfo, live, cinematic.active);
  finishFrame(dt, live);
}

// 手の画面・HUD・音・結果（毎フレーム）
function finishFrame(dt, live) {
  // 手の中の球の大きさは貯めた力。掴まれている間は、光が弱く不安定に瞬く
  const h = handInput ?? { level: game.power.level, active: game.charge.active, steady: game.grabbing > 0 ? GRABBED_STEADY : 1 };
  hand.update(dt, h.level, h.active, h.steady);
  hud.update({ remaining: game.timer.remaining, power: game.power.value, max: CONFIG.power.max, canPuff: game.canPuff, alive: game.aliveCount });
  // 最後の一発を放ってから結果までずっと HUD は出さない（両手が玉を握り込む間も、リプレイの間も）
  hud.setVisible(!debugCam && !cinematic.active && !replay.active && !blackhole.active);
  updateAudio(live, dt);
  updateResult(dt);
}

// 音: 貯めの唸り、じわじわ期の脈動、弾けた瞬間の爆発、崩落
const _camV = new THREE.Vector3();
function updateAudio(live, dt = 0) {
  audio.chargeHum(game.charge.active ? game.power.level : 0);
  // 電車と高速（S8）: 今の画面のカメラから見た一番近い車両・高速の点の距離と左右。演出・リプレイ・結末の間は鳴らさない
  if (cityView.transit && !cinematic.active && !replay.active && !blackhole.active && audio.running) {
    const cam = cityCam();
    cam.updateMatrixWorld();
    const src = cityView.transit.sources(cam.position);
    audio.transit(transitMix(src, (p) => { _camV.set(p.x, p.y ?? 0, p.z).applyMatrix4(cam.matrixWorldInverse); return { x: _camV.x, z: _camV.z }; }), dt);
  } else audio.transit(null, dt);
  // BGM: 最初のタップで鳴らせるようになり、遊びが始まったら鳴らしはじめる（一度だけ）。その前のフレームで楽器の音を作っておく
  if (bgm.state === 'off') bgm.prepare();
  if (game.phase === 'playing' && audio.running) bgm.start();
  bgm.update({ elapsed: CONFIG.roundSeconds - game.timer.remaining, power: game.power.level, holding: game.charge.active });
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
function draw() {
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
// 最初のフレームのあと: 細かい主人公の体を、手の空いた時間に区切り 1 つずつ組み立てる
const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 16));
function onFirstFrame() {
  // 主人公の細かい体 → 肩越しの一人の体の順に、区切りごとに手の空いた時間で
  const tick = () => {
    if (heroBuilder && !heroBuilder.done) {
      if (heroBuilder.step()) enemyView.setHeroBody(heroBuilder.body);
      idle(tick);
      return;
    }
    if (riderBuilder.done) return;
    if (riderBuilder.step()) enemyView.setRiderBody(riderBuilder.body); else idle(tick);
  };
  idle(tick);
}
function frame(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_FRAME_DT);
  last = now;
  if (!paused) {
    if (governor.sample(dt) === 'down') lowerTier();
    simulate(dt);
    draw();
  }
  if (firstFrameMs === null) { firstFrameMs = performance.now(); onFirstFrame(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 撮影スクリプト用: 実時間を止め、決まった dt で進めてから描く（ヘッドレスは実時間より遅いため）
const debugHooks = {
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
  // 画面全体を決まったカメラで描く（撮影用）: { pos: [x, y, z], look: [x, y, z], fov }。null で戻す
  look(o) {
    if (!o) { debugCam = null; return; }
    debugCam = new THREE.PerspectiveCamera(o.fov ?? 60, views.size.w / Math.max(1, views.size.h), 1, 6000);
    debugCam.position.fromArray(o.pos);
    debugCam.lookAt(new THREE.Vector3().fromArray(o.look));
    debugCam.updateMatrixWorld();
  },
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
  window.__tier = tier;
  window.__cityView = cityView;
  window.__renderer = renderer; // 描画の回数・三角形の数を測る（renderer.info）
  window.__destruction = destruction;
  window.__explosionView = explosionView;
  window.__views = views;
  window.__hand = hand;
  window.__enemyView = enemyView;
  window.__patrolGlow = patrolGlow;
  Object.defineProperty(window, '__firstFrameMs', { get: () => firstFrameMs });
  window.__cinematic = cinematic;
  window.__replay = replay;
  window.__blackhole = blackhole;
  window.__bgm = bgm;
}
