import { TIERS } from '../render/quality.js';
import { AMOUNT_LABEL } from '../ui/result.js';

// R4（spec §15「爆発の短い縦動画」・「珍しい結末の称号…短い動画」）: その人の一撃（爆発〜宇宙〜縦一線の光）を 6〜10 秒の縦動画にして、
// 題字と被害額を載せ、共有できる端末では共有、できなければ保存する（サーバーは持たない。録画はブラウザの中の MediaRecorder）。
// ここには描画を知らない純粋な関数（時間割・大きさ・形式・共有か保存か・重ねる文字）と、録画の段取り（createClipRecorder。描くのは main.js の host）を置く。
//
// 時間割（planClip）。動画の秒 τ を、どの場面のどの時刻で描くかへ写す。どの場面も現実の速さ（引き伸ばさない）:
//   close     リプレイの street（通りから見上げる）: 弾ける少し前のスローから、光の壁に呑まれる（白）まで
//   showcase  そのままリプレイの続き（ずっと引いた横のカット → 真上のカット）。主人公のカットには入らない
//   space     演出の宇宙: ふくらんだ光の半球と衝撃波の輪（押しつぶされる手前の spaceLead 秒）
//   line      半球が押しつぶされて縦一本の線になり、画面の上まで突き抜けて細くなって消える（R1d・M2。途中で切らない）
//   tail      消えたあとの焼けた街の灯と無音。題字と被害額を読む間
// 長すぎれば 見せ場 → 宇宙の前置き → 寄りの前置き → 余韻 の順に詰め、短すぎれば 余韻 → 宇宙 → 見せ場 の順に延ばす。
export const CLIP = {
  minSec: 6, maxSec: 10,
  closeLead: 1.6, closeMin: 1.0,     // 寄り: 弾ける前のスローの秒（その下限）
  showcaseSec: 2.0, showcaseMin: 1.2, // 見せ場の秒（その下限）
  spaceLead: 1.6, spaceMin: 1.0,     // 宇宙: 押しつぶされる前の秒（その下限）
  tailSec: 0.8, tailMin: 0.5, tailMax: 1.6,
  flashSec: 0.18,                     // 見せ場から宇宙へ切り替わる白の閃き
  bhTail: 0.5,                        // ブラックホール: 暗転（fade）からこの秒まで
  fps: 30,
};

// replay: createReplayTimeline の戻り値（cuts・burst）、finale: 演出の時刻表（chaseEnd・flatten・lineEnd）
export function planClip({ replay, finale }, C = CLIP) {
  const cut = (n) => replay.cuts.find((c) => c.name === n);
  const street = cut('street');
  const showEnd = (cut('top') ?? cut('side') ?? street).t1;
  const lineSec = finale.lineEnd - finale.flatten;
  // 長さ（秒）
  let close = street.t1 - Math.max(street.t0, replay.burst - C.closeLead);
  let show = Math.min(C.showcaseSec, showEnd - street.t1);
  let space = finale.flatten - Math.max(finale.chaseEnd, finale.flatten - C.spaceLead);
  let tail = C.tailSec;
  const closeAfter = street.t1 - replay.burst; // 弾けてから呑まれるまで（詰めない）
  const sum = () => close + show + space + lineSec + tail;
  const shrink = (len, min, over) => { const d = Math.max(0, Math.min(over, len - min)); return [len - d, over - d]; };
  let over = sum() - C.maxSec;
  if (over > 0) {
    [show, over] = shrink(show, Math.min(show, C.showcaseMin), over);
    [space, over] = shrink(space, Math.min(space, C.spaceMin), over);
    [close, over] = shrink(close, Math.min(close, closeAfter + C.closeMin), over);
    [tail, over] = shrink(tail, C.tailMin, over);
  }
  let need = C.minSec - sum();
  const grow = (len, max, n) => { const d = Math.max(0, Math.min(n, max - len)); return [len + d, n - d]; };
  if (need > 0) {
    [tail, need] = grow(tail, C.tailMax, need);
    [space, need] = grow(space, finale.flatten - finale.chaseEnd, need);
    [show, need] = grow(show, showEnd - street.t1, need);
    tail += Math.max(0, need);
  }
  const parts = [
    { name: 'close', src: 'replay', from: street.t1 - close, to: street.t1 },
    { name: 'showcase', src: 'replay', from: street.t1, to: street.t1 + show },
    { name: 'space', src: 'finale', from: finale.flatten - space, to: finale.flatten },
    { name: 'line', src: 'finale', from: finale.flatten, to: finale.lineEnd },
    { name: 'tail', src: 'finale', from: finale.lineEnd, to: finale.lineEnd + tail },
  ];
  const segments = stack(parts);
  const [s0, , s2, s3] = segments;
  const burst = replay.burst - s0.from;
  // 地鳴り（audio.rumbleKeys）と爆発の音（finaleBoomOpts）が読む時刻（動画の秒）
  const audio = {
    erupt: 0, burst, engulf: burst + 0.6 * (s0.t1 - burst), snap: s0.t1,
    chaseEnd: s2.t0, flatten: s3.t0, lineEnd: s3.t1,
  };
  const cues = [{ t: 0, name: 'erupt' }, { t: burst, name: 'burst' }, { t: s2.t0, name: 'space' }];
  return { kind: 'blast', segments, total: segments.at(-1).t1, cues, audio, flashes: [{ t: s2.t0, sec: C.flashSec }] };
}

