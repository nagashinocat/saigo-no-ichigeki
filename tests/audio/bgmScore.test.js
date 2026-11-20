import { test, expect } from 'vitest';
import {
  intensityAt, levelFor, tempoFor, nextTempo, noteRate, createSequencer, stretchWarp, MELODY, MODE, QUIET_TEMPO, accentFor,
} from '../../src/audio/bgmScore.js';

const cond = (elapsed, power = 0, holding = false) => ({ elapsed, power, holding });
const run = (seq, until, c) => seq.advance(until, typeof c === 'function' ? c : () => c);

test('強さは時間とともに上がり、貯めた力でも上がる（0〜1）', () => {
  expect(intensityAt(0, 0)).toBe(0);
  expect(intensityAt(15, 0)).toBeCloseTo(0.25);
  expect(intensityAt(40, 0)).toBeCloseTo(0.6);
  expect(intensityAt(60, 0)).toBeCloseTo(1);
  expect(intensityAt(20, 1)).toBeGreaterThan(intensityAt(20, 0));
  expect(intensityAt(60, 1)).toBe(1);
  for (let t = 0; t < 60; t += 0.5) expect(intensityAt(t + 0.5, 0.3)).toBeGreaterThanOrEqual(intensityAt(t, 0.3));
});

test('層: 0〜15 秒は 0、15〜40 秒は 1、40 秒〜は 2、残り 10 秒は最高潮の 3。長押しの間は一段上', () => {
  expect(levelFor(cond(5))).toBe(0);
  expect(levelFor(cond(20))).toBe(1);
  expect(levelFor(cond(45))).toBe(2);
  expect(levelFor(cond(50))).toBe(3);
  expect(levelFor(cond(59))).toBe(3);
  expect(levelFor(cond(5, 0, true))).toBe(1);
  expect(levelFor(cond(55, 0, true))).toBe(4);
  // 力をたくさん貯めると、時間より早く層が増える
  expect(levelFor(cond(30, 1))).toBe(2);
});

test('テンポは強さで上がり、一小節ごとに少しずつしか変わらない', () => {
  expect(tempoFor(0)).toBeLessThan(tempoFor(0.5));
  expect(tempoFor(1)).toBeGreaterThan(tempoFor(0) * 1.25);
  expect(nextTempo(84, 116)).toBeCloseTo(87);
  expect(nextTempo(100, 99)).toBeCloseTo(99);
});

test('音程: D4 からの半音の数から再生の速さ（D4 が 1、1 オクターブで 2 倍）', () => {
  expect(noteRate(0)).toBeCloseTo(1);
  expect(noteRate(12)).toBeCloseTo(2);
  expect(noteRate(-12)).toBeCloseTo(0.5);
  expect(noteRate(1)).toBeCloseTo(2 ** (1 / 12)); // E♭4（半音のぶつかり）
  expect(noteRate(6)).toBeCloseTo(Math.SQRT2); // A♭4（増4度）
});

test('暗い旋法: D のフリジア（半音上の E♭）に増4度の A♭ を足したもの。明るい長三度・長六度・長七度はない', () => {
  expect(MODE).toEqual([0, 1, 3, 5, 6, 7, 8, 10]);
  for (const bad of [2, 4, 9, 11]) expect(MODE.includes(bad)).toBe(false);
});

const pc = (n) => ((n % 12) + 12) % 12;
test('旋律は 8 小節で、音はみな 12 刻みの中、暗い旋法の音だけで、ほぼ 1 オクターブ半に収まる', () => {
  expect(MELODY.length).toBe(8);
  for (const bar of MELODY) for (const [p, n] of bar) {
    expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(12);
    expect(n).toBeGreaterThanOrEqual(-7); expect(n).toBeLessThanOrEqual(14);
    expect(MODE.includes(pc(n)), `音 ${n}`).toBe(true);
  }
});

test('旋律は半音のぶつかりと増4度の跳躍を含み、解決しきらずに終わる（最後の音は根音でも五度でもない）', () => {
  const notes = MELODY.flat();
  let semis = 0, tritones = 0;
  for (let i = 1; i < notes.length; i++) {
    const d = Math.abs(notes[i][1] - notes[i - 1][1]);
    if (d === 1) semis++;
    if (d === 6) tritones++;
  }
  expect(semis).toBeGreaterThanOrEqual(6);
  expect(tritones).toBeGreaterThanOrEqual(2);
  const last = MELODY.at(-1).at(-1)[1];
  expect([0, 7]).not.toContain(pc(last));
  // 呼びかけ（1 小節目）と応答（3 小節目）: 応答は低い
  const avg = (b) => b.reduce((s, [, n]) => s + n, 0) / b.length;
  expect(avg(MELODY[2])).toBeLessThan(avg(MELODY[0]));
});

