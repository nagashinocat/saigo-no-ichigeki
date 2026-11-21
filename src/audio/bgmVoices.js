// BGM の楽器の音を、ただの数の並び（Float32Array）として合成する純粋な関数。
// ブラウザでは一度だけ作って AudioBuffer にし、音程は再生の速さで変える（毎回の発音は再生ノード 1 つと音量 1 つで軽い）。
// 同じ関数でオフラインに書き出せるので、node でも波形を確かめられる。ノイズは種で決まる（毎回同じ波形）。

// マリンバはこの音程で作り、ほかの音程は再生の速さで移す
export const MARIMBA_BASE_HZ = 293.66; // D4

export const VOICES = ['marimba', 'marimbaSoft', 'low', 'deep', 'slap', 'tone', 'shaker', 'wood', 'drone', 'scrape'];
// ドローンはこの音程で作る（D2）。五度・増4度は再生の速さで移す
export const DRONE_BASE_HZ = 73.42;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 一次の low-pass の係数（fc Hz）
const onePole = (fc, sr) => 1 - Math.exp(-2 * Math.PI * fc / sr);

// 立ち上がりの短い傾き（プツッと鳴らないように）
const attack = (t, sec) => (t >= sec ? 1 : t / sec);

// 木の鍵盤: 基音（速い減衰と、共鳴管の少し長い尾）＋ 4 倍の倍音と約 10 倍の倍音（もっと速く消える）＋ 打鍵の木の音。
// 不穏にするため、基音をわずかに上下へずらした 2 音にして（detune、約 ±8 セント）うなりで濁らせ、
// 高い倍音と打鍵の明るさは抑える（暗い音色）
function marimba(sr, { bright, decay, detune = 0.0045 }) {
  const len = Math.floor(sr * 1.1 * decay);
  const out = new Float32Array(len);
  const rnd = mulberry32(11);
  const f = MARIMBA_BASE_HZ, w = 2 * Math.PI / sr;
  const lp = onePole(1300 * bright + 500, sr);
  const fa = f * (1 - detune), fb = f * (1 + detune);
  let n = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const body = 0.62 * Math.exp(-t / (0.16 * decay)) + 0.15 * Math.exp(-t / (0.3 * decay));
    let v = body * 0.5 * (Math.sin(w * fa * i) + Math.sin(w * fb * i + 0.4));
    v += 0.27 * bright * Math.exp(-t / 0.04) * Math.sin(w * 4 * fa * i + 0.3);
    v += 0.012 * bright * Math.exp(-t / 0.01) * Math.sin(w * 9.86 * f * i + 1.1);
    n += lp * ((rnd() * 2 - 1) - n);
    v += 0.3 * bright * Math.exp(-t / 0.004) * n;
    out[i] = v * attack(t, 0.002 + 0.004 * (1 - bright));
  }
  return out;
}

// ドローン（底でうなる音）: わずかにずらした 2 本ののこぎり波と、1 オクターブ下の正弦波。
// 音色（low-pass の開き）と音量がゆっくり揺れ、全体はゆっくりふくらんで、ゆっくり消える（小節ごとに重ねて切れ目なく鳴らす）
export const DRONE_SEC = 7;
function drone(sr) {
  const len = Math.floor(sr * DRONE_SEC);
  const out = new Float32Array(len);
  const f = DRONE_BASE_HZ;
  let pa = 0, pb = 0, ps = 0, y1 = 0, y2 = 0, a = 0, level = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    pa += f * 0.9965 / sr; pb += f * 1.0035 / sr; ps += f * 0.5 / sr; // 2 本のうなり: 約 0.5 Hz
    pa -= Math.floor(pa); pb -= Math.floor(pb);
    const saw = (pa * 2 - 1) + (pb * 2 - 1);
    // ゆっくり変わる値は 64 標本ごとに計算する（最初のタップの前に作るので軽く）
    if ((i & 63) === 0) {
      // 音色: 開きが 180〜1100 Hz をゆっくり往復（約 0.17 Hz）
      const fc = 180 + 920 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 0.17 * t + 0.6)) ** 1.6;
      a = onePole(fc, sr);
      // 音量の揺れ（約 0.23 Hz）と、全体のふくらみ（ハン窓: 重ねたとき切れ目がない）
      const sway = 0.72 + 0.28 * Math.sin(2 * Math.PI * 0.23 * t);
      level = sway * Math.sin(Math.PI * t / DRONE_SEC) ** 2;
    }
    y1 += a * (saw - y1); y2 += a * (y1 - y2);
    out[i] = level * (0.55 * y2 + 0.5 * Math.sin(2 * Math.PI * ps));
  }
  return out;
}

// 金属的に擦れる音（合成）: ノイズを、整数倍でない高い共鳴（金属板の鳴り）に通し、細かくざらつく（約 37 Hz の擦れ）。
// だんだん強くなって、短く消える（最高潮の緊張）
function scrape(sr) {
  const lenSec = 1.15;
  const len = Math.floor(sr * lenSec);
  const out = new Float32Array(len);
  const rnd = mulberry32(53);
  const bands = [[1530, 18, 0.7], [2410, 22, 1], [3370, 26, 0.8], [4870, 30, 0.5]].map(([fc, q, g]) => {
    const w0 = 2 * Math.PI * Math.min(fc, sr * 0.45) / sr, al = Math.sin(w0) / (2 * q), a0 = 1 + al;
    return { g, b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  });
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const x = rnd() * 2 - 1;
    let v = 0;
    for (const b of bands) {
      const y = b.b0 * x + b.b2 * b.x2 - b.a1 * b.y1 - b.a2 * b.y2;
      b.x2 = b.x1; b.x1 = x; b.y2 = b.y1; b.y1 = y;
      v += b.g * y;
    }
    ph += (37 + 9 * Math.sin(2 * Math.PI * 1.3 * t)) / sr; ph -= Math.floor(ph);
    const grain = 0.35 + 0.65 * (1 - ph) ** 2; // 擦れのざらつき
    const rise = (t / (lenSec * 0.8)) ** 2.2;
    const env = t < lenSec * 0.8 ? rise : Math.exp(-(t - lenSec * 0.8) / 0.045);
    out[i] = v * grain * env * attack(t, 0.01);
  }
  return out;
}

