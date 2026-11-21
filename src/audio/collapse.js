// 瓦礫の崩れる音（持ち主の要望 2026-11-21 09:59、23:01）。描画も Web Audio も知らない純粋な関数だけ（audio.js が鳴らす）。
//   - 音のもと: 起動時に数種類だけ数の並びに書き出しておき（renderCollapse）、一つの命中ごとに読む速さ・大きさ・左右・こもりを
//     変えて使い回す（中くらいの Android で軽く）。ビルや高架が崩れる長い音（building）と、破片が落ちて止まる短い音（settle）
//   - 近い・大きいほど低く（ゆっくり読む）大きい。遠いほどこもる（low-pass。遠くの崩落は高い粒が抜けて、低い地鳴りになる）
//   - 頻度の上限: 同時に鳴る数と 1 秒あたりの数を抑え、そのあいだの命中は、いちばん大きい一つにまとめる（createCollapseGate）
//   - 同じビルはいつも同じ音（id から決める。リプレイでも同じ崩落に同じ音）
// 23:01 の「チリチリ」: 前の音のもとは、低い一打が 40〜110 Hz の正弦波だけ（スマホのスピーカーでは鳴らない）で、聞こえるのは
// 1.6〜5.2 kHz の細かい粒の層ばかりだった。しかも遠い・小さい命中ほど速く読んで（rate 1.2 倍あまり）高くなり、こもりもしない。
// リプレイは爆発の音を鳴らさず、カメラが遠い（真上・横）ので、この高い粒だけがチリチリと残っていた。
// いまの音のもとは、スマホでも聞こえる 100〜400 Hz の胴（歪ませた一打の倍音・崩れる板・こすれる音）が主で、ガラスと金属は
// 上にわずかに散らすだけ。遠い命中はゆっくり読み、こもらせる

