// S8: 高架の電車と高速の音（持ち主 13:06「音は画面に合わせる」）。描画も Web Audio も知らない純粋な関数だけ（audio.js が鳴らす）。
//  - 電車: 低いゴーという走行音と、継ぎ目のガタンゴトン（速さ / 継ぎ目の間隔 で刻む）。一番近い走っている車両の位置から
//  - 高速: 車の流れのシャーという風切り（こわれていない区間の一番近い点から）
//  大きさは画面のカメラからの距離で弱まり（near 以内で最大、far で 0。対数で）、左右はカメラから見た横の向き。
//  BGM の下でかすかに聞こえる程度（max）。最後の一発の演出・リプレイ・結末の間は鳴らさない（main が null を渡す）

export const TRANSIT_SOUND = {
  train: { max: 0.05, near: 25, far: 700 },
  clatter: { max: 0.06, joint: 25 },     // 継ぎ目の間隔 m
  hiss: { max: 0.03, near: 20, far: 600 },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// 距離による弱まり（0〜1）
export const distGain = (d, near, far) => clamp(1 - Math.log(Math.max(d, near) / near) / Math.log(far / near), 0, 1) ** 1.6;
// カメラの座標で見た横の向き（-1 左 〜 1 右）。camX: 右、camZ: 前が負
export const panOf = (camX, camZ) => clamp((camX / (Math.abs(camX) + Math.abs(camZ) + 1e-6)) * 1.2, -0.9, 0.9);

// sources: transitView.sources(camPos) の戻り値、toCam(p) → { x, z }（カメラの座標）。戻り値: { train, hiss }（鳴らさないものは gain 0）
export function transitMix(sources, toCam, S = TRANSIT_SOUND) {
  const out = { train: { gain: 0, clatter: 0, pan: 0, rate: 0 }, hiss: { gain: 0, pan: 0 } };
  const t = sources?.train;
  if (t) {
    const g = distGain(t.dist, S.train.near, S.train.far), c = toCam(t);
    out.train = { gain: S.train.max * g, clatter: S.clatter.max * g, pan: panOf(c.x, c.z), rate: t.speed / S.clatter.joint };
  }
  const h = sources?.highway;
  if (h) {
    const c = toCam(h);
    out.hiss = { gain: S.hiss.max * distGain(h.dist, S.hiss.near, S.hiss.far), pan: panOf(c.x, c.z) };
  }
  return out;
}
