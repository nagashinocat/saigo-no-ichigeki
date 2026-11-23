import { test, expect, afterEach } from 'vitest';
import { createAudio, finaleBoomOpts, DEBRIS_LEVEL, REPLAY_CUT_SEC } from '../../src/audio/audio.js';
import { collapseHitInfo } from '../../src/audio/collapse.js';
import { createTimeline } from '../../src/render/finaleTimeline.js';
import { restoreReplayAfterClip } from '../../src/share/clip.js';
import { CONFIG } from '../../src/config.js';

// 持ち主 22:47「リプレイ飛ばすと音が残ってる」: リプレイを飛ばしたら、リプレイの音（瓦礫の崩れる音・演出のあとの低い地鳴りと地響き・
// 爆発の音の尾・先に予約した音）を約 80 ms で 0 へ落とし、先の予約も取り消す。飛ばしたあとの早送り（暗いうちに最後まで）の崩れる音は鳴らさない。
// 次のリプレイ（'replayStart' の debrisMode('replay')）で元へ。R4 の録画のあとの早送りの黙らせ（debrisMode('off') → 'replay'）も変えない

import { fakeCtx } from './fakeAudioCtx.js';
afterEach(() => { delete globalThis.window; });
function rig() {
  const ctx = fakeCtx();
  globalThis.window = { AudioContext: function AC() { return ctx; } };
  const audio = createAudio({ nav: {}, later: () => {} });
  audio.unlock();
  // build の最初の gain が master（世界の音）、次が cine（演出の音）。最初の filter が out。瓦礫の音の道 debrisBus は debrisLp（3 つ目の filter）へつながる gain
  const debrisLp = ctx.filters[2];
  const debrisBus = ctx.links.find(([a, b]) => b === debrisLp && ctx.gains.includes(a))[0];
  const boomClip = ctx.links.find(([a, b]) => a === ctx.gains[7] && b.oversample)?.[1];
  return { ctx, audio, master: ctx.gains[0], cine: ctx.gains[1], boomBus: ctx.gains[7], boomClip, out: ctx.filters[0], debrisBus, built: { s: ctx.sources.length, o: ctx.oscs.length } };
}
const tl = () => createTimeline({ radius: CONFIG.radius.max, riderDist: CONFIG.radius.max * 0.46, camDist: CONFIG.radius.max * 0.46 + 14 });
const hits = (n, from = 0) => Array.from({ length: n }, (_, i) => collapseHitInfo({ id: 'b' + (from + i), w: 20, d: 20, h: 40 }, { camX: 10, camZ: -40, dist: 60 }));
// 演出の終わりからリプレイの途中まで: 時間が戻る（世界の音・地響き）→ 弾ける（爆発の音）→ 宇宙でこもる → 無音のあとの地鳴り → リプレイ（瓦礫の音）
function playIntoReplay({ ctx, audio }) {
  const T = tl();
  audio.silence();
  audio.unsilence(); audio.finaleRumble(T);
  audio.boom(1, finaleBoomOpts(T));
  audio.muffle(1.4);
  audio.deepRumble(1);
  ctx.currentTime += 1.0; // 演出の終わり → リプレイの始まり（rumbleHold 1 秒）
  audio.debrisMode('replay');
  for (let i = 0; i < 6; i++) { audio.collapse(hits(3, i * 3)); ctx.currentTime += 0.3; }
}

test('22:47: リプレイを飛ばすと、それまでに鳴らした・予約した音はどれも飛ばした時刻 + 0.1 秒より後まで鳴らない', () => {
  const r = rig();
  playIntoReplay(r);
  const { ctx, audio, built } = r;
  const made = [...ctx.sources.slice(built.s), ...ctx.oscs.slice(built.o)].filter((s) => s.startT != null);
  expect(made.length).toBeGreaterThan(10);
  const skipAt = ctx.currentTime;
  expect(made.some((s) => s.stopT > skipAt + 1)).toBe(true); // 直す前: 地鳴り・地響き・爆発の尾が何秒も残る
  expect(REPLAY_CUT_SEC).toBeGreaterThan(0.03); expect(REPLAY_CUT_SEC).toBeLessThanOrEqual(0.08);
  audio.cutReplay();
  for (const s of made) expect(s.stopT, `${s.loop ? 'loop' : 'one-shot'} start ${s.startT}`).toBeLessThanOrEqual(skipAt + 0.1 + 1e-9);
});

test('22:47: 飛ばすと、瓦礫の音の道・演出の音の道・爆発の音の道・世界の音（master）が約 80 ms で 0 へ。地鳴りの「6 秒後に戻す」予約も消える', () => {
  const r = rig();
  playIntoReplay(r);
  const { ctx, audio, master, cine, boomBus, debrisBus } = r;
  const t = ctx.currentTime;
  expect(debrisBus.gain.at(t)).toBeCloseTo(DEBRIS_LEVEL.replay, 5);
  audio.cutReplay();
  for (const [name, g] of [['debris', debrisBus], ['cine', cine], ['boom', boomBus], ['master', master]]) {
    expect(g.gain.at(t + 0.001), name).toBeGreaterThanOrEqual(0); // 急に切らずに落とす（クリックしない）
    expect(g.gain.at(t + REPLAY_CUT_SEC + 1e-6), name).toBeLessThan(1e-3);
    expect(g.gain.at(t + 7), name).toBeLessThan(1e-3); // 先の予約（地鳴りが引いたあとに master を戻す）は取り消し
  }
});

