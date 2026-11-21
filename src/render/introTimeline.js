import { createRng } from '../rng.js';

// 導入のアニメーションの時刻表（S6。持ち主 11:15 / 13:06 / 15:55）。描く側・音・撮影・録画が同じ時刻を使う純粋な関数。
// 流れ（15:55）: 1 バイクが頭上を抜ける → 2 黒に白の縦書き「ありったけを」→ 3 主人公がライトに捉えられる →
// 4 「解き放て」→ 5 ビルのすき間へ隠れる（そこが爆心）→ 6 手のアップ（貯め始め → 最後の一撃を放つ瞬間に握り込む）→
// 7 真っ白 → 8 「最後の一撃」が 1 文字ずつ十字の星が弾けて生まれる → 9 TAP START。
// リトライは 8 の短いものだけ（音は鳴らせない。ページを読み直すとブラウザがまた操作を待つため）。
export const INTRO = {
  beats: [
    { name: 'bikes', dur: 2.2 },
    // カード（持ち主 19:04「文字の画面の切り替わりがちょっと早い」）: 真っ黒を INTRO.card.black 秒見せてから文字
    { name: 'cardA', dur: 1.7, text: 'ありったけを' },
    { name: 'light', dur: 2.4 }, // 持ち主 18:04: バイクのライトがスポットライトのように一つから増えていく（1.8 → 2.4 秒）
    { name: 'cardB', dur: 1.7, text: '解き放て' },
    { name: 'hide', dur: 2.2 },
    // 真っ暗な中に力の球がぼうっと浮き上がる（持ち主 19:04。隠れる → 手のアップのつなぎ）
    { name: 'orb', dur: 0.75 },
    { name: 'hands', dur: 2.5 },
    { name: 'white', dur: 0.4 },
  ],
  // 題字: 最初の文字まで lead 秒、step 秒おき。文字は burst 秒の星から生まれ、settle 秒で落ち着く。
  // 最後の文字の buttonGap 秒あとに TAP START が buttonFade 秒で出る。白は flashOut 秒で黒へ引く
  // 持ち主 20:47: 5 文字が出そろって（最後の「撃」の bhGap 秒あと）から、「の」の後ろにブラックホールが点から bhGrow 秒で開く。
  // 開ききって buttonGap 秒あとに TAP START
  title: { text: '最後の一撃', lead: 0.2, step: 0.22, burst: 0.6, settle: 0.32, bhGap: 0.4, bhGrow: 0.8, buttonGap: 0.2, buttonFade: 0.5, flashOut: 0.07 },
  shortTitle: { lead: 0.25, step: 0.16, burst: 0.5, settle: 0.28, bhGap: 0.3, bhGrow: 0.6, buttonGap: 0.15, buttonFade: 0.4, flashOut: 0 },
  // カードの叩きつけ: overshoot 秒で大きめから縮んで止まる、揺れ shake 秒、粒子の閃き grain 秒
  card: { black: 0.4, overshoot: 0.16, scale0: 1.2, shake: 0.22, grain: 0.12 },
  // 3: ライトが主人公を捉える（拍の中の秒）。すくむ
  // 3: スポットライトが一つずつ主人公を捉え（LIGHT_BIKES の lockAt）、十字砲火に縫い止められてすくむ
  light: { flinchAt: 1.36 },
  // 走り（足が地面を打つ間隔 stride 秒）: ライトの拍ですくんだ runFrom 秒あと〜、隠れる拍の 0〜stopAt 秒
  run: { stride: 0.26, afterFlinch: 0.42, hideStop: 1.0 },
  // 6: 手。貯め始め（ignite 秒で球が灯る）→ grow 秒で満ちる → releaseAt で放つ（握り込む）
  // releaseAt: 放つ瞬間。録画の 30 fps のコマの頭にそろえる（手の拍の頭 10.95 + 1.75 = 12.7 秒 = 381 コマ目。テストあり）
  // clampFrame: 放ってから組んだ手が初めて映るまで（30 fps の 1 コマ）。握り込みの音と音楽を止める所
  hands: { ignite: 0.3, grow: 1.3, releaseAt: 1.75, flash: 0.2, clampFrame: 1 / 30 },
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

export function createIntroTimeline({ short = false } = {}) {
  const T = short ? INTRO.shortTitle : INTRO.title;
  const beats = [];
  let t = 0;
  if (!short) for (const b of INTRO.beats) { beats.push({ ...b, start: t, end: t + b.dur }); t += b.dur; }
  const titleStart = t;
  const chars = [...INTRO.title.text].map((ch, i) => ({ ch, t: titleStart + T.lead + i * T.step }));
  const lastChar = chars[chars.length - 1].t;
  // 最後の文字が出きって（settle）から bhGap 秒でブラックホールが開き始める
  const bhAt = lastChar + T.settle + T.bhGap;
  const buttonAt = bhAt + T.bhGrow + T.buttonGap;
  const total = buttonAt + T.buttonFade;
  beats.push({ name: 'title', dur: total - titleStart, start: titleStart, end: total });
  const byName = Object.fromEntries(beats.map((b) => [b.name, b]));
  return {
    short, beats, chars, bhAt, buttonAt, total, title: T,
    // 1〜7 拍のどこで飛ばしても、題字の終わり（TAP START が出ている）へ
    skipTarget: total,
    beat: (name) => byName[name],
    // 時刻 t の拍（name, index, local: 拍の中の秒）。前は最初の拍、後ろは最後の拍の終わり
    beatAt(time) {
      const x = Math.min(Math.max(time, 0), total);
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        if (x < b.end || i === beats.length - 1) return { name: b.name, index: i, local: Math.min(x, b.end) - b.start, beat: b };
      }
      return null;
    },
    // 題字の様子: chars[i] = { ch, k（現れ 0〜1）, burst（星の弾け 0〜1。始まる前は -1）}, button（0〜1）、
    // flash（白の残り 0〜1）
    titleState(time) {
      const local = time - titleStart;
      return {
        chars: chars.map((c) => {
          const d = time - c.t;
          return { ch: c.ch, k: d < 0 ? 0 : smooth(d / T.settle), burst: d < 0 ? -1 : clamp01(d / T.burst), age: d };
        }),
        // ブラックホールの開き（0: まだ、点から 1: 開ききった）
        bh: clamp01((time - bhAt) / T.bhGrow),
        button: time >= total ? 1 : clamp01((time - buttonAt) / T.buttonFade),
        flash: short || local < 0 ? (local < 0 ? 1 : 0) : Math.exp(-local / Math.max(1e-3, T.flashOut)),
      };
    },
  };
}

