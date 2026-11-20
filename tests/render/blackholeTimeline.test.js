import { test, expect } from 'vitest';
import { BLACKHOLE, stageAt, cuesBetween, collapseAt, splitLensAt, fullLensAt, layerAt, lensMap, isFullscreen } from '../../src/render/blackholeTimeline.js';

const B = BLACKHOLE;
const ts = (from, to, n = 200) => Array.from({ length: n + 1 }, (_, i) => from + (to - from) * (i / n));

test('段の順番: つぶれる（2画面）→ 画面全体で街 → 空 → 何もない空間 → 暗転 → end。全体は 8〜10 秒', () => {
  const order = [0, B.cut, B.skyFrom, B.cityTo, B.void, B.fade, B.end];
  for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  expect(B.end).toBeGreaterThanOrEqual(8);
  expect(B.end).toBeLessThanOrEqual(10);
  // 街が先に飲まれ始め、空はそのあと（重なってよい）、空が終わると何もない空間
  expect(B.cityFrom).toBeLessThan(B.skyFrom);
  expect(B.cityTo).toBeLessThan(B.skyTo);
  expect(B.skyTo).toBeCloseTo(B.void, 9);
  // 何もない空間で黒い球と光の輪を見せる間（暗転の前）
  expect(B.fade - B.void).toBeGreaterThanOrEqual(1);
  expect(stageAt(0.1)).toBe('collapse');
  expect(stageAt(B.cut + 0.1)).toBe('swallow');
  expect(stageAt(B.void + 0.1)).toBe('void');
  expect(stageAt(B.fade + 0.1)).toBe('fade');
  expect(stageAt(B.end + 0.01)).toBe('done');
  expect(isFullscreen(B.cut - 0.01)).toBe(false);
  expect(isFullscreen(B.cut)).toBe(true);
});

test('音と結果の合図: collapse → cut（BGM を引き伸ばす）→ void（無音）→ end の順に一度ずつ。大きな dt でも抜けない', () => {
  for (const dt of [1 / 60, 1 / 20, 0.1, 0.7]) {
    const names = [];
    let t = 0;
    names.push(...cuesBetween(-Infinity, 0));
    while (t < B.end + 1) { const n = t + dt; names.push(...cuesBetween(t, n)); t = n; }
    expect(names).toEqual(['collapse', 'cut', 'void', 'end']);
  }
  // BGM の引き伸ばしは、飲み込みの始まり（cut）から何もない空間（void）までで消える
  expect(B.cut + B.stretchSec * 1.05).toBeLessThanOrEqual(B.void + 0.2);
  expect(B.cut + B.stretchSec * 1.05).toBeGreaterThan(B.skyFrom);
});

test('手の中の球がつぶれる: 0 から 1 へ単調に進み、cut で 1。両手の画面の黒い球と、引き込む強さも単調に育つ', () => {
  let prev = { k: -1, shadow: -1, hand: -1 };
  for (const t of ts(0, B.cut)) {
    const k = collapseAt(t), s = splitLensAt(t);
    expect(k).toBeGreaterThanOrEqual(prev.k - 1e-12);
    expect(s.hand.shadow).toBeGreaterThanOrEqual(prev.shadow - 1e-12);
    expect(s.hand.layer.logZoom).toBeGreaterThanOrEqual(prev.hand - 1e-12);
    expect(s.hand.E).toBeGreaterThan(s.hand.shadow);
    prev = { k, shadow: s.hand.shadow, hand: s.hand.layer.logZoom };
  }
  expect(collapseAt(0)).toBe(0);
  expect(collapseAt(B.cut)).toBe(1);
  // 両手は cut の直前には、ほとんど黒い球に吸い込まれている（手の画面の外側は何もない）
  const end = splitLensAt(B.cut - 1e-6).hand;
  expect(lensMap([0.45, 0.3], end.E, end.layer).inside).toBe(false);
  // 上の街の画面は、まだ少しゆがむだけ
  const city = splitLensAt(B.cut - 1e-6).city;
  expect(city.layer.alpha).toBe(1);
  const far = lensMap([0.4, 0.3], city.E, city.layer);
  expect(Math.hypot(far.p[0] - 0.4, far.p[1] - 0.3)).toBeLessThan(0.08);
});

test('画面全体へ切り替わった瞬間: 黒い球はまだ小さく、中心から離れた所はほとんどゆがまない（切り替わりで画が跳ばない）', () => {
  const L = fullLensAt(B.cut);
  expect(L.shadow).toBeLessThan(0.05);
  for (const layer of [L.city, L.sky]) {
    expect(layer.alpha).toBe(1);
    for (const q of [[0.35, 0], [0, -0.5], [-0.3, 0.6]]) {
      const m = lensMap(q, L.E, layer);
      expect(m.inside).toBe(true);
      expect(Math.hypot(m.p[0] - q[0], m.p[1] - q[1])).toBeLessThan(0.02);
    }
  }
});

test('街が先に、空があとから飲まれる。黒い球は育ち、光の輪は街と空の光を集めて強まる', () => {
  let prev = null;
  for (const t of ts(B.cut, B.void)) {
    const L = fullLensAt(t);
    expect(L.city.k).toBeGreaterThanOrEqual(L.sky.k - 1e-12);
    if (prev) {
      expect(L.shadow).toBeGreaterThanOrEqual(prev.shadow - 1e-12);
      expect(L.city.k).toBeGreaterThanOrEqual(prev.city.k - 1e-12);
      expect(L.sky.k).toBeGreaterThanOrEqual(prev.sky.k - 1e-12);
      expect(L.disk).toBeGreaterThanOrEqual(prev.disk - 1e-12);
    }
    expect(L.E).toBeGreaterThan(L.shadow);
    prev = L;
  }
  // 街が飲まれきったとき、空はまだ残っている
  const mid = fullLensAt(B.cityTo);
  expect(mid.city.alpha).toBe(0);
  expect(mid.sky.alpha).toBeGreaterThan(0.5);
  expect(fullLensAt(B.cut).disk).toBeLessThan(fullLensAt(B.void).disk * 0.5);
});

