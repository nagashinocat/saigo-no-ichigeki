// 看板の絵柄を一枚の発光テクスチャ（アトラス）に手続きで描く（S7。持ち主 2026-11-21 13:13 / 13:16）。
// 文字は「漢字っぽい」「カタカナっぽい」架空の字形（線の組み合わせを乱数で作る。実在の語・店名・ロゴは描かない）。
// 2 チャンネル（RG）: R = ネオン管の芯（くっきり）、G = 管のまわりのにじみ（やわらかい）。色はシェーダーがインスタンスの色を掛ける。
// 区画（タイル）の並びは layout() で、画素を描かなくても分かる（看板の置き方を決める純粋な関数が使う）。

import { createRng } from '../rng.js';

export const ATLAS_SIZE = 1024;

// タイルの並び（画素）。[x, y, w, h] は左下原点
const GROUPS = {
  blade: { n: 16, w: 64, h: 256, x0: 0, y0: 0, cols: 16 },     // 縦長の看板（ビルの角を走る）
  band: { n: 16, w: 256, h: 64, x0: 0, y0: 256, cols: 4 },     // 横長の看板（張り出し・壁）
  board: { n: 8, w: 256, h: 128, x0: 0, y0: 512, cols: 4 },    // 屋上の大看板（図柄 + 文字）
  lantern: { n: 8, w: 64, h: 128, x0: 0, y0: 768, cols: 8 },   // 提灯のような箱
  shop: { n: 8, w: 128, h: 64, x0: 512, y0: 768, cols: 4 },    // 店先（のれん・格子）
  picto: { n: 8, w: 128, h: 128, x0: 0, y0: 896, cols: 8 },    // 単純な図柄
};

// 種類ごとのタイルの UV [u0, v0, du, dv]（0〜1）
export function layout(size = ATLAS_SIZE) {
  const k = size / ATLAS_SIZE;
  const out = {};
  for (const [name, g] of Object.entries(GROUPS)) {
    out[name] = [];
    for (let i = 0; i < g.n; i++) {
      const x = g.x0 + (i % g.cols) * g.w, y = g.y0 + Math.floor(i / g.cols) * g.h;
      out[name].push({ px: [x * k, y * k, g.w * k, g.h * k], uv: [x / ATLAS_SIZE, y / ATLAS_SIZE, g.w / ATLAS_SIZE, g.h / ATLAS_SIZE] });
    }
  }
  return out;
}
export const TILE_COUNTS = Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, g.n]));

