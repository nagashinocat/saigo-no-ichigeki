// BGM の譜面と、先読みのスケジューラ（純粋な関数。音は鳴らさず、いつ・どの楽器を・どの高さで・どの大きさで鳴らすかだけを返す）。
// 打楽器とマリンバで煽る民族音楽風。12/8 の感じ: 1 小節 = 4 拍 = 12 刻み（フィルの連打はその半分の刻み）。
// 不穏な暗い旋法: D のフリジア（根音の半音上の E♭ がぶつかる）に増4度の A♭ を足したもの。明るい長三度・長六度はない。
// 旋律はこの曲のために書いたもの（半音で揺れる短い呼びかけと、低く答える 2 小節。2 回目は高く呼び、最後は増4度へ跳んで解決しない）。
// 底ではいつもドローン（根音と、少し低くずらした五度・増4度）がうなり、強さが上がるほど厚くなる。
// 小節によって不規則なアクセント（裏の刻みの強打・次の拍へ食い込む強打・一拍抜く）が入り、つんのめる。
//
// 強さ（0〜1）は経った時間と貯めた力で決まり、層（0〜4）になる:
//   0: 0〜15 秒   低い太鼓と、ゆったりしたマリンバ（拍の頭の音だけ）、底のドローン（根音）
//   1: 15〜40 秒  高い太鼓（スラップ）とシェイカーが加わり、旋律が全部と低い伴奏、ときどき不協和な重音とアクセント
//   2: 40 秒〜    深い太鼓・開いた高い太鼓・木の打楽器が重なり、4 小節に 1 回フィル。ドローンに増4度
//   3: 残り 10 秒 最高潮: 2 小節に 1 回フィル（マリンバの駆け上がり）と、その小節の 3 拍目に太鼓のロールと金属的に擦れる音、
//                シェイカーが倍の細かさ、旋律がオクターブで重なる、ドローンにオクターブ下
//   長押しの間は一段上（4 は最高潮の上: 毎小節フィル）
// テンポと強さは小節の頭でだけ変わり（一小節に ±3 まで）、長押しの層は拍の頭で切り替わる（拍の途中では切らない。
// 一度切り替えたら最低 2 拍は保つ）。

const ROUND = 60;
const PULSES = 12;
const BEATS = 4;

// 時間による強さ: 0→15 秒で 0.25、40 秒で 0.6、50 秒で 0.85、60 秒で 1
const TIME_KNOTS = [[0, 0], [15, 0.25], [40, 0.6], [50, 0.85], [ROUND, 1]];
const POWER_WEIGHT = 0.2;

export function intensityAt(elapsed, power) {
  const e = Math.max(0, Math.min(ROUND, elapsed));
  let v = 1;
  for (let i = 1; i < TIME_KNOTS.length; i++) {
    const [t0, v0] = TIME_KNOTS[i - 1], [t1, v1] = TIME_KNOTS[i];
    if (e <= t1) { v = v0 + (v1 - v0) * (e - t0) / (t1 - t0); break; }
  }
  return Math.min(1, v + POWER_WEIGHT * Math.max(0, Math.min(1, power)));
}

// 層 0〜4（残り 10 秒は必ず 3。長押しで +1）
export function levelFor({ elapsed, power, holding }) {
  const i = intensityAt(elapsed, power);
  let l = elapsed >= ROUND - 10 ? 3 : i < 0.25 ? 0 : i < 0.6 ? 1 : i < 0.85 ? 2 : 3;
  if (holding) l += 1;
  return Math.min(4, l);
}

// テンポ（付点四分の拍の数 / 分）
export const QUIET_TEMPO = 58;
export const tempoFor = (intensity) => 84 + 32 * intensity;
const TEMPO_STEP = 3;
export const nextTempo = (prev, target) => prev + Math.max(-TEMPO_STEP, Math.min(TEMPO_STEP, target - prev));

// 暗い旋法（D からの半音の数）: D E♭ F G A♭ A B♭ C
export const MODE = [0, 1, 3, 5, 6, 7, 8, 10];
const inMode = (n) => MODE.includes(((n % 12) + 12) % 12);
// 旋法の外の音は半音下の旋法の音へ寄せる（伴奏が根音とともに動くとき）
const snap = (n) => (inMode(n) ? n : n - 1);
// D4 からの半音の数 → 再生の速さ（マリンバは D4 で作ってある）
export const noteRate = (semis) => 2 ** (semis / 12);

