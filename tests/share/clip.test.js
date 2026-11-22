import { test, expect } from 'vitest';
import { CLIP, planClip, planBlackholeClip, clipAt, cuesBetween, clipSize, pickClipFormat, CLIP_FORMATS, deliverClip, clipFileName, clipOverlay } from '../../src/share/clip.js';
import { createReplayTimeline } from '../../src/render/replayTimeline.js';
import { createTimeline } from '../../src/render/finaleTimeline.js';
import { BLACKHOLE } from '../../src/render/blackholeTimeline.js';
import { CONFIG } from '../../src/config.js';

const RADII = [CONFIG.radius.min, 120, 300, 500, CONFIG.radius.max];
const plans = (r) => {
  const replay = createReplayTimeline({ radius: r, streetDist: Math.min(170, Math.max(40, 0.4 * r)) });
  const finale = createTimeline({ radius: r });
  return { replay, finale, clip: planClip({ replay, finale }) };
};

// ---- 動画の時間割（カットと長さ）----
test('爆発の動画: 爆発の寄り → 見せ場 → 宇宙 → 縦一線の光 → 余韻、の順で 6〜10 秒（どの大きさの一発でも）', () => {
  for (const r of RADII) {
    const { clip } = plans(r);
    expect(clip.segments.map((s) => s.name)).toEqual(['close', 'showcase', 'space', 'line', 'tail']);
    expect(clip.total).toBeGreaterThanOrEqual(CLIP.minSec);
    expect(clip.total).toBeLessThanOrEqual(CLIP.maxSec);
    // つながっている（0 から始まり、すき間なく total まで）
    expect(clip.segments[0].t0).toBe(0);
    for (let i = 1; i < clip.segments.length; i++) expect(clip.segments[i].t0).toBeCloseTo(clip.segments[i - 1].t1, 9);
    expect(clip.segments.at(-1).t1).toBeCloseTo(clip.total, 9);
    for (const s of clip.segments) expect(s.to - s.from).toBeCloseTo(s.t1 - s.t0, 9); // 現実の速さ（引き伸ばさない）
  }
});

test('爆発の寄りと見せ場はリプレイの続きの時刻（同じ写しから同じ一発）、宇宙と縦一線は演出の時刻表から', () => {
  for (const r of RADII) {
    const { replay, finale, clip } = plans(r);
    const [close, show, space, line, tail] = clip.segments;
    const street = replay.cut('street');
    expect(close.src).toBe('replay'); expect(show.src).toBe('replay');
    // 寄りは弾ける少し前のスローから、通りで呑み込まれる（白）まで
    expect(close.from).toBeGreaterThanOrEqual(street.t0 - 1e-9);
    expect(close.from).toBeLessThan(replay.burst);
    expect(close.to).toBeCloseTo(street.t1, 9);
    // 見せ場はそのままリプレイの続き（引きの横のカット・真上のカット）。主人公のカットには入らない
    expect(show.from).toBeCloseTo(close.to, 9);
    expect(show.to).toBeLessThanOrEqual(replay.cut('top').t1 + 1e-9);
    // 宇宙: 押しつぶされる前の半球。縦一線: 押しつぶされて線になり、消えるまで（途中で切らない）
    expect(space.src).toBe('finale'); expect(line.src).toBe('finale'); expect(tail.src).toBe('finale');
    expect(space.from).toBeGreaterThanOrEqual(finale.chaseEnd - 1e-9);
    expect(space.to).toBeCloseTo(finale.flatten, 9);
    expect(line.from).toBeCloseTo(finale.flatten, 9);
    expect(line.to).toBeCloseTo(finale.lineEnd, 9);
    expect(tail.from).toBeCloseTo(finale.lineEnd, 9);
  }
});

test('clipAt: 動画の時刻 → その場面の元の時刻（境目では次の場面、最後は余韻の終わり）', () => {
  const { clip } = plans(300);
  const [close, show, space] = clip.segments;
  expect(clipAt(clip, 0)).toEqual({ name: 'close', src: 'replay', t: close.from, u: 0 });
  expect(clipAt(clip, close.t1).name).toBe('showcase');
  const mid = (show.t0 + show.t1) / 2;
  expect(clipAt(clip, mid).t).toBeCloseTo(show.from + (mid - show.t0), 9);
  expect(clipAt(clip, space.t0 + 0.1).src).toBe('finale');
  const end = clipAt(clip, clip.total + 5);
  expect(end.name).toBe('tail');
  expect(end.t).toBeCloseTo(clip.segments.at(-1).to, 9);
  expect(end.u).toBe(1);
});

