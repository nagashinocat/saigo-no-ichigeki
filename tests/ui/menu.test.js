import { test, expect } from 'vitest';
import { createMenu, loadVolumes, saveVolumes, retryRound, VOLUME_KEYS } from '../../src/ui/menu.js';
import { createPause } from '../../src/ui/pause.js';
import { createGame } from '../../src/game/game.js';
import { createControls } from '../../src/input/controls.js';
import { bindPointerInput } from '../../src/input/bindDom.js';
import { pickCity, rememberRetryCity, citySeed } from '../../src/game/daily.js';
import { markRetry, introMode } from '../../src/ui/introFlow.js';
import { fakeDom } from '../input/fakeDom.js';

// R1f（持ち主 18:14「一時停止、リトライ、音量調節ができるメニューボタンを作って」）
function store(fail = false) {
  const m = new Map();
  return { m, getItem: (k) => { if (fail) throw new Error('no'); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { if (fail) throw new Error('no'); m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
}
function el(tag = 'div') {
  const h = {};
  return { tag, hidden: false, value: '', attrs: {}, h, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { (h[t] ??= []).push(f); }, fire(t, e = {}) { const ev = { type: t, stopped: false, stopPropagation() { ev.stopped = true; }, preventDefault() {}, ...e }; for (const f of h[t] ?? []) f(ev); return ev; } };
}
function menuDom() {
  const parts = { '[data-act="resume"]': el('button'), '[data-act="retry"]': el('button'), 'input[name="bgm"]': el('input'), 'input[name="sfx"]': el('input') };
  const panel = { ...el(), querySelector: (s) => parts[s] ?? null };
  return { button: el('button'), panel, parts };
}
const fakeAudio = () => ({ log: [], suspend() { this.log.push('suspend'); }, resume() { this.log.push('resume'); }, mute(on) { this.log.push(on ? 'mute' : 'unmute'); } });
const fakeBgm = () => ({ log: [], pause() { this.log.push('pause'); }, resume() { this.log.push('resume'); } });

test('R1f: メニューを開くと一時停止: ゲームの時間・軍勢・力は進まず、溜めの指は放たずに打ち切り、BGM と音も止まる。閉じると続きから進む', () => {
  const g = createGame({ seed: 3 });
  g.begin(); g.pressStart();
  for (let i = 0; i < 30; i++) g.update(1 / 30);
  const log = [];
  const controls = createControls({ onChargeStart: () => { log.push('start'); g.pressStart(); }, onChargeEnd: () => log.push('fire'), onChargeCancel: () => { log.push('cancel'); g.pressCancel(); } });
  controls.down(1, 200, 200, 0);
  const audio = fakeAudio(), bgm = fakeBgm();
  const pause = createPause({ game: g, controls, audio, bgm });
  const dom = menuDom();
  const menu = createMenu(dom, { onOpen: () => pause.set('menu', true), onClose: () => pause.set('menu', false) });
  menu.setAvailable(true);
  expect(dom.button.hidden).toBe(false);
  const t0 = g.timer.remaining, p0 = g.power.value, e0 = g.enemies.list.map((e) => [e.x, e.z]);
  dom.button.fire('click');
  expect(menu.isOpen).toBe(true);
  expect(dom.panel.hidden).toBe(false);
  expect(pause.paused).toBe(true);
  expect(log).toEqual(['start', 'cancel']); // 放たない
  expect(controls.charging).toBe(false);
  // fix1（見直し Minor 6）: メニューでは AudioContext を止めず、世界の音と BGM を黙らせるだけ（音量の試し音が聞こえる）
  expect(audio.log).toEqual(['mute']);
  expect(bgm.log).toEqual(['pause']);
  for (let i = 0; i < 90; i++) g.update(1 / 30);
  expect(g.timer.remaining).toBe(t0);
  expect(g.power.value).toBe(p0);
  expect(g.enemies.list.map((e) => [e.x, e.z])).toEqual(e0);
  g.pressStart(); // 止まっている間は溜め始めない
  expect(g.charge.active).toBe(false);
  dom.parts['[data-act="resume"]'].fire('click');
  expect(menu.isOpen).toBe(false);
  expect(pause.paused).toBe(false);
  expect(audio.log).toEqual(['mute', 'unmute']);
  g.update(1 / 30);
  expect(g.timer.remaining).toBeLessThan(t0);
  expect(g.timer.remaining).toBeGreaterThan(t0 - 0.05); // 止まっていた 3 秒は数えない
});

test('R1f / fix1: タブ・アプリの切り替えの一時停止とメニューの一時停止は重なっても、両方が外れるまで止まったまま', () => {
  const g = createGame({ seed: 3 });
  g.begin(); g.pressStart();
  const audio = fakeAudio(), bgm = fakeBgm();
  const pause = createPause({ game: g, controls: null, audio, bgm });
  // タブの切り替えは AudioContext を止める。戻ってもメニューが開いていれば、鳴らし直して黙らせたまま
  pause.set('tab', true); pause.set('menu', true);
  expect(audio.log).toEqual(['mute', 'suspend']);
  pause.set('tab', false);
  expect(pause.paused).toBe(true);
  expect(audio.log).toEqual(['mute', 'suspend', 'resume', 'mute']);
  pause.set('menu', false);
  expect(pause.paused).toBe(false);
  expect(audio.log).toEqual(['mute', 'suspend', 'resume', 'mute', 'unmute']);
  expect(bgm.log).toEqual(['pause', 'resume']);
});

// 持ち主 2026-11-23 08:41（「リトライ押したら暗い画面に操作説明」「TAPの文字がかなりデカく」）: リトライはページを読み直さず、その場で遊び直す
// （restart）。読み直しは、その場の遊び直しが投げたときだけの控え（同じ街を覚える → 導入を飛ばす印 → 読み直す の順。R1f のまま）
test('リトライはその場で遊び直す（restart）。読み直さず、印も置かない', () => {
  const s = store();
  const pick = pickCity({ params: new URLSearchParams(''), now: Date.UTC(2026, 10, 21, 14, 59, 0), storage: s });
  const order = [];
  const r = retryRound({ restart: () => order.push('restart'), session: s, cityPick: pick, rememberRetryCity: () => order.push('remember'), markRetry: () => order.push('mark'), reload: () => order.push('reload') });
  expect(r).toBe('inplace');
  expect(order).toEqual(['restart']);
  expect(s.m.size).toBe(0);
});

test('控え: その場の遊び直しが投げたら、同じ街（0 時をまたいでも）で導入を飛ばして読み直す（覚える → 印 → 読み直す の順）', () => {
  const s = store();
  const before = Date.UTC(2026, 10, 21, 14, 59, 0); // 日本時間 11/21 23:59
  const pick = pickCity({ params: new URLSearchParams(''), now: before, storage: s });
  expect(pick.key).toBe('20261121');
  const order = [], errors = [];
  const r = retryRound({
    restart: () => { order.push('restart'); throw new Error('cannot'); }, onError: (e) => errors.push(e.message),
    session: s, cityPick: pick, rememberRetryCity: (st, c) => { order.push('remember'); rememberRetryCity(st, c); }, markRetry: (st) => { order.push('mark'); markRetry(st); }, reload: () => order.push('reload'),
  });
  expect(r).toBe('reload');
  expect(order).toEqual(['restart', 'remember', 'mark', 'reload']);
  expect(errors).toEqual(['cannot']);
  // 読み直したページ（日本時間 11/22 になっている）
  const after = pickCity({ params: new URLSearchParams(''), now: Date.UTC(2026, 10, 21, 15, 1, 0), storage: s });
  expect(after.key).toBe('20261121');
  expect(after.seed).toBe(citySeed('20261121'));
  expect(introMode({ params: new URLSearchParams(''), storage: s })).toBe('retry'); // 導入も説明も飛ばす
  // 新しい一回（同じ種の街で、時間は最初から）
  const g = createGame({ seed: after.seed });
  expect(g.timer.remaining).toBe(60);
  expect(g.phase).toBe('ready');
});

test('R1f: 音量（BGM・効果音）は動かすとすぐ音へ渡り、端末に覚える（名前に接頭辞）。次に開いたページは覚えた音量から。保存できなくても動く', () => {
  const s = store();
  const got = [];
  const dom = menuDom();
  const gotKind = [];
  const menu = createMenu(dom, { storage: s, onVolume: (v, k) => { got.push(v); gotKind.push(k ?? null); } });
  expect(got.at(-1)).toEqual({ bgm: 1, sfx: 1 }); // 覚えた音量が無ければ 1
  dom.parts['input[name="bgm"]'].value = '35';
  dom.parts['input[name="bgm"]'].fire('input');
  dom.parts['input[name="sfx"]'].value = '70';
  dom.parts['input[name="sfx"]'].fire('input');
  expect(got.at(-1)).toEqual({ bgm: 0.35, sfx: 0.7 });
  // fix1: どのスライダーを動かしたか（試し音をその道で鳴らす）。開いたときの読み込みでは鳴らさない
  expect(gotKind).toEqual([null, 'bgm', 'sfx']);
  expect(s.m.get(VOLUME_KEYS.bgm)).toBe('0.35');
  expect(VOLUME_KEYS.bgm.startsWith('saigo-no-ichigeki:')).toBe(true);
  expect(VOLUME_KEYS.sfx.startsWith('saigo-no-ichigeki:')).toBe(true);
  expect(loadVolumes(s)).toEqual({ bgm: 0.35, sfx: 0.7 });
  const got2 = [];
  const dom2 = menuDom();
  createMenu(dom2, { storage: s, onVolume: (v) => got2.push(v) });
  expect(got2[0]).toEqual({ bgm: 0.35, sfx: 0.7 });
  expect(dom2.parts['input[name="sfx"]'].value).toBe('70');
  expect(menu.volumes).toEqual({ bgm: 0.35, sfx: 0.7 });
  // 壊れた値・保存できない端末
  s.m.set(VOLUME_KEYS.sfx, 'abc');
  expect(loadVolumes(s).sfx).toBe(1);
  const bad = store(true);
  expect(loadVolumes(bad)).toEqual({ bgm: 1, sfx: 1 });
  expect(saveVolumes(bad, { bgm: 0.2, sfx: 0.2 })).toBe(false);
  const dom3 = menuDom();
  const m3 = createMenu(dom3, { storage: bad });
  expect(() => m3.setVolume('bgm', 0.5)).not.toThrow();
  expect(m3.volumes.bgm).toBe(0.5);
});

test('R1f: メニューのボタン・メニューに触れても溜めにならない（指の知らせを canvas へ伝えない）。メニューが開いている間の画面のタップも溜めにならない', () => {
  const log = [];
  const controls = createControls({ onChargeStart: () => log.push('start') });
  const d = fakeDom();
  const dom = menuDom();
  const menu = createMenu(dom, {});
  menu.setAvailable(true);
  bindPointerInput(d.target, { controls, perf: d.perf, intercept: () => menu.isOpen });
  // ボタンへの pointerdown は止められる（canvas の兄弟の DOM。伝わらない）
  const ev = dom.button.fire('pointerdown');
  expect(ev.stopped).toBe(true);
  dom.button.fire('click');
  expect(menu.isOpen).toBe(true);
  expect(dom.panel.fire('pointerdown').stopped).toBe(true);
  // 開いている間の画面のタップ（canvas）は溜めにならない
  d.fire('pointerdown', { pointerId: 5 });
  expect(log).toEqual([]);
  menu.close();
  d.fire('pointerdown', { pointerId: 6 });
  expect(log).toEqual(['start']);
  // 遊んでいないとき（導入・結果）はボタンを出さず、開かない
  menu.setAvailable(false);
  expect(dom.button.hidden).toBe(true);
  expect(menu.open()).toBe(false);
});

test('R1f: index.html: メニューのボタン（44 px 以上の当たり、右上の残り時間の下）とメニュー。隠したメニュー・結果の画面は横画面でも出ない', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  expect(html).toMatch(/<button id="menuBtn"[^>]*hidden/);
  expect(html).toMatch(/data-act="resume"[^>]*>つづける</);
  expect(html).toMatch(/data-act="retry"[^>]*>リトライ</);
  expect(html).toMatch(/name="bgm"/);
  expect(html).toMatch(/name="sfx"/);
  expect(html).toMatch(/#menuBtn \{[^}]*width: 44px; height: 44px;/);
  expect(html).toMatch(/#menuBtn\[hidden\], #menu\[hidden\] \{ display: none; \}/);
  // R3 からの不具合: 横画面の #result:not(.fail) { display: grid } が [hidden] に勝っていた
  expect(html).toMatch(/#result\[hidden\] \{ display: none !important; \}/);
});

test('R1f fix2: 演出・リプレイ・ブラックホールの間のメニューは AudioContext を止める（suspend）。遊んでいる間は門で黙らせる（mute）', () => {
  const g = createGame({ seed: 3 });
  let cine = true;
  const audio = fakeAudio(), bgm = fakeBgm();
  const pause = createPause({ game: g, controls: null, audio, bgm, cinematic: () => cine });
  pause.set('menu', true);
  expect(audio.log).toEqual(['mute', 'suspend']);
  pause.set('menu', false);
  expect(audio.log).toEqual(['mute', 'suspend', 'resume', 'unmute']);
  cine = false;
  pause.set('menu', true);
  expect(audio.log.slice(4)).toEqual(['mute']);
  pause.set('menu', false);
  expect(audio.log.slice(4)).toEqual(['mute', 'unmute']);
});
