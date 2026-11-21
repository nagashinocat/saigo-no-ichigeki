import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createTimeline, FINALE } from './finaleTimeline.js';
import { retreatPoint } from './finalePlan.js';
import { createSpaceView } from './spaceView.js';

// 最後の一発の演出（画面全体を使う。仕様 12 章の絵コンテ 1〜5）。時間割は finaleTimeline.js、撮る場所は finalePlan.js。
//   1. 離す → 両手が玉を鷲掴みに握り込む（2画面のまま）→ 画面全体が真っ白
//   2. R0b（持ち主 22:15・22:18。ガラスの一拍はやめた）: 遠くの軍勢（見回る者の数人）の後ろのカメラ。地平の爆心（主人公の所）で
//      爆発が始まり、少しふくらむ間はスロー（swell）。弾けた瞬間に現実の速さになり（race）、光の壁が街を走ってこちらへ迫り、
//      ビル・高速・電車を飲み、軍勢を後ろから一気に飲む（光の壁を背にした影 → 吹き飛ぶ）。カメラも飲まれて白 →
//   3. 追ってくる爆発から、カメラが通りを上へ・外へ逃げ、ゆっくり進む光の壁（見せる期）を止まって待ち受ける:
//      手前のビルが飲まれ、球の全体がだんだん大きく迫る
//   4. 宇宙（光の壁がまだ進んでいるうちに切り替わる）: 夕暮れの地球の丸みの上で、光の半球が街の前線の残りと同じく
//      ゆっくりゆるみながら 2 秒あまりかけてふくらみ、止まる（domeAt）。衝撃波の輪が雲の上を走る
//   5. 半球が地平に沿って押しつぶされ、横一線の光になり、細くなって消える。無音のあと、低い地鳴り
// 音の段取り（cue）: silence（放った瞬間）→ erupt（白が晴れ爆発が始まる: 世界の音が戻り、遠い地鳴りがふくらむ）→
//   burst（弾けた瞬間: 爆発の音が開く。光の壁が届くまでにうなりが開く）→ space → rumble（音は画面に従う。持ち主 13:06）
// 終わると 'end' を知らせ（結果へ。G4 のリプレイはここに入る）、最後の宇宙の絵を出したまま待つ（held）。
// ゲームの時計はこの演出が決める（gameDt）。前線の進みは演出の時刻表どおりになる。

// 追われて引くカメラは front からこの距離だけ先にいたい（lead）、決してこれより近づかない（minLead）
export const leadFor = (front) => 20 + 0.6 * front;
export const minLeadFor = (front) => 6 + 0.08 * front;

// 軍勢が光の壁に吹き飛ばされる: 前線が乗り手の lead m 手前に来たら、光の壁に押されて外（カメラの方）へ、壁の速さの carry 倍で
// 運ばれる（壁のすぐ前を、回りながら。少しずつ壁に追いつかれ、追いつかれたら光の中に消える）。up: 上へ m/s
export const FLING = { lead: 2.5, carry: 0.92, up: 6, spin: 9 };

// 追われて引く距離 s。生きた front を毎フレーム読み、front + lead へ臨界減衰のばねで向かう。
// 戻らず、front + minLead より近づかない（front が急に速くなればカメラも同じだけ速くなる）。
// hold: 引くのはここまで（ゆっくり進む光の壁を、止まったカメラが待ち受ける。それでも minLead より近づかない）
export function createChase(s0, { rate = 6, lead = leadFor, minLead = minLeadFor, hold = Infinity } = {}) {
  let s = s0, v = 0;
  return {
    get s() { return s; },
    update(dt, front) {
      const want = Math.max(s, Math.min(hold, front + lead(front)));
      if (dt > 0) {
        v = (v + rate * rate * (want - s) * dt) / (1 + 2 * rate * dt + rate * rate * dt * dt);
        v = Math.max(0, v);
        s += v * dt;
      }
      const floor = front + minLead(front);
      if (s < floor) { if (dt > 0) v = Math.max(v, (floor - s) / dt); s = floor; }
      return s;
    },
  };
}

// 追われて引くカメラが止まる距離: 宇宙へ切り替わるときの前線 fCut の (1 + gap) 倍 + add（m）。
// 持ち主 23:01「全体を撮るカメラは、もう少し引いた方がいい」: 0.55 倍 + 20 m → 0.95 倍 + 40 m（球の全体と街の端に余白）
export const CHASE_HOLD = { gap: 0.95, add: 40, fit: 0.8 };
// 止まる距離: 上の式と、半径 fCut の球の見かけの半径が画面の短い向きの画角（半分）の fit 倍に収まる距離の、遠い方。
// fovV: 引ききったときの縦の画角（度）
export function chaseHoldDist(fCut, aspect, fovV, H = CHASE_HOLD) {
  const halfV = THREE.MathUtils.degToRad(fovV) / 2;
  const half = aspect < 1 ? Math.atan(Math.tan(halfV) * aspect) : halfV;
  return Math.max(fCut * (1 + H.gap) + H.add, fCut / Math.sin(H.fit * half));
}
// 引いたとき（wide）の、前線からの先の距離: add + k·front（前は 24 + 1.25·front）
export const CHASE_WIDE = { add: 30, k: 1.7, rise: 0.2, sec: 1.45 }; // rise: 引ききったときの高さ（爆心からの距離に対する割合）

