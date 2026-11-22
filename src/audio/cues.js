// R1（spec §15）: 払うの腕前（×k）と大物が来た知らせの音のレシピ（純粋な数。audio.js が Web Audio で鳴らす）。
// どちらもオリジナルの合成音。音は画面に従う（持ち主 13:06）: 左右（pan）は画面の出来事の場所から決め（main.js が今のカメラから）、
// 鳴る時刻はゲームの知らせ（combo / bossArrive）のフレーム。大きさはリミッターの天井より十分下（重なっても割れない）

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 画面の左右: カメラの空間の (camX, camZ) から -0.95〜0.95（collapse.js の崩れる音と同じ式）
export const screenPan = (camX, camZ) => clamp((camX / (Math.abs(camX) + Math.abs(camZ) + 1e-6)) * 1.3, -0.95, 0.95);

// 払うの腕前の音: k 体目（3 から）を払った瞬間の、澄んだ金属の二音（上の音は 5 度上）と、ちいさなきらめきのノイズ。
// k が一つ増えるたびに全音ずつ上がる（一度の払うで ×3 → ×4 → … と上る音の列になる）。高さは 9 段（×11）で止まる
export const COMBO_CUE = { base: 784, step: 2, maxStep: 8, dur: 0.32, gain: 0.16, fifth: 1.5, sparkle: 0.05 };
export function comboRecipe(k, C = COMBO_CUE) {
  const s = clamp(Math.round(k) - 3, 0, C.maxStep);
  const f = C.base * 2 ** ((s * C.step) / 12);
  const g = C.gain * (1 + 0.04 * s);
  return {
    tones: [
      { type: 'triangle', f, dur: C.dur, gain: g, attack: 0.004 },
      { type: 'sine', f: f * C.fifth, dur: C.dur * 0.8, gain: g * 0.55, attack: 0.004, when: 0.035 },
    ],
    sparkle: { dur: 0.09, freq: Math.min(12000, f * 6), gain: C.sparkle, q: 2.5 },
  };
}

// 大物が来た音: 遠くで重い警笛が二度うなる（低い鋸歯の和音が low-pass を開きながらふくらんで消える。二つの音は短 2 度の不協和）と、
// 探照灯が点く重い「ガチン」（帯域のノイズの一打と低い一打）。near（0〜1）で近いほど大きく明るい
export const BOSS_CUE = {
  horn: { f: [49, 52], dur: 1.5, gain: 0.13, lp: [180, 900], attack: 0.35, gap: 0.55 },
  clank: { when: 0.05, dur: 0.12, freq: 2600, gain: 0.12, q: 3 },
  thud: { when: 0.05, f0: 120, f1: 50, dur: 0.25, gain: 0.18 },
};
export function bossRecipe({ near = 0.5 } = {}, C = BOSS_CUE) {
  const k = 0.65 + 0.35 * clamp(near, 0, 1);
  const H = C.horn;
  const horns = [0, H.gap].map((when, i) => ({
    when, dur: H.dur - i * 0.2, gain: H.gain * k * (i ? 0.8 : 1), attack: H.attack,
    f: H.f.map((x) => x * (i ? 0.94 : 1)), lp: [H.lp[0], H.lp[1] * (0.7 + 0.3 * k)],
  }));
  return { horns, clank: { ...C.clank, gain: C.clank.gain * k }, thud: { ...C.thud, gain: C.thud.gain * k } };
}

// 一つのレシピが同時に鳴らす声の大きさの合計（天井の確かめ用。和音・重なりの足し算の上限）
export function recipePeak(r) {
  if (r.tones) return r.tones.reduce((a, t) => a + t.gain, 0) + r.sparkle.gain;
  return r.horns.reduce((a, h) => a + h.gain * h.f.length, 0) + r.clank.gain + r.thud.gain;
}

// R1b（持ち主 08:24「吸われてる音と画面点滅入れた方がいいかな」）: 吸われる音。掴まれている間ずっと鳴る、オリジナルの合成音:
//   hiss  帯域ノイズの吸い込み。画面の縁の脈打ち（drainFx の phase、1 秒に 3 回より少ない）の一回ごとに、帯が高い所から低い所へ下がる
//   whine うねりながら下がる細い唸り（三角波。warble の速さ・深さで揺れる）
// k: 強さ 0〜1（drainFx。掴んでいる者の吸う力の合計）。強いほど大きく、低く。phase: 脈打ちの位相 0〜1（山は 0.5）。
// audio.js が毎フレーム、この値へなめらかに寄せる。hiss の gain は帯域を通す前の白いノイズに掛ける（帯域を通ると振れ幅は約 1/4）。
// 実際の出口の大きさは scripts/drain-preview.mjs で測る（ふつうの者 1 人で約 −24 dBFS、6 人で約 −14 dBFS。天井より十分下）
export const DRAIN_CUE = {
  hiss: { hi: 2600, lo: 650, q: 1.6, gain: 0.4, floor: 0.35, deepen: 0.3 },
  whine: { f: 640, drop: 0.72, gain: 0.08, floor: 0.45, deepen: 0.28 },
  warble: { rate: 6.5, depth: 0.035 },
  lp: { open: 5200, closed: 2600 },
};
export function drainVoice(k, phase, C = DRAIN_CUE) {
  const s = clamp(Number.isFinite(k) ? k : 0, 0, 1);
  const p = ((Number.isFinite(phase) ? phase : 0) % 1 + 1) % 1;
  // 一回の吸い込みの山（位相 0 で谷、0.5 で山）
  const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
  const H = C.hiss, W = C.whine;
  return {
    hiss: { f: H.hi * (H.lo / H.hi) ** p * (1 - H.deepen * s), q: H.q, gain: s > 0 ? H.gain * s * (H.floor + (1 - H.floor) * env) : 0 },
    whine: { f: W.f * W.drop ** p * (1 - W.deepen * s), gain: s > 0 ? W.gain * s * (W.floor + (1 - W.floor) * env) : 0 },
    lp: C.lp.closed + (C.lp.open - C.lp.closed) * s,
  };
}