test('22:47: 飛ばしたあとの早送り（暗いうちに最後まで）の崩れる音は鳴らさない。次のリプレイ（debrisMode replay）では元どおり鳴る', () => {
  const r = rig();
  playIntoReplay(r);
  const { ctx, audio, debrisBus, out } = r;
  audio.cutReplay();
  const n0 = ctx.sources.length;
  for (let i = 0; i < 10; i++) { audio.collapse(hits(4, 100 + i * 4)); ctx.currentTime += 1 / 60; }
  ctx.currentTime += 1;
  audio.collapse([]);
  expect(ctx.sources.length).toBe(n0);
  // もう一度リプレイ（結果画面の「リプレイ」）: 瓦礫の音の道は戻り、新しい演出の道が out へつながる
  audio.debrisMode('replay');
  const t = ctx.currentTime;
  expect(debrisBus.gain.at(t + 0.01)).toBeCloseTo(DEBRIS_LEVEL.replay, 5);
  audio.collapse(hits(2, 500));
  expect(ctx.sources.length).toBeGreaterThan(n0);
  const freshCine = ctx.gains.filter((g) => ctx.links.some(([a, b]) => a === g && b === out));
  expect(freshCine.some((g) => g !== r.cine && g.gain.at(t) > 0.5)).toBe(true);
});

test('22:47: R4 の録画のあとの早送り（restoreReplayAfterClip: off → play → skip）も黙ったまま。aftermath の debrisMode(replay) で戻る', () => {
  const r = rig();
  playIntoReplay(r);
  const { ctx, audio, debrisBus } = r;
  // main.js の replay.on('skip') と同じく、飛ばした知らせで cutReplay
  const replay = { play() {}, skip() { audio.cutReplay(); } };
  expect(restoreReplayAfterClip({ audio, replay, args: {} })).toBe(true);
  const n0 = ctx.sources.length;
  audio.collapse(hits(4, 300)); ctx.currentTime += 0.5; audio.collapse([]);
  expect(ctx.sources.length).toBe(n0);
  expect(debrisBus.gain.at(ctx.currentTime)).toBeLessThan(1e-3);
  audio.debrisMode('replay'); // main.js clipRestored（'aftermath' / 'replayEnd'）
  audio.collapse(hits(2, 600));
  expect(ctx.sources.length).toBeGreaterThan(n0);
});

test('22:47: 飛ばしても BGM の出口（静かな変奏は結果画面でも続く）は触らない。音の許可（AudioContext）は止めない', () => {
  const r = rig();
  playIntoReplay(r);
  const gate = r.audio.bgmOutput.dest, bus = r.audio.bgmBus;
  r.audio.cutReplay();
  expect(r.ctx.state).toBe('running');
  expect(gate.gain.at(r.ctx.currentTime + 1)).toBeCloseTo(1, 5);
  expect(bus.gain.at(r.ctx.currentTime + 1)).toBeCloseTo(1, 5);
});

test('22:47: 飛ばしたあとのその場のリトライ（resetRound）でも、瓦礫の音と世界の音は元どおり鳴る', () => {
  const r = rig();
  playIntoReplay(r);
  const { ctx, audio, master, debrisBus } = r;
  audio.cutReplay();
  ctx.currentTime += 2;
  audio.resetRound();
  const t = ctx.currentTime;
  expect(master.gain.at(t + 0.01)).toBeCloseTo(0.8, 5);
  expect(debrisBus.gain.at(t + 0.01)).toBeCloseTo(DEBRIS_LEVEL.open, 5);
  const n0 = ctx.sources.length;
  audio.collapse(hits(2, 700));
  expect(ctx.sources.length).toBeGreaterThan(n0);
});

// Fix round 1（見直し Minor 4）: cutReplay は master を 0 にしたままにする。結果画面を出すとき（restoreWorld）に戻し、結果画面の音（master を通る音）が
// また鳴るようにする。瓦礫の音の黙らせ（早送りの間）は解かない（次のリプレイ・リトライで解く）
test('Fix round 1: 飛ばしたあと結果画面で restoreWorld すると master は約 50 ms で元の大きさへ。爆発の音も鳴る。瓦礫の音は黙ったまま', () => {
  const r = rig();
  playIntoReplay(r);
  const { ctx, audio, master } = r;
  audio.cutReplay();
  ctx.currentTime += 0.5;
  expect(master.gain.at(ctx.currentTime)).toBeLessThan(1e-3);
  audio.restoreWorld();
  const t = ctx.currentTime;
  expect(master.gain.at(t + 0.1)).toBeCloseTo(0.8, 5);
  expect(master.gain.at(t + 7)).toBeCloseTo(0.8, 5);
  const n0 = ctx.sources.length;
  audio.collapse(hits(3, 900));
  expect(ctx.sources.length).toBe(n0);
  audio.boom(0.3);
  expect(ctx.sources.slice(n0).some((s) => s.startT != null && s.startT < t + 0.5)).toBe(true);
  // 演出の無音（silence）のあとの結果画面（録画のあと）でも戻る
  audio.silence();
  audio.restoreWorld();
  expect(master.gain.at(ctx.currentTime + 0.1)).toBeCloseTo(0.8, 5);
});