// 旋律（8 小節）: [刻み, D4 からの半音]
export const MELODY = [
  [[0, 0], [3, 1], [5, 0], [6, -2], [9, 0], [10, 1]],   // 呼びかけ: D と E♭ の半音で揺れる
  [[0, 3], [2, 1], [3, 0], [6, 6], [8, 1]],             // 増4度（A♭）へ跳ぶ
  [[0, -2], [3, -4], [4, -5], [6, -6], [9, -5], [11, -4]], // 低く答える: 半音で這い下りる
  [[0, -5], [3, -6], [6, -5]],                          // A と A♭ の間で止まる
  [[0, 7], [3, 8], [5, 7], [6, 6], [9, 7], [10, 8]],    // 高く呼ぶ
  [[0, 12], [2, 8], [3, 7], [6, 13], [8, 8]],           // 増4度の跳躍（A → E♭5）
  [[0, 6], [3, 5], [4, 3], [6, 1], [9, 3], [11, 1]],    // 答えて下りる
  [[0, 1], [3, 0], [4, 1], [6, 0], [9, 6]],             // 根音へ戻りかけて、増4度へ跳んで解決しない
];
// 低い伴奏（マリンバの左手）: 根音からの半音（根音・五度・半音上・増4度）。小節ごとの根音（D3 から: D D E♭ E♭ D D C A♭）
const OSTINATO = [[0, 0], [2, 7], [3, 0], [5, 1], [6, 0], [8, 7], [9, 1], [11, 6]];
const OST_ROOT = [0, 0, 1, 1, 0, 0, -2, -6];
const ostRate = (root, iv) => noteRate(-12 + root + snap(root + iv) - root);

// ドローン（D2 で作ってある）: [半音, 音量]。五度はわずかに低く（-14 セント）ずらしてうなる。層が上がるほど厚く
const FIFTH_FLAT = 7 - 0.14;
const DRONE = [
  [[0, 1]],
  [[0, 1], [FIFTH_FLAT, 0.5]],
  [[0, 1], [FIFTH_FLAT, 0.55], [6, 0.32]],
  [[0, 1.1], [FIFTH_FLAT, 0.65], [6, 0.42], [-12, 0.55]],
  [[0, 1.2], [FIFTH_FLAT, 0.72], [6, 0.5], [-12, 0.62]],
];
const DRONE_QUIET = [[0, 1], [FIFTH_FLAT, 0.4]];
// ドローンの一音は小節より長く重なって鳴るので、小節の長さに比例した音量にする（テンポが変わっても底の厚さは同じ）
const DRONE_REF_BAR = 2.4;
// ゆっくり読む音（オクターブ下: 速さ 0.5）は 1/速さ 倍長く鳴り、その分多く重なるので、速さに比例して小さくする。
// 速く読む音（五度・増4度）は持ち主が選んだ響きのまま（大きくはしない）
const droneGain = (n, g, barDur, quiet = 1) => GAIN.drone * quiet * g * Math.min(1, noteRate(n)) * barDur / DRONE_REF_BAR;

// 打楽器の型: 刻み → 強さ（層ごと）
const LOW = [{ 0: 1, 7: 0.5 }, { 0: 1, 5: 0.55, 7: 0.7 }, { 0: 1, 3: 0.4, 5: 0.6, 7: 0.8, 9: 0.45 }];
const DEEP = [null, null, { 0: 1 }, { 0: 1, 6: 0.75 }, { 0: 1, 6: 0.75, 9: 0.6 }];
const SLAP = [null, { 3: 0.8, 9: 0.9 }, { 3: 0.8, 4: 0.4, 9: 0.9, 11: 0.5 }, { 1: 0.3, 3: 0.8, 4: 0.4, 8: 0.35, 9: 0.9, 11: 0.5 }];
const TONE = [null, null, { 6: 0.7, 7: 0.4 }, { 6: 0.7, 7: 0.4, 10: 0.5 }];
const WOOD = [null, null, { 0: 0.8, 2: 0.5, 5: 0.7, 7: 0.6, 8: 0.5, 10: 0.7 }, null, { 0: 0.8, 2: 0.5, 5: 0.7, 7: 0.6, 8: 0.5, 10: 0.7, 11: 0.5 }];
const pick = (arr, l) => { for (let i = Math.min(l, arr.length - 1); i >= 0; i--) if (arr[i] !== undefined) return arr[i]; return null; };
const at = (arr, l) => (l < arr.length ? arr[l] : arr[arr.length - 1]);