// ---- 1: バイク（街の通りの座標。カメラは通りの中心の低い位置で、奥（-z）を見上げる）----
// pos: カメラの位置、look: 見る点（m）。バイクは奥から手前（+z）へ抜け、tp 秒にカメラの真上（同じ z）を通る
export const BIKE_CAM = { pos: [0, 0.55, 0], look: [0, 9.5, -40], fov: 66 };
const BIKE_SEED = 0x51a7e;
export const HERO_BIKE = 3; // 見せ場の一台（introBikes の番号）

export function introBikes(seed = BIKE_SEED) {
  const rng = createRng(seed);
  const n = 6;
  const out = [];
  // 通る時刻: 最初の拍の中に散らす（最初は少し待たせ、最後の 2 台は続けて）
  const tps = [0.5, 0.86, 1.12, 1.46, 1.74, 1.9];
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    // S6 fix1: 一台だけは見せ場の「抜き」。ゆっくりめに、レンズのすぐ上を通り、乗り手とバイクの形がはっきり読める
    if (i === HERO_BIKE) { rng(); rng(); rng(); rng(); rng(); out.push({ id: i, tp: 1.56, x: 0.3, y: 2.25, v: 34, roll: 0.12, weave: 0.2, hero: true }); continue; }
    out.push({
      id: i,
      tp: tps[i] + (rng() - 0.5) * 0.06,
      x: side * (0.35 + 1.35 * rng()), // 縦長の画面は横が狭いので、カメラの近くを通す
      y: 2.6 + 2.4 * rng(),
      v: 62 + 24 * rng(),
      roll: side * (0.12 + 0.25 * rng()),
      weave: 0.4 + 0.6 * rng(),
    });
  }
  return out;
}

// 時刻 t（導入の秒）のバイクの位置と向き（通りの座標）。yaw 0 で +z（手前）を向く
export function bikeAt(b, t) {
  const d = t - b.tp;
  return {
    x: b.x + b.weave * Math.sin(d * 2.2) * 0.4 * Math.min(1, Math.abs(d) * 2),
    y: b.y,
    z: BIKE_CAM.pos[2] + d * b.v,
    yaw: -0.04 * b.weave * Math.cos(d * 2.2),
    pitch: 0.18, roll: b.roll,
  };
}

