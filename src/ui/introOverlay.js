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

export function createIntroOverlay(root = document.body) {
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
  let W = 1, H = 1, dpr = 1;

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
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
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
  function card(text, d, seedK) {
    const chars = [...text];
    const n = chars.length;
    const S = Math.min((H * 0.8) / n, W * 0.46, 200);
    const step = S * 0.98;
    const sc = slamScale(d);
    // 揺れ（叩きつけの瞬間に大きく、すぐ止む）
    const a = 9 * Math.exp(-d / INTRO.card.shake * 3.2);
    const sx = a * Math.sin(d * 91 + seedK), sy = a * Math.sin(d * 77 + 1.3 + seedK);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2 + sx, H / 2 + sy);
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
  const white = (a) => `rgba(255,255,255,${a})`;
  const warm = (a) => `rgba(255,226,170,${a})`;
  const cool = (a) => `rgba(200,240,255,${a})`;
  function star(x, y, S, u, big = 1, rot = 0) {
    // u: 弾けの進み 0〜1。光の筋はすばやく伸び、ゆっくり細って消える
    const grow = easeOut(u * 3.2), fade = (1 - u) ** 1.4;
    const L = S * big * (0.3 + 2.1 * grow) * (0.55 + 0.45 * fade);
    const w = S * big * 0.045 * fade + 0.6;
    const A = fade;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    for (const [dx, dy, k] of [[0, -1, 1.25], [0, 1, 1.25], [-1, 0, 1], [1, 0, 1]]) ray(0, 0, dx, dy, L * k, w, A, white);
    const d2 = Math.SQRT1_2;
    for (const [dx, dy] of [[d2, d2], [-d2, d2], [d2, -d2], [-d2, -d2]]) ray(0, 0, dx, dy, L * 0.34, w * 0.6, A * 0.7, warm);
    // 明るい芯
    const R = S * big * (0.18 + 0.55 * (1 - u) ** 2);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, R);
    rg.addColorStop(0, white(Math.min(1, 1.2 * fade)));
    rg.addColorStop(0.25, warm(0.75 * fade));
    rg.addColorStop(1, warm(0));
    g.fillStyle = rg;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // 文字ごとの小さな星（決まった位置・時刻）
  const sparks = [...INTRO.title.text].map((_, i) => {
    const rng = createRng(0x5eed + i * 31);
    return Array.from({ length: 6 }, () => ({ a: rng() * Math.PI * 2, r: 0.55 + 0.95 * rng(), delay: 0.04 + 0.26 * rng(), size: 0.1 + 0.17 * rng(), drift: 0.15 + 0.3 * rng(), life: 0.32 + 0.2 * rng() }));
  });

  // 題字の配置（縦書き。「の」は小さく）
  function titleLayout() {
    const S = Math.min((H * 0.6) / 4.55, W * 0.34, 150);
    const sizes = [1, 1, 0.6, 1, 1.04].map((k) => k * S);
    const gaps = sizes.map((s) => s * 0.97);
    const total = gaps.reduce((a, b) => a + b, 0);
    let y = H * 0.44 - total / 2;
    return sizes.map((s, i) => { const cy = y + gaps[i] / 2; y += gaps[i]; return { x: W / 2, y: cy, S: s }; });
  }

  function title(state) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    // うしろにごく弱い暖かい光（題字が浮く）
    const lit = state.chars.reduce((a, c) => a + c.k, 0) / state.chars.length;
    if (lit > 0) {
      const rg = g.createRadialGradient(W / 2, H * 0.44, 0, W / 2, H * 0.44, H * 0.55);
      rg.addColorStop(0, `rgba(90,40,22,${0.55 * lit})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
    }
    const L = titleLayout();
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
      g.shadowColor = `rgba(255,190,120,${0.55 + 0.45 * (1 - c.k)})`;
      g.shadowBlur = 10 + 40 * (1 - c.k);
      g.fillStyle = c.k < 1 ? `rgb(255,${Math.round(236 + 19 * c.k)},${Math.round(205 + 50 * c.k)})` : '#fff';
      g.font = font(S);
      g.fillText(c.ch, 0, 0);
      g.shadowBlur = 0;
      g.restore();
    });
    g.globalAlpha = 1;
    // 星（加算）
    g.save();
    g.globalCompositeOperation = 'lighter';
    state.chars.forEach((c, i) => {
      if (c.burst < 0 || c.age > 1.2) return;
      const { x, y, S } = L[i];
      if (c.burst < 1) star(x, y, S, c.burst, i === 4 ? 1.25 : 1);
      for (const sp of sparks[i]) {
        const d = c.age - sp.delay;
        if (d < 0 || d > sp.life) continue;
        const u = d / sp.life;
        const r = S * (sp.r + sp.drift * u);
        star(x + Math.cos(sp.a) * r, y + Math.sin(sp.a) * r, S * sp.size, u, 1, 0);
      }
    });
    g.restore();
    if (state.flash > 0.003) { g.fillStyle = `rgba(255,255,255,${state.flash})`; g.fillRect(0, 0, W, H); }
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
    draw(tl, t, b, view3d = null) {
      if (!visible) return;
      g.clearRect(0, 0, W, H);
      const n = b.name;
      if (n === 'cardA' || n === 'cardB') card(b.beat.text, b.local, n === 'cardA' ? 0 : 2.1);
      else if (n === 'white') { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); }
      else if (n === 'title') title(tl.titleState(t));
      else if (n === 'bikes' && view3d) speedLines(t, view3d.speed, view3d.vanish[0], view3d.vanish[1]);
      // ボタン: 題字の終わりへ向けて浮かぶ
      const bt = n === 'title' ? tl.titleState(t).button : 0;
      button.style.opacity = String(bt);
      button.classList.toggle('on', bt > 0);
      button.classList.toggle('pulse', bt >= 1);
    },
    // 画面全体を覆っているか（下の WebGL を描かなくてよい）
    covers(b) { return b.name === 'cardA' || b.name === 'cardB' || b.name === 'white' || b.name === 'title'; },
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