// 楽器ごとの音量と左右
const GAIN = { marimba: 0.5, ost: 0.27, low: 0.85, deep: 0.8, slap: 0.38, tone: 0.36, shaker: 0.13, wood: 0.22, soft: 0.42, drone: 0.2, accent: 0.8, scrape: 0.16 };
const PAN = { melody: 0.12, ost: -0.12, low: 0, deep: 0, slap: -0.28, tone: -0.22, shaker: 0.42, wood: -0.42 };

// 不規則なアクセント（小節ごとに決まる）: 'off' 裏の刻みの強打 / 'push' 4 拍目の頭の直前へ食い込む強打（4 拍目の頭の低い太鼓は抜く）/
// 'drop' 3 拍目の打楽器を抜く / null ふつう。8 小節の頭はいつもふつう
export function accentFor(bar) {
  if (bar % 8 === 0) return null;
  let h = (bar * 374761393 + 0x51ed27) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  const k = Math.floor(16 * ((h ^ (h >>> 16)) >>> 0) / 4294967296);
  return k < 3 ? 'off' : k < 5 ? 'push' : k < 7 ? 'drop' : null;
}
// 最高潮のロールと擦れる音の小節（フィルと同じ 2 小節に 1 回）
const isRollBar = (bar, level) => level >= 3 && bar % 2 === 1;

