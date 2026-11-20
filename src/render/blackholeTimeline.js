// 時間切れの結末（ブラックホール、仕様 12 章）の時間割と、重力レンズの写し方。描画は知らない純粋な関数だけ。
// t は時間切れの瞬間からの秒。
//   0〜cut          2画面のまま: 手の中の球が内側へつぶれて黒い球になり、両手が引き込まれる（手の画面のレンズ）。
//                   上の街の画面でも、主人公のところが少しゆがみ始める
//   cut〜void       画面全体: 主人公の位置に黒い球。重力レンズのゆがみが育ち、街が渦を巻いて中心へ流れ込む（cityFrom〜cityTo）。
//                   街に続いて、夕焼けの空・雲・夕日・地平線も引き伸ばされ、光の筋になって渦を巻き中心へ（skyFrom〜skyTo）
//   void〜fade      何もない真っ暗な空間に、黒い球と光の輪だけ
//   fade〜end       暗転。end で結果（「ブラックホールになった」）
//
// 写し方（レンズ）: 画面の点 q（黒い球の中心から、画面の短い辺を 1 とした長さ）に、元の画のどの点を写すか。
//   1. 点の質量のレンズ: q · (1 − E²/|q|²)（E はアインシュタイン半径。E の内側は反対側の像になり、真後ろの光が輪になる）
//   2. 渦: 中心に近いほど強く回す（swirl · (reach / (|q| + reach))^1.5。画面の縁のほうまで渦の腕が曲がる）
//   3. 流れ込み: exp(logZoom) 倍だけ外の点を写す（= 画の中身が中心へ縮んでいく。画の外は何もない）
// 層（街・空）ごとに進み k（0〜1）を持ち、k から渦・流れ込み・残り（alpha）・光の強まり・光の筋の長さが決まる。
// 光の筋は、同じ式を少し前の k まで遡って何度か写して重ねる（シェーダーは blurSwirl / blurZoom の幅で並べる）。

export const BLACKHOLE = {
  cut: 1.8,
  cityFrom: 1.8, cityTo: 5.4,
  skyFrom: 3.4, skyTo: 7.0,
  void: 7.0,
  fade: 8.4,
  end: 9.4,
  stretchSec: 5.0,   // BGM の引き伸ばし（cut から。1.05 倍で尾が切れる = 何もない空間の手前で消える）
  // 2画面: 手の画面の黒い球と、引き込み
  hand: { shadowFrom: 0.3, shadowSec: 1.2, shadowMax: 0.1, pullFrom: 0.9, pullMax: 0.82 },
  // 2画面: 上の街の画面の、主人公のところの小さなゆがみ
  city: { from: 0.4, sec: 1.4, E: 0.075, k: 0.22 },
  // 画面全体: 黒い球の半径（画面の短い辺に対する比）とアインシュタイン半径の倍率
  shadow: [0.03, 0.13], einstein: 1.75,
};

// 渦の強さ・流れ込み（log の倍率）・光の筋の幅（k の割合）・光の強まり
export const LENS_CURVE = { swirl: 7.0, reach: 0.35, zoom: 4.2, blur: 0.35, boost: 1.6 };

// 元の画の中で黒い球から from〜to（短い辺の単位）の所を消していく（飲まれていく画の縁を丸くし、何もない空間へ溶かす）。
// 層の進み k が kFrom〜kTo の間に効き始める（始めは画面の端まで残す）
export const SOURCE_FADE = { from: 0.45, to: 0.9, kFrom: 0.05, kTo: 0.3 };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const smoother = (e0, e1, x) => smooth((x - e0) / (e1 - e0));
const easeInOut = (x) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
const safe = (t) => (Number.isFinite(t) ? t : 0);

export function stageAt(rawT, B = BLACKHOLE) {
  const t = safe(rawT);
  if (t < B.cut) return 'collapse';
  if (t < B.void) return 'swallow';
  if (t < B.fade) return 'void';
  if (t <= B.end) return 'fade';
  return 'done';
}

export const isFullscreen = (t, B = BLACKHOLE) => safe(t) >= B.cut;

// 合図（音と結果）: collapse（低い唸りが始まる）、cut（BGM を引き伸ばす）、void（無音）、end（結果）
export function cueTimes(B = BLACKHOLE) {
  return [['collapse', 0], ['cut', B.cut], ['void', B.void], ['end', B.end]];
}
// (a, b] の間の合図の名前（a = -Infinity なら 0 のものも含む）
export function cuesBetween(a, b, B = BLACKHOLE) {
  const out = [];
  for (const [name, at] of cueTimes(B)) if (at > a && at <= b) out.push(name);
  return out;
}

