import fontUrl from '../assets/intro-mincho.woff2?url';
import { INTRO } from '../render/introTimeline.js';
import { createRng } from '../rng.js';

// 導入の 2D の層（S6）: 黒に白の縦書きのカード（「ありったけを」「解き放て」）、真っ白、題字「最後の一撃」（1 文字ずつ十字の星が
// 弾けて生まれる）、最初の読み込みの小さな「TAP」、TAP START のボタン。WebGL の画面の上に重ねる 2D の canvas に、
// 時刻 t（導入の秒）から決まる絵を描く（同じ t なら同じ絵。撮影・録画もこれ）。
// 書体: Zen Old Mincho Black（SIL Open Font License 1.1）を、ここで使う文字だけに切り詰めて埋め込む（scripts/build-intro-font.py）
export const INTRO_FONT = 'SaigoMincho';
const FONT_STACK = `"${INTRO_FONT}", "Hiragino Mincho ProN", "Yu Mincho", serif`;
// 縦書きで小さく右上へ寄せる仮名
const SMALL_KANA = new Set([...'っゃゅょぁぃぅぇぉ']);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3;

// 叩きつけ: 大きめから一気に縮み（わずかに行き過ぎ）、跳ね返って止まる。そのあとはゆっくり寄る
export function slamScale(d) {
  const C = INTRO.card;
  if (d < 0) return C.scale0;
  const hit = 0.065;
  if (d < hit) { const u = d / hit; return C.scale0 + (0.95 - C.scale0) * u * u; }
  return 1 - 0.05 * Math.exp(-(d - hit) / 0.045) * Math.cos((d - hit) * 38) + 0.022 * (d / 1.3);
}