// 時間切れの結末（ブラックホール）の動画: 画面全体になってから（cut）、街と空の飲み込み → 何もない空間 → 暗転の少しあとまで
export function planBlackholeClip(B, C = CLIP) {
  const segments = stack([{ name: 'swallow', src: 'blackhole', from: B.cut, to: Math.min(B.end, B.fade + C.bhTail) }]);
  return { kind: 'blackhole', segments, total: segments.at(-1).t1, cues: [{ t: 0, name: 'drone' }, { t: B.void - B.cut, name: 'void' }], audio: null, flashes: [] };
}

function stack(parts) {
  let t = 0;
  return parts.map((p) => { const s = { ...p, t0: t, t1: t + (p.to - p.from) }; t = s.t1; return s; });
}

// 動画の秒 tau の場面と、その場面の元の時刻 t（u は場面の中の 0〜1）。最後を過ぎたら最後の場面の終わり
export function clipAt(plan, tau) {
  const segs = plan.segments;
  let s = segs.find((x) => tau < x.t1) ?? segs.at(-1);
  const k = Math.min(s.t1 - s.t0, Math.max(0, tau - s.t0));
  return { name: s.name, src: s.src, t: s.from + k, u: s.t1 > s.t0 ? k / (s.t1 - s.t0) : 1 };
}

// (a, b] の間の合図
export function cuesBetween(plan, a, b) {
  return plan.cues.filter((c) => c.t > a && c.t <= b);
}

// ---- 大きさ ----
// 画質の段の画素（画面の長い辺 × 段の画素比の上限まで）で撮る。high は 1080×1920 まで、mid / low は 720×1280 まで（中くらいの Android で 30 fps）。
// 小さくても 360×640。縦 9:16（偶数）
export const CLIP_CAP = { high: 1920, mid: 1280, low: 1280, min: 640 };
export function clipSize({ tier, viewW, viewH, dpr = 1 }, cap = CLIP_CAP) {
  const pr = Math.min(dpr || 1, TIERS[tier]?.pixelRatioMax ?? 1);
  let h = Math.round(Math.max(viewW, viewH) * pr);
  h = Math.max(cap.min, Math.min(cap[tier] ?? cap.low, h));
  h = 2 * Math.round(h / 2);
  return { w: 2 * Math.floor(h * 9 / 32), h };
}