// 画面の縦横比ごとのレンズ（縦の画角、度）。縦長の画面は横が狭いので広め
export const LENS = {
  // 2: 遠くの軍勢の後ろ。始めは少し長いレンズで地平の爆心を大きく、光の壁が迫るにつれて広がる
  beat: { portrait: [20, 42], landscape: [14, 30] },
  chase: { portrait: 78, landscape: 56 },      // 3: 追われて引く
  chaseWide: { portrait: 8, landscape: 0 },    // 3: 引ききったときに足す画角（縦長は横が狭いので広げる）
};
// 黒い帯: 画面をこの縦横比に切る（縦長は 9:16、横長はシネマスコープ）
export const BARS = { portrait: 9 / 16, landscape: 2.39 };

export function barsFor(aspect) {
  const target = aspect < 1 ? BARS.portrait : BARS.landscape;
  return Math.max(0, (1 - aspect / target) / 2);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3;
const easeInOut = (x) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

// 宇宙へ切り替わった瞬間の光の半球の大きさ（最大に対する割合）。街の画で大きく迫っていた球が、
// 宇宙で急に小さく見えないよう大きめから始める
const DOME0 = 0.4;
// 宇宙の衝撃波の殻の半径（rMax に対する割合）。p は半球のふくらみ（finaleTimeline の domeAt、0〜1）。
// 半球（DOME0 + (1 − DOME0)·p）の少し先（1.05 倍から 1.45 倍へ）を、半球と同じ進みでふくらむ
export const shellRadius = (p) => (DOME0 + (1 - DOME0) * p) * (1.05 + 0.4 * p);
// S8 fix2: 宇宙で、街を見回る者（爆心から dist m）の火花が散る時刻（演出の秒）。宇宙の光の半球の縁
// （rMax·(DOME0 + (1 − DOME0)·domeAt(t))。見回る者は dist / radius·rMax に描く）がその者に届いた瞬間。
// 宇宙へ切り替わった瞬間にもう半球の中にいる者は -Infinity（追うカットで飲まれ、その火花は街の画で見せた。宇宙では描かない）。
// 半径の外の者は Infinity（届かない。緑の点のまま）
export function spaceSparkTime(tl, dist, radius, dome0 = DOME0) {
  const frac = dist / Math.max(1e-6, radius);
  if (frac > 1 + 1e-9) return Infinity;
  if (frac <= dome0) return -Infinity;
  const g = Math.min(1, (frac - dome0) / (1 - dome0));
  let lo = tl.chaseEnd, hi = tl.domeEnd;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (tl.domeAt(m) < g) lo = m; else hi = m; }
  return hi;
}
// 宇宙のカメラの画角（縦長は横の、横長は縦の、度）
const SPACE_FOV = { h: 54, v: 36 };
// カメラのそばのビル（水平にこの距離 m 以内）は、光の壁が触れた瞬間に隠す（球の面へ半分だけ押されて引き伸ばされた壁が
// レンズの前を横切らない。光の壁の面がその場所をおおう）。遠くのビルは今までどおり飲まれてつぶれていくのを見せる
export const VEIL_NEAR = 80;
export const VEIL_K = 2.5;
export const OCCLUDE = 1.6; // finalePlan の PLAN.open.occlude と同じ
// 線分 a→c（THREE.Vector3）がビルの箱（地面から b.h）を通るか
const _sb = new THREE.Box3(), _sr = new THREE.Ray(), _sv = new THREE.Vector3();
function segBox(a, c, b) {
  _sb.min.set(b.x - b.w / 2, -1, b.z - b.d / 2); _sb.max.set(b.x + b.w / 2, b.h, b.z + b.d / 2);
  _sr.origin.copy(a); _sr.direction.copy(c).sub(a);
  const L = _sr.direction.length(); _sr.direction.multiplyScalar(1 / L);
  const hit = _sr.intersectBox(_sb, _sv);
  return !!hit && hit.distanceTo(a) <= L;
}
export const VEIL_ADD = 60;
// 光の壁がカメラのこの距離（m。カメラの爆心からの距離の 8% まで）手前に来たところから白へ（球の面へ押されたビルが板になって
// レンズの前を横切る前に）
export const WHITE_AHEAD = 9;
// 弾けてから画角が広がるまで（秒）と、弾けたあとに下げる露出
export const BEAT_WIDEN = 0.25;
export const BEAT_RACE_DARK = 0.25;
// 弾けたら見る向きを乗り手の列の真ん中の方へこの割合だけ寄せる
export const BEAT_LOOK_RIDERS = 0.75;
// 軍勢の後ろのカットの間の、爆発の球の白い芯の強さの倍率
export const BLAST_CORE_SCALE = 0.3;
// 軍勢の後ろのカットの間の、爆心の光の強さの上限（弾けたあとは光の届く距離が街の広くへ伸びるので、強さはじわじわ期の光（およそ 30）より下に抑える）
export const BLAST_LIGHT_CAP = 5;
export const BLAST_BIRTH_SCALE = 0.2;

