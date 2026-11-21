// 瓦礫の崩れる音（持ち主の要望 2026-11-21 09:59）。描画も Web Audio も知らない純粋な関数だけ（audio.js が鳴らす）。
//   - 音のもと: コンクリートが砕けて落ちる音（ドサッという低い一打と、ガラガラという破片の粒）を、起動時に数種類だけ
//     数の並びに書き出しておき（renderCollapse）、一つの命中ごとに読む速さ・大きさ・左右を変えて使い回す（中くらいの Android で軽く）
//   - 近い・大きいビルほど低く（ゆっくり読む）大きい（collapseVoice）
//   - 頻度の上限: 同時に鳴る数と 1 秒あたりの数を抑え、そのあいだの命中は、いちばん大きい一つにまとめる（createCollapseGate）
//   - 同じビルはいつも同じ音（id から決める。リプレイでも同じ崩落に同じ音）

export const COLLAPSE = {
  variants: 4,       // 書き出しておく音のもとの数
  bufSec: 0.9,       // 音のもとの長さ（秒）
  gap: 0.07,         // 鳴らし始めの最短の間隔（秒）
  perSec: 9,         // 1 秒あたりに鳴らし始める最大の数
  maxVoices: 5,      // 同時に鳴る最大の数
  stale: 0.25,       // これより古い、鳴らせなかった命中は捨てる（絵とずれた音を遅れて鳴らさない）
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

// 命中したものの音の手がかり: 大きさ size（0〜1。ビルは体積の 3 乗根、小物はごく小さい）、近さ near（0〜1。20 m 以内で 1、
// 500 m で 0）、左右 pan（-1〜1。カメラから見た横の向き。後ろのものも左右に散る）。
// camX / camZ: カメラの座標で見た命中の位置（x は右、-z が前）。dist: カメラからの距離
export function collapseHitInfo({ id, w = 3, d = 3, h = 3 }, { camX, camZ, dist }) {
  const isBuilding = String(id)[0] === 'b';
  const size = isBuilding ? clamp(Math.cbrt(Math.max(1, w * d * h)) / 30, 0.08, 1) : 0.05;
  const near = clamp(1 - Math.log(Math.max(dist, 20) / 20) / Math.log(25), 0, 1);
  const pan = clamp((camX / (Math.abs(camX) + Math.abs(camZ) + 1e-6)) * 1.3, -0.95, 0.95);
  return { id, size, near, pan };
}

// 一つの命中の鳴らし方: 近い・大きいほど低く（rate が小さい）大きい。merged: まとめた命中の数（多いほど少し大きく）
export function collapseVoice({ id, size, near, pan }, merged = 1, C = COLLAPSE) {
  const j = idHash(id, 7);
  const rate = (1.25 - 0.42 * size - 0.2 * near) * (0.94 + 0.12 * j);
  const boost = Math.min(1.5, 1 + 0.12 * Math.log2(Math.max(1, merged)));
  const gain = (0.08 + 0.3 * size) * (0.3 + 0.7 * near) * boost;
  return {
    variant: Math.floor(idHash(id, 3) * C.variants) % C.variants,
    rate, gain, pan: clamp(pan, -1, 1), dur: C.bufSec / rate,
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

// 音のもとを一つ書き出す（モノラル、頂点 0.9）。中身:
//   ドサッ   最初の低い一打（下がる正弦波 + 低い帯域のノイズ）と、少し遅れた二つ目の小さな一打（崩れ落ちる塊）
//   ガラガラ 破片の粒（高いかけら・中くらいの塊）。始めに密で、だんだん疎らに小さくなる
export function renderCollapse(sr, seed, sec = COLLAPSE.bufSec) {
  const r = rand(seed * 7919 + 17);
  const n = Math.ceil(sec * sr), out = new Float32Array(n);
  const thud = (t0, f0, f1, len, g) => {
    const i0 = Math.floor(t0 * sr), m = Math.min(n, i0 + Math.ceil(len * sr));
    const lp = coef('lp', 260, 0.8, sr);
    let ph = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = i0; i < m; i++) {
      const u = (i - i0) / sr, f = f0 * (f1 / f0) ** Math.min(1, u / (len * 0.7));
      ph += 2 * Math.PI * f / sr;
      const e = Math.min(1, u / 0.003) * Math.exp(-u / (len * 0.28));
      const x = r() * 2 - 1;
      const y = lp[0] * x + lp[1] * x1 + lp[2] * x2 - lp[3] * y1 - lp[4] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] += g * e * (0.8 * Math.sin(ph) + 1.6 * y);
    }
  };
  thud(0, 85 + 25 * r(), 40, 0.32, 0.9);
  thud(0.12 + 0.2 * r(), 70 + 30 * r(), 38, 0.22, 0.45);
  const grains = 34 + Math.floor(14 * r());
  for (let k = 0; k < grains; k++) {
    const u = r();
    const t0 = 0.01 + (sec - 0.12) * u ** 1.7;
    const chunk = r() < 0.35;
    const len = chunk ? 0.03 + 0.05 * r() : 0.006 + 0.022 * r();
    const fc = chunk ? 300 + 700 * r() : 1600 + 3600 * r();
    const g = (chunk ? 0.55 : 0.35 + 0.3 * r()) * (1 - 0.75 * u);
    const bp = coef('bp', fc, chunk ? 1.6 : 2.4, sr);
    const i0 = Math.floor(t0 * sr), m = Math.min(n, i0 + Math.ceil(len * sr));
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = i0; i < m; i++) {
      const v = (i - i0) / sr;
      const e = Math.min(1, v / 0.0015) * Math.exp(-v / (len * 0.35));
      const x = r() * 2 - 1;
      const y = bp[0] * x + bp[1] * x1 + bp[2] * x2 - bp[3] * y1 - bp[4] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] += g * e * y * 2.2;
    }
  }
  // 終わりは 50 ms で消し、頂点を 0.9 にそろえる
  const fade = Math.ceil(0.05 * sr);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  let p = 1e-9;
  for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / p;
  return out;
}
