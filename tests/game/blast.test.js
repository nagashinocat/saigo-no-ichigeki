import { test, expect } from 'vitest';
import { createBlast, frontAt, blastDuration, timeAtFront, phaseTimes } from '../../src/game/blast.js';
import { CONFIG } from '../../src/config.js';

const shot = (radius) => ({ amount: 50, radius, isBig: true });

const R = CONFIG.radius.max;
// 払う（小爆発）の秒の式。S8 で最大の半径を 440 → 720 m に広げたが、払うの秒は前の最大（blast.smallRef = 440 m）を基準のまま
// （払うの広がり方と釣り合いを変えない）。前の式の R をその基準に置き換えた
const RS = CONFIG.blast.smallRef;
const sec = (radius) => ({ creep: Math.max(0.25, CONFIG.blast.creepSec * Math.sqrt(radius / RS)), burst: Math.max(0.2, CONFIG.blast.burstSec * Math.sqrt(radius / RS)) });
const speedAt = (t, radius, small = false) => (frontAt(t + 1e-4, radius, CONFIG, small) - frontAt(t - 1e-4, radius, CONFIG, small)) / 2e-4;

test('frontAt は単調増加、0 で 0、blastDuration で radius（払うも最後の一発も）', () => {
  for (const small of [true, false]) {
    for (const r of [22, 30, 150, R]) {
      const d = blastDuration(r, CONFIG, small);
      expect(frontAt(0, r, CONFIG, small)).toBe(0);
      expect(frontAt(d, r, CONFIG, small)).toBeCloseTo(r, 9);
      expect(frontAt(d + 5, r, CONFIG, small)).toBe(r);
      let prev = 0;
      for (let i = 1; i <= 800; i++) { const f = frontAt((d * i) / 800, r, CONFIG, small); expect(f).toBeGreaterThanOrEqual(prev); prev = f; }
    }
  }
});

// ---- 払う（小爆発）: 前と同じ曲線（じわじわ → 弾ける。見せる期はない） ----
test('払うの曲線は前のまま: 前の式と一致する', () => {
  const old = (t, radius) => {
    const { creep, burst } = sec(radius), f0 = CONFIG.blast.creepFrac * radius;
    if (t <= 0) return 0;
    if (t < creep) { const u = t / creep; return f0 * u * u; }
    const u = Math.min(1, (t - creep) / burst);
    return f0 + (radius - f0) * (1 - (1 - u) ** 3);
  };
  for (const r of [CONFIG.puff.radius, 30, 150, R]) {
    expect(blastDuration(r, CONFIG, true)).toBeCloseTo(sec(r).creep + sec(r).burst, 12);
    for (let i = 0; i <= 200; i++) { const t = (i / 200) * 3; expect(frontAt(t, r, CONFIG, true)).toBeCloseTo(old(t, r), 9); }
  }
  expect(phaseTimes(CONFIG.puff.radius, CONFIG, true).show).toBe(0);
  expect(blastDuration(30, CONFIG, true)).toBeLessThan(0.8);
});
test('払う: じわじわ期の終わりの front は radius の約6%で、その間の平均速度は弾ける期の最大速度の 1/8 未満', () => {
  const r = CONFIG.puff.radius, { creep, burst } = sec(r);
  expect(frontAt(creep, r, CONFIG, true)).toBeCloseTo(r * CONFIG.blast.creepFrac, 6);
  expect(CONFIG.blast.creepFrac).toBeCloseTo(0.06, 9);
  const avgCreep = frontAt(creep, r, CONFIG, true) / creep;
  let maxBurst = 0;
  for (let i = 0; i <= 200; i++) maxBurst = Math.max(maxBurst, speedAt(creep + 1e-3 + ((burst - 2e-3) * i) / 200, r, true));
  expect(avgCreep).toBeLessThan(maxBurst / 8);
});
test('払う: 速度の最大は弾ける期の前半（burstAt から burstSec の 40% 以内）にあり、最後は少しゆるむ', () => {
  const r = CONFIG.puff.radius, { creep, burst } = sec(r);
  let best = 0, bestT = 0;
  for (let i = 0; i <= 400; i++) { const t = creep + 1e-3 + ((burst - 2e-3) * i) / 400; const v = speedAt(t, r, true); if (v > best) { best = v; bestT = t; } }
  expect(bestT - creep).toBeLessThanOrEqual(burst * 0.4);
  expect(speedAt(creep + burst * 0.98, r, true)).toBeLessThan(best * 0.5);
});
test('timeAtFront は frontAt の逆（払うも最後の一発も）', () => {
  for (const f of [0, 5, 26, 100, 176, 177, 300, 439, 440]) expect(frontAt(timeAtFront(f, R), R)).toBeCloseTo(f, 4);
  for (const f of [0, 1, 1.3, 5, 15, 22]) expect(frontAt(timeAtFront(f, 22, CONFIG, true), 22, CONFIG, true)).toBeCloseTo(f, 6);
});