// 手の中の球のつぶれ具合（0: 構え, 1: 黒い球になりきった）
export function collapseAt(rawT, B = BLACKHOLE) {
  return smooth(safe(rawT) / B.cut);
}

// 層の進み k から、写し方の値
export function layerAt(rawK, C = LENS_CURVE) {
  const k = clamp01(safe(rawK));
  const swirl = (x) => C.swirl * x * x, zoom = (x) => C.zoom * x * x * x;
  const kb = k * (1 - C.blur);
  return {
    k,
    swirl: swirl(k),
    logZoom: zoom(k),
    alpha: 1 - smoother(0.8, 1, k),
    boost: 1 + C.boost * k,
    blurSwirl: swirl(k) - swirl(kb),
    blurZoom: zoom(k) - zoom(kb),
  };
}

// 2画面の間（0〜cut）: 手の画面と上の街の画面のレンズ（長さはそれぞれの画面の短い辺が 1）
export function splitLensAt(rawT, B = BLACKHOLE) {
  const t = safe(rawT);
  const h = B.hand, c = B.city;
  const shadow = h.shadowMax * easeInOut((t - h.shadowFrom) / h.shadowSec);
  const pull = h.pullMax * smoother(h.pullFrom, B.cut, t) ** 1.4;
  const cityE = c.E * smoother(c.from, c.from + c.sec, t) + 0.002;
  return {
    hand: { E: shadow * 1.6 + 0.015, shadow, ring: 0.4 + 1.2 * smoother(0.2, 1.2, t), layer: layerAt(pull) },
    city: { E: cityE, shadow: cityE * 0.5, ring: 0.5 * smoother(c.from, B.cut, t), layer: layerAt(c.k * smoother(c.from, B.cut, t)) },
  };
}

// 画面全体の間（cut〜）: 黒い球・光の輪・円盤と、街・空の層
export function fullLensAt(rawT, B = BLACKHOLE) {
  const t = safe(rawT);
  const u = clamp01((t - B.cut) / (B.void - B.cut));
  const shadow = B.shadow[0] + (B.shadow[1] - B.shadow[0]) * easeInOut(u);
  const city = layerAt(smoother(B.cityFrom, B.cityTo, t));
  const sky = layerAt(smoother(B.skyFrom, B.skyTo, t));
  const fed = smooth(0.45 * city.k + 0.55 * sky.k);
  // 最後の光が落ちきった瞬間に、輪がひときわ強く光る
  const flare = t >= B.void ? Math.exp(-(t - B.void) / 0.35) * 1.4 : 0;
  // 画面全体へ切り替わった瞬間も、輪が一度強く光る（手の中で生まれた輪が、外から見た輪へつながる）
  const cutFlash = t >= B.cut ? Math.exp(-(t - B.cut) / 0.18) * 1.5 : 0;
  return {
    shadow,
    // 黒い球が小さいうちから、まわりの街が輪のようにゆがんで見えるよう、レンズは早めに育てる
    E: shadow * B.einstein + 0.07 * smoother(B.cut, B.cut + 1.5, t),
    city, sky,
    ring: 0.35 + 0.65 * fed + flare + cutFlash,
    disk: 0.15 + 0.85 * fed,
    fade: smoother(B.fade, B.end, t),
    bars: smoother(B.cut, B.cut + 0.5, t),
    shake: 0.004 * city.k * (1 - sky.k) + 0.0015 * smoother(B.cut, B.cityFrom + 0.5, t) * (1 - sky.k),
  };
}

// 画面の点 q（黒い球の中心から、短い辺を 1 とした長さ）に写る、元の画の点 p。half: 画の外とみなす境（短い辺の単位）
export function lensMap(q, E, layer, half = [1.2, 1.2], C = LENS_CURVE) {
  const r2 = Math.max(q[0] * q[0] + q[1] * q[1], 1e-12), r = Math.sqrt(r2);
  const f = 1 - (E * E) / r2;
  const a = layer.swirl * (C.reach / (r + C.reach)) ** 1.5;
  const z = Math.exp(layer.logZoom);
  const sx = q[0] * f, sy = q[1] * f;
  const c = Math.cos(a), s = Math.sin(a);
  const p = [(c * sx - s * sy) * z, (s * sx + c * sy) * z];
  return { p, inside: Math.abs(p[0]) <= half[0] && Math.abs(p[1]) <= half[1] };
}

// 元の画の点 p（黒い球の中心から、短い辺の単位）を、層の進み k のときどれだけ残すか（lensFx.js のシェーダーと同じ式）
export function sourceFade(p, k, F = SOURCE_FADE) {
  const d = Math.hypot(p[0], p[1]);
  const f = 1 - smoother(F.from, F.to, d);
  const w = smoother(F.kFrom, F.kTo, k);
  return 1 + (f - 1) * w;
}