test('長すぎるときは見せ場 → 宇宙の前置き → 寄りの前置きの順に詰め、短すぎるときは余韻と宇宙を延ばす', () => {
  // 作った時刻表で: 長い見せ場・長い宇宙（上限を超える）
  const replay = { burst: 3, cuts: [{ name: 'street', t0: 0.5, t1: 3.2 }, { name: 'side', t0: 3.2, t1: 9 }, { name: 'top', t0: 9, t1: 12 }, { name: 'hero', t0: 12, t1: 14 }] };
  const long = planClip({ replay, finale: { chaseEnd: 4, flatten: 12, lineEnd: 13.5 } }, { ...CLIP, showcaseSec: 4, spaceLead: 4, closeLead: 2.5 });
  expect(long.total).toBeCloseTo(CLIP.maxSec, 6);
  const seg = Object.fromEntries(long.segments.map((s) => [s.name, s]));
  expect(seg.showcase.t1 - seg.showcase.t0).toBeCloseTo(CLIP.showcaseMin, 6);
  expect(seg.line.t1 - seg.line.t0).toBeCloseTo(1.5, 6); // 縦一線は詰めない
  // 短い: 見せ場がほとんどない・宇宙もない
  const shortR = { burst: 1.0, cuts: [{ name: 'street', t0: 0.5, t1: 1.1 }, { name: 'side', t0: 1.1, t1: 1.2 }, { name: 'top', t0: 1.2, t1: 1.3 }, { name: 'hero', t0: 1.3, t1: 2 }] };
  const short = planClip({ replay: shortR, finale: { chaseEnd: 4, flatten: 4.5, lineEnd: 5.5 } });
  expect(short.total).toBeGreaterThanOrEqual(CLIP.minSec - 1e-9);
  const s2 = Object.fromEntries(short.segments.map((s) => [s.name, s]));
  expect(s2.space.from).toBeGreaterThanOrEqual(4 - 1e-9); // 宇宙は chaseEnd より前へは延ばせない
  expect(s2.tail.t1 - s2.tail.t0).toBeGreaterThan(CLIP.tailSec);
});

test('音の合図: 0 秒で地鳴り（erupt）、弾けた瞬間に爆発の音（burst）、宇宙でこもる（space）。地鳴りの時刻表は動画の秒', () => {
  for (const r of RADII) {
    const { replay, clip } = plans(r);
    const close = clip.segments[0];
    const names = clip.cues.map((c) => c.name);
    expect(names).toEqual(['erupt', 'burst', 'space']);
    const at = Object.fromEntries(clip.cues.map((c) => [c.name, c.t]));
    expect(at.erupt).toBe(0);
    expect(at.burst).toBeCloseTo(replay.burst - close.from, 9);
    expect(at.space).toBeCloseTo(clip.segments[2].t0, 9);
    const a = clip.audio;
    // 地鳴りの折れ線（audio.rumbleKeys）が読む時刻: 順に並ぶ
    expect(a.erupt).toBe(0);
    expect(a.burst).toBeCloseTo(at.burst, 9);
    expect(a.snap).toBeCloseTo(close.t1, 9);
    expect(a.engulf).toBeLessThan(a.snap);
    expect(a.engulf).toBeGreaterThan(a.burst);
    expect(a.chaseEnd).toBeCloseTo(clip.segments[2].t0, 9);
    expect(a.flatten).toBeCloseTo(clip.segments[3].t0, 9);
    expect(a.lineEnd).toBeCloseTo(clip.segments[3].t1, 9);
  }
});

test('cuesBetween: (a, b] の合図（同じ合図は一度だけ）', () => {
  const { clip } = plans(300);
  expect(cuesBetween(clip, -Infinity, 0).map((c) => c.name)).toEqual(['erupt']);
  const b = clip.cues[1].t;
  expect(cuesBetween(clip, 0, b).map((c) => c.name)).toEqual(['burst']);
  expect(cuesBetween(clip, b, b + 0.01)).toEqual([]);
  expect(cuesBetween(clip, 0, clip.total).map((c) => c.name)).toEqual(['burst', 'space']);
});

test('ブラックホールの動画: 画面全体になってから（cut）、飲み込み → 何もない空間 → 暗転の手前まで。6〜10 秒', () => {
  const p = planBlackholeClip(BLACKHOLE);
  expect(p.segments.map((s) => s.name)).toEqual(['swallow']);
  const s = p.segments[0];
  expect(s.src).toBe('blackhole');
  expect(s.from).toBeCloseTo(BLACKHOLE.cut, 9);
  expect(s.to).toBeGreaterThan(BLACKHOLE.void);
  expect(s.to).toBeLessThanOrEqual(BLACKHOLE.end);
  expect(p.total).toBeGreaterThanOrEqual(CLIP.minSec);
  expect(p.total).toBeLessThanOrEqual(CLIP.maxSec);
  expect(p.cues.map((c) => c.name)).toEqual(['drone', 'void']);
  expect(p.cues[1].t).toBeCloseTo(BLACKHOLE.void - BLACKHOLE.cut, 9);
  expect(clipAt(p, 1).t).toBeCloseTo(BLACKHOLE.cut + 1, 9);
});