// views: createViews の戻り値（全画面の大きさ）、enemyView: 主人公の向きと演出の乗り手、explosionView: 揺れと閃光。
// opts.renderer: 宇宙の場面の温め、opts.scene: 街の場面、opts.tier: 画質の段
// opts.lights: { sun, fill }（街の光。遠くの爆発の光が際立つよう、軍勢の後ろのカットの間は少し弱める）
// opts.getTier: 今の画質の段（演出を始めるたびに読み、雲の細かさ・星の数を合わせる）
// opts.veilBuilding(id, on): 軍勢の後ろのカットの間だけ、光の壁が触れたビルのうちカメラのそば・画面の中の近いものを一時的に隠す（veilTouched）。
// 追うカットへ切り替わると戻す（そこから先は今までどおり、光の壁に飲まれてつぶれていく）
export function createCinematic(views, enemyView, explosionView, { renderer, scene, sunDir, tier = 'high', getTier = () => tier, cfg = CONFIG, lights = null, veilBuilding = null } = {}) {
  const listeners = {};
  const emit = (name, arg) => { for (const fn of listeners[name] ?? []) fn(arg); };
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
  let playTier = tier;
  const space = createSpaceView(tier);

  // phase: 'off' | 'play'（時刻表を進める） | 'held'（終わって最後の絵のまま待つ）
  let phase = 'off', t = 0, plan = null, tl = null, stage = 'off';
  let shot = null, getEnemies = null;
  const sparkAt = new Map(), _sparks = [];
  let gameDt = 0, worldDt = 0, chase = null, chaseC = 1, chaseR0 = 0, cuesDone = new Set(), focusOn = false;
  // 逃げる道（planFinale の retreat: false で後回しにしたもの）を求める関数。スローの間に一度だけ呼ぶ
  let resolveRetreat = null;
  // 光の壁が近い縁に届いたら隠すビル（近い順）と、次に見る番号
  let touch = [], touchAt = 0, veiled = [], occluders = [];
  // 一時的に隠したビルを戻す
  function unveilAll() {
    for (const id of veiled) veilBuilding(id, false);
    touch = []; touchAt = 0; veiled = []; occluders = [];
  }
  // 光の壁が触れたビルを、隠すか決める（fix1: カメラのそば VEIL_NEAR m 以内か、画面に入っていてカメラからの距離が
  // 壁の残りの道のり（カメラまで）の VEIL_K 倍 + VEIL_ADD m 以内なら隠す。球の面へ押されて引き伸ばされた板がレンズの前・画面の縁に出ない。
  // 遠くで飲まれていくビルはつぶれていくのを見せる）
  function veilTouched(front) {
    let frus = null;
    while (touchAt < touch.length && touch[touchAt].near <= front) {
      const b = touch[touchAt++];
      const dCam = Math.hypot(Math.max(0, Math.abs(b.x - P.cam.x) - b.w / 2), Math.max(0, Math.abs(b.z - P.cam.z) - b.d / 2));
      let on = dCam < VEIL_NEAR;
      if (!on && dCam < VEIL_K * Math.max(0, tl.camDist - b.near) + VEIL_ADD) {
        frus ??= _frus.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        _box.min.set(b.x - b.w / 2, 0, b.z - b.d / 2); _box.max.set(b.x + b.w / 2, b.h, b.z + b.d / 2);
        on = frus.intersectsBox(_box);
      }
      if (on) { veilBuilding(b.id, true); veiled.push(b.id); }
    }
  }
  function ensureRetreat() {
    if (!plan.retreat && resolveRetreat) plan.retreat = resolveRetreat();
    resolveRetreat = null;
    return plan.retreat;
  }
  const P = { cam: new THREE.Vector3(), look: new THREE.Vector3(), radial: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), riderMid: new THREE.Vector3() };
  const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _box = new THREE.Box3(), _frus = new THREE.Frustum(), _pm = new THREE.Matrix4();
  const screen = { flash: 0, time: 0, heat: null, grade: { bars: 0, ca: 0, vig: 0, sat: 1, grain: 0, streak: 0, exposure: 1, fade: 0, warm: 0, contrast: 1, bloom: 1 } };
  let rMax = 20, spaceDist = 260, wideK = 0;

  const baseLight = lights ? { sun: lights.sun?.intensity ?? 0, fill: lights.fill?.intensity ?? 0 } : null;
  function dimLights(k) {
    if (!lights) return;
    if (lights.sun) lights.sun.intensity = baseLight.sun * (1 - 0.6 * k);
    if (lights.fill) lights.fill.intensity = baseLight.fill * (1 - 0.7 * k);
  }

  // 軍勢の後ろのカット（swell・race）の間に隠す、街の側の物: 爆発の粉の板（スローの間は爆心の光の玉を雲でおおい、迫ると画面全体を
  // 白い膜でおおう）と、壊れたビルから飛ぶ物理の破片。遠くで飲まれていくビルと光の壁はそのまま
  let worldFx = null;
  function setExplosionDust(on) {
    worldFx ??= [explosionView.group?.getObjectByName?.('dust'), scene?.getObjectByName?.('debris')].filter(Boolean);
    for (const o of worldFx) o.visible = on;
  }

  const aspect = () => views.size.w / Math.max(1, views.size.h);
  const lens = (l) => (aspect() < 1 ? l.portrait : l.landscape);

  function aim(pos, look, fovDeg, roll = 0) {
    cam.aspect = aspect();
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    if (roll) cam.rotateZ(roll);
    cam.fov = fovDeg;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  function cue(name, arg) {
    const key = name + (arg ?? '');
    if (cuesDone.has(key)) return;
    cuesDone.add(key);
    emit('cue', { name, arg });
  }

  // ---- 2: 遠くの軍勢の後ろ（swell → race）----
  // 乗り手（演出の一人と、その前に並ぶ数人）: 一人ずつの置き場所・爆心からの距離（球の前線が届く距離）・外向き・向き。
  // 姿勢は毎フレーム poses に書き、enemyView が読む（poses[0] が撮る一人。riderBody の体で描く）
  let riders = [];
  const poses = [];
  const beatInfo = { riders: poses };
  const mkPose = () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, reach: 0, thrust: 1, keep: 0, head: 0, anchor: 0 });

  function poseRiders() {
    const front = tl.front(t);
    for (let i = 0; i < riders.length; i++) {
      const r = riders[i], p = poses[i];
      const h = r.seed;
      // 浮いて爆心を向き、推進の光を灯したまま、ゆっくり揺れる（スローの間は世界の時間で動く）
      const w = tl.blastClock(t) + h * 10;
      p.x = r.pos[0]; p.y = r.pos[1] + 0.12 * Math.sin(w * 2.1 + h * 37); p.z = r.pos[2];
      p.yaw = r.yaw + 0.03 * Math.sin(w * 0.8 + h * 11); p.pitch = 0.04; p.roll = 0.05 * Math.sin(w * 1.7 + h * 23);
      p.thrust = 1.1; p.keep = 1; p.reach = 0; p.head = 0.1 * Math.sin(w * 0.6 + h * 5);
      // 光の壁が lead m 手前に来たら、壁に押されて外（カメラの方）へ運ばれ、回りながら舞い上がる。追いつかれたら光の中に消える
      const pushed = front - (r.dist - FLING.lead);
      if (pushed > 0) {
        const carried = FLING.carry * pushed;
        p.x += r.out[0] * carried; p.z += r.out[2] * carried;
        const tau = Math.max(0, t - r.hitAt);
        p.y += FLING.up * tau + 0.05 * carried;
        p.pitch -= FLING.spin * tau * (0.7 + 0.6 * h);
        p.roll += (h > 0.5 ? 1 : -1) * FLING.spin * 0.6 * tau;
        p.yaw += 2.5 * tau;
        p.thrust = Math.max(0, 1.1 - 8 * tau);
        // 光の壁（球の表面）に追いつかれた
        if (front >= Math.hypot(r.pos[0] + r.out[0] * carried, p.y, r.pos[2] + r.out[2] * carried) - 0.3) p.keep = 0;
      }
    }
  }

  function updateBeat() {
    const front = tl.front(t);
    const sw = clamp01((t - tl.white) / (tl.burst - tl.white)); // スローの進み
    const rk = t >= tl.burst ? clamp01((t - tl.burst) / Math.max(0.05, tl.camHit - tl.burst)) : 0; // 弾けてからカメラが飲まれるまで
    const gap = Math.max(0, tl.camDist - front); // 光の壁からカメラまで
    const near = smooth(1 - gap / Math.max(60, tl.camDist * 0.5)); // 壁が近いほど 1
    // fix1: スローの間は長いレンズで地平の爆心の光の玉を大きく（ふくらんで画面の 1/4〜1/3 ほどに）、ゆっくり押し込む。
    // 弾けると画角が広がり、見る向きが下がって、屋上に並ぶ乗り手の列と迫る光の壁が入る
    const wideAt = t >= tl.burst ? smooth((t - tl.burst) / BEAT_WIDEN) : 0;
    _pos.copy(P.cam).addScaledVector(P.fwd, 4 * easeInOut(sw)).addScaledVector(P.fwd, -2.5 * near * near);
    // 手持ちのわずかな揺れ
    _pos.addScaledVector(P.right, 0.03 * Math.sin(t * 1.3)).y += 0.025 * Math.sin(t * 1.1 + 1);
    // 見る先: 地平の爆心の光 → 弾けたら乗り手の列の真ん中の方へ半分。光の壁が迫ると、そびえる壁の上の方へ少し見上げる
    _a.copy(P.look).sub(_pos).normalize();
    _b.copy(P.riderMid).sub(_pos).normalize();
    _a.lerp(_b, BEAT_LOOK_RIDERS * wideAt).normalize();
    const lookUp = Math.min(0.14, (front * 0.5) / Math.max(1, gap + 30)) * near;
    _look.copy(_pos).addScaledVector(_a, 100);
    _look.y += 100 * lookUp;
    const [f0, f1] = lens(LENS.beat);
    const fov = f0 * (1 - 0.08 * easeInOut(sw)) + (f1 - f0) * Math.max(0.8 * wideAt, smooth(near));
    aim(_pos, _look, fov, 0.015 * Math.sin(t * 0.7));
    const shake = 0.0015 + (t >= tl.burst ? 0.006 * Math.exp(-(t - tl.burst) / 0.25) + 0.035 * near * near : 0.002 * sw);
    _e.set(shake * Math.sin(t * 41), shake * Math.sin(t * 33 + 1.3), shake * 0.7 * Math.sin(t * 27 + 2.1));
    cam.quaternion.multiply(_q.setFromEuler(_e));
    cam.updateMatrixWorld();
    poseRiders();
    const g = screen.grade;
    g.sat = 1.0; g.warm = 0.45; g.contrast = 1.15 + 0.25 * rk;
    g.vig = 0.42 + 0.2 * near;
    g.ca = 0.2 + 0.4 * rk + 1.2 * near * near;
    // fix1: 弾けたあとは露出を下げる（光の壁は明るいまま、乗り手と街は黒い影に）。白い閃きは出さない
    g.exposure = 0.92 - BEAT_RACE_DARK * Math.max(wideAt, rk);
    g.bloom = 0.8 + 0.2 * near;
    g.grain = 0.04;
    // 白が晴れる閃光。光の壁がカメラの WHITE_AHEAD m 手前に来てから白へ（追うカットへは白のまま切り替わる）
    const camD = _pos.length(), whiteAhead = Math.min(WHITE_AHEAD, 0.08 * camD);
    screen.flash = Math.max(0, 0.95 * Math.exp(-(t - tl.white) / 0.05))
      + Math.max(smooth((front - (camD - whiteAhead)) / whiteAhead), smooth((t - (tl.snap - 0.06)) / 0.06));
  }

  // ---- 3: 追ってくる爆発から逃げる ----
  function updateChase(dt) {
    const front = tl.front(t);
    // はじめは通りの高さで、すぐ後ろに迫る光の壁から逃げる（近い）。追いつかれる寸前に振り切り、
    // 光の壁の輪郭（球の上の縁）が画面に入る遠さへ引いて、街が飲まれていく全体を見せる
    const k = (t - tl.snap);
    // fix1: 引くのは追うカットの始めから CHASE_WIDE.sec 秒かけて（前は 0.6 秒で球の見かけが半分になった）
    const wide = smooth((k - 0.05) / CHASE_WIDE.sec);
    if (!chase) {
      const d = ensureRetreat().dir;
      chaseC = Math.max(0.35, (d[0] * P.radial.x + d[1] * P.radial.z));
      // 見せる期: カメラは宇宙へ切り替わるときの前線（fCut）の外の hold で止まり、ゆっくり進む光の壁が
      // 手前のビルを飲みながら迫ってくるのを待ち受ける（球の全体が入り、だんだん大きくなる）
      // 持ち主 23:01: 止まる距離は、宇宙へ切り替わるときの球（半径 fCut）が画面に余白をもって収まる遠さ以上
      // （縦長は横の画角、横長は縦の画角の CHASE_HOLD.fit 倍に、球の見かけの半径が収まる）
      const fCut = tl.fCut;
      const holdD = chaseHoldDist(fCut, aspect(), lens(LENS.chase) + lens(LENS.chaseWide));
      chase = createChase(chaseR0, {
        lead: (f) => (16 + 0.55 * f) * (1 - wideK) + Math.max(CHASE_WIDE.add + CHASE_WIDE.k * f, holdD - f) * wideK,
        minLead: (f) => (8 + 0.2 * f) * (1 - wideK) + (8 + 0.35 * f) * wideK,
        hold: Math.max(chaseR0, holdD),
      });
    }
    wideK = wide;
    const s = chase.update(dt, front);
    const x = Math.max(0, (s - chaseR0) / chaseC);
    _pos.fromArray(retreatPoint(plan.retreat, x));
    // 引ききるにつれて少し上がる（球の全体と、その下に広がる街と穴、街の端を見下ろす。持ち主 23:01）
    _pos.y = Math.max(_pos.y, CHASE_WIDE.rise * wide * s);
    // 爆心の方、迫る光の壁が街に触れているあたりを見る（近いうちは壁の根元、引くと球の全体）
    const lookD = front * 0.3, lookY = Math.max(4, front * (0.2 + 0.18 * wide));
    _look.copy(P.radial).multiplyScalar(Math.max(4, lookD)).setY(lookY);
    const fov = lens(LENS.chase) + 10 * Math.exp(-k / 0.35) + lens(LENS.chaseWide) * wide;
    const shake = Math.min(0.06, (explosionView.cameraInfo?.shake ?? 0) * 2.2 + 0.02 * Math.exp(-k / 0.25));
    aim(_pos, _look, fov, 0);
    _e.set(shake * Math.sin(t * 37), shake * Math.sin(t * 29 + 1.3), shake * 0.6 * Math.sin(t * 23 + 2.1));
    cam.quaternion.multiply(_q.setFromEuler(_e));
    cam.updateMatrixWorld();
    const g = screen.grade;
    g.sat = 1.05; g.warm = 0.25; g.vig = 0.35; g.grain = 0.04; g.exposure = 0.85; g.contrast = 1.1; g.bloom = 1;
    g.ca = 0.5 + 2.4 * Math.exp(-k / 0.3);
    // 白から、弾けた閃光へ
    screen.flash = 1 - smooth(k / 0.12);
  }

  // ---- 4〜5: 宇宙 ----
  function updateSpace() {
    const u = clamp01((t - tl.chaseEnd) / (tl.flatten - tl.chaseEnd));
    const portrait = aspect() < 1;
    const push = easeOut(u) * 0.12 + Math.max(0, t - tl.flatten) * 0.012;
    space.aim({
      aspect: aspect(),
      dist: spaceDist * (1 - push), alt: (portrait ? 46 : 64) * (1 - push * 0.6),
      lookAhead: 420, lookUp: portrait ? -250 : -40,
      fovH: SPACE_FOV.h, fovV: SPACE_FOV.v, roll: 0.07 - 0.03 * easeOut(u),
    });
    // 光の半球: ふくらむ → 押しつぶされて横一線 → 細くなって消える
    const f = clamp01((t - tl.flatten) / FINALE.flattenSec);
    const th = clamp01((t - tl.flatten - FINALE.flattenSec) / FINALE.thinSec);
    // 半球は街の前線の残りと同じく、ゆっくりゆるみながらふくらみ、domeEnd に止まる（finaleTimeline の domeAt）
    const r = rMax * (DOME0 + (1 - DOME0) * tl.domeAt(t));
    const flat = easeInOut(f);
    const domeI = (0.75 + 0.35 * Math.sin(Math.PI * f)) * (1 - smooth((f - 0.3) / 0.4));
    space.setDome(r, flat, domeI, t);
    // 衝撃波の輪: 半球の根元から雲の上を走り、カメラの下をくぐって消える
    const ru = clamp01((u - 0.03) / 0.97);
    const ringR = r * 0.9 + (spaceDist * 0.78) * (1 - (1 - ru) ** 1.5);
    // カメラの下へ近づくほど太く見えるので、近づく前に薄れる
    space.setRing(ringR, ru > 0 ? (1 - smooth((ru - 0.45) / 0.45)) * (1 - f) * smooth(ru / 0.05) : 0);
    // 衝撃波の殻: 半球の少し先を、半球と同じゆっくりした進み（domeAt）でふくらみ、ふくらみきる前に薄れて消える
    const pd = tl.domeAt(t);
    space.setShell(rMax * shellRadius(pd), (1 - smooth((pd - 0.55) / 0.45)) * smooth(u / 0.06) * (1 - f));
    // 横一線の光: 画面の横幅の大半にわたる
    const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(space.camera.fov) / 2) * space.camera.aspect);
    const d = space.camera.position.length();
    const len = 2 * d * Math.tan(hf / 2) * (0.6 + 0.5 * smooth(f / 0.7)) * (1 + 0.15 * th);
    const lineI = smooth((f - 0.15) / 0.35) * (1 - smooth((th - 0.35) / 0.65)) * (1.2 + 0.8 * Math.sin(Math.PI * clamp01(f * 1.3)));
    space.setLine(len, r * 1.1 * (1 - 0.8 * flat), th, lineI);
    // 街を見回る軍勢: 生きている者は緑の点、宇宙の光の半球の縁が届いた瞬間に火花（宇宙の座標へ縮める: 半径 radius m → rMax）
    if (getEnemies) {
      const k = rMax / Math.max(1, shot.radius);
      _sparks.length = 0;
      for (const e of getEnemies()) {
        if (!e.patrol) continue;
        // 火花の時刻は時刻表から一人ずつ決める（S8 fix2: 前は宇宙の最初のフレームで、追う間に飲まれた者が一斉に弾けていた）
        if (!sparkAt.has(e.id)) sparkAt.set(e.id, spaceSparkTime(tl, e.dist, shot.radius));
        const at = sparkAt.get(e.id);
        if (at === -Infinity) continue;
        const age = t >= at ? t - at : -1;
        if (age > 0.7 || f > 0.3) continue;
        _sparks.push({ x: e.x * k, z: e.z * k, age });
      }
      space.setSparks(_sparks, renderer?.getPixelRatio?.() ?? 1);
    }
    // 消えたあとに残る、焼けた街の小さな灯
    space.setScar(2.0 * smooth((t - tl.lineEnd + 0.3) / 0.6) * (1 - 0.4 * smooth((t - tl.rumble) / 1.5)));
    space.setStars(smooth(u / 0.4));
    const g = screen.grade;
    g.sat = 1.0; g.warm = 0.1; g.grain = 0.035; g.contrast = 1.05; g.bloom = 0.55;
    g.vig = 0.5;
    g.ca = 0.25 + 0.6 * lineI;
    g.streak = lineI;
    // 地鳴りの間、ごくわずかに揺れる
    if (t > tl.rumble) {
      const k = Math.min(1, (t - tl.rumble) / 0.4) * 0.0025;
      space.camera.rotateX(k * Math.sin(t * 31));
      space.camera.rotateY(k * Math.sin(t * 23 + 1));
      space.camera.updateMatrixWorld();
    }
    g.exposure = 1 - 0.18 * smooth((t - tl.lineEnd) / 1.2);
    screen.flash = 0;
  }


  const self = {
    get active() { return phase !== 'off'; },
    // 演出の時刻表が終わったか（終わったあとは最後の絵のまま待つ）
    get finished() { return phase === 'held'; },
    // ゲームが止まって見える間（両手と白の間）
    get frozen() { return phase === 'play' && t < (tl?.white ?? 0); },
    // 画面全体を演出のカメラで描くか（手の画面と HUD は描かない）
    get fullscreen() { return phase === 'held' || (phase === 'play' && t >= tl.hands); },
    get white() { return phase === 'play' && stage === 'white'; },
    get camera() { return stage === 'space' || stage === 'flatten' || stage === 'silence' || stage === 'rumble' || stage === 'done' ? space.camera : cam; },
    // 描く場面（null なら街の場面）
    get renderScene() { return self.camera === space.camera ? space.scene : null; },
    get plan() { return plan; },
    // 軍勢の後ろのカットの確かめ用: { riders（乗り手の姿勢の一覧。[0] が撮る一人） }
    get beat() { return beatInfo; },
    get timeline() { return tl; },
    // 宇宙で描いている見回る者の点と火花（[{ x, z, age }]。テスト用）
    get spaceSparks() { return _sparks; },
    get time() { return t; },
    get stage() { return stage; },
    get phase() { return phase; },
    // このフレームでゲームを進める秒（ゲームの時計は演出の時刻表が決める）
    get gameDt() { return phase === 'off' ? null : gameDt; },
    // 世界（破片・粉・球の模様・軍勢）を進める秒
    get worldDt() { return worldDt; },
    get screen() { return phase === 'off' ? null : screen; },
    // 爆心の光（explosionView.light）の強さの上限。軍勢の後ろのカット（swell・race）の間だけ。弾けた瞬間に光が跳ね上がると、
    // カメラのまわりの街まで真っ白に照らされ、光の壁が街を走るのも軍勢の影も見えなくなる（main.js が描く前に当てはめる）
    // 弾けた瞬間に爆発の球が白く飛ぶ強さの倍率（軍勢の後ろのカットの間だけ弱める。main.js が爆発の見た目を進める前に渡す）
    get blastCoreScale() { return phase === 'play' && (stage === 'swell' || stage === 'race') ? BLAST_CORE_SCALE : 1; },
    get blastBirthScale() { return phase === 'play' && (stage === 'swell' || stage === 'race') ? BLAST_BIRTH_SCALE : 1; },
    // 軍勢と主人公が爆発の光で白く光る強さの倍率（軍勢の後ろのカットの間は 0: 乗り手は光の壁を背にした黒い影）
    get glowScale() { return phase === 'play' && (stage === 'swell' || stage === 'race') ? 0 : 1; },
    get blastLightCap() { return phase === 'play' && (stage === 'swell' || stage === 'race') ? BLAST_LIGHT_CAP : Infinity; },
    on(name, fn) { (listeners[name] ??= []).push(fn); },
    warmup(r) {
      space.warmup(r);
      // 宇宙の場面は一度小さく描いて、形と画像を先に GPU へ送っておく（切り替わった瞬間に止まらないように）
      space.aim({ aspect: 0.5, dist: 190, alt: 46, lookAhead: 420, lookUp: -250, fovH: SPACE_FOV.h, fovV: SPACE_FOV.v });
      const tmp = new THREE.WebGLRenderTarget(16, 16);
      const prev = r.getRenderTarget();
      r.setRenderTarget(tmp);
      r.render(space.scene, space.camera);
      r.setRenderTarget(prev);
      tmp.dispose();
    },
    // 今の演出の画質: 段・雲の段数と星の数
    get quality() { return { tier: playTier, space: space.tierInfo }; },
    // 'cinematicStart': plan は finalePlan.planFinale の戻り値。
    // opts.retreat: plan.retreat が null のとき逃げる道を返す関数（重いので、放つ瞬間ではなくスローの間に呼ぶ）
    // opts.buildings: 残っているビル（軍勢の後ろのカットの間、カメラのそばのビルを光の壁が触れたら veilBuilding で一時的に隠す）
    // opts.enemies: 軍勢の一覧を返す関数（宇宙で見回る軍勢の光と火花を描く）
    play(p, s, { retreat = null, buildings = null, enemies = null } = {}) {
      plan = { ...p }; phase = 'play'; t = 0; stage = 'hands';
      shot = s; getEnemies = enemies; sparkAt.clear();
      resolveRetreat = retreat;
      if (!plan.retreat && !resolveRetreat) throw new Error('cinematic.play: plan.retreat がなく、求める関数もない');
      playTier = getTier();
      space.setTier(playTier);
      tl = createTimeline({ radius: s.radius, riderDist: p.riderDist, firstDist: p.firstDist, camDist: p.camDist }, undefined, cfg);
      chase = null; cuesDone = new Set(); focusOn = false;
      P.cam.fromArray(p.camPos); P.look.fromArray(p.look);
      P.radial.set(p.camPos[0], 0, p.camPos[2]).normalize();
      P.fwd.copy(P.radial).negate();
      P.right.set(-P.fwd.z, 0, P.fwd.x);
      chaseR0 = Math.hypot(p.camPos[0], p.camPos[2]);
      const nearOf = (b) => Math.hypot(Math.max(0, Math.abs(b.x) - b.w / 2), Math.max(0, Math.abs(b.z) - b.d / 2));
      unveilAll();
      touch = veilBuilding && buildings ? buildings.map((b) => ({ near: nearOf(b), id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, h: b.h })).filter((b) => b.near < s.radius).sort((a, b) => a.near - b.near) : [];
      touchAt = 0;
      // スローの間、爆心のそば（じわじわ期の光の OCCLUDE 倍の内）で、カメラから光の玉をふさぐビルは、白の間に隠しておく
      // （じわじわ期〜弾けた直後に光に飲まれるビル。白が晴れたときにはもう無いので、隠れる瞬間は見えない。追うカットで戻す）
      if (veilBuilding && buildings) {
        const f0 = tl.creepFront;
        for (const b of buildings) {
          if (nearOf(b) > OCCLUDE * f0) continue;
          const hits = [-0.7, 0, 0.7].some((u) => [0.25, 0.6, 0.95].some((v) => {
            _a.set(-P.radial.z * u * f0, v * f0, P.radial.x * u * f0);
            return segBox(P.cam, _a, b);
          }));
          if (hits) occluders.push(b.id);
        }
      }
      // 主人公は撮る向きを向く
      enemyView.setHeroYaw(Math.atan2(P.radial.x, P.radial.z));
      // 乗り手: 撮る一人（[0]）と、その前に並ぶ数人。古い plan（riders なし）は撮る一人だけ
      const list = p.riders ?? [{ id: p.riderId, pos: p.rider.pos, yaw: p.rider.yaw }];
      riders = list.map((r, i) => {
        const d = Math.hypot(r.pos[0], r.pos[2]) || 1;
        const dist = Math.hypot(...r.pos);
        const hash = ((Math.sin((r.id ?? i + 0.5) * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
        return { id: r.id, pos: r.pos, yaw: r.yaw, dist, out: [r.pos[0] / d, 0, r.pos[2] / d], seed: hash, hitAt: tl.timeAtFront(dist - FLING.lead) };
      });
      poses.length = 0;
      P.riderMid.set(0, 0, 0);
      for (const r of riders) P.riderMid.add(_a.fromArray(r.pos));
      P.riderMid.multiplyScalar(1 / Math.max(1, riders.length));
      for (let i = 0; i < riders.length; i++) poses.push(mkPose());
      // 宇宙での大きさ: 大きな一発ほど大きい
      // 光の半球の最大の大きさは、宇宙のカメラの画面の高さに対して決める（縦長でも横長でも同じ見え方）
      spaceDist = aspect() < 1 ? 190 : 270;
      space.aim({ aspect: aspect(), dist: spaceDist, alt: 50, lookAhead: 420, lookUp: 0, fovH: SPACE_FOV.h, fovV: SPACE_FOV.v });
      const halfH = spaceDist * Math.tan(THREE.MathUtils.degToRad(space.camera.fov) / 2);
      // S8: 大きさの基準は S7 までの最大の半径（blast.smallRef）。広げた最大の一発（720 m）は前の最大より約 14% 大きく見える
      rMax = 0.17 * halfH * (0.5 + 0.5 * Math.sqrt(s.radius / (cfg.blast.smallRef ?? cfg.radius.max)));
      screen.grade.bars = 0; screen.grade.fade = 0; screen.grade.streak = 0;
      cue('silence');
      self.update(0);
    },
    // 'cinematicEnd': ゲーム側の止まった時間の終わり（この演出はゲームの時計を自分で進めるので、することはない）
    end() {},
    update(dt) {
      gameDt = 0; worldDt = 0;
      if (phase === 'off') return;
      // 最後の絵のまま待つ間: ゲームがまだ終わっていなければ（念のため）、ゲームの時間は現実の速さで進める
      if (phase === 'held') { gameDt = dt; updateSpace(); t += dt; return; }
      const t0 = t;
      t += dt;
      gameDt = tl.gameDt(t0, t);
      worldDt = tl.worldRate(t, dt) * dt;
      stage = tl.stage(t);
      screen.time = t;
      const g = screen.grade;
      g.bars = barsFor(aspect()) * smooth((t - tl.white) / 0.3);
      g.streak = 0;
      if (stage === 'hands') { screen.flash = 0; return; }
      // 演出の乗り手は、画面全体になってから決めた隊形に描く（白の間に置き直す）
      if (!focusOn) {
        poseRiders();
        enemyView.setFocus?.({ id: riders[0]?.id ?? null, pose: poses[0], group: riders.slice(1).map((r, i) => ({ id: r.id, pose: poses[i + 1] })) });
        focusOn = true;
      }
      if (occluders.length) { for (const id of occluders) { veilBuilding(id, true); veiled.push(id); } occluders = []; }
      if (stage === 'white') { screen.flash = 0; return; }
      setExplosionDust(stage !== 'race' && stage !== 'swell');
      if (stage === 'swell' || stage === 'race') {
        cue('erupt'); // 白が晴れて爆発が始まる: 世界の音が戻り、遠い地鳴りがふくらむ
        if (stage === 'race') cue('burst'); // 弾けた瞬間に爆発の音が開く
        dimLights(0.5 * smooth((t - tl.white) / 0.3) * (1 - smooth((t - tl.camHit) / 0.1)));
        updateBeat();
        veilTouched(tl.front(t));
        // 逃げる道は、スローの間に求める（必要になるのは追うカットから）
        ensureRetreat();
        return;
      }
      dimLights(0);
      for (const p of poses) p.keep = 0; // 飲まれた乗り手は消える
      unveilAll(); // 追うカットでは、触れたビルは今までどおり飲まれてつぶれていく
      if (stage === 'chase') { cue('erupt'); cue('burst'); updateChase(dt); return; }
      cue('space');
      if (t >= tl.rumble) cue('rumble');
      updateSpace();
      if (stage === 'done') {
        phase = 'held';
        emit('end');
      }
    },
    // 演出をやめる（2画面へ戻る）
    stop() {
      phase = 'off'; stage = 'off';
      if (focusOn) enemyView.setFocus?.(null);
      focusOn = false;
      setExplosionDust(true);
      unveilAll();
      dimLights(0);
    },
  };
  return self;
}