// ---- 字形（単位正方形 0〜1 の線分の集まり。y は上向き） ----
const seg = (x0, y0, x1, y1) => [x0, y0, x1, y1];
function radicalStrokes(r, x0, x1) {
  // 偏や旁の一部: 横棒・縦棒・はらい・点・口 を組み合わせる
  const s = [];
  const cx = (x0 + x1) / 2, wv = x1 - x0;
  const kind = Math.floor(r() * 6);
  if (kind === 0) { // 口
    s.push(seg(x0 + 0.1 * wv, 0.3, x1 - 0.1 * wv, 0.3), seg(x0 + 0.1 * wv, 0.7, x1 - 0.1 * wv, 0.7), seg(x0 + 0.1 * wv, 0.3, x0 + 0.1 * wv, 0.7), seg(x1 - 0.1 * wv, 0.3, x1 - 0.1 * wv, 0.7));
  } else if (kind === 1) { // 十に払い
    s.push(seg(x0, 0.6, x1, 0.6), seg(cx, 0.9, cx, 0.1), seg(cx, 0.45, x0, 0.15));
  } else if (kind === 2) { // 三本の横棒と縦棒
    s.push(seg(x0, 0.85, x1, 0.85), seg(x0 + 0.1 * wv, 0.5, x1 - 0.1 * wv, 0.5), seg(x0, 0.12, x1, 0.12), seg(cx, 0.85, cx, 0.12));
  } else if (kind === 3) { // 点が三つ（さんずい風）
    s.push(seg(x0 + 0.2 * wv, 0.85, x0 + 0.45 * wv, 0.75), seg(x0 + 0.1 * wv, 0.55, x0 + 0.4 * wv, 0.48), seg(x0 + 0.15 * wv, 0.1, x0 + 0.5 * wv, 0.35));
  } else if (kind === 4) { // 门のような囲い
    s.push(seg(x0 + 0.1 * wv, 0.9, x0 + 0.1 * wv, 0.1), seg(x0 + 0.1 * wv, 0.88, x1 - 0.1 * wv, 0.88), seg(x1 - 0.1 * wv, 0.88, x1 - 0.1 * wv, 0.1), seg(cx, 0.6, cx, 0.3));
  } else { // 人のような払い二つ
    s.push(seg(cx, 0.9, x0 + 0.05 * wv, 0.1), seg(cx - 0.05 * wv, 0.6, x1 - 0.05 * wv, 0.1));
  }
  return s;
}
// 漢字っぽい字: 左右（偏と旁）か上下に分けて組む
function kanjiGlyph(r) {
  if (r() < 0.6) {
    const split = 0.38 + 0.12 * r();
    return [...radicalStrokes(r, 0.05, split), ...radicalStrokes(r, split + 0.06, 0.95)];
  }
  const top = radicalStrokes(r, 0.1, 0.9).map(([a, b, c, d]) => [a, 0.55 + b * 0.4, c, 0.55 + d * 0.4]);
  const bot = radicalStrokes(r, 0.05, 0.95).map(([a, b, c, d]) => [a, 0.05 + b * 0.45, c, 0.05 + d * 0.45]);
  return [...top, ...bot];
}
// カタカナっぽい字: 2〜3 画の直線と払い
function kanaGlyph(r) {
  const pool = [
    () => seg(0.15, 0.82, 0.85, 0.82), () => seg(0.2, 0.5, 0.8, 0.5), () => seg(0.5, 0.9, 0.5, 0.1),
    () => seg(0.85, 0.82, 0.3, 0.08), () => seg(0.35, 0.9, 0.2, 0.45), () => seg(0.7, 0.6, 0.85, 0.2),
    () => seg(0.2, 0.15, 0.85, 0.15), () => seg(0.3, 0.85, 0.6, 0.55), () => seg(0.6, 0.82, 0.6, 0.35),
  ];
  const n = 2 + Math.floor(r() * 2), s = [];
  for (let i = 0; i < n; i++) s.push(pool[Math.floor(r() * pool.length)]());
  return s;
}
function circle(cx, cy, rad, n = 20, a0 = 0, a1 = Math.PI * 2) {
  const s = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (a1 - a0) * (i / n), t1 = a0 + (a1 - a0) * ((i + 1) / n);
    s.push(seg(cx + Math.cos(t0) * rad, cy + Math.sin(t0) * rad, cx + Math.cos(t1) * rad, cy + Math.sin(t1) * rad));
  }
  return s;
}
// 単純な図柄（どこの店のものでもない、ありふれた形）
const PICTOS = [
  () => circle(0.5, 0.5, 0.36),                                                                         // 輪
  () => { const s = []; for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + i * 4 * Math.PI / 5, b = a + 4 * Math.PI / 5; s.push(seg(0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a), 0.5 + 0.4 * Math.cos(b), 0.5 + 0.4 * Math.sin(b))); } return s; }, // 星
  () => [seg(0.5, 0.9, 0.85, 0.5), seg(0.85, 0.5, 0.5, 0.1), seg(0.5, 0.1, 0.15, 0.5), seg(0.15, 0.5, 0.5, 0.9)], // ひし形
  () => [seg(0.15, 0.5, 0.85, 0.5), seg(0.85, 0.5, 0.6, 0.75), seg(0.85, 0.5, 0.6, 0.25)],             // 矢印
  () => [seg(0.6, 0.92, 0.3, 0.48), seg(0.3, 0.48, 0.62, 0.52), seg(0.62, 0.52, 0.38, 0.08)],            // 稲妻
  () => [...circle(0.45, 0.45, 0.25, 16, Math.PI, Math.PI * 2), seg(0.2, 0.45, 0.2, 0.75), seg(0.7, 0.45, 0.7, 0.75), seg(0.2, 0.75, 0.7, 0.75), ...circle(0.78, 0.58, 0.1, 10, -Math.PI / 2, Math.PI / 2)], // 湯のみ
  () => [...circle(0.45, 0.5, 0.28, 18, 0.5, Math.PI * 2 - 0.5), seg(0.7, 0.62, 0.92, 0.75), seg(0.7, 0.38, 0.92, 0.25), seg(0.92, 0.75, 0.92, 0.25)], // 魚
  () => [...circle(0.5, 0.5, 0.38, 20), ...circle(0.5, 0.5, 0.18, 14)],                               // 二重の輪
];

// ---- 描画 ----
// 線分の集まりを、画素の矩形 [x, y, w, h] の中へ、距離場で描く（芯の太さ width px、にじみ halo px）
function rasterize(data, size, rect, strokes, { width = 2.2, halo = 6 } = {}) {
  const [rx, ry, rw, rh] = rect;
  const dist = new Float32Array(rw * rh).fill(1e9);
  const reach = width + halo * 3;
  for (const [x0, y0, x1, y1] of strokes) {
    const ax = x0, ay = y0, bx = x1, by = y1;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - reach)), maxX = Math.min(rw - 1, Math.ceil(Math.max(ax, bx) + reach));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - reach)), maxY = Math.min(rh - 1, Math.ceil(Math.max(ay, by) + reach));
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5 - ax, py = y + 0.5 - ay;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
        const ex = px - dx * t, ey = py - dy * t;
        const d = Math.sqrt(ex * ex + ey * ey);
        const k = y * rw + x;
        if (d < dist[k]) dist[k] = d;
      }
    }
  }
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const d = dist[y * rw + x];
      const core = Math.max(0, Math.min(1, (width + 0.7 - d) / 1.4));
      const glow = d > 1e8 ? 0 : Math.exp(-Math.max(0, d - width) / halo);
      const o = ((ry + y) * size + rx + x) * 2;
      data[o] = Math.max(data[o], Math.round(core * 255));
      data[o + 1] = Math.max(data[o + 1], Math.round(glow * 255));
    }
  }
}