// ---- 大きさ（画質の段）----
test('大きさ: 9:16 の縦。画質の段の画素（画面の長い辺 × 段の画素比）で、mid / low は 720×1280 まで、high は 1080×1920 まで', () => {
  // 390×844 の携帯、画素比 3
  expect(clipSize({ tier: 'high', viewW: 390, viewH: 844, dpr: 3 })).toEqual({ w: 948, h: 1688 }); // 844 × 2（high の上限 2）
  expect(clipSize({ tier: 'mid', viewW: 390, viewH: 844, dpr: 3 })).toEqual({ w: 712, h: 1266 }); // 844 × 1.5
  expect(clipSize({ tier: 'mid', viewW: 412, viewH: 915, dpr: 2.6 })).toEqual({ w: 720, h: 1280 }); // 915 × 1.5 = 1372 → 上限
  expect(clipSize({ tier: 'low', viewW: 390, viewH: 844, dpr: 3 })).toEqual({ w: 474, h: 844 });
  // PC の横長 1920×1080、画素比 1: 長い辺 1920 → high は 1080×1920
  expect(clipSize({ tier: 'high', viewW: 1920, viewH: 1080, dpr: 1 })).toEqual({ w: 1080, h: 1920 });
  expect(clipSize({ tier: 'mid', viewW: 2560, viewH: 1440, dpr: 2 })).toEqual({ w: 720, h: 1280 });
  // 小さすぎる画面でも 360×640 より小さくしない。いつも偶数で 9:16 に近い
  const s = clipSize({ tier: 'low', viewW: 200, viewH: 300, dpr: 1 });
  expect(s).toEqual({ w: 360, h: 640 });
  for (const t of ['high', 'mid', 'low']) for (const [w, h, d] of [[390, 844, 3], [412, 915, 2.6], [1366, 768, 1], [768, 1024, 2]]) {
    const z = clipSize({ tier: t, viewW: w, viewH: h, dpr: d });
    expect(z.w % 2).toBe(0); expect(z.h % 2).toBe(0);
    expect(Math.abs(z.w / z.h - 9 / 16)).toBeLessThan(0.004);
    if (t !== 'high') expect(z.h).toBeLessThanOrEqual(1280);
  }
});