// opts.dprMax: 2D の層の画素比の上限（画質の段の pixelRatioMax。録画は大きく）、opts.glow: 文字の光のにじみ（'full' high・'cheap' mid・'none' low）
export function createIntroOverlay(root = document.body, { dprMax = 2, glow = 'full' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.id = 'intro-fx';
  const gate = document.createElement('div');
  gate.id = 'intro-gate';
  gate.innerHTML = '<span>TAP</span>';
  const button = document.createElement('button');
  button.id = 'intro-start';
  button.type = 'button';
  button.textContent = 'TAP START';
  root.append(canvas, gate, button);
  const g = canvas.getContext('2d');
  let W = 1, H = 1, dpr = 1, lastEmpty = false;
  // 光のにじみ（shadowBlur は半径に比例して重い）: mid は小さく、low はなし（星と後ろの光は描く）
  const blurK = glow === 'full' ? 1 : glow === 'cheap' ? 0.35 : 0;

  // 書体（読み込めるまで、カードは仮の明朝で描く）
  let fontOk = false;
  const ready = (async () => {
    try {
      const face = new FontFace(INTRO_FONT, `url(${fontUrl}) format("woff2")`, { weight: '900', display: 'block' });
      await face.load();
      document.fonts.add(face);
      fontOk = true;
    } catch { /* 仮の明朝のまま */ }
  })();

  // 粒子（叩きつけの閃き）: 小さなノイズの模様を前もって作る
  const grain = document.createElement('canvas');
  grain.width = grain.height = 192;
  {
    const gg = grain.getContext('2d'), img = gg.createImageData(192, 192), rng = createRng(0x9a1e);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.floor(rng() * 255); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    gg.putImageData(img, 0, 0);
  }
  const grainPat = g.createPattern(grain, 'repeat');

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, dprMax);
    lastEmpty = false;
    W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const font = (px) => `900 ${px}px ${FONT_STACK}`;
  function glyph(ch, x, y, S) {
    if (SMALL_KANA.has(ch)) { g.font = font(S); g.fillText(ch, x + S * 0.14, y - S * 0.15); return; }
    g.font = font(S);
    g.fillText(ch, x, y);
  }

  // ---- カード ----
  function card(text, d) {
    const chars = [...text];
    const n = chars.length;
    const S = Math.min((H * 0.8) / n, W * 0.46, 200);
    const step = S * 0.98;
    const sc = slamScale(d);
    // R1b（持ち主 08:24「画面揺れなくていい」）: 叩きつけは大きめから縮んで止まる動きだけ（揺らさない）
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(sc, sc);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = clamp01(d / 0.02);
    const y0 = -(n - 1) * step / 2;
    chars.forEach((ch, i) => glyph(ch, 0, y0 + i * step, S));
    g.restore();
    g.globalAlpha = 1;
    // 粒子の閃きと、一瞬の白
    const gk = Math.exp(-d / (INTRO.card.grain * 0.45));
    if (gk > 0.01) {
    g.save();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.32 * gk;
    g.translate(-((d * 997) % 192), -((d * 613) % 192));
    g.fillStyle = grainPat;
    g.fillRect(0, 0, W + 192, H + 192);
    g.restore();
    }
    const fk = Math.exp(-d / 0.022);
    if (fk > 0.01) { g.fillStyle = `rgba(255,255,255,${0.32 * fk})`; g.fillRect(0, 0, W, H); }
  }

  // ---- 題字の十字の星 ----
  function ray(x, y, dx, dy, len, w, alpha, color) {
    if (len <= 0.5 || alpha <= 0.005) return;
    const nx = -dy, ny = dx;
    const grd = g.createLinearGradient(x, y, x + dx * len, y + dy * len);
    grd.addColorStop(0, color(alpha));
    grd.addColorStop(0.35, color(alpha * 0.55));
    grd.addColorStop(1, color(0));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x + nx * w, y + ny * w);
    g.lineTo(x + dx * len, y + dy * len);
    g.lineTo(x - nx * w, y - ny * w);
    g.closePath();
    g.fill();
  }
  // 持ち主 18:02: 題字は横書き、星は黒。白の閃光のあと白い地に、黒い文字と黒い四方の十字の星が 1 文字ずつ弾ける
  const ink = (a) => `rgba(8,6,10,${a})`;
  const smoke = (a) => `rgba(60,52,58,${a})`;
  function star(x, y, S, u, big = 1, rot = 0) {
    // u: 弾けの進み 0〜1。光の筋（黒）はすばやく伸び、ゆっくり細って消える
    const grow = easeOut(u * 3.2), fade = (1 - u) ** 1.4;
    const L = S * big * (0.3 + 2.1 * grow) * (0.55 + 0.45 * fade);
    const w = S * big * 0.04 * fade + 0.5;
    const A = fade;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    for (const [dx, dy, k] of [[0, -1, 1], [0, 1, 1], [-1, 0, 1.3], [1, 0, 1.3]]) ray(0, 0, dx, dy, L * k, w, A, ink);
    const d2 = Math.SQRT1_2;
    for (const [dx, dy] of [[d2, d2], [-d2, d2], [d2, -d2], [-d2, -d2]]) ray(0, 0, dx, dy, L * 0.32, w * 0.55, A * 0.6, smoke);
    // 黒い芯
    const R = S * big * (0.12 + 0.4 * (1 - u) ** 2);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, R);
    rg.addColorStop(0, ink(Math.min(1, 1.1 * fade)));
    rg.addColorStop(0.3, ink(0.55 * fade));
    rg.addColorStop(1, ink(0));
    g.fillStyle = rg;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // 文字ごとの小さな星（決まった位置・時刻）
  const sparks = [...INTRO.title.text].map((_, i) => {
    const rng = createRng(0x5eed + i * 31);
    return Array.from({ length: 6 }, () => ({ a: rng() * Math.PI * 2, r: 0.55 + 0.95 * rng(), delay: 0.04 + 0.26 * rng(), size: 0.08 + 0.13 * rng(), drift: 0.15 + 0.3 * rng(), life: 0.32 + 0.2 * rng() }));
  });

  // 題字の配置（横書き。「の」は小さく、少し下げる）
  const NO = 2; // 「の」の番号
  function titleLayout() {
    const S = Math.min(W * 0.185, H * 0.13, 150);
    const sizes = [1, 1, 0.7, 1, 1.05].map((k) => k * S);
    const adv = sizes.map((sz, i) => sz * (i === NO ? 1.12 : 1.0));
    const total = adv.reduce((a, b2) => a + b2, 0);
    let x = W / 2 - total / 2;
    const y = H * 0.42;
    return sizes.map((sz, i) => { const cx = x + adv[i] / 2; x += adv[i]; return { x: cx, y: y + (i === NO ? S * 0.08 : 0), S: sz, base: S }; });
  }

  // ---- 「の」の後ろのブラックホール（持ち主 18:02）: 暗い芯、細い光子の輪、まわりの白い地と粒を曲げる重力レンズ。
  // 「の」が吸い込まれていくように見せる（「の」は読めるまま）。ゆっくり渦を巻き続ける（ゲームの時間切れのブラックホールの予告）。
  // high: 地（白と粒、となりの文字）を小さな画面に描いて画素ごとにレンズで曲げる。mid / low: 曲げずに、影と輪と渦の筋だけ
  const lensSrc = document.createElement('canvas'), lensDst = document.createElement('canvas');
  const ls = lensSrc.getContext('2d', { willReadFrequently: true }), ld = lensDst.getContext('2d');
  let lensImg = null;
  function blackHole(L, state, alive) {
    const c = L[NO], S = c.base;
    // 持ち主 20:47: 5 文字が出そろってから、点から開く（レンズが広がり、輪に火がつく）
    if (!(state.bh > 0)) return;
    const grow = easeOut(state.bh);
    const cx = c.x, cy = c.y - S * 0.02;
    const thE = S * 0.46 * grow, rc = S * 0.25 * grow, R = S * 1.45 * grow;
    if (R < 2) return;
    const spin = alive * 0.35; // ゆっくりした渦
    if (blurK === 1) {
      // 地をレンズで曲げる（画素比の 0.75 倍の細かさ）
      const q = Math.max(1, dpr * 0.75), n = Math.ceil(2 * R * q);
      if (lensSrc.width !== n) { lensSrc.width = lensSrc.height = lensDst.width = lensDst.height = n; lensImg = null; }
      ls.setTransform(q, 0, 0, q, -(cx - R) * q, -(cy - R) * q);
      ls.fillStyle = '#fff';
      ls.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      paintGrain(ls, cx - R, cy - R, 2 * R, 2 * R, 0.07, alive); // 外の紙と同じ粒（円盤に見せない）
      const src = ls.getImageData(0, 0, n, n).data;
      lensImg ??= ld.createImageData(n, n);
      const out = lensImg.data, h = n / 2, te = thE * q, rcq = rc * q, Rq = R * q;
      for (let py = 0; py < n; py++) {
        for (let px = 0; px < n; px++) {
          const dx = px + 0.5 - h, dy = py + 0.5 - h, r = Math.hypot(dx, dy), o = (py * n + px) * 4;
          if (r >= Rq) { out[o] = src[o]; out[o + 1] = src[o + 1]; out[o + 2] = src[o + 2]; out[o + 3] = 0; continue; }
          // 点の重さのレンズ: 見える角 θ の光は β = θ − θE²/θ から来る。縁へ向けて曲げを弱める。中ほどほど強く渦を巻く
          const wgt = 1 - smoothstepJs(Rq * 0.55, Rq, r);
          const beta = r - (te * te / Math.max(r, 1e-3)) * wgt;
          const ang = Math.atan2(dy, dx) + spin * 0.9 * (te / Math.max(r, te)) ** 2 + 0.6 * wgt * (te / Math.max(r, te)) ** 2;
          let sx = h + Math.cos(ang) * beta, sy = h + Math.sin(ang) * beta;
          sx = Math.min(n - 1, Math.max(0, sx | 0)); sy = Math.min(n - 1, Math.max(0, sy | 0));
          const so = (sy * n + sx) * 4;
          // 芯へ近いほど暗く（光が戻ってこない）、芯は真っ黒
          const dark = r < rcq ? 1 : Math.exp(-(((r - rcq) / (te * 0.45)) ** 2)) * 0.8;
          const k = 1 - dark;
          out[o] = src[so] * k; out[o + 1] = src[so + 1] * k; out[o + 2] = src[so + 2] * k;
          out[o + 3] = 255 * (1 - smoothstepJs(Rq * 0.55, Rq, r)); // 縁は紙へなじませる
        }
      }
      ld.putImageData(lensImg, 0, 0);
      g.drawImage(lensDst, cx - R, cy - R, 2 * R, 2 * R);
    } else {
      // 軽い版: 影の広がり（灰）と黒い芯
      const rg = g.createRadialGradient(cx, cy, rc * 0.9, cx, cy, R);
      rg.addColorStop(0, 'rgba(0,0,0,1)');
      rg.addColorStop(0.12, 'rgba(10,8,12,0.85)');
      rg.addColorStop(0.45, 'rgba(40,34,40,0.25)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      // 渦の筋（ゆっくり回る）
      g.save();
      g.translate(cx, cy);
      g.strokeStyle = 'rgba(30,24,30,0.35)';
      g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const a0 = spin * 1.6 + i * 1.047; g.beginPath(); g.arc(0, 0, thE * (1.3 + 0.18 * i), a0, a0 + 1.2); g.stroke(); }
      g.restore();
    }
    // 降着円盤（細く傾いた、暖かい白の帯。手前の半分は芯の前を横切り、向こうの半分は曲げられて芯の上に弧を描く）と光子の輪
    g.save();
    g.translate(cx, cy);
    g.globalCompositeOperation = 'source-over';
    const hot = (a) => `rgba(255,214,150,${a})`;
    if (blurK > 0) { g.shadowColor = 'rgba(255,170,80,0.9)'; g.shadowBlur = 8 * blurK; }
    g.lineCap = 'round';
    // 向こう側の弧（重力で持ち上がって芯の上を回る）
    g.strokeStyle = hot(0.85 * grow); g.lineWidth = Math.max(1, S * 0.022);
    g.beginPath(); g.ellipse(0, -thE * 0.12, thE * 1.02, thE * 0.98, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    // 光子の輪
    g.strokeStyle = hot(0.95 * grow); g.lineWidth = Math.max(0.8, S * 0.012);
    g.beginPath(); g.arc(0, 0, rc * 1.12, 0, Math.PI * 2); g.stroke();
    // 手前の円盤（傾き、ゆっくり明るさが回る）
    g.rotate(-0.22);
    const sweep = 0.75 + 0.25 * Math.sin(spin * 3);
    g.strokeStyle = hot(0.9 * grow * sweep); g.lineWidth = Math.max(1, S * 0.03);
    g.beginPath(); g.ellipse(0, 0, thE * 2.0, thE * 0.26, 0, 0, Math.PI); g.stroke();
    g.strokeStyle = hot(0.45 * grow * sweep); g.lineWidth = Math.max(0.8, S * 0.014);
    g.beginPath(); g.ellipse(0, 0, thE * 2.0, thE * 0.26, 0, Math.PI, Math.PI * 2); g.stroke();
    g.restore();
  }
  const smoothstepJs = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function paintGrain(ctx, x, y, w, h, alpha, t) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = alpha;
    ctx.translate(-((t * 233) % 192), -((t * 157) % 192));
    ctx.fillStyle = grainPat;
    ctx.fillRect(x - 192, y - 192, w + 384, h + 384);
    ctx.restore();
  }

  function title(state, alive) {
    // 白い地（ごく弱い粒と、端の淡い影）
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    paintGrain(g, 0, 0, W, H, 0.07, alive);
    const vg = g.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.3, W / 2, H * 0.42, Math.hypot(W, H) * 0.65);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(40,30,40,0.16)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    const L = titleLayout();
    // 「の」の後ろのブラックホール（文字より先に描く。「の」は手前で読めるまま）
    blackHole(L, state, alive);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    state.chars.forEach((c, i) => {
      if (c.k <= 0) return;
      const { x, y, S } = L[i];
      const sc = 1.22 - 0.22 * c.k;
      g.save();
      g.translate(x, y);
      g.scale(sc, sc);
      g.globalAlpha = c.k;
      g.font = font(S);
      if (i === NO) {
        // 吸い込まれていく「の」: 渦の向きへごくわずかに傾く。仕上げはほかの文字と同じ黒。芯の黒の上でも読めるよう、
        // 白い縁どりではなく、紙の色のやわらかい光で芯から浮かせる
        g.rotate(0.025 * Math.sin(alive * 0.7));
        g.save(); g.shadowColor = 'rgba(255,255,255,0.95)'; g.shadowBlur = S * 0.12; g.fillStyle = '#0a080c'; g.fillText(c.ch, 0, 0); g.fillText(c.ch, 0, 0); g.restore();
      }
      if (blurK > 0) { g.shadowColor = `rgba(0,0,0,${0.45 * (1 - c.k)})`; g.shadowBlur = 30 * (1 - c.k) * blurK; }
      g.fillStyle = '#0a080c';
      g.fillText(c.ch, 0, 0);
      g.restore();
    });
    g.globalAlpha = 1;
    // 黒い十字の星
    state.chars.forEach((c, i) => {
      if (c.burst < 0 || c.age > 1.2) return;
      const { x, y, S } = L[i];
      if (c.burst < 1) star(x, y, S, c.burst, i === 4 ? 1.2 : 1);
      for (const sp of sparks[i]) {
        const d = c.age - sp.delay;
        if (d < 0 || d > sp.life) continue;
        const u = d / sp.life;
        const r = S * (sp.r + sp.drift * u);
        star(x + Math.cos(sp.a) * r, y + Math.sin(sp.a) * r, S * sp.size, u, 1, 0);
      }
    });
  }

  // 隠れる → 手のアップのつなぎ（持ち主 19:04「真っ暗な中に力の球がぼうっと浮き上がる」）: 真っ黒の中に、手の拍の球と同じ所に
  // かすかな力の球が、ゆらぎながらゆっくり浮かび上がる（u: 0〜1）
  function orbRise(u, t) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const k = easeOut(u) * (0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1));
    const cx = W / 2, cy = H * 0.5, R = Math.min(W, H) * (0.05 + 0.05 * easeOut(u));
    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, R * 5);
    halo.addColorStop(0, `rgba(255,170,90,${0.22 * k})`);
    halo.addColorStop(0.4, `rgba(160,60,30,${0.08 * k})`);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    core.addColorStop(0, `rgba(255,236,200,${0.85 * k})`);
    core.addColorStop(0.45, `rgba(255,170,90,${0.55 * k})`);
    core.addColorStop(1, 'rgba(120,40,20,0)');
    g.fillStyle = core;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  }

  // 1: 速さの線（消失点から外へ。速いほど濃い）
  const lines = (() => { const rng = createRng(0x11e5); return Array.from({ length: 46 }, () => ({ a: rng() * Math.PI * 2, r0: rng(), len: 0.08 + 0.22 * rng(), sp: 0.9 + 1.4 * rng(), w: 0.5 + 1.6 * rng() })); })();
  function speedLines(t, speed, vx, vy) {
    const cx = vx * W, cy = (1 - vy) * H, R = Math.hypot(W, H) * 0.75;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const l of lines) {
      const p = (l.r0 + t * l.sp * (0.6 + speed)) % 1;
      const r1 = R * (0.12 + 0.88 * p), r2 = r1 + R * l.len * (0.4 + speed);
      const a = 0.22 * speed * Math.sin(Math.PI * p);
      if (a < 0.01) continue;
      g.strokeStyle = `rgba(225,255,240,${a})`;
      g.lineWidth = l.w;
      g.beginPath();
      g.moveTo(cx + Math.cos(l.a) * r1, cy + Math.sin(l.a) * r1);
      g.lineTo(cx + Math.cos(l.a) * r2, cy + Math.sin(l.a) * r2);
      g.stroke();
    }
    g.restore();
  }

  let visible = true;
  return {
    canvas, gate, button, ready,
    get fontReady() { return fontOk; },
    resize,
    // 最初の読み込みの「TAP」
    showGate(on) { gate.classList.toggle('on', !!on); },
    // 時刻 t の絵。tl: introTimeline、b: tl.beatAt(t)、view3d: { speed, vanish }（3D の拍の速さの線）
    // alive: 題字が出たあとも動き続けるもの（ブラックホールの渦）の時刻（省けば t）
    draw(tl, t, b, view3d = null, alive = null) {
      if (!visible) return;
      const n = b.name;
      // 何も描かない拍（ライト・隠れる・手）は、空にしたら次からは触らない
      const empty = !(n === 'cardA' || n === 'cardB' || n === 'white' || n === 'title' || n === 'orb' || (n === 'bikes' && view3d));
      if (empty && lastEmpty) return;
      lastEmpty = empty;
      g.clearRect(0, 0, W, H);
      // カード: 真っ黒を INTRO.card.black 秒見せてから、文字が叩きつけられる（持ち主 19:04）
      if (n === 'cardA' || n === 'cardB') {
        const d = b.local - INTRO.card.black;
        if (d < 0) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); } else card(b.beat.text, d);
      }
      else if (n === 'orb') orbRise(b.local / b.beat.dur, t);
      else if (n === 'white') { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); }
      else if (n === 'title') title(tl.titleState(t), alive ?? t);
      else if (n === 'bikes' && view3d) speedLines(t, view3d.speed, view3d.vanish[0], view3d.vanish[1]);
      // ボタン: 題字の終わりへ向けて浮かぶ
      const bt = n === 'title' ? tl.titleState(t).button : 0;
      button.style.opacity = String(bt);
      button.classList.toggle('on', bt > 0);
      button.classList.toggle('pulse', bt >= 1);
    },
    // 画面全体を覆っているか（下の WebGL を描かなくてよい）
    covers(b) { return b.name === 'cardA' || b.name === 'cardB' || b.name === 'white' || b.name === 'title' || b.name === 'orb'; },
    // ゲームへ: 少しかけて消える
    fadeOut(sec = 0.5) {
      canvas.style.transition = `opacity ${sec}s ease-out`;
      canvas.style.opacity = '0';
      button.classList.remove('on', 'pulse');
      button.style.opacity = '0';
      button.disabled = true;
      setTimeout(() => { visible = false; canvas.hidden = true; button.hidden = true; }, sec * 1000 + 50);
    },
  };
}