test('拍と小節の時刻: 小節は 4 拍・12 刻み。テンポは小節の頭でだけ変わり、拍の長さは小節の中で一定', () => {
  const seq = createSequencer({ start: 1 });
  const ev = run(seq, 40, (t) => cond(t * 3, 0)); // 時間がどんどん進む（テンポが上がり続ける）
  const bars = seq.history; // [{ bar, t, tempo, level }]
  expect(bars[0].t).toBeCloseTo(1);
  for (let i = 1; i < bars.length; i++) {
    const beat = 60 / bars[i - 1].tempo;
    expect(bars[i].t - bars[i - 1].t).toBeCloseTo(4 * beat, 6);
    expect(Math.abs(bars[i].tempo - bars[i - 1].tempo)).toBeLessThanOrEqual(3 + 1e-9);
  }
  expect(bars.at(-1).tempo).toBeGreaterThan(bars[0].tempo);
  // すべての音は刻み（小節頭 + 刻み × n、フィルは半分の刻み）に乗る
  for (const e of ev) {
    const b = [...bars].reverse().find((x) => x.t <= e.t + 1e-9);
    const step = 60 / b.tempo / 6;
    const k = (e.t - b.t) / step;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
  }
  // 時刻順。作るのは until より前に始まる拍まで（音はその拍の終わりより前）
  for (let i = 1; i < ev.length; i++) expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t - 1e-9);
  expect(bars.at(-1).t).toBeLessThan(40);
  expect(ev.at(-1).t).toBeLessThan(40 + 60 / bars.at(-1).tempo);
});

test('先読み: advance を細かく刻んでも一度に進めても、同じ音が同じ時刻に鳴る', () => {
  const a = createSequencer({ start: 0 }), b = createSequencer({ start: 0 });
  const c = () => cond(20, 0.4);
  const all = run(a, 12, c);
  const parts = [];
  for (let t = 0.05; t <= 12; t += 0.05) parts.push(...run(b, t, c));
  parts.push(...run(b, 12, c));
  expect(parts.map((e) => [e.voice, e.t.toFixed(6)])).toEqual(all.map((e) => [e.voice, e.t.toFixed(6)]));
});

const voicesIn = (ev) => new Set(ev.map((e) => e.voice));
const barEvents = (level, holding = false, bars = 4) => {
  const elapsed = [5, 20, 45, 55][level];
  const seq = createSequencer({ start: 0 });
  return run(seq, bars * 4 * 60 / 60, cond(elapsed, 0, holding));
};

test('層の選び方: 0 は低い太鼓とマリンバだけ、1 で高い太鼓とシェイカー、2 で木と深い太鼓とフィル', () => {
  const l0 = voicesIn(barEvents(0));
  expect(l0).toEqual(new Set(['low', 'marimba', 'drone']));
  const l1 = voicesIn(barEvents(1));
  for (const v of ['low', 'marimba', 'slap', 'shaker']) expect(l1.has(v)).toBe(true);
  expect(l1.has('wood')).toBe(false);
  const l2 = voicesIn(barEvents(2, false, 8));
  for (const v of ['wood', 'deep', 'tone']) expect(l2.has(v)).toBe(true);
});

test('音の数は層とともに増え、最高潮がいちばん多く大きい。長押しでさらに増える', () => {
  const perSec = (ev) => ev.length / (ev.at(-1).t - ev[0].t);
  const loud = (ev) => ev.reduce((s, e) => s + e.gain, 0) / (ev.at(-1).t - ev[0].t);
  const n = [0, 1, 2, 3].map((l) => barEvents(l, false, 8));
  for (let i = 1; i < 4; i++) { expect(perSec(n[i])).toBeGreaterThan(perSec(n[i - 1])); expect(loud(n[i])).toBeGreaterThan(loud(n[i - 1])); }
  expect(perSec(barEvents(3, true, 8))).toBeGreaterThan(perSec(n[3]));
});