export const COLLAPSE = {
  variants: 4,       // 書き出しておく、ビルが崩れる音のもとの数
  settleVariants: 3, // 書き出しておく、破片が落ちて止まる音のもとの数（variants の後ろの番号）
  bufSec: 1.6,       // ビルが崩れる音のもとの長さ（秒）
  settleSec: 0.8,    // 破片が落ちて止まる音のもとの長さ（秒）
  sampleRate: 24000, // 音のもとを書き出す標本の速さ（出口がこれより低ければ出口の速さ）
  gap: 0.07,         // 鳴らし始めの最短の間隔（秒）
  perSec: 9,         // 1 秒あたりに鳴らし始める最大の数
  maxVoices: 5,      // 同時に鳴る最大の数
  stale: 0.25,       // これより古い、鳴らせなかった命中は捨てる（絵とずれた音を遅れて鳴らさない）
  lp: [700, 12000],  // こもり（low-pass の Hz）: 遠い（near 0）〜近い（near 1）
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// id（'b12' / 'p3' など）から 0 以上 1 未満の決まった値（同じ id ならいつも同じ）
export function idHash(id, salt = 0) {
  let h = (2166136261 ^ salt) >>> 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// 命中したものの音の手がかり: 種類 kind（building: ビル・高架の橋桁・電車の車両 / settle: 落ちて止まった破片（id 's…'）/
// prop: 道路沿いの小物）、大きさ size（0〜1）、近さ near（0〜1。20 m 以内で 1、500 m で 0）、左右 pan（-1〜1。カメラから見た
// 横の向き。後ろのものも左右に散る）。camX / camZ: カメラの座標で見た命中の位置（x は右、-z が前）。dist: カメラからの距離
export function collapseHitInfo({ id, w = 3, d = 3, h = 3 }, { camX, camZ, dist }) {
  const c = String(id)[0];
  const kind = 'bxrt'.includes(c) ? 'building' : c === 's' ? 'settle' : 'prop';
  const vol = Math.cbrt(Math.max(1e-3, w * d * h));
  const size = kind === 'building' ? clamp(vol / 30, 0.08, 1) : kind === 'settle' ? clamp(vol / 12, 0.05, 0.5) : 0.05;
  const near = clamp(1 - Math.log(Math.max(dist, 20) / 20) / Math.log(25), 0, 1);
  const pan = clamp((camX / (Math.abs(camX) + Math.abs(camZ) + 1e-6)) * 1.3, -0.95, 0.95);
  return { id, kind, size, near, pan };
}

// 一つの命中の鳴らし方: 近い・大きいほど低く（rate が小さい）大きい、遠いほどこもる（lp）。merged: まとめた命中の数（多いほど少し大きく）。
// 速さは 0.8〜1.1 倍の間だけ（前は小さく遠いほど 1.25 倍まで速く、高くなっていた）
export function collapseVoice({ id, kind = 'building', size, near, pan }, merged = 1, C = COLLAPSE) {
  const j = idHash(id, 7);
  const settle = kind === 'settle';
  const rate = (1.06 - 0.22 * size - 0.06 * near) * (0.95 + 0.1 * j);
  const boost = Math.min(1.5, 1 + 0.12 * Math.log2(Math.max(1, merged)));
  const gain = (settle ? 0.06 + 0.3 * size : 0.1 + 0.32 * size) * (0.25 + 0.75 * near) * boost;
  const vi = Math.floor(idHash(id, 3) * (settle ? C.settleVariants : C.variants));
  return {
    variant: settle ? C.variants + (vi % C.settleVariants) : vi % C.variants,
    rate, gain, pan: clamp(pan, -1, 1),
    lp: C.lp[0] + (C.lp[1] - C.lp[0]) * near ** 1.6,
    dur: (settle ? C.settleSec : C.bufSec) / rate,
  };
}

// 頻度の上限。take(hits, now) は今鳴らし始める一つ（{ hit, merged }）か null を返す。
// 間隔が空いていない・1 秒の数が尽きた・同時の数が埋まっているときの命中はためておき、次に鳴らす一回でいちばん大きいものにまとめる
export function createCollapseGate(C = COLLAPSE, durOf = (hit) => collapseVoice(hit, 1, C).dur) {
  let pending = []; // { hit, t }
  let last = -Infinity;
  const starts = []; // 直近 1 秒の鳴らし始め
  const ends = [];   // 鳴っている音の終わる時刻
  const score = (h) => h.size * (0.3 + 0.7 * h.near);
  return {
    take(hits, now) {
      for (const hit of hits ?? []) pending.push({ hit, t: now });
      pending = pending.filter((p) => now - p.t <= C.stale + 1e-9);
      while (starts.length && now - starts[0] >= 1 - 1e-9) starts.shift();
      for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= now + 1e-9) ends.splice(i, 1);
      if (!pending.length || now - last < C.gap - 1e-9 || starts.length >= C.perSec || ends.length >= C.maxVoices) return null;
      let best = pending[0];
      for (const p of pending) if (score(p.hit) > score(best.hit)) best = p;
      const merged = pending.length;
      pending = [];
      last = now;
      starts.push(now);
      ends.push(now + durOf(best.hit));
      return { hit: best.hit, merged };
    },
    get active() { return ends.length; },
    reset() { pending = []; last = -Infinity; starts.length = 0; ends.length = 0; },
  };
}

// mulberry32（音のもとの粒のばらつき。種で決まる）
function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// RBJ のフィルタの係数（bandpass は頂点の大きさ 1）
function coef(type, fc, q, sr) {
  const w0 = 2 * Math.PI * Math.min(fc, sr * 0.45) / sr, al = Math.sin(w0) / (2 * q), c = Math.cos(w0), a0 = 1 + al;
  if (type === 'bp') return [al / a0, 0, -al / a0, -2 * c / a0, (1 - al) / a0];
  return [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0];
}
function biquad(k) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = k[0] * x + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

// 音のもとを一つ書き出す（モノラル、頂点 0.9）。kind: 'building'（ビルが崩れる。sec 秒）/ 'settle'（破片が落ちて止まる）。中身:
//   ドスン   重い一打（下がる正弦波と低い帯域のノイズを強く歪ませ、120〜300 Hz の倍音を作る。スマホでも重く聞こえる）
//   ゴロゴロ 続いて落ちる塊の一打（低い）がいくつか
//   ガラガラ 崩れる板（150〜700 Hz の帯域の塊の粒。始めに密で、だんだん疎らに小さく）
//   ゴゴゴ   こすれる・きしむ音（低いブラウンノイズを細かく揺らす）
//   上に     割れたガラスのきらめき（2.5〜6 kHz）と、鉄骨の金属の響き（ずれた倍音）を、わずかに散らす
export function renderCollapse(sr, seed, sec = COLLAPSE.bufSec, kind = 'building') {
  const r = rand(seed * 7919 + 17);
  const n = Math.ceil(sec * sr), out = new Float32Array(n);
  const settle = kind === 'settle';
  const add = (t0, len, fn) => {
    const i0 = Math.max(0, Math.floor(t0 * sr)), m = Math.min(n, i0 + Math.ceil(len * sr));
    for (let i = i0; i < m; i++) out[i] += fn((i - i0) / sr);
  };
  // 重い一打: 下がる正弦波 + 低い帯域のノイズを tanh で歪ませる
  const thud = (t0, f0, f1, len, g, drive) => {
    const lp = biquad(coef('lp', 480, 0.8, sr));
    let ph = 0;
    const norm = Math.tanh(drive);
    add(t0, len, (u) => {
      const f = f0 * (f1 / f0) ** Math.min(1, u / (len * 0.6));
      ph += 2 * Math.PI * f / sr;
      const e = Math.min(1, u / 0.004) * Math.exp(-u / (len * 0.3));
      const x = 0.9 * Math.sin(ph) + 1.4 * lp(r() * 2 - 1);
      return g * e * Math.tanh(drive * x) / norm;
    });
  };
  const f0 = 80 + 30 * r();
  thud(0, f0, 52, settle ? 0.32 : 0.55, 1.0, 3.4);
  const nSecond = settle ? 1 + Math.floor(2 * r()) : 3 + Math.floor(3 * r());
  for (let k = 0; k < nSecond; k++) {
    const u = (k + 0.3 + 0.7 * r()) / nSecond;
    thud((settle ? 0.06 : 0.12) + (sec * 0.7) * u, 70 + 70 * r(), 48, 0.16 + 0.2 * r(), (0.65 - 0.3 * u) * (settle ? 0.6 : 0.8), 3.0);
  }
  // 崩れる板: 低い〜中くらいの帯域の塊の粒
  const nChunk = settle ? 12 + Math.floor(8 * r()) : 60 + Math.floor(30 * r());
  for (let k = 0; k < nChunk; k++) {
    const u = r();
    const t0 = 0.02 + (sec - 0.15) * u ** (settle ? 1.4 : 1.25);
    const len = 0.025 + 0.06 * r();
    const bp = biquad(coef('bp', 150 + 550 * r() ** 1.5, 1.4, sr));
    const g = (0.4 + 0.35 * r()) * (1 - 0.65 * u);
    add(t0, len, (v) => g * Math.min(1, v / 0.002) * Math.exp(-v / (len * 0.35)) * bp(r() * 2 - 1) * 3.4);
  }
  // こすれる・きしむ: 低いブラウンノイズを 6〜11 Hz で揺らす（ビルだけ）
  if (!settle) {
    const lp = biquad(coef('lp', 380, 0.7, sr));
    const rate = 6 + 5 * r(), ph0 = r() * 6.28;
    let b = 0;
    const len = sec * 0.85;
    add(0.1, len, (u) => {
      b = 0.985 * b + 0.15 * (r() * 2 - 1);
      const e = Math.min(1, u / 0.25) * Math.exp(-u / (len * 0.45));
      const am = 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * rate * u + ph0));
      return 0.55 * e * am * lp(b);
    });
  }
  // 割れたガラスのきらめき（小さく）
  const nGlass = settle ? Math.floor(2.5 * r()) : 5 + Math.floor(5 * r());
  for (let k = 0; k < nGlass; k++) {
    const t0 = 0.06 + (sec - 0.25) * r() ** 1.3, f = 2600 + 3400 * r(), tau = 0.02 + 0.03 * r(), g = 0.045 + 0.04 * r();
    add(t0, tau * 6, (v) => g * Math.exp(-v / tau) * (Math.sin(2 * Math.PI * f * v) + 0.5 * Math.sin(2 * Math.PI * f * 1.53 * v)));
  }
  // 鉄骨の金属の響き（ずれた倍音。小さく）
  const nMetal = settle ? (r() < 0.35 ? 1 : 0) : 1 + Math.floor(2 * r());
  for (let k = 0; k < nMetal; k++) {
    const t0 = 0.08 + (sec * 0.6) * r(), f = 380 + 520 * r(), tau = 0.12 + 0.13 * r(), g = 0.06 + 0.03 * r();
    add(t0, tau * 5, (v) => g * Math.exp(-v / tau) * (Math.sin(2 * Math.PI * f * v) + 0.6 * Math.sin(2 * Math.PI * f * 2.76 * v) + 0.3 * Math.sin(2 * Math.PI * f * 5.4 * v)));
  }
  // 終わりは 60 ms で消し、頂点を 0.9 にそろえる
  const fade = Math.ceil(0.06 * sr);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  let p = 1e-9;
  for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / p;
  return out;
}

// variant 番号の音のもと（0〜variants−1 はビル、その後ろは破片）
export function renderCollapseVariant(sr, v, C = COLLAPSE) {
  return v < C.variants ? renderCollapse(sr, v + 1, C.bufSec, 'building') : renderCollapse(sr, 101 + v - C.variants, C.settleSec, 'settle');
}