// ---- 形式 ----
// mp4（H.264 + AAC。共有先で再生できる所が多い）が使えればそれ。AAC の無い Chrome（Linux など）は H.264 + Opus の mp4。
// 名指ししない video/mp4 は最後の mp4（Safari は H.264 + AAC。Chrome は VP9 + Opus を mp4 に入れる）。だめなら webm。
// 音の入らない形式（codecs=avc1 だけ）は使わない（音の道をつなぐと録れない）
export const CLIP_FORMATS = [
  'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
// isTypeSupported: MediaRecorder.isTypeSupported（無ければ null）
export function pickClipFormat(isTypeSupported, formats = CLIP_FORMATS) {
  if (typeof isTypeSupported !== 'function') return null;
  for (const m of formats) {
    let ok = false;
    try { ok = !!isTypeSupported(m); } catch { ok = false; }
    if (ok) return { mimeType: m, ext: m.startsWith('video/mp4') ? 'mp4' : 'webm' };
  }
  return null;
}

// 日本時間の日時のファイル名
export function clipFileName(date, ext) {
  const j = new Date(date.getTime() + 9 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return `saigo-no-ichigeki-${j.getUTCFullYear()}${p(j.getUTCMonth() + 1)}${p(j.getUTCDate())}-${p(j.getUTCHours())}${p(j.getUTCMinutes())}.${ext}`;
}

// ---- 共有か保存か ----
// navigator.canShare({ files }) なら Web Share（ファイルと共有の文）。取り消しは 'cancel'。共有できない・失敗したら保存（download(file) が true を返せば保存の操作をした）。
// framed（artifact の iframe の中）は保存が止められていることがある: 'maybe-blocked'。戻り値 'shared' | 'cancel' | 'downloaded' | 'maybe-blocked' | 'failed'
export async function deliverClip(file, { nav = null, text = '', download, framed = false } = {}) {
  let can = false;
  try { can = typeof nav?.share === 'function' && !!nav?.canShare?.({ files: [file] }); } catch { can = false; }
  if (can) {
    try { await nav.share(text ? { files: [file], text } : { files: [file] }); return 'shared'; } catch (e) {
      if (e?.name === 'AbortError') return 'cancel';
      // 共有に失敗した（許可がない・ファイルの種類を断られたなど）: 保存へ
    }
  }
  let ok = false;
  try { ok = !!download(file); } catch { ok = false; }
  if (!ok) return 'failed';
  return framed ? 'maybe-blocked' : 'downloaded';
}
export const CLIP_NOTE = {
  downloaded: '動画を保存しました',
  'maybe-blocked': 'この画面では動画を保存できないことがあります。保存されないときは、正式なページで試してください（文の「共有」はそのまま使えます）',
  failed: '動画を共有・保存できませんでした（文の「共有」はそのまま使えます）',
  empty: '動画を作れませんでした（中身が空でした。文の「共有」はそのまま使えます）',
  error: '動画を作れませんでした（文の「共有」はそのまま使えます）',
};

// ---- 重ねる文字 ----
// c: result.resultContent の戻り値（title・headline・amount・rank・titles）
export function clipOverlay(c) {
  const b = c.titles?.[0] ?? null;
  return {
    title: c.title, rank: c.rank ?? null, headline: c.headline,
    amountLabel: c.amount ? AMOUNT_LABEL : null, amount: c.amount ?? null,
    badge: b?.name ?? null, stars: b?.rarity ?? 0,
  };
}

// 動画の一コマに文字を重ねる（2D の canvas）。上に題字、下に暗い帯とランク・勝ち負け・被害額・称号。
// titleFont: 題字の書体（同梱の Zen Old Mincho の切り詰め。「最後の一撃」の字は入っている）。ほかは太いシステムの字
export function drawOverlay(g, w, h, ov, tau, plan, { titleFont = null } = {}) {
  const sys = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
  const fadeIn = Math.min(1, tau / 0.35);
  // 宇宙へ切り替わる白の閃き
  for (const f of plan.flashes ?? []) {
    const a = 1 - (tau - f.t) / f.sec;
    if (tau >= f.t && a > 0) { g.fillStyle = `rgba(255,250,240,${a.toFixed(3)})`; g.fillRect(0, 0, w, h); }
  }
  g.save();
  g.globalAlpha = fadeIn;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // 上: 題字
  const top = g.createLinearGradient(0, 0, 0, h * 0.16);
  top.addColorStop(0, 'rgba(8,4,18,0.55)'); top.addColorStop(1, 'rgba(8,4,18,0)');
  g.fillStyle = top; g.fillRect(0, 0, w, h * 0.16);
  const ts = Math.round(w * 0.105);
  g.font = titleFont ? `900 ${ts}px "${titleFont}", ${sys}` : `900 ${ts}px ${sys}`;
  g.shadowColor = 'rgba(255,170,80,0.85)'; g.shadowBlur = ts * 0.35;
  g.fillStyle = '#fff6e6';
  g.fillText(ov.title, w / 2, h * 0.07);
  g.shadowBlur = 0;
  // 下: 暗い帯
  const y0 = h * 0.72;
  const bot = g.createLinearGradient(0, y0, 0, h);
  bot.addColorStop(0, 'rgba(8,4,18,0)'); bot.addColorStop(0.35, 'rgba(8,4,18,0.62)'); bot.addColorStop(1, 'rgba(8,4,18,0.82)');
  g.fillStyle = bot; g.fillRect(0, y0, w, h - y0);
  const pad = w * 0.06;
  let tx = w / 2;
  if (ov.rank) {
    const rs = Math.round(w * 0.24);
    g.font = `italic 900 ${rs}px ${sys}`;
    g.textAlign = 'left';
    g.shadowColor = ov.rank === 'S' ? 'rgba(255,196,80,0.95)' : 'rgba(200,190,255,0.5)'; g.shadowBlur = rs * 0.25;
    g.fillStyle = { S: '#fff4c8', A: '#ffe2b8', B: '#dfe8ff', C: '#b9b0c4' }[ov.rank] ?? '#eee';
    g.fillText(ov.rank, pad, h * 0.865);
    g.shadowBlur = 0;
    g.font = `700 ${Math.round(w * 0.032)}px ${sys}`;
    g.fillStyle = 'rgba(232,226,240,0.75)';
    g.fillText('ランク', pad + w * 0.01, h * 0.785);
    tx = pad + rs * 0.95 + (w - pad - (pad + rs * 0.95)) / 2;
    g.textAlign = 'center';
  }
  const room = ov.rank ? w - (pad + w * 0.24 * 0.95) - pad : w - 2 * pad;
  const fit = (text, size, weight = 800) => {
    let s = size;
    g.font = `${weight} ${Math.round(s)}px ${sys}`;
    while (s > 8 && g.measureText(text).width > room) { s *= 0.92; g.font = `${weight} ${Math.round(s)}px ${sys}`; }
  };
  g.fillStyle = '#ffffff';
  fit(ov.headline, w * 0.072, 900);
  g.fillText(ov.headline, tx, h * (ov.amount ? 0.80 : 0.84));
  if (ov.amount) {
    fit(ov.amountLabel, w * 0.034, 700);
    g.fillStyle = 'rgba(232,226,240,0.8)';
    g.fillText(ov.amountLabel, tx, h * 0.845);
    fit(ov.amount, w * 0.085, 900);
    g.fillStyle = '#ffe9b0';
    g.fillText(ov.amount, tx, h * 0.885);
  }
  if (ov.badge) {
    const label = `${ov.badge}${ov.stars ? ' ' + '★'.repeat(ov.stars) : ''}`;
    fit(label, w * 0.04, 800);
    const bw = Math.min(room, g.measureText(label).width + w * 0.06), bh = w * 0.065, by = h * 0.94;
    g.fillStyle = 'rgba(255,214,120,0.18)';
    g.strokeStyle = 'rgba(255,214,120,0.9)'; g.lineWidth = Math.max(1, w * 0.004);
    roundRect(g, tx - bw / 2, by - bh / 2, bw, bh, bh / 2);
    g.fill(); g.stroke();
    g.fillStyle = '#ffe7a8';
    g.fillText(label, tx, by);
  }
  g.restore();
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - r); g.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  g.lineTo(x + r, y + h); g.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  g.lineTo(x, y + r); g.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  g.closePath();
}

// ---- 録画の段取り ----
// host（main.js）:
//   begin(kind, size) → plan       録画の前: ゲームの毎フレームを止め、描く大きさを size にし、場面を最初の時刻の手前まで進める（重い）
//   frame(at)                       clipAt の場面と元の時刻を、WebGL の canvas へ描く
//   cue(name, plan)                 音の合図（erupt・burst・space・drone・void）
//   audioStream() → MediaStream?    master の出口の写し（MediaStreamDestination）。鳴っている音は変えない
//   end()                           元へ戻す（大きさ・リプレイの最後の絵・ブラックホールの暗転・BGM）
//   shouldStop() → bool             一時停止・タブの切り替えで、録画を打ち切る
//   canvas                          WebGL の canvas（描いた直後に 2D の canvas へ写す）
// 戻り値の record(...) は { file, blob, url, mimeType, plan } か { cancelled: true } か { error } を返す約束
export const CLIP_MIN_BYTES = 1024; // これより小さい動画は中身がない（エンコーダの失敗など）
export function createClipRecorder(host, { doc = document, MR = globalThis.MediaRecorder, now = () => performance.now(), raf = (f) => requestAnimationFrame(f), later = (f, ms) => setTimeout(f, ms), C = CLIP } = {}) {
  let busy = false, cancelFn = null;
  return {
    get busy() { return busy; },
    get supported() { return !!pickClipFormat(MR?.isTypeSupported?.bind(MR)) && typeof doc.createElement('canvas').captureStream === 'function'; },
    // fix1（見直し I-1）: 待っている録画をすぐ終わらせる（次のフレームが来なくても）
    cancel() { cancelFn?.(); },
    // kind: 'blast' | 'blackhole'。size: { w, h }。overlay: clipOverlay の戻り値。onProgress(p 0〜1, phase)
    // 戻り値は { blob, mimeType, ext, plan } | { cancelled: true } | { error }。どの道でも（描く側が投げても）最後に host.end を一度呼んで元へ戻す
    async record({ kind, size, overlay, titleFont = null, onProgress = () => {}, onPreview = () => {} }) {
      if (busy) return { error: 'busy' };
      const fmt = pickClipFormat(MR?.isTypeSupported?.bind(MR));
      if (!fmt) return { error: 'unsupported' };
      busy = true;
      // 段取りの途中の待ち（フレーム・録画の止まり）は、やめる・失敗でいつでも打ち切れる（stop）
      let stopWith = null;
      const halted = new Promise((r) => { stopWith = r; });
      let cancelled = false;
      cancelFn = () => { cancelled = true; stopWith({ cancelled: true }); };
      const fail = (error) => stopWith({ error });
      const race = (p) => Promise.race([p, halted.then((x) => { throw x; })]);
      let began = false, canvas = null, stream = null, audio = null, rec = null;
      try {
        canvas = doc.createElement('canvas');
        canvas.width = size.w; canvas.height = size.h;
        const g = canvas.getContext('2d', { alpha: false });
        onProgress(0, 'prepare');
        // 準備の重い計算（リプレイを最初の時刻の手前まで進める）の前に、知らせを一度描かせる
        await race(new Promise((r) => raf(() => r())));
        began = true;
        const plan = host.begin(kind, size);
        onPreview(canvas);
        const paint = (tau) => {
          host.frame(clipAt(plan, tau));
          g.drawImage(host.canvas, 0, 0, size.w, size.h);
          drawOverlay(g, size.w, size.h, overlay, tau, plan, { titleFont });
        };
        paint(0);
        stream = canvas.captureStream(C.fps);
        audio = host.audioStream();
        for (const tr of audio?.getAudioTracks?.() ?? []) stream.addTrack(tr);
        const px = size.w * size.h;
        rec = new MR(stream, { mimeType: fmt.mimeType, videoBitsPerSecond: Math.round(Math.min(12e6, Math.max(2.5e6, px * 6))), audioBitsPerSecond: 128000 });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
        rec.onerror = (e) => fail(e?.error ?? new Error('MediaRecorder error'));
        const stopped = new Promise((r) => { rec.onstop = () => r(); });
        rec.start(250);
        const start = now();
        let prev = -Infinity;
        await race(new Promise((resolve) => {
          const tick = () => {
            // fix1（I-1）: rAF の中で投げたら、外の約束を失敗で終わらせる（後始末へ）
            try {
              if (cancelled) return;
              if (host.shouldStop()) { cancelFn(); return; }
              const tau = Math.min(plan.total, (now() - start) / 1000);
              for (const c of cuesBetween(plan, prev, tau)) host.cue(c.name, plan);
              prev = tau;
              paint(tau);
              onProgress(tau / plan.total, 'record');
              if (tau >= plan.total) { resolve(); return; }
              raf(tick);
            } catch (e) { fail(e); }
          };
          tick();
        }));
        // 最後の一コマが写ってから止める
        await race(new Promise((r) => raf(() => r())));
        rec.stop();
        await race(Promise.race([stopped, new Promise((r) => later(r, 2000))]));
        const blob = new Blob(chunks, { type: fmt.mimeType.split(';')[0] });
        // fix1（M7）: 中身のない動画は失敗
        if (blob.size < CLIP_MIN_BYTES) return { error: 'empty' };
        return { blob, mimeType: fmt.mimeType, ext: fmt.ext, plan };
      } catch (x) {
        if (x && typeof x === 'object' && ('cancelled' in x || ('error' in x && Object.keys(x).length === 1))) return x;
        return { error: x };
      } finally {
        try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* 済み */ }
        for (const tr of stream?.getTracks?.() ?? []) { try { tr.stop(); } catch { /* 済み */ } }
        for (const tr of audio?.getTracks?.() ?? []) { try { tr.stop(); } catch { /* 済み */ } }
        if (canvas) canvas.width = canvas.height = 0;
        stream = audio = rec = null;
        let endError = null;
        if (began) { try { host.end(); } catch (e) { endError = e; } }
        busy = false; cancelFn = null;
        // 元へ戻す処理が投げた: 録画は失敗として返す（旗は下ろした）
        if (endError) return { error: endError }; // eslint-disable-line no-unsafe-finally
      }
    },
  };
}