test('長押しの層は拍の頭で切り替わる（拍の途中では切らない）', () => {
  const seq = createSequencer({ start: 0 });
  let holding = false;
  const ev = [];
  // 0.37 秒ごとに advance し、2.0 秒で押しはじめる
  for (let t = 0.1; t < 8; t += 0.37) { if (t > 2) holding = true; ev.push(...seq.advance(t, () => cond(5, 0, holding))); }
  const firstSlap = ev.find((e) => e.voice === 'slap' || e.voice === 'shaker');
  expect(firstSlap).toBeTruthy();
  const beat = 60 / seq.history[0].tempo;
  const k = firstSlap.t / beat;
  // 層が上がって初めて鳴る音は、ある拍の中にあり、その拍は押しはじめたあとに先読みされた拍
  const beatStart = Math.floor(k + 1e-9) * beat;
  expect(beatStart).toBeGreaterThan(2 - 0.37 - 1e-9);
});

test('フィル: 層 2 は 4 小節に 1 回、最高潮は 2 小節に 1 回、最後の拍が細かい連打になる', () => {
  const fills = (level) => {
    const seq = createSequencer({ start: 0 });
    const ev = run(seq, 60, cond([5, 20, 45, 55][level]));
    const bars = seq.history;
    return bars.filter((b, i) => {
      const t0 = b.t, t1 = bars[i + 1]?.t ?? Infinity, step = 60 / b.tempo / 6;
      return ev.some((e) => e.voice === 'slap' && e.t > t0 && e.t < t1 && Math.round((e.t - t0) / step) % 2 === 1);
    }).map((b) => b.bar);
  };
  const f2 = fills(2), f3 = fills(3);
  expect(f2.length).toBeGreaterThan(0);
  for (const b of f2) expect(b % 4).toBe(3);
  expect(f3.length).toBeGreaterThan(f2.length);
  for (const b of f3) expect(b % 2).toBe(1);
});

test('静かな変奏: 同じ旋律を、ゆっくり、柔らかいマリンバで、小さく', () => {
  const seq = createSequencer({ start: 0 });
  const play = run(seq, 20, cond(45));
  const q = createSequencer({ start: 0, mode: 'quiet' });
  const quiet = run(q, 40, cond(0));
  expect(q.history[0].tempo).toBe(QUIET_TEMPO);
  expect(QUIET_TEMPO).toBeLessThan(tempoFor(0));
  const mel = quiet.filter((e) => e.voice === 'marimbaSoft' && e.role === 'melody');
  // 一小節目の旋律の音程は MELODY[0] と同じ順
  const beat = 60 / QUIET_TEMPO;
  const bar0 = mel.filter((e) => e.t < 4 * beat - 1e-9).map((e) => e.rate);
  expect(bar0).toEqual(MELODY[0].map(([, n]) => noteRate(n)));
  expect(voicesIn(quiet).has('slap')).toBe(false);
  expect(voicesIn(quiet).has('marimba')).toBe(false);
  const loud = (ev, dur) => ev.reduce((s, e) => s + e.gain, 0) / dur;
  expect(loud(quiet, 40)).toBeLessThan(loud(play, 20) * 0.25);
});

test('途中から静かな変奏へ: 指定の時刻から一小節目として始め直す', () => {
  const seq = createSequencer({ start: 0 });
  run(seq, 5, cond(30));
  seq.setMode('quiet', 7.25);
  const ev = run(seq, 20, cond(0));
  expect(ev[0].t).toBeCloseTo(7.25);
  expect(seq.history.at(-1).mode).toBe('quiet');
  const firstQuiet = seq.history.find((b) => b.mode === 'quiet');
  expect(firstQuiet.bar).toBe(0);
  expect(firstQuiet.t).toBeCloseTo(7.25);
});

test('引き伸ばし: 音程（再生の速さ）が下がりながら間隔が開き、渦のように左右を回り、sec 秒で消える', () => {
  const w = stretchWarp(3);
  expect(w.time(0)).toBeCloseTo(0);
  expect(w.rate(0)).toBeCloseTo(1);
  expect(w.rate(3)).toBeLessThan(0.2);
  // 曲の中の時間が等しく進むほど、実際の時間は長くかかる
  expect(w.time(0.6) - w.time(0.3)).toBeGreaterThan(w.time(0.3) - w.time(0));
  expect(w.fade(3)).toBe(0);
  expect(w.cutoff(3)).toBeLessThan(w.cutoff(0) / 10);

  const seq = createSequencer({ start: 0 });
  run(seq, 10, cond(52));
  seq.stretch(10, 3);
  const ev = run(seq, 20, cond(52));
  expect(ev.length).toBeGreaterThan(3);
  expect(ev.every((e) => e.t >= 10 - 1e-9 && e.t < 13)).toBe(true);
  // 時刻とともに音程が下がり、音量が下がる
  for (let i = 1; i < ev.length; i++) {
    const a = ev[i - 1], b = ev[i];
    if (b.t > a.t + 1e-6) expect(b.stretch).toBeLessThan(a.stretch);
  }
  const lateGain = ev.filter((e) => e.t > 12).reduce((m, e) => Math.max(m, e.gain), 0);
  const earlyGain = ev.filter((e) => e.t < 10.5).reduce((m, e) => Math.max(m, e.gain), 0);
  expect(lateGain).toBeLessThan(earlyGain * 0.4);
  // 渦: 左右の位置は時間とともに入れ替わる
  expect(Math.min(...ev.map((e) => e.pan))).toBeLessThan(-0.3);
  expect(Math.max(...ev.map((e) => e.pan))).toBeGreaterThan(0.3);
  expect(seq.done).toBe(true);
  expect(run(seq, 30, cond(52))).toEqual([]);
});