// 字形（単位正方形）を画素の箱 [x, y, s, s] へ写す
const place = (strokes, x, y, s) => strokes.map(([a, b, c, d]) => [x + a * s, y + b * s, x + c * s, y + d * s]);
const frame = (w, h, m) => [seg(m, m, w - m, m), seg(w - m, m, w - m, h - m), seg(w - m, h - m, m, h - m), seg(m, h - m, m, m)];

// アトラスを描く。返り値: { data: Uint8Array（RG, size×size）, size, tiles: layout(size) }
export function buildSignAtlas(seed = 7, size = ATLAS_SIZE) {
  const r = createRng(seed);
  const data = new Uint8Array(size * size * 2);
  const tiles = layout(size);
  const k = size / ATLAS_SIZE;
  const glyph = () => (r() < 0.55 ? kanjiGlyph(r) : kanaGlyph(r));
  // 縦長: 字を縦に 3〜4 つ、枠つき
  tiles.blade.forEach(({ px }) => {
    const [, , w, h] = px, n = 3 + Math.floor(r() * 2), s = w * 0.74, gap = (h - 12 * k - n * s) / (n + 1);
    const st = [...frame(w, h, 3 * k)];
    for (let i = 0; i < n; i++) st.push(...place(glyph(), (w - s) / 2, h - 6 * k - (gap + s) * (i + 1), s));
    rasterize(data, size, px, st, { width: 2.0 * k, halo: 5 * k });
  });
  // 横長: 字を横に 3〜5 つ（ときどき図柄を頭に）
  tiles.band.forEach(({ px }) => {
    const [, , w, h] = px, n = 3 + Math.floor(r() * 3), s = h * 0.6, gap = (w - 10 * k - n * s) / (n + 1);
    const st = r() < 0.6 ? [...frame(w, h, 3 * k)] : [];
    for (let i = 0; i < n; i++) st.push(...place(i === 0 && r() < 0.3 ? PICTOS[Math.floor(r() * PICTOS.length)]() : glyph(), 5 * k + gap + (gap + s) * i, (h - s) / 2, s));
    rasterize(data, size, px, st, { width: 2.0 * k, halo: 5 * k });
  });
  // 屋上の大看板: 大きな図柄と、横に字の列、二重の枠
  tiles.board.forEach(({ px }) => {
    const [, , w, h] = px, ps = h * 0.7;
    const st = [...frame(w, h, 3 * k), ...frame(w, h, 9 * k)];
    st.push(...place(PICTOS[Math.floor(r() * PICTOS.length)](), 14 * k, (h - ps) / 2, ps));
    const n = 3 + Math.floor(r() * 2), s = h * 0.36, x0 = 22 * k + ps, gap = (w - x0 - 14 * k - n * s) / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) st.push(...place(glyph(), x0 + (s + gap) * i, h * 0.5, s));
    for (let i = 0; i < n + 2; i++) st.push(...place(kanaGlyph(r), x0 + ((w - x0 - 14 * k) / (n + 2)) * i, h * 0.16, s * 0.6));
    rasterize(data, size, px, st, { width: 2.6 * k, halo: 7 * k });
  });
  // 提灯: 横の骨と、まん中に字ひとつ
  tiles.lantern.forEach(({ px }) => {
    const [, , w, h] = px, st = [];
    for (let i = 1; i <= 5; i++) st.push(seg(4 * k, (h * i) / 6, w - 4 * k, (h * i) / 6));
    st.push(...place(kanjiGlyph(r), w * 0.15, h * 0.32, w * 0.7));
    rasterize(data, size, px, st, { width: 1.6 * k, halo: 7 * k });
  });
  // 店先: のれんの縦の切れ目と、細い枠
  tiles.shop.forEach(({ px }) => {
    const [, , w, h] = px, st = [seg(2 * k, h - 4 * k, w - 2 * k, h - 4 * k)], n = 3 + Math.floor(r() * 4);
    for (let i = 1; i < n; i++) st.push(seg((w * i) / n, h - 4 * k, (w * i) / n, h * 0.3));
    st.push(...place(glyph(), w * 0.5 - h * 0.22, h * 0.45, h * 0.44));
    rasterize(data, size, px, st, { width: 1.8 * k, halo: 6 * k });
  });
  tiles.picto.forEach(({ px }, i) => {
    const [, , w, h] = px;
    rasterize(data, size, px, place(PICTOS[i % PICTOS.length](), w * 0.1, h * 0.1, w * 0.8), { width: 3 * k, halo: 7 * k });
  });
  return { data, size, tiles };
}