// ---- 結果画面の「動画で共有」の段取り ----
// fix1（見直し I-2・M3・M6・M7）: 押した瞬間（await の前）に、二度目を断り、結果画面を押せなくし、知らせを開く。準備（書体の読み込み）の間に
// やめたら録画は始めない。失敗・中身のない動画は知らせを閉じて一言。「共有する」は一つ目が終わるまで二つ目を無視（共有と保存が両方走らない）。
// 録った動画を覚えておく（last）のは debug のときだけ。
// recorder: createClipRecorder の戻り値、panel: createClipPanel の戻り値、result: { setBusy, notify }、canClip(reason)、
// prepare(info) → { kind, size, overlay, titleFont }（約束でよい）、share(r, info) → { file, text, label }、deliver(file, text) → deliverClip の答え
export function createClipSession({ recorder, panel, result, canClip, prepare, share, deliver, debug = false }) {
  // open: 押してから知らせを閉じるまで（できたあとの「共有する」の画面も含む）。その間は次を始めない
  let open = false, cancelled = false, last = null;
  return {
    get busy() { return open || recorder.busy; },
    get last() { return last; },
    cancel() { cancelled = true; recorder.cancel(); },
    async start(info) {
      if (open || recorder.busy || !canClip(info.reason)) return null;
      open = true; cancelled = false;
      result.setBusy(true);
      panel.start({ cancel: () => this.cancel() });
      const back = () => { panel.close(); result.setBusy(false); open = false; };
      try {
        let opts;
        try { opts = await prepare(info); } catch (error) { back(); result.notify(CLIP_NOTE.error); return { error }; }
        if (cancelled) { back(); return { cancelled: true }; }
        const r = await recorder.record({ ...opts, onProgress: (p, ph) => panel.progress(p, ph), onPreview: (c) => panel.preview(c) });
        if (debug) last = r;
        if (!r.blob) {
          back();
          if (r.error) result.notify(r.error === 'empty' ? CLIP_NOTE.empty : CLIP_NOTE.error);
          return r;
        }
        const { file, text, label } = share(r, info);
        let delivering = false;
        panel.done({
          blob: r.blob, label,
          // Web Share はボタンを押したその操作の中で呼ぶ（録画のあとでは押した操作の期限が切れている）
          async deliver() {
            if (delivering) return null;
            delivering = true;
            panel.setBusy?.(true);
            try {
              const res = await deliver(file, text);
              if (res === 'shared') back();
              else if (CLIP_NOTE[res]) panel.say(CLIP_NOTE[res]);
              return res;
            } finally { delivering = false; panel.setBusy?.(false); }
          },
          close: back,
        });
        return r;
      } catch (error) {
        back();
        result.notify(CLIP_NOTE.error);
        return { error };
      }
    },
  };
}