const droneOf = (ev) => ev.filter((e) => e.voice === 'drone');
test('ドローン: どの層でも小節ごとに底でうなり続け、強さが上がるほど厚く（音が増え、大きく）なる。根音・少し低い五度・増4度', () => {
  const thick = [0, 1, 2, 3].map((l) => {
    const seq = createSequencer({ start: 0 });
    const ev = run(seq, 16, cond([5, 20, 45, 55][l]));
    const d = droneOf(ev);
    // 小節の頭ごとに鳴る（途切れない）
    for (const b of seq.history) expect(d.some((e) => Math.abs(e.t - b.t) < 1e-9), `層 ${l} 小節 ${b.bar}`).toBe(true);
    const heads = seq.history.length;
    return { n: d.length / heads, g: d.reduce((s, e) => s + e.gain, 0) / heads, rates: new Set(d.map((e) => e.rate.toFixed(4))) };
  });
  for (let i = 1; i < 4; i++) { expect(thick[i].n).toBeGreaterThanOrEqual(thick[i - 1].n); expect(thick[i].g).toBeGreaterThan(thick[i - 1].g); }
  expect(thick[0].n).toBe(1);
  expect(thick[3].n).toBeGreaterThanOrEqual(3);
  const r = [...thick[3].rates].map(Number);
  // 五度はわずかに低くずらす（うなり）、増4度
  expect(r.some((x) => x < 2 ** (7 / 12) && x > 2 ** (6.7 / 12))).toBe(true);
  expect(r.some((x) => Math.abs(x - 2 ** (6 / 12)) < 0.01)).toBe(true);
});

test('ドローンは小節の長さに合わせて音量をそろえる（テンポが上がっても、重なった分だけ大きくならない）', () => {
  const per = (elapsed) => {
    const seq = createSequencer({ start: 0 });
    for (let t = 0; t < 40; t += 0.5) run(seq, t, cond(elapsed));
    const ev = run(seq, 60, cond(elapsed)).filter((e) => e.voice === 'drone' && e.rate === 1);
    const bar = 4 * 60 / seq.tempo;
    return { g: ev[0].gain / ev[0].gainScale, bar };
  };
  // 同じ層（層 1: 20 秒と 35 秒）。小節が短いほど一音は小さい（小節の長さに比例）
  const a = per(20), b = per(35);
  expect(b.bar).toBeLessThan(a.bar);
  expect((b.g / b.bar) / (a.g / a.bar)).toBeCloseTo(1, 1);
});

test('マリンバに、ときどき半音や増4度の不協和な重音が重なる', () => {
  const seq = createSequencer({ start: 0 });
  const ev = run(seq, 30, cond(20));
  const dy = ev.filter((e) => e.role === 'dyad');
  expect(dy.length).toBeGreaterThan(0);
  const ivs = new Set();
  for (const d of dy) {
    const m = ev.find((e) => e.role === 'melody' && Math.abs(e.t - d.t) < 1e-9);
    expect(m).toBeTruthy();
    ivs.add(Math.round(12 * Math.log2(d.rate / m.rate)));
  }
  expect([...ivs].sort()).toEqual([1, 6]);
  // ときどき: 旋律の音の 1 割以下
  expect(dy.length).toBeLessThan(ev.filter((e) => e.role === 'melody').length * 0.1);
});

