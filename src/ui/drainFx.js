// R1b（持ち主 08:24「吸われてる時をもっと分かりやすくしたい 吸われてる音と画面点滅入れた方がいいかな」）:
// 掴まれて力を吸われている間の知らせの状態（描画も音も知らない純粋な状態）。main.js が毎フレーム update し、
//   画面の縁の赤紫の脈打ち（vignette。画面全体の点滅ではない）、力の数字とゲージの点滅（pulse）、吸われた量の「−N」（lost）、
//   手の帯の球のゆらぎ（pulse・k）、吸われる音（sound・phase・pan）に使う。
// 光に敏感な人にもやさしく: 脈打ちはなめらかな山（cos）で、1 秒に rateMax（3 回より少ない）回まで。濃さは縁だけで vignetteMax まで。
// 強さ k は吸う力の合計（enemies.drainLoad。ふつうの者 1 人を 1、吸う者 2.5、大物 4）で決まる: 強く吸われるほど濃く、少し速く脈打つ。
// 音は画面に従う: 掴まれた瞬間に鳴り、はがれた瞬間に止まる（sound はその場で 0）。縁の脈打ちも素早く消える
export const DRAIN_FX = {
  kScale: 2.5,        // 強さ = 1 − exp(−吸う力の合計 / kScale)
  rateMin: 1.6,       // 脈打ちの速さ（回/秒）。弱いとき
  rateMax: 2.6,       //   強いとき（3 回/秒より少ない）
  vignetteMax: 0.5,   // 縁の濃さの上限（不透明度）
  base: 0.35,         // 脈打ちの谷でも残る縁の濃さの割合（ずっと掴まれていると分かる）
  attack: 0.1,        // 縁の濃さがなじむ時定数（秒）: 掴まれたとき
  release: 0.06,      //   はがれたとき
  startPhase: 0.3,    // 掴まれた瞬間の脈打ちの位相（すぐ山が来る）
  lostKeep: 1.2,      // はがれたあと「−N」を見せる秒
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 吸う力の合計 load（ふつうの者 1 人を 1）から強さ 0〜1
export function drainIntensity(load, F = DRAIN_FX) {
  return load > 0 ? 1 - Math.exp(-load / F.kScale) : 0;
}

// 掴んでいる者の画面の左右 [{ pan（−1〜1）, w（吸う力の倍率）}] を、吸う力の重みでならした左右（−0.95〜0.95）
export function drainPan(list) {
  let s = 0, w = 0;
  for (const g of list ?? []) { const k = Math.max(0, g.w ?? 1); s += clamp(g.pan, -1, 1) * k; w += k; }
  return w > 0 ? clamp(s / w, -0.95, 0.95) : 0;
}

export function createDrainFx(F = DRAIN_FX) {
  let active = false, phase = 0, level = 0, lost = 0, lostShow = 0;
  const state = { active: false, k: 0, level: 0, pulse: 0, phase: 0, rate: F.rateMin, vignette: 0, sound: 0, pan: 0, lost: 0, lostShow: 0 };
  return {
    // dt: 秒、load: 吸う力の合計（enemies.drainLoad）、drained: このフレームに吸われた力、grabbers: [{ pan, w }]（省けば左右 0）
    update(dt, { load = 0, drained = 0, grabbers = null } = {}) {
      const d = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const k = drainIntensity(load, F);
      const on = k > 0;
      if (on && !active) { phase = F.startPhase; lost = 0; }
      active = on;
      const rate = F.rateMin + (F.rateMax - F.rateMin) * k;
      if (on) { phase = (phase + rate * d) % 1; lost += Math.max(0, drained); lostShow = F.lostKeep; }
      else lostShow = Math.max(0, lostShow - d);
      if (!on && lostShow === 0) lost = 0;
      level += (k - level) * (1 - Math.exp(-d / (k > level ? F.attack : F.release)));
      if (!on && level < 1e-4) level = 0;
      const pulse = on || level > 0 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * phase) : 0;
      Object.assign(state, {
        active: on, k, level, pulse, phase, rate,
        vignette: F.vignetteMax * level * (F.base + (1 - F.base) * pulse),
        sound: on ? k : 0,
        pan: on ? drainPan(grabbers) : state.pan,
        lost, lostShow,
      });
      return state;
    },
    get state() { return state; },
    reset() {
      active = false; phase = 0; level = 0; lost = 0; lostShow = 0;
      Object.assign(state, { active: false, k: 0, level: 0, pulse: 0, phase: 0, rate: F.rateMin, vignette: 0, sound: 0, pan: 0, lost: 0, lostShow: 0 });
    },
  };
}