// ---- 録画の知らせ（進み・やめる・できたら共有か保存）----
// root: 空の <div id="clip">。録画の間は録っている 2D の canvas をそのまま見せ、できたら録った動画を見せる
export function createClipPanel(root, doc = document) {
  const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const card = mk('div', 'clip-card');
  const view = mk('div', 'clip-view');
  const side = mk('div', 'clip-side');
  const status = mk('div', 'clip-status');
  const bar = mk('div', 'clip-bar'), fill = mk('i');
  bar.append(fill);
  const note = mk('div', 'clip-note');
  const row = mk('div', 'clip-row');
  const main = mk('button', 'result-btn primary', '共有する');
  const cancel = mk('button', 'result-btn', 'やめる');
  row.append(main, cancel);
  side.append(status, bar, note, row);
  card.append(view, side);
  root.append(card);
  root.hidden = true;
  let onCancel = null, onMain = null, onClose = null, url = null;
  cancel.addEventListener('click', () => (onClose ?? onCancel)?.());
  main.addEventListener('click', () => onMain?.());
  const clearView = () => {
    for (const v of view.querySelectorAll('video')) { v.pause?.(); v.removeAttribute('src'); v.load?.(); }
    view.replaceChildren();
    if (url) { URL.revokeObjectURL(url); url = null; }
  };
  return {
    get open() { return !root.hidden; },
    // 録画を始める: 進みの帯と「やめる」
    start({ cancel: c }) {
      clearView();
      onCancel = c; onMain = null; onClose = null;
      status.textContent = '動画を作っています…';
      note.textContent = ''; note.hidden = true;
      fill.style.width = '0%';
      bar.hidden = false; main.hidden = true;
      cancel.textContent = 'やめる';
      root.hidden = false;
      cancel.focus?.();
    },
    preview(canvas) { view.replaceChildren(canvas); },
    progress(p, phase) {
      status.textContent = phase === 'prepare' ? '動画の準備をしています…' : '動画を作っています…';
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
    },
    // できた: 録った動画を見せ、共有（共有できなければ保存）と閉じる
    done({ blob, label, deliver, close }) {
      clearView();
      url = URL.createObjectURL(blob);
      const v = mk('video');
      Object.assign(v, { src: url, muted: true, loop: true, autoplay: true, playsInline: true, controls: false });
      v.setAttribute('playsinline', '');
      view.append(v);
      v.play?.()?.catch?.(() => {});
      status.textContent = 'できました';
      bar.hidden = true;
      main.textContent = label; main.hidden = false;
      cancel.textContent = '閉じる';
      onMain = deliver; onClose = close; onCancel = null;
      main.focus?.();
    },
    say(m) { note.textContent = m ?? ''; note.hidden = !m; },
    // fix1（M3）: 共有・保存をしている間は「共有する」を押せない
    setBusy(on) { main.disabled = !!on; },
    close() { clearView(); root.hidden = true; onCancel = onMain = onClose = null; },
  };
}