test('渦: 飲み込みが進むほど中心のまわりで回り、外のものは中心へ流れ込む（光の筋の長さも育つ）', () => {
  const a = layerAt(0.2), b = layerAt(0.6);
  expect(b.swirl).toBeGreaterThan(a.swirl);
  expect(b.logZoom).toBeGreaterThan(a.logZoom);
  expect(b.blurSwirl).toBeGreaterThan(a.blurSwirl);
  expect(layerAt(0)).toMatchObject({ swirl: 0, logZoom: 0, alpha: 1, blurSwirl: 0, blurZoom: 0 });
  // 画面上の点 q は、元の画のもっと外側の点を写す（= 中身は中心へ流れ込む）。回り方は中心に近いほど強い
  const E = 0.1;
  const near = lensMap([0.2, 0], E, b), far = lensMap([0.5, 0], E, b);
  expect(Math.hypot(...far.p)).toBeGreaterThan(0.5);
  const ang = (m) => Math.abs(Math.atan2(m.p[1], m.p[0]));
  expect(ang(near)).toBeGreaterThan(ang(far));
});

test('何もない空間: void 以降は、黒い球のまわりのどの点にも街も空も写らない（黒い球と光の輪だけが残る）', () => {
  for (const t of [B.void, B.void + 0.5, B.fade, B.end]) {
    const L = fullLensAt(t);
    for (const layer of [L.city, L.sky]) {
      for (let i = 0; i < 24; i++) {
        const r = L.shadow * 1.01 + i * 0.05, a = i * 2.39;
        const m = lensMap([r * Math.cos(a), r * Math.sin(a)], L.E, layer);
        expect(layer.alpha === 0 || !m.inside).toBe(true);
      }
    }
    expect(L.ring).toBeGreaterThan(0);
  }
  // 暗転: fade から end へ 0 → 1、その前は 0
  expect(fullLensAt(B.void + 0.5).fade).toBe(0);
  expect(fullLensAt(B.end).fade).toBe(1);
  expect(fullLensAt((B.fade + B.end) / 2).fade).toBeGreaterThan(0);
});

test('値はどこでも有限（t が範囲の外・NaN でも）', () => {
  for (const t of [-1, 0, B.cut, B.void, B.end, B.end + 5, NaN]) {
    const vals = [collapseAt(t), ...Object.values(fullLensAt(t)).flatMap((v) => (typeof v === 'object' ? Object.values(v) : [v]))];
    const s = splitLensAt(t);
    for (const l of [s.hand, s.city]) vals.push(l.E, l.shadow, ...Object.values(l.layer));
    for (const v of vals) expect(Number.isFinite(v)).toBe(true);
  }
});

test('飲まれていく画の縁: 黒い球からの距離だけで消える（四角でなく丸い）。始めは消さず、進むと遠い所から何もない空間へ溶ける', async () => {
  const { sourceFade, SOURCE_FADE: F } = await import('../../src/render/blackholeTimeline.js');
  // k = 0: どこも残る（切り替わった瞬間の画は端まで見える）
  for (const p of [[0, 0], [0.5, 0.9], [1.1, 0], [0.9, -1.0]]) expect(sourceFade(p, 0)).toBe(1);
  // 同じ距離なら向きによらない（丸い）
  for (const k of [0.2, 0.5, 1]) {
    const d = 0.7, vals = [0, 1, 2, 3, 4, 5].map((i) => sourceFade([d * Math.cos(i), d * Math.sin(i)], k));
    for (const v of vals) expect(v).toBeCloseTo(vals[0], 12);
  }
  // 進むと: 近くは残り、to より遠くは消える。距離が遠いほど小さい
  expect(sourceFade([F.from * 0.9, 0], 0.5)).toBe(1);
  expect(sourceFade([F.to * 1.01, 0], 0.5)).toBe(0);
  let prev = 2;
  for (let d = 0; d < 1.2; d += 0.05) { const v = sourceFade([0, d], 0.5); expect(v).toBeLessThanOrEqual(prev + 1e-12); prev = v; }
});

test('何もない空間（void 以降）は、場面を描かず重ねる処理もしない。その前は描く', async () => {
  const { layersEmpty } = await import('../../src/render/lensFx.js');
  // blackhole.js と同じ渡し方（街の層は layer、空の層は sky）
  const lensOf = (t) => { const L = fullLensAt(t); return { layer: L.city, sky: L.sky }; };
  for (const t of [B.void, B.void + 0.5, B.fade, B.end]) expect(layersEmpty(lensOf(t))).toBe(true);
  for (const t of [B.cut, B.cityTo, B.skyFrom + 1, B.void - 0.3]) expect(layersEmpty(lensOf(t))).toBe(false);
  // 2画面の間の手の画面（空の層なし）も、まだ描く
  expect(layersEmpty(splitLensAt(B.cut - 0.01).hand)).toBe(false);
  expect(layersEmpty({ layer: splitLensAt(B.cut - 0.01).hand.layer })).toBe(false);
});