// ---- 最後の一発: じわじわ期 → 弾ける期（一気に）→ 見せる期（光の壁が街を飲みながらゆっくり進み、止まる） ----
test('最後の一発: じわじわ期は前と同じ（radius の約6%まで）、その間の平均速度は弾ける期の最大速度の 1/8 未満', () => {
  const { creep, burst } = phaseTimes(R);
  expect(creep).toBeCloseTo(CONFIG.blast.creepSec, 9);
  expect(frontAt(creep, R)).toBeCloseTo(R * CONFIG.blast.creepFrac, 6);
  let maxBurst = 0;
  for (let i = 0; i <= 200; i++) maxBurst = Math.max(maxBurst, speedAt(creep + 1e-3 + ((burst - 2e-3) * i) / 200, R));
  expect(frontAt(creep, R) / creep).toBeLessThan(maxBurst / 8);
});
test('最後の一発: 弾ける期のはじめが最速、弾ける期の終わりに半径の burstFrac、見せる期は速さが途切れずにつながって、ゆっくり止まる', () => {
  for (const r of [60, 200, R]) {
    const { creep, burst, show } = phaseTimes(r);
    expect(show).toBeGreaterThan(burst);
    expect(frontAt(creep + burst, r)).toBeCloseTo(r * CONFIG.finalBlast.burstFrac, 6);
    let best = 0, bestT = 0;
    const end = creep + burst + show;
    for (let i = 0; i <= 600; i++) { const t = creep + 1e-3 + ((end - creep - 2e-3) * i) / 600; const v = speedAt(t, r); if (v > best) { best = v; bestT = t; } }
    expect(bestT - creep).toBeLessThanOrEqual(burst * 0.2);
    // 境目で速さが跳ばない
    const b = creep + burst;
    expect(speedAt(b - 2e-3, r)).toBeCloseTo(speedAt(b + 2e-3, r), -1);
    expect(Math.abs(speedAt(b - 2e-3, r) - speedAt(b + 2e-3, r)) / speedAt(b, r)).toBeLessThan(0.03);
    // 見せる期: はじめでも弾ける期の最大の 1/3 未満。だんだんゆるみ、最後はほぼ止まる
    expect(speedAt(b + 1e-3, r)).toBeLessThan(best / 3);
    let prev = Infinity;
    for (let i = 1; i < 50; i++) { const v = speedAt(b + (show * i) / 50, r); expect(v).toBeLessThan(prev + 1e-6); prev = v; }
    expect(speedAt(end - show * 0.02, r)).toBeLessThan(speedAt(b + 1e-3, r) * 0.15);
  }
});
// S8: 街を広げて最大の半径を 440 → 720 m にした（持ち主 13:16「爆発の規模をもっと上げて」）。見せる期の速さを 150 m/s 以下に保つため
// 見せる期を 3.4 → 4.3 秒に延ばしたので、最大の一発は前（S7 まで 4.8 秒）より長い。上限を 2 → 2.5 倍へ（演出の全体は +1.5 秒の内）
test('最大の一発の blastDuration は前（2.4 秒）の 1.5〜2.5 倍、見せる期の前線の速さは街を飲むのが見える速さ（最大の一発で 150 m/s 以下）', () => {
  const before = CONFIG.blast.creepSec + CONFIG.blast.burstSec;
  expect(blastDuration(R) / before).toBeGreaterThanOrEqual(1.5);
  expect(blastDuration(R) / before).toBeLessThanOrEqual(2.5);
  const { creep, burst } = phaseTimes(R);
  expect(speedAt(creep + burst + 1e-3, R)).toBeLessThan(150);
  expect(blastDuration(30)).toBeLessThan(1.6);
});
test('createBlast: phase が creep → burst → show → done と進み、burstAt が creepSec と一致、front は終わりで止まる', () => {
  const b = createBlast(shot(R), []);
  const { creep, burst } = phaseTimes(R);
  expect(b.burstAt).toBeCloseTo(creep, 9); expect(b.burstAt).toBeCloseTo(CONFIG.blast.creepSec, 9);
  expect(b.front).toBe(0); expect(b.phase).toBe('creep'); expect(b.done).toBe(false);
  b.update(creep - 0.05); expect(b.phase).toBe('creep'); expect(b.front).toBeLessThan(R * 0.06);
  b.update(0.1); expect(b.phase).toBe('burst'); expect(b.done).toBe(false);
  b.update(burst); expect(b.phase).toBe('show'); expect(b.done).toBe(false);
  b.update(blastDuration(R)); expect(b.phase).toBe('done'); expect(b.done).toBe(true); expect(b.front).toBe(R);
  b.update(1); expect(b.front).toBe(R);
  expect(createBlast(shot(30), []).burstAt).toBeCloseTo(0.25, 9);
});
test('createBlast: 払う（shot.small）は前の曲線で、見せる期を通らない', () => {
  const s = { amount: 8, radius: CONFIG.puff.radius, small: true };
  const b = createBlast(s, []);
  const d = sec(s.radius).creep + sec(s.radius).burst;
  b.update(sec(s.radius).creep + 0.01); expect(b.phase).toBe('burst');
  b.update(d - sec(s.radius).creep - 0.02); expect(b.phase).toBe('burst'); expect(b.done).toBe(false);
  b.update(0.02); expect(b.done).toBe(true); expect(b.front).toBe(s.radius);
});
test('Hit は従来どおり各対象に一度だけ、front が dist を越えた更新で出る', () => {
  const b = createBlast(shot(300), [{ id: 2, dist: 100 }, { id: 1, dist: 40 }, { id: 3, dist: 40 }]);
  const hits = [];
  for (let i = 0; i < 400; i++) {
    const before = b.front;
    for (const h of b.update(1 / 100)) {
      const t = [{ id: 2, dist: 100 }, { id: 1, dist: 40 }, { id: 3, dist: 40 }].find((x) => x.id === h.id);
      expect(before).toBeLessThan(t.dist); expect(b.front).toBeGreaterThanOrEqual(t.dist);
      hits.push(h.id);
    }
  }
  expect(hits.sort()).toEqual([1, 2, 3]);
});
test('dist < radius*vaporizeRatio は vaporize、それ以外は push', () => {
  const r = 200, lim = r * CONFIG.blast.vaporizeRatio; // 36
  const b = createBlast(shot(r), [{ id: 1, dist: lim - 1 }, { id: 2, dist: lim }, { id: 3, dist: 150 }]);
  const h = b.update(10);
  expect(h.find((x) => x.id === 1).kind).toBe('vaporize');
  expect(h.find((x) => x.id === 2).kind).toBe('push');
  expect(h.find((x) => x.id === 3).kind).toBe('push');
});
test('radius より遠い対象は Hit にならない', () => {
  const b = createBlast(shot(100), [{ id: 1, dist: 100.5 }, { id: 2, dist: 100 }]);
  const h = b.update(10);
  expect(h.map((x) => x.id)).toEqual([2]); expect(b.done).toBe(true);
});