test('不規則なアクセント: 裏の刻みの強打・次の拍へ食い込む強打・一拍抜く、が小節によってときどき入る', () => {
  const kinds = new Set();
  for (let b = 0; b < 64; b++) kinds.add(accentFor(b));
  for (const k of ['off', 'push', 'drop', null]) expect(kinds.has(k), String(k)).toBe(true);
  const plain = [...Array(64).keys()].filter((b) => accentFor(b) === null).length;
  expect(plain).toBeGreaterThan(64 * 0.4); // ときどき（半分近くの小節はふつう）

  const seq = createSequencer({ start: 0 });
  const ev = run(seq, 40, cond(20));
  const DRUMS = ['low', 'deep', 'slap', 'tone', 'shaker', 'wood'];
  for (const b of seq.history.slice(0, -1)) {
    const step = 60 / b.tempo / 6;
    const inBar = ev.filter((e) => e.t >= b.t - 1e-9 && e.t < b.t + 24 * step - 1e-9).map((e) => ({ ...e, h: Math.round((e.t - b.t) / step) }));
    const drums = (h0, h1) => inBar.filter((e) => e.h >= h0 && e.h < h1 && DRUMS.includes(e.voice));
    const kind = accentFor(b.bar);
    if (kind === 'drop') expect(drums(12, 18), `小節 ${b.bar}`).toEqual([]); // 3 拍目が抜ける
    else expect(drums(12, 18).length, `小節 ${b.bar}`).toBeGreaterThan(0);
    const acc = inBar.filter((e) => e.role === 'accent');
    if (kind === 'off') { expect(acc.length).toBeGreaterThan(0); expect(acc.every((e) => e.h % 6 !== 0)).toBe(true); }
    if (kind === 'push') {
      // 4 拍目の頭の直前に食い込み、4 拍目の頭の低い太鼓は抜ける
      expect(acc.length).toBeGreaterThan(0);
      expect(acc.every((e) => e.h === 16)).toBe(true);
      expect(inBar.some((e) => e.voice === 'low' && e.h === 18)).toBe(false);
    }
    if (kind === null || kind === 'drop') expect(acc).toEqual([]);
  }
  // 静かな始まり（層 0）には入れない
  expect(run(createSequencer({ start: 0 }), 30, cond(5)).some((e) => e.role === 'accent')).toBe(false);
});

test('最高潮: 3 拍目に太鼓のロール（半分の刻みでだんだん強く）と、金属的に擦れる音が加わる', () => {
  const seq = createSequencer({ start: 0 });
  const ev = run(seq, 20, cond(55, 0.8, true));
  const rolls = ev.filter((e) => e.role === 'roll');
  expect(rolls.length).toBeGreaterThanOrEqual(6);
  expect(ev.some((e) => e.voice === 'scrape')).toBe(true);
  const b = seq.history.find((x) => rolls.some((e) => e.t >= x.t && e.t < x.t + 4 * 60 / x.tempo));
  const step = 60 / b.tempo / 6;
  const inBar = rolls.filter((e) => e.t >= b.t && e.t < b.t + 24 * step).sort((x, y) => x.t - y.t);
  expect(inBar.length).toBe(6);
  for (const e of inBar) { const h = (e.t - b.t) / step; expect(h).toBeGreaterThan(12 - 1e-6); expect(h).toBeLessThan(18); }
  expect(inBar.at(-1).gain).toBeGreaterThan(inBar[0].gain * 1.5); // だんだん強く
  // 始まりや中ごろにはない
  const calm = run(createSequencer({ start: 0 }), 20, cond(20));
  expect(calm.some((e) => e.voice === 'scrape' || e.role === 'roll')).toBe(false);
});

test('長押しの層は、切り替えたら最低 2 拍は保つ（連打でばたばたしない）', () => {
  const seq = createSequencer({ start: 0 });
  // 0.15 秒ごとに押す / 離すを繰り返す
  let t = 0.1, holding = false;
  const ev = [];
  while (t < 20) { holding = !holding; ev.push(...seq.advance(t, () => cond(45, 0, holding))); t += 0.15; }
  const beats = [];
  for (const b of seq.history) for (let k = 0; k < 4; k++) beats.push(b.t + k * 60 / b.tempo);
  // 拍ごとの層（層 2 → 長押しで 3: シェイカーが半分の刻みで鳴るか）
  const up = beats.slice(0, -1).map((t0, i) => {
    const step = (beats[i + 1] - t0) / 6;
    return ev.some((e) => e.voice === 'shaker' && e.t >= t0 - 1e-9 && e.t < beats[i + 1] - 1e-9 && Math.round((e.t - t0) / step) % 2 === 1);
  });
  let n = 1;
  const runs = [];
  for (let i = 1; i < up.length; i++) { if (up[i] === up[i - 1]) n++; else { runs.push(n); n = 1; } }
  expect(runs.length).toBeGreaterThan(2);
  for (const r of runs.slice(1)) expect(r).toBeGreaterThanOrEqual(2);
});