// 風切りの聞こえ方（13:06 音は画面に合わせる）: 左右 pan（画面の x の側）、大きさ gain（近いほど大きい。一番近い瞬間が最大）、
// 速さの比 rate（ドップラー: 近づくと高く、遠ざかると低い）、距離 dist（m）
const SOUND_C = 343;
export function whooshAt(b, t) {
  const p = bikeAt(b, t), dt = 1 / 240, q = bikeAt(b, t + dt);
  const [cx, cy, cz] = BIKE_CAM.pos;
  const rx = p.x - cx, ry = p.y - cy, rz = p.z - cz;
  const dist = Math.hypot(rx, ry, rz);
  // 近づく速さ（遠ざかると正）
  const dist2 = Math.hypot(q.x - cx, q.y - cy, q.z - cz);
  const vr = (dist2 - dist) / dt;
  const rate = Math.min(1.6, Math.max(0.6, SOUND_C / (SOUND_C + vr)));
  const pan = Math.max(-1, Math.min(1, (rx / Math.max(1, dist)) * 1.8));
  const gain = 1 / (1 + (dist / 4) ** 2);
  return { pan, gain, rate, dist };
}

// ---- 5: すき間の開口部を横切る光の筋（隠れる拍の中の秒）----
// u: 開口部の横の位置（-1 左 → 1 右）、pan: その左右
export function introStreaks() {
  return [
    { id: 0, t: 0.78, dur: 0.22, dir: 1, y: 0.55, depth: 0.2 },
    { id: 1, t: 1.12, dur: 0.18, dir: -1, y: 0.35, depth: 0.6 },
    { id: 2, t: 1.42, dur: 0.24, dir: 1, y: 0.7, depth: 0.35 },
    { id: 3, t: 1.62, dur: 0.16, dir: 1, y: 0.45, depth: 0.8 },
    { id: 4, t: 1.9, dur: 0.2, dir: -1, y: 0.6, depth: 0.15 },
  ];
}
export function streakAt(s, local) {
  const u = ((local - s.t) / s.dur) * 2 * s.dir;
  return { u, pan: Math.max(-1, Math.min(1, u * 0.9)), on: Math.abs(u) <= 1.4 };
}

// ---- 3・5: 主人公の通り道と、撮るカメラ（その拍の撮る場所のローカルの座標。カメラは奥（-z）を見る）----
// 3（持ち主 19:04）: 追い詰められた主人公（すぐ後ろに壁）を、バイクのライトが正面から照らす。カメラはバイクの後ろ・間から主人公を見る
export const LIGHT_SHOT = { hero: [0.3, -7.6], walk: 0, wall: -9, cam: { pos: [0.4, 1.45, 6], look: [0.25, 1.3, -8], fov: 46 } };
// 主人公の正面に浮かぶバイク（ローカルの座標。画面の手前の左右に後ろ姿が見える）。arrive 秒かけて飛び込み、lockAt 秒にライトが主人公をとらえる
export const LIGHT_BIKES = [
  { id: 0, pos: [0.9, 1.9, -0.5], lockAt: 0.16, from: [4, 6, 6] },
  { id: 1, pos: [-2.6, 2.3, 0.8], lockAt: 0.62, from: [-9, 7, 5] },
  { id: 2, pos: [3.2, 1.5, 1.5], lockAt: 0.84, from: [10, 4, 6] },
  { id: 3, pos: [-1.4, 1.2, 2.6], lockAt: 1.02, from: [-6, 2, 10] },
  { id: 4, pos: [2.0, 2.6, 3.4], lockAt: 1.16, from: [7, 9, 12] },
];
const ARRIVE = 0.4;
// 拍の中の秒 local のバイクの位置（ローカル）と、ライトが主人公をどれだけ捉えたか lock（0〜1）、見えているか on
export function lightBikeAt(b, local) {
  const a = smooth((local - (b.lockAt - ARRIVE)) / ARRIVE);
  const k = 1 - (1 - a) ** 3;
  const bob = 0.25 * Math.sin(local * 2.3 + b.id * 1.7), orbit = 0.7 * Math.sin(local * 0.9 + b.id);
  return {
    x: b.from[0] + (b.pos[0] - b.from[0]) * k + orbit, y: b.from[1] + (b.pos[1] - b.from[1]) * k + bob, z: b.from[2] + (b.pos[2] - b.from[2]) * k + 0.5 * orbit,
    lock: smooth((local - b.lockAt) / 0.07), on: local > b.lockAt - ARRIVE,
  };
}
// そのバイクのカメラから見た左右（ライトの拍のカメラ）
export function lightBikePan(b, local) {
  const p = lightBikeAt(b, local);
  return camPan(LIGHT_SHOT.cam, p.x, p.z);
}
function camPan(cam, x, z) {
  const fx = cam.look[0] - cam.pos[0], fz = cam.look[2] - cam.pos[2], n = Math.hypot(fx, fz);
  const rx = -fz / n, rz = fx / n;
  const dx = x - cam.pos[0], dz = z - cam.pos[2];
  const side = dx * rx + dz * rz, fwd = (dx * fx + dz * fz) / n;
  return Math.max(-1, Math.min(1, (side / Math.max(1, Math.hypot(side, fwd))) * 1.8));
}
export const HIDE_SHOT = { open: -17, from: [0.45, -16.6], to: [-0.72, -5.4], cam: { pos: [0.32, 1.02, 0], look: [-0.3, 1.5, -12], fov: 62 } };
// 拍 name の中の秒 local の主人公の足元 { x, z }（ローカル）と、走り出してからの秒 run（走っていなければ null）
export function heroPath(name, local) {
  if (name === 'light') {
    const fl = INTRO.light.flinchAt, runFrom = fl + INTRO.run.afterFlinch - 0.13;
    let x = LIGHT_SHOT.hero[0], z = LIGHT_SHOT.hero[1] + Math.min(local, fl) * LIGHT_SHOT.walk, run = null;
    if (local >= runFrom) {
      const u = local - runFrom, k = smooth(u / 0.25);
      x += 2.6 * u * u + 3.2 * u * k;
      z += 0.6 * u * k;
      run = u;
    }
    return { x, z, run, runFrom };
  }
  if (name === 'hide') {
    const u = clamp01(local / INTRO.run.hideStop), e = 1 - (1 - u) ** 2;
    const { from, to } = HIDE_SHOT;
    return { x: from[0] + (to[0] - from[0]) * e, z: from[1] + (to[1] - from[1]) * e, run: local, runFrom: 0 };
  }
  return null;
}
// 足音の左右: その瞬間の主人公の、カメラから見た左右（画面の x の側）
export function heroPan(tl, t) {
  const b = tl.beatAt(t);
  const p = heroPath(b.name, b.local);
  if (!p) return 0;
  return camPan((b.name === 'light' ? LIGHT_SHOT : HIDE_SHOT).cam, p.x, p.z);
}