// ---- 形式の選び方 ----
test('形式: 使えれば mp4（H.264 + AAC）、だめなら webm、どれも使えなければ null', () => {
  const only = (...ok) => (m) => ok.includes(m);
  expect(pickClipFormat(() => true)).toEqual({ mimeType: CLIP_FORMATS[0], ext: 'mp4' });
  expect(CLIP_FORMATS[0]).toMatch(/^video\/mp4/);
  expect(pickClipFormat(only('video/mp4'))).toEqual({ mimeType: 'video/mp4', ext: 'mp4' });
  expect(pickClipFormat(only('video/webm;codecs=vp9,opus', 'video/webm'))).toEqual({ mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' });
  expect(pickClipFormat(only('video/webm'))).toEqual({ mimeType: 'video/webm', ext: 'webm' });
  expect(pickClipFormat(() => false)).toBe(null);
  expect(pickClipFormat(null)).toBe(null); // MediaRecorder がない
  // isTypeSupported が投げても次を試す
  expect(pickClipFormat((m) => { if (m.startsWith('video/mp4')) throw new Error('x'); return m === 'video/webm'; })).toEqual({ mimeType: 'video/webm', ext: 'webm' });
  // H.264 の mp4 は、形式を名指ししない video/mp4（Chrome は VP9 を mp4 に入れる）より先。AAC が無い Chrome（Linux）は H.264 + Opus
  expect(pickClipFormat(only('video/mp4', 'video/mp4;codecs=avc1,opus', 'video/webm'))).toEqual({ mimeType: 'video/mp4;codecs=avc1,opus', ext: 'mp4' });
  expect(pickClipFormat(only('video/mp4', 'video/mp4;codecs=avc1,mp4a.40.2'))).toEqual({ mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' });
  // 音の入らない形式（codecs=avc1 だけ）は選ばない
  expect(CLIP_FORMATS).not.toContain('video/mp4;codecs=avc1');
  // mp4 は webm より先
  const i = (p) => CLIP_FORMATS.findIndex((m) => m.startsWith(p));
  expect(i('video/mp4')).toBeLessThan(i('video/webm'));
});

test('ファイル名: saigo-no-ichigeki-YYYYMMDD-HHMM.拡張子（日本時間）', () => {
  expect(clipFileName(new Date('2026-11-23T03:04:00Z'), 'mp4')).toBe('saigo-no-ichigeki-20261123-1204.mp4');
  expect(clipFileName(new Date('2026-11-23T15:30:00Z'), 'webm')).toBe('saigo-no-ichigeki-20261124-0030.webm');
});

// ---- 共有か保存か ----
const FILE = { name: 'a.mp4', type: 'video/mp4' };
test('共有: canShare({ files }) なら Web Share にファイルと文を渡す', async () => {
  const calls = [];
  const nav = { canShare: (d) => { calls.push(['can', d]); return true; }, share: async (d) => { calls.push(['share', d]); } };
  const r = await deliverClip(FILE, { nav, text: 'T', download: () => { throw new Error('no'); } });
  expect(r).toBe('shared');
  expect(calls[0]).toEqual(['can', { files: [FILE] }]);
  expect(calls[1]).toEqual(['share', { files: [FILE], text: 'T' }]);
});

test('共有: 取り消しは cancel（保存しない）。共有が失敗（取り消し以外）したら保存へ', async () => {
  const abort = Object.assign(new Error('a'), { name: 'AbortError' });
  let saved = 0;
  const download = () => { saved++; return true; };
  expect(await deliverClip(FILE, { nav: { canShare: () => true, share: async () => { throw abort; } }, download })).toBe('cancel');
  expect(saved).toBe(0);
  const denied = Object.assign(new Error('n'), { name: 'NotAllowedError' });
  expect(await deliverClip(FILE, { nav: { canShare: () => true, share: async () => { throw denied; } }, download })).toBe('downloaded');
  expect(saved).toBe(1);
});

test('保存: canShare が無い・ファイルを共有できない・share が無いなら保存。iframe の中は保存できないことがある（blocked?）', async () => {
  const names = [];
  const download = (f) => { names.push(f.name); return true; };
  expect(await deliverClip(FILE, { nav: {}, download })).toBe('downloaded');
  expect(await deliverClip(FILE, { nav: { canShare: () => false, share: async () => {} }, download })).toBe('downloaded');
  expect(await deliverClip(FILE, { nav: { canShare: () => true }, download })).toBe('downloaded');
  expect(await deliverClip(FILE, { nav: { canShare: () => { throw new Error('x'); }, share: async () => {} }, download })).toBe('downloaded');
  expect(await deliverClip(FILE, { nav: null, download })).toBe('downloaded');
  expect(names).toEqual(['a.mp4', 'a.mp4', 'a.mp4', 'a.mp4', 'a.mp4']);
  // artifact の iframe（framed）: 保存の操作はしたが、止められているかもしれない
  expect(await deliverClip(FILE, { nav: {}, download, framed: true })).toBe('maybe-blocked');
  // 保存もできない
  expect(await deliverClip(FILE, { nav: {}, download: () => false })).toBe('failed');
  expect(await deliverClip(FILE, { nav: {}, download: () => { throw new Error('x'); } })).toBe('failed');
});

test('共有の知らせ: 保存した・止められたかも・できない、それぞれ一言（共有の文のボタンはそのまま使える）', async () => {
  const { CLIP_NOTE } = await import('../../src/share/clip.js');
  expect(CLIP_NOTE.downloaded).toMatch(/保存/);
  expect(CLIP_NOTE['maybe-blocked']).toMatch(/保存できない/);
  expect(CLIP_NOTE['maybe-blocked']).toMatch(/共有/); // 文の共有はそのまま使える
  expect(CLIP_NOTE.failed).toBeTruthy();
  expect(CLIP_NOTE.shared).toBeUndefined();
  expect(CLIP_NOTE.cancel).toBeUndefined();
});

// ---- 重ねる文字 ----
test('重ねる文字: 題字「最後の一撃」・ランク・勝ち負け・被害額・称号（あれば一つ）', () => {
  const c = { title: '最後の一撃', headline: '撃退成功', amount: '¥3.2億', rank: 'S', titles: [{ name: '残り一秒の奇跡', rarity: 4 }] };
  expect(clipOverlay(c)).toEqual({ title: '最後の一撃', rank: 'S', headline: '撃退成功', amountLabel: '被害額', amount: '¥3.2億', badge: '残り一秒の奇跡', stars: 4 });
  const bh = { title: '最後の一撃', headline: 'ブラックホールになった', amount: null, rank: 'C', titles: [] };
  expect(clipOverlay(bh)).toEqual({ title: '最後の一撃', rank: 'C', headline: 'ブラックホールになった', amountLabel: null, amount: null, badge: null, stars: 0 });
  // 全角の間で区切った見出しは、そのまま一行の文字
  expect(clipOverlay({ ...c, headline: '撃退失敗　残り 3 体' }).headline).toBe('撃退失敗　残り 3 体');
});