test('静かな変奏も同じ暗い旋法: 低音は根音と五度・ときどき増4度、底にかすかなドローン', () => {
  const q = createSequencer({ start: 0, mode: 'quiet' });
  const ev = run(q, 60, cond(0));
  const ost = ev.filter((e) => e.role === 'ost');
  const ivs = new Set();
  for (const b of q.history) {
    const inBar = ost.filter((e) => e.t >= b.t - 1e-9 && e.t < b.t + 4 * 60 / QUIET_TEMPO - 1e-9).sort((x, y) => x.t - y.t);
    if (inBar.length === 2) ivs.add(Math.round(12 * Math.log2(inBar[1].rate / inBar[0].rate)));
  }
  expect(ivs.has(7)).toBe(true);
  expect(ivs.has(6)).toBe(true);
  const d = droneOf(ev);
  expect(d.length).toBeGreaterThan(0);
  const play = run(createSequencer({ start: 0 }), 60, cond(5));
  expect(Math.max(...d.map((e) => e.gain))).toBeLessThan(Math.max(...droneOf(play).map((e) => e.gain)));
});

test('オクターブ下のドローンは、ゆっくり読むぶん長く鳴って重なるので、その分（再生の速さに比例して）小さくする', () => {
  // 最高潮（層 3）: 根音 1.1、オクターブ下 0.55 の割合。速さ 0.5 の音は 2 倍長く鳴るので、一音は 0.5 倍
  const seq = createSequencer({ start: 0 });
  const d = droneOf(run(seq, 16, cond(55)));
  const root = d.find((e) => e.rate === 1), sub = d.find((e) => Math.abs(e.rate - 0.5) < 1e-9);
  expect(sub).toBeTruthy();
  expect(sub.gain / root.gain).toBeCloseTo((0.55 / 1.1) * 0.5, 5);
  // 重なりを含めた底の厚さ（音量 × 鳴る長さ ∝ gain / rate）は、オクターブ下が根音を超えない
  expect(sub.gain / sub.rate).toBeLessThan(root.gain / root.rate);
});

test('作り直し（rewind）: 頭が at 以後の拍から作り直す。同じ状態なら同じ音、長押しが変われば新しい層の音になる', () => {
  const key = (e) => `${e.t.toFixed(5)}:${e.voice}:${e.rate.toFixed(5)}:${e.gain.toFixed(5)}`;
  const c = cond(20, 0.2, false);
  // 小節の頭をまたいで先まで作ってから、途中へ戻して同じ状態で作り直すと、まったく同じ音（テンポ・小節の取り決めも戻る）
  const a = createSequencer({ start: 0 });
  const first = run(a, 12, c);
  const from = a.rewind(6.1);
  expect(from).toBeGreaterThanOrEqual(6.1);
  expect(from - 6.1).toBeLessThan(60 / tempoFor(0));
  const again = run(a, 12, c);
  expect(again.map(key)).toEqual(first.filter((e) => e.t >= from - 1e-9).map(key));
  expect(Math.min(...again.map((e) => e.t))).toBeGreaterThanOrEqual(from - 1e-9);
  // 長押しに変わったら、作り直した拍は一段上（層 2: 木の打楽器が入る）
  const b = createSequencer({ start: 0 });
  const plain = run(b, 12, c);
  expect(plain.some((e) => e.voice === 'wood')).toBe(false);
  const fromB = b.rewind(6.1);
  const held = run(b, 12, cond(20, 0.2, true));
  expect(held.some((e) => e.voice === 'wood')).toBe(true);
  expect(Math.min(...held.filter((e) => e.voice === 'wood').map((e) => e.t))).toBeGreaterThanOrEqual(fromB - 1e-9);
  // 作り直す拍がない（まだ先を作っていない）・静かな変奏・引き伸ばしの間は何もしない
  expect(createSequencer({ start: 0 }).rewind(1)).toBe(null);
  const q = createSequencer({ start: 0, mode: 'quiet' });
  run(q, 8, c);
  expect(q.rewind(2)).toBe(null);
  const s = createSequencer({ start: 0 });
  run(s, 8, c);
  s.stretch(3, 3);
  expect(s.rewind(4)).toBe(null);
});