// ---- 3・5: 走る足が地面を打つ時刻（導入の秒）----
export function introRunFeet(tl) {
  const out = [];
  const { stride, afterFlinch, hideStop } = INTRO.run;
  const light = tl.beat('light'), hide = tl.beat('hide');
  if (!light || !hide) return out;
  for (let t = light.start + INTRO.light.flinchAt + afterFlinch; t < light.end - 1e-9; t += stride) out.push(+t.toFixed(6));
  for (let t = hide.start + 0.04; t < hide.start + hideStop; t += stride) out.push(+t.toFixed(6));
  return out;
}

// ---- 6: 手（拍の中の秒）: level 貯めた力 0〜1、active 長押し中 ----
export function introHands(local) {
  const H = INTRO.hands;
  if (local >= H.releaseAt) return { level: 0, active: false };
  const ig = smooth(local / H.ignite);
  const grow = smooth((local - H.ignite) / H.grow);
  return { level: 0.04 + 0.14 * ig + 0.82 * grow ** 1.4, active: true };
}

// ---- 音の合図（導入の秒の順）: flinch / step / grip / white（持ち主 19:05: スポットライトには音をつけない） ----
// 持ち主 18:02: 文字の拍（カード・「最後の一撃」の各文字）は効果音なし（BGM だけ）。画面の出来事の音だけを合図にする
export function introCues(tl) {
  const cues = [];
  // スポットライトの拍（すくむ・逃げ出す足音・街のざわめきも）は効果音なし、BGM だけ（持ち主 19:05）。足音はすき間へ駆け込む所だけ
  const light = tl.beat('light');
  for (const t of introRunFeet(tl)) if (!light || t >= light.end) cues.push({ t, name: 'step' });
  // 握り込みの音は、組んだ手が初めて映るコマ（音楽を止める所と同じ）
  if (tl.beat('hands')) cues.push({ t: tl.beat('hands').start + INTRO.hands.releaseAt + INTRO.hands.clampFrame, name: 'grip' });
  if (tl.beat('white')) cues.push({ t: tl.beat('white').start, name: 'white' });
  return cues.sort((a, b) => a.t - b.t);
}