// 少しの人の手の揺れ（決まった値: 小節・刻み・楽器から）
function wobble(bar, half, role) {
  let h = (bar * 374761393 + half * 668265263 + role.length * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return 0.92 + 0.16 * ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const isFill = (bar, level) => (level >= 4 ? true : level === 3 ? bar % 2 === 1 : level === 2 ? bar % 4 === 3 : false);

// ある拍（beat 0〜3）の音: [半刻み（0〜23）, 楽器, 速さ, 音量, 左右, 役]。barDur は小節の長さ（ドローンの音量に使う）
function playBeat(bar, beat, level, fill, barDur) {
  const out = [];
  const add = (half, voice, rate, gain, pan, role) => out.push([half, voice, rate, gain * wobble(bar, half, role), pan, role]);
  const fillBeat = fill && beat === 3;
  const roll = isRollBar(bar, level);
  const acc = level >= 1 ? accentFor(bar) : null;
  const dropped = acc === 'drop' && beat === 2 && !roll; // 一拍抜く（打楽器だけ。旋律とドローンは続く）
  const mel = MELODY[bar % MELODY.length], root = OST_ROOT[bar % OST_ROOT.length];
  if (beat === 0) {
    // 底のドローン（揺れはつけない: 重なって切れ目なく鳴る）
    for (const [n, g] of DRONE[Math.min(level, DRONE.length - 1)]) out.push([0, 'drone', noteRate(n), droneGain(n, g, barDur), 0, 'drone']);
  }
  for (let p = beat * 3; p < beat * 3 + 3; p++) {
    const h = 2 * p;
    if (!dropped) {
      const lo = at(LOW, level)[p];
      if (lo && !(fillBeat && p > 9) && !(acc === 'push' && p === 9)) add(h, 'low', 1, GAIN.low * lo, PAN.low, 'low');
      const dp = pick(DEEP, level)?.[p];
      if (dp && !fillBeat) add(h, 'deep', 1, GAIN.deep * dp, PAN.deep, 'deep');
      const sl = pick(SLAP, level)?.[p];
      if (sl && !fillBeat) add(h, 'slap', 1, GAIN.slap * sl, PAN.slap, 'slap');
      const to = pick(TONE, level)?.[p];
      if (to && !fillBeat) add(h, 'tone', 1, GAIN.tone * to, PAN.tone, 'tone');
      const wd = pick(WOOD, level)?.[p];
      if (wd) add(h, 'wood', 1, GAIN.wood * wd, PAN.wood, 'wood');
      if (level >= 1) {
        add(h, 'shaker', 1, GAIN.shaker * (p % 3 === 0 ? 1 : 0.5), PAN.shaker, 'shaker');
        if (level >= 3) add(h + 1, 'shaker', 1, GAIN.shaker * (level >= 4 ? 0.45 : 0.3), PAN.shaker, 'shaker');
      }
    }
    // 不規則なアクセント
    if (acc === 'off' && (p === 4 || p === 7)) {
      add(h, 'tone', 1, GAIN.tone * 1.25, -PAN.tone, 'accent');
      add(h, 'low', 1, GAIN.low * 0.7 * GAIN.accent, PAN.low, 'accent');
    }
    if (acc === 'push' && p === 8) {
      add(h, 'deep', 1, GAIN.deep * 0.95, PAN.deep, 'accent');
      add(h, 'slap', 1, GAIN.slap * 1.15, -PAN.slap, 'accent');
    }
    if (level >= 1) {
      const o = OSTINATO.find(([q]) => q === p);
      if (o && (level >= 2 || p % 6 === 0)) add(h, 'marimba', ostRate(root, o[1]), GAIN.ost, PAN.ost, 'ost');
    }
    const run = fillBeat && level >= 3;
    for (const [q, n] of mel) {
      if (q !== p) continue;
      if (level === 0 && p % 3 !== 0) continue; // ゆったり: 拍の頭の音だけ
      if (run && p >= 9) continue;
      add(h, 'marimba', noteRate(n), GAIN.marimba, PAN.melody, 'melody');
      if (level >= 3 || (level === 2 && p === 0)) add(h, 'marimba', noteRate(n + 12), GAIN.marimba * 0.38, -PAN.melody, 'octave');
      // ときどき不協和な重音: 半音上（4 小節に一度）と増4度上（8 小節に一度）
      if (level >= 1 && ((p === 0 && bar % 4 === 1) || (p === 6 && bar % 8 === 6))) {
        add(h, 'marimba', noteRate(n + (p === 0 ? 1 : 6)), GAIN.marimba * 0.55, -PAN.melody, 'dyad');
      }
    }
  }
  if (roll && beat === 2) {
    // 最高潮: 3 拍目に開いた太鼓のロール（半分の刻みでだんだん強く）と、金属的に擦れる音（次の小節の頭へふくらむ）
    for (let k = 0; k < 6; k++) add(12 + k, 'tone', 1, GAIN.tone * (0.3 + 0.75 * k / 5), PAN.tone * (k % 2 ? -1 : 1), 'roll');
    add(12, 'scrape', 1, GAIN.scrape, bar % 4 === 1 ? 0.5 : -0.5, 'scrape');
  }
  if (fillBeat) {
    // 最後の拍: 半刻みのスラップの連打がだんだん強く、低い太鼓で締める。最高潮はマリンバが暗い旋法で駆け上がる
    for (let k = 0; k < 6; k++) add(18 + k, 'slap', 1, GAIN.slap * (0.35 + 0.65 * k / 5), PAN.slap * (k % 2 ? -1 : 1), 'fill');
    add(22, 'low', 1, GAIN.low * 0.8, PAN.low, 'low');
    if (level >= 3) {
      add(22, 'deep', 1, GAIN.deep * 0.9, PAN.deep, 'deep');
      for (let k = 0; k < 6; k++) add(18 + k, 'marimba', noteRate(MODE[k]), GAIN.marimba * (0.45 + 0.35 * k / 5), PAN.melody, 'run');
    }
  }
  return out;
}

// 静かな変奏（リプレイと結果画面）: 同じ暗い旋律を柔らかいマリンバで、拍の頭の音にはオクターブ上の小さなこだま。
// 根音と五度（4 小節に一度は増4度）の柔らかい低音、底にかすかなドローン、2 小節に一度の小さな低い太鼓、拍の頭のかすかなシェイカー
function quietBeat(bar, beat, barDur) {
  const out = [];
  const add = (half, voice, rate, gain, pan, role) => out.push([half, voice, rate, gain * wobble(bar, half, role), pan, role]);
  const mel = MELODY[bar % MELODY.length], root = OST_ROOT[bar % OST_ROOT.length];
  if (beat === 0) for (const [n, g] of DRONE_QUIET) out.push([0, 'drone', noteRate(n), droneGain(n, g, barDur, 0.5), 0, 'drone']);
  for (let p = beat * 3; p < beat * 3 + 3; p++) {
    const h = 2 * p;
    if (p === 0) add(h, 'marimbaSoft', noteRate(root - 12), GAIN.soft * 0.55, -0.15, 'ost');
    if (p === 6) add(h, 'marimbaSoft', noteRate(root - 12 + (bar % 4 === 3 ? 6 : 7)), GAIN.soft * 0.4, -0.15, 'ost');
    if (p === 0 && bar % 2 === 0) add(h, 'low', 1, GAIN.low * 0.3, 0, 'low');
    if (p % 6 === 0) add(h, 'shaker', 1, GAIN.shaker * 0.35, 0.35, 'shaker');
    for (const [q, n] of mel) {
      if (q !== p) continue;
      add(h, 'marimbaSoft', noteRate(n), GAIN.soft, 0.1, 'melody');
      if (p % 3 === 0) add(h + 2, 'marimbaSoft', noteRate(n + 12), GAIN.soft * 0.22, 0.4, 'echo');
    }
  }
  return out;
}

// 引き伸ばし（ブラックホール）: 曲の中の時間 m（引き伸ばしを始めてからの秒）が、実際の時刻 time(m) に鳴る。
// 再生の速さ rate(τ) は実際の時間 τ とともに指数で下がり（音程が下がり、間隔が開く）、音量と明るさは sec 秒で消える。
// 左右は渦のようにだんだん速く回る。
export function stretchWarp(sec, rMin = 0.12) {
  const k = -Math.log(rMin) / sec;
  const mMax = (1 - rMin) / k; // sec 秒の間に進む曲の中の時間
  return {
    sec, mMax,
    time: (m) => (m >= mMax ? Infinity : -Math.log(1 - k * m) / k),
    rate: (tau) => Math.exp(-k * Math.min(tau, sec)),
    fade: (tau) => Math.max(0, 1 - tau / sec) ** 1.3,
    cutoff: (tau) => 9000 * (160 / 9000) ** Math.min(1, tau / sec),
    pan: (tau) => 0.8 * Math.sin(2 * Math.PI * (0.35 * tau + 0.45 * tau * tau)),
  };
}

const HISTORY_MAX = 256;
const HOLD_MIN_BEATS = 2;

// 先読みのスケジューラ。advance(until, cond) で、until より前に始まる拍をすべて作り、その音を時刻順に返す。
// cond(t) は { elapsed, power, holding }（その拍を作るときに読む）。小節の頭で強さ・テンポ・フィルを決める。
// tempo: 決まったテンポで鳴らす（S6 の導入: 小節の頭を画面の出来事にそろえる。省けば強さで動く）
export function createSequencer({ start = 0, mode = 'play', tempo: fixedTempo = null } = {}) {
  let pos = start; // 次の拍の頭（曲の中の時刻）
  let bar = 0, beat = 0;
  let tempo = fixedTempo ?? (mode === 'quiet' ? QUIET_TEMPO : tempoFor(0));
  let cur = null; // 今の小節の取り決め
  let warp = null; // 引き伸ばし { at, w }
  let done = false;
  let keepBar = false; // 引き伸ばしで小節の途中（または頭）へ戻ったとき、その小節の取り決めをそのまま使う
  let hold = false, dwell = HOLD_MIN_BEATS; // 長押しの層（切り替えたら最低 HOLD_MIN_BEATS 拍は保つ）
  const history = [];
  // 作った拍の頭ごとの状態（rewind で、その拍から作り直すため）。引き伸ばし・静かな変奏の拍は残さない
  let marks = [];

  function beginBar(c) {
    let level, gainScale, intensity;
    if (mode === 'quiet') { tempo = QUIET_TEMPO; level = 0; gainScale = 0.5; intensity = 0; }
    else {
      intensity = intensityAt(c.elapsed, c.power);
      if (fixedTempo) tempo = fixedTempo;
      else if (history.length && history.at(-1).mode === mode) tempo = nextTempo(tempo, tempoFor(intensity));
      level = levelFor({ ...c, holding: false });
      gainScale = 0.62 + 0.38 * (c.elapsed >= ROUND - 10 ? 1 : intensity);
    }
    const holdAtStart = mode === 'play' && hold;
    cur = { bar, t: pos, tempo, level, mode, gainScale, intensity, fill: mode === 'play' && isFill(bar, Math.min(4, level + (holdAtStart ? 1 : 0))) };
    history.push(cur);
    if (history.length > HISTORY_MAX) history.shift();
  }

  // 曲の中の時刻 → 実際の時刻と、引き伸ばしの係数
  function place(m) {
    if (!warp) return { t: m, tau: 0 };
    const tau = warp.w.time(m - warp.at);
    return { t: warp.at + tau, tau };
  }

  return {
    history,
    get done() { return done; },
    get tempo() { return tempo; },
    get bar() { return bar; },
    get mode() { return mode; },
    advance(until, cond) {
      const events = [];
      while (!done) {
        const first = place(pos);
        if (!(first.t < until)) break;
        if (!warp && mode === 'play') {
          marks.push({ pos, bar, beat, tempo, cur, hold, dwell, keepBar });
          if (marks.length > HISTORY_MAX) marks.shift();
        }
        const c = cond(first.t);
        if (!!c.holding !== hold && dwell >= HOLD_MIN_BEATS) { hold = !!c.holding; dwell = 0; }
        dwell++;
        if (beat === 0 && !keepBar) beginBar(c);
        keepBar = false;
        const beatDur = 60 / cur.tempo, half = beatDur / 6;
        const level = cur.mode === 'quiet' ? 0 : Math.min(4, cur.level + (hold ? 1 : 0));
        const notes = cur.mode === 'quiet' ? quietBeat(cur.bar, beat, BEATS * beatDur) : playBeat(cur.bar, beat, level, cur.fill, BEATS * beatDur);
        for (const [h, voice, rate, gain, pan, role] of notes) {
          const m = cur.t + h * half;
          if (warp && m < warp.at - 1e-9) continue; // 引き伸ばしの前に鳴り終えた分
          const { t, tau } = place(m);
          if (!Number.isFinite(t)) continue;
          if (warp) {
            const g = warp.w.fade(tau);
            if (g <= 0) continue;
            events.push({ t, voice, rate: rate * warp.w.rate(tau), gain: gain * cur.gainScale * g, pan: warp.w.pan(tau), role, stretch: warp.w.rate(tau), gainScale: cur.gainScale });
          } else events.push({ t, voice, rate, gain: gain * cur.gainScale, pan, role, gainScale: cur.gainScale });
        }
        pos += beatDur;
        if (++beat === BEATS) { beat = 0; bar++; }
        if (warp && !Number.isFinite(place(pos).t)) done = true;
      }
      events.sort((a, b) => a.t - b.t);
      return events;
    },
    // 時刻 at より後に頭がある、もう作った拍を作り直す（長押しが変わったとき。先読みが長くても、変わったあとの拍は新しい
    // 長押しの状態で作る）。作り直す最初の拍の頭の時刻を返す（鳴らす側はそれより後の音を取り消す）。作り直す拍がなければ null
    rewind(at) {
      if (warp || mode !== 'play') return null;
      const i = marks.findIndex((m) => m.pos >= at - 1e-9);
      if (i < 0) return null;
      const m = marks[i];
      ({ pos, bar, beat, tempo, cur, hold, dwell, keepBar } = m);
      // その拍の頭より後に始めた小節の取り決めは捨てる（拍が小節の頭なら、作り直すときに決め直す）
      while (history.length && history.at(-1).t >= m.pos - 1e-9) history.pop();
      marks = marks.slice(0, i);
      return m.pos;
    },
    // 時刻 at から静かな変奏を一小節目として始め直す（それより後に作った音は、鳴らす側が取り消す）
    setMode(next, at) {
      marks = [];
      mode = next; pos = at; bar = 0; beat = 0; warp = null; done = false; keepBar = false;
      tempo = next === 'quiet' ? QUIET_TEMPO : tempoFor(0);
    },
    // 時刻 at から sec 秒で引き伸ばして消える。at を含む拍から作り直す（at より後に作った音は、鳴らす側が取り消す）
    stretch(at, sec) {
      const b = [...history].reverse().find((x) => x.t <= at + 1e-9) ?? history.at(-1);
      if (b) {
        const beatDur = 60 / b.tempo;
        const k = Math.max(0, Math.min(BEATS - 1, Math.floor((at - b.t) / beatDur + 1e-9)));
        // 拍が小節の外（at が先読みより先）なら、今の位置のまま
        if (at - b.t < BEATS * beatDur) { cur = b; tempo = b.tempo; bar = b.bar; beat = k; pos = b.t + k * beatDur; keepBar = true; }
      }
      warp = { at, w: stretchWarp(sec) };
    },
  };
}