// 低い胴の太鼓: 張った皮の音程が落ちていく正弦波 ＋ 胴の 2 番目の鳴り ＋ 打った瞬間のこもったノイズ
function drum(sr, { f0, sweep, tau, len: lenSec, click }) {
  const len = Math.floor(sr * lenSec);
  const out = new Float32Array(len);
  const rnd = mulberry32(23);
  const lp = onePole(1100, sr);
  let ph = 0, ph2 = 0, n = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = f0 * (1 + sweep * Math.exp(-t / 0.03));
    ph += 2 * Math.PI * f / sr;
    ph2 += 2 * Math.PI * f * 1.59 / sr;
    n += lp * ((rnd() * 2 - 1) - n);
    const v = 0.85 * Math.exp(-t / tau) * Math.sin(ph) + 0.18 * Math.exp(-t / (tau * 0.3)) * Math.sin(ph2)
      + click * Math.exp(-t / 0.007) * n;
    out[i] = v * attack(t, 0.001);
  }
  return out;
}

// 高い皮の太鼓。slap: 手のひらで叩く鋭い音（帯域ノイズが主）/ tone: 開いた音（音程が主）
function handDrum(sr, { f0, tau, noise, noiseTau, len: lenSec }) {
  const len = Math.floor(sr * lenSec);
  const out = new Float32Array(len);
  const rnd = mulberry32(37);
  // 帯域ノイズ: RBJ の band-pass（中心 2.2 kHz）
  const fc = 2200, q = 1.1, w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * q);
  const a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const x = rnd() * 2 - 1;
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    ph += 2 * Math.PI * f0 * (1 + 0.12 * Math.exp(-t / 0.02)) / sr;
    const v = 0.7 * Math.exp(-t / tau) * Math.sin(ph) + 0.22 * Math.exp(-t / (tau * 0.5)) * Math.sin(ph * 1.5)
      + noise * Math.exp(-t / noiseTau) * y;
    out[i] = v * attack(t, 0.0008);
  }
  return out;
}

// シェイカー: 高い音だけのノイズ、少しふくらんでから消える（「シャッ」）
function shaker(sr) {
  const len = Math.floor(sr * 0.13);
  const out = new Float32Array(len);
  const rnd = mulberry32(41);
  const lp = onePole(1800, sr);
  let low = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const x = rnd() * 2 - 1;
    low += lp * (x - low);
    const env = t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) / 0.022);
    out[i] = 0.7 * env * (x - low);
  }
  return out;
}

// 木の打楽器（くりぬいた木を叩く）: 高めの二つの鳴りが短く消える
function wood(sr) {
  const len = Math.floor(sr * 0.16);
  const out = new Float32Array(len);
  const w = 2 * Math.PI / sr;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const v = 0.75 * Math.exp(-t / 0.028) * Math.sin(w * 1180 * i) + 0.25 * Math.exp(-t / 0.01) * Math.sin(w * 2930 * i + 0.7);
    out[i] = v * attack(t, 0.0006);
  }
  return out;
}

// 最大の振幅を 0.9 にそろえる（楽器どうしの音量は譜面の側で決める）
function normalize(a) {
  let p = 0;
  for (let i = 0; i < a.length; i++) p = Math.max(p, Math.abs(a[i]));
  if (p > 0) for (let i = 0; i < a.length; i++) a[i] *= 0.9 / p;
  return a;
}

// 作った楽器の音を覚えておく（BGM と導入の音楽で使い回す。標本化周波数ごと）
const voiceCache = new Map();
export function cachedVoice(name, sr) {
  const key = name + '@' + sr;
  if (!voiceCache.has(key)) voiceCache.set(key, renderVoice(name, sr));
  return voiceCache.get(key);
}
export const hasCachedVoice = (name, sr) => voiceCache.has(name + '@' + sr);

// 名前の楽器を、標本化周波数 sr で一回ぶん作る（最大の振幅は 0.9）
export function renderVoice(name, sr) {
  return normalize(build(name, sr));
}

function build(name, sr) {
  switch (name) {
    case 'marimba': return marimba(sr, { bright: 1, decay: 1 });
    case 'marimbaSoft': return marimba(sr, { bright: 0.28, decay: 1.5 });
    case 'low': return drum(sr, { f0: 62, sweep: 1.1, tau: 0.22, len: 1.1, click: 0.45 });
    case 'deep': return drum(sr, { f0: 44, sweep: 1.4, tau: 0.36, len: 1.6, click: 0.35 });
    case 'slap': return handDrum(sr, { f0: 360, tau: 0.035, noise: 0.95, noiseTau: 0.028, len: 0.3 });
    case 'tone': return handDrum(sr, { f0: 228, tau: 0.13, noise: 0.25, noiseTau: 0.012, len: 0.55 });
    case 'shaker': return shaker(sr);
    case 'wood': return wood(sr);
    case 'drone': return drone(sr);
    case 'scrape': return scrape(sr);
    default: throw new Error('unknown voice ' + name);
  }
}
