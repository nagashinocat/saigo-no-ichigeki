import { test, expect } from 'vitest';
import { planFinale, planRetreat, pickLead, openness, hiddenFor, PLAN, retreatPoint, segHitsBox, retreatMargin, nearDist } from '../../src/render/finalePlan.js';
import { createTimeline } from '../../src/render/finaleTimeline.js';
import { phaseTimes, frontAt } from '../../src/game/blast.js';
import { facadeWindows } from '../../src/render/facadeWindows.js';
import { generateCity } from '../../src/world/cityGen.js';
import { radiusFor } from '../../src/game/charge.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';

const shotOf = (amount) => ({ amount, radius: radiusFor(amount), isBig: true });
const SHOTS = [shotOf(CONFIG.power.minRelease), shotOf(60), shotOf(CONFIG.power.max)];
const enemy = (id, angle, dist, state = 'approach') => ({ id, angle, dist, state, deadTime: 0 });
// 主人公を狙う者と、街を見回る者（S8、patrol。爆心から 88〜680 m）
const patrol = (id, angle, dist, state = 'search') => ({ ...enemy(id, angle, dist, state), patrol: true });
const ARMY = [enemy(1, 0.3, 40), enemy(2, 2.1, 30), enemy(3, 4.0, 3, 'grab'), enemy(4, 5.2, 55), enemy(5, 1.0, 20, 'dead'),
  patrol(11, 0.8, 120), patrol(12, 2.6, 210), patrol(13, 4.4, 330), patrol(14, 5.9, 410), patrol(15, 1.7, 520, 'dead')];
const lead = (r) => 20 + 0.6 * r;
const inside = (p, b, m = 0) => Math.abs(p[0] - b.x) < b.w / 2 + m && Math.abs(p[2] - b.z) < b.d / 2 + m && p[1] < b.h + m;

// 同じ場面を何度も作らない（planFinale は 1 回 数十 ms。テストの時間切れを避ける）。テストは plan を書き換えない
const memo = new Map();
function cases(seeds = [3, 7, 11]) {
  const key = seeds.join(',');
  if (!memo.has(key)) memo.set(key, makeCases(seeds));
  return memo.get(key);
}
function makeCases(seeds) {
  const out = [];
  for (const seed of seeds) {
    const city = generateCity(seed);
    for (const shot of SHOTS) for (let r = 1; r <= 6; r++) {
      out.push({ city, shot, plan: planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(r), lead: lead(shot.radius) }) });
    }
  }
  return out;
}

// R0b（持ち主 22:15）: 遠くの軍勢（見回る者）の後ろから、地平の爆心を見る
const horiz = (p) => Math.hypot(p[0], p[2]);
const f0Of = (R) => frontAt(phaseTimes(R).creep, R);

test('撮る一人の選び方: 帯（半径の band）の中の生きた見回る者から。いなければ帯にいちばん近い見回る者、それもいなければ生きた誰か、誰もいなければ null', () => {
  const R = radiusFor(CONFIG.power.max);
  const [a, b] = PLAN.band.map((k) => k * R);
  for (let s = 1; s <= 8; s++) {
    const e = pickLead(ARMY, R, createRng(s));
    expect(e.patrol).toBe(true);
    expect(e.dist).toBeGreaterThanOrEqual(a);
    expect(e.dist).toBeLessThanOrEqual(b);
    expect(e.state).not.toBe('dead');
  }
  // 小さな一発: 帯（44〜69 m）に見回る者はいない → 帯にいちばん近い見回る者（120 m）
  expect(pickLead(ARMY, radiusFor(CONFIG.power.minRelease), createRng(1)).id).toBe(11);
  // 見回る者がいない → 帯にいちばん近い生きた者
  expect(pickLead(ARMY.filter((e) => !e.patrol), R, createRng(1)).id).toBe(4);
  expect(pickLead([enemy(9, 0, 10, 'dead')], R, createRng(1))).toBeNull();
});

// カメラから見た点 p の、爆心への水平の線からの角度（°、右が正）と、前への距離・横の距離・下への距離
function rel(c, p) {
  const f = [-c[0], -c[2]], fl = Math.hypot(...f), fw = [f[0] / fl, f[1] / fl], rt = [-fw[1], fw[0]];
  const dx = p[0] - c[0], dz = p[2] - c[2];
  const along = dx * fw[0] + dz * fw[1], across = dx * rt[0] + dz * rt[1];
  return { along, across, below: c[1] - p[1], az: Math.atan2(across, along) * 180 / Math.PI };
}

test('fix2/fix3 撮る一人（riders[0]）: カメラの 12〜18 m 先、横に 2〜3 m（fix3）、2.5〜3.5 m 下（見下ろす 8〜10° ほど。爆心の光をかなり見下ろす小さな一発だけ steep m まで）。ビルの壁に入らず、爆心を向く', () => {
  for (const { city, shot, plan } of cases()) {
    const c = plan.camPos, r = rel(c, plan.riders[0].pos), R = shot.radius;
    expect(plan.riders[0].id).toBe(plan.riderId);
    expect(plan.rider.pos).toEqual(plan.riders[0].pos);
    expect(r.along).toBeGreaterThanOrEqual(12 - 1e-6);
    expect(r.along).toBeLessThanOrEqual(18 + 1e-6);
    expect(Math.abs(r.across)).toBeGreaterThanOrEqual(PLAN.near.side[0] - 1e-6);
    expect(Math.abs(r.across)).toBeLessThanOrEqual(PLAN.near.side.at(-1) + 1e-6);
    expect(PLAN.near.side).toEqual([2, 2.5, 3]);
    expect(r.below).toBeGreaterThanOrEqual(PLAN.near.below[0] - 1e-6);
    const steep = Math.atan2(c[1] - 0.5 * f0Of(R), horiz(c)) * 180 / Math.PI + PLAN.near.under > PLAN.near.dipMax;
    expect(r.below, `r=${R.toFixed(0)}`).toBeLessThanOrEqual((steep ? PLAN.near.steep : PLAN.near.below[1]) + 1e-6);
    if (!steep) {
      const dip = Math.atan2(r.below, Math.hypot(r.along, r.across)) * 180 / Math.PI;
      expect(dip).toBeGreaterThanOrEqual(7.5);
      expect(dip).toBeLessThanOrEqual(11.5);
    }
    expect(city.buildings.filter((o) => inside(plan.riders[0].pos, o, PLAN.riderClear - 0.01)).map((o) => o.id)).toEqual([]);
    // fix3: 撮る一人の背後（カメラから胸を通る線の先 near.back m）にビルがない（黒い背中が明るい光の壁を背にする）
    expect(plan.nearBack).toBe(true);
    const p = plan.riders[0].pos, h = [p[0], p[1] + 1, p[2]], d = Math.hypot(h[0] - c[0], h[1] - c[1], h[2] - c[2]);
    const q = c.map((v, i) => v + (h[i] - v) * (d + PLAN.near.back) / d);
    expect(city.buildings.filter((o) => segHitsBox(h, q, o, 0.29)).map((o) => o.id)).toEqual([]);
  }
  // 最大の一発では、撮る一人は選んだ見回る者（街を見回る者）
  for (const { shot, plan } of cases()) {
    if (shot.amount !== CONFIG.power.max) continue;
    expect(ARMY.find((e) => e.id === plan.riderId)?.patrol, `r=${shot.radius.toFixed(0)}`).toBe(true);
  }
});

test('fix2 列の乗り手: 撮る一人の 30〜180 m 先（小さな一発は縮める）に、左右へ交互に 5〜15 m（fix3: 列が短い小さな一発は 2.5 m まで縮める）、爆心への線から 2° 以上それて、ほぼ目の高さ（lineDip° 下の線。屋上が高ければその上）に浮く。じわじわ期の光の外・半径の 0.7 より内で、ビルの壁に入らず、爆心を向く', () => {
  for (const { city, shot, plan } of cases()) {
    const R = shot.radius, f0 = f0Of(R), c = plan.camPos;
    expect(plan.riders.length).toBeGreaterThanOrEqual(PLAN.minRiders);
    expect(plan.riders.length).toBeLessThanOrEqual(10);
    const base = rel(c, plan.riders[0].pos).along;
    // fix3: 横の幅は列の長さ（span）が sideSpan m より短ければ縮める（sideMin 倍まで）
    const span = Math.max(8, Math.min(base + PLAN.ahead[1], horiz(c) - f0 - 12));
    const ks = Math.min(1, Math.max(PLAN.sideMin, span / PLAN.sideSpan));
    if (shot.amount === CONFIG.power.max) expect(ks).toBe(1);
    const line = plan.riders.slice(1).map((r) => ({ r, q: rel(c, r.pos) }));
    // いちばん手前の列の者は撮る一人の反対側から（fix3）。そこから交互
    let prevSign = Math.sign(rel(c, plan.riders[0].pos).across), flips = 0;
    for (const { r, q } of line) {
      expect(q.along).toBeGreaterThan(base);
      expect(q.along).toBeLessThanOrEqual(base + PLAN.ahead[1] + 1e-6);
      expect(Math.abs(q.across)).toBeGreaterThanOrEqual(PLAN.side[0] * ks - 1e-6);
      expect(Math.abs(q.across)).toBeLessThanOrEqual(PLAN.side[1] * ks + 1e-6);
      expect(Math.abs(q.az)).toBeGreaterThanOrEqual(PLAN.minAz - 1e-6);
      if (Math.sign(q.across) !== prevSign) flips++;
      prevSign = Math.sign(q.across);
      const d3 = Math.hypot(...r.pos);
      expect(d3).toBeGreaterThan(f0 + 3);
      expect(d3).toBeLessThan(0.7 * R);
      // 目の高さより下（胸がほぼ目の高さ）。線より下へは、屋上か地面の hoverMax の上までしか下がらない
      expect(q.below).toBeGreaterThanOrEqual(PLAN.lineDrop - 1e-6);
      const under = city.buildings.filter((o) => Math.abs(r.pos[0] - o.x) < o.w / 2 - 0.8 && Math.abs(r.pos[2] - o.z) < o.d / 2 - 0.8).sort((a, b) => b.h - a.h)[0];
      const floorY = under ? under.h : 0;
      expect(r.pos[1]).toBeGreaterThanOrEqual(floorY + PLAN.hover - 0.05);
      expect(r.pos[1]).toBeLessThanOrEqual(floorY + PLAN.hoverMax + 0.05);
      const line0 = PLAN.lineDrop + q.along * Math.tan(PLAN.lineDip * Math.PI / 180);
      if (r.pos[1] > floorY + PLAN.hover + 0.05 && r.pos[1] < floorY + PLAN.hoverMax - 0.05) expect(q.below).toBeCloseTo(line0, 6);
      expect(city.buildings.filter((o) => o !== under && inside(r.pos, o, PLAN.riderClear - 0.01)).map((o) => o.id)).toEqual([]);
      const f = [Math.sin(r.yaw), Math.cos(r.yaw)], d = horiz(r.pos);
      expect(f[0] * -r.pos[0] / d + f[1] * -r.pos[2] / d).toBeCloseTo(1, 6);
    }
    // 左右へ交互（抜けた者がいれば同じ側が続くこともある）
    expect(flips).toBeGreaterThanOrEqual(line.length - 2);
    expect(plan.riderDist).toBeCloseTo(Math.hypot(...plan.rider.pos), 6);
    expect(plan.firstDist).toBeCloseTo(Math.min(...plan.riders.map((r) => Math.hypot(...r.pos))), 6);
  }
});

test('fix2/fix3 隠すビル（plan.hide）: じわじわ期の光の玉の中（nearDist < glowIgnore·f0）のビルは全部、カメラから hideFar m より遠いものは光の玉（根元の低いところも）をふさぐものだけ。hideFar m 以内のビルは隠さない', () => {
  for (const { city, shot, plan } of cases([3, 7])) {
    const f0 = f0Of(shot.radius), c = plan.camPos, hide = new Set(plan.hide);
    expect(plan.hide).toEqual(hiddenFor(c, f0, city.buildings).map((o) => o.id));
    for (const o of city.buildings) {
      const dCam = Math.hypot(Math.max(0, Math.abs(c[0] - o.x) - o.w / 2), Math.max(0, Math.abs(c[2] - o.z) - o.d / 2));
      if (nearDist(o) < PLAN.glowIgnore * f0) expect(hide.has(o.id)).toBe(true);
      else if (dCam <= PLAN.hideFar) expect(hide.has(o.id)).toBe(false);
      // 真ん中（爆心の向き、光の玉の 0.65 倍の高さ）をふさぐ遠いビルは隠す
      else if (segHitsBox(c, [0, 0.65 * f0, 0], o, 0.3)) expect(hide.has(o.id)).toBe(true);
      // fix3: 光の玉の根元（0.03〜0.05·f0 の高さ、横は見かけの半径の ±0.9 倍まで）の前の低いビルも隠す
      if (dCam > PLAN.hideFar) {
        const D = horiz(c), half = Math.atan(f0 / D), base = Math.atan2(-c[2], -c[0]);
        for (const k of [-0.9, -0.45, 0, 0.45, 0.9]) for (const h of [0.03, 0.05]) {
          const q = [c[0] + Math.cos(base + k * half) * D, h * f0, c[2] + Math.sin(base + k * half) * D];
          if (segHitsBox(c, q, o, 0)) expect(hide.has(o.id), `b${o.id}`).toBe(true);
        }
      }
    }
  }
});

test('fix1 影の間: 奥の乗り手が飲まれてからカメラが飲まれるまで 0.4 秒以上（乗り手が光の壁を背にした影として順に飲まれていく）', () => {
  for (const { shot, plan } of cases()) {
    const tl = createTimeline({ radius: shot.radius, riderDist: plan.riderDist, firstDist: plan.firstDist, camDist: plan.camDist });
    expect(tl.camHit - tl.firstEngulf, `r=${shot.radius.toFixed(0)}`).toBeGreaterThanOrEqual(PLAN.window.min);
    expect(tl.firstEngulf).toBeGreaterThan(tl.burst);
    expect(plan.window).toBeCloseTo(tl.camHit - tl.firstEngulf, 6);
  }
});

test('fix1 開けた所の決まり（谷でない・真ん中が見通せる・開け具合・6 人以上・影の間 0.4 秒以上）を全部守れる所を、試した場面の 85% 以上で選ぶ（守れない街では一番近い所）', () => {
  const all = cases();
  expect(all.filter(({ plan }) => plan.soft === 0).length / all.length).toBeGreaterThanOrEqual(0.85);
  for (const { plan } of all) expect(plan.soft).toBeLessThanOrEqual(1);
});

test('fix1 開けた所: 爆心へ向けた ±8° の扇の光線（と画面の下半分の光線）の open.min 以上がビルにふさがれず（fix2: 白の間に隠すビルは数えない）、±4° の光線はカメラの 60 m 以内でビルに当たらない（谷ではない）', () => {
  for (const { city, shot, plan } of cases()) {
    const f0 = f0Of(shot.radius);
    const hide = new Set(plan.hide);
    const live = city.buildings.filter((o) => !hide.has(o.id));
    const o = openness(plan.camPos, f0, live);
    expect(o.canyon).toBe(false);
    expect(o.open).toBeGreaterThanOrEqual(PLAN.open.min);
    if (plan.soft === 0) expect(o.center).toBe(true);
    expect(plan.open).toBeCloseTo(o.open, 9);
  }
});

test('乗り手の顔ぶれ: 撮る一人は選んだ見回る者、ほかはその場所に近い生きた者（重ならない）。軍勢がいなければ名もない乗り手', () => {
  for (const { plan } of cases()) {
    const ids = plan.riders.map((r) => r.id).filter((x) => x !== null);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(ARMY.find((e) => e.id === id).state).not.toBe('dead');
  }
  const p = planFinale({ shot: SHOTS[1], buildings: generateCity(3).buildings, enemies: [], rng: createRng(1) });
  expect(p.riderId).toBeNull();
  expect(p.riders.length).toBeGreaterThanOrEqual(PLAN.minRiders);
  expect(p.rider.pos.every(Number.isFinite)).toBe(true);
});

test('最大の一発: カメラと乗り手の列は爆心から数百 m（列の手前は 250 m 以上）', () => {
  for (const { shot, plan } of cases()) {
    if (shot.amount !== CONFIG.power.max) continue;
    expect(horiz(plan.rider.pos)).toBeGreaterThan(250);
  }
});

test('カメラ: 列の後ろ（爆心から離れた側）、まわり（camReach m 以内）の屋上の camAbove m 上（fix2: 屋上の並みのすぐ上。爆心の光を見通すのに要るときだけ hideFar m 以内のビルの上まで上げる）でビルの外。爆心の光（隠すビルを除く）と、乗り手の一人ひとりを見通せる。見る先は爆心', () => {
  for (const { city, shot, plan } of cases()) {
    const R = shot.radius, f0 = f0Of(R), c = plan.camPos, hide = new Set(plan.hide);
    for (const r of plan.riders) expect(c[1]).toBeGreaterThanOrEqual(r.pos[1] + PLAN.lineDrop - 1e-6);
    expect(city.buildings.filter((o) => inside(c, o, PLAN.camClear - 0.01)).map((o) => o.id)).toEqual([]);
    const boxD = (o) => Math.hypot(Math.max(0, Math.abs(c[0] - o.x) - o.w / 2), Math.max(0, Math.abs(c[2] - o.z) - o.d / 2));
    const roof = Math.max(0, ...city.buildings.filter((o) => boxD(o) < PLAN.camReach).map((o) => o.h));
    expect(c[1]).toBeGreaterThanOrEqual(roof + PLAN.camAbove - 1e-6);
    // 上げたのは、hideFar m 以内のビル越しに爆心の光を見通すためだけ
    if (c[1] > Math.max(roof + PLAN.camAbove, PLAN.hover + PLAN.camAbove) + 0.6) {
      expect(city.buildings.some((o) => boxD(o) <= PLAN.hideFar && o.h > roof && nearDist(o) >= PLAN.glowIgnore * f0)).toBe(true);
    }
    for (const g of PLAN.glow) {
      expect(city.buildings.filter((o) => !hide.has(o.id) && segHitsBox(c, [0, g * f0, 0], o, 0.5)).map((o) => o.id)).toEqual([]);
    }
    for (const r of plan.riders) {
      const under = city.buildings.filter((o) => Math.abs(r.pos[0] - o.x) < o.w / 2 - 0.8 && Math.abs(r.pos[2] - o.z) < o.d / 2 - 0.8).sort((a, b) => b.h - a.h)[0];
      expect(city.buildings.filter((o) => o !== under && segHitsBox(c, [r.pos[0], r.pos[1] + 1.3, r.pos[2]], o, 0.29)).map((o) => o.id), `rider ${r.id}`).toEqual([]);
    }
    expect(horiz(plan.look)).toBeLessThan(1e-9);
    expect(plan.camDist).toBeCloseTo(Math.hypot(...c), 6);
    expect(horiz(c)).toBeGreaterThanOrEqual(PLAN.camBand[0] * R - 1e-6);
    expect(horiz(c)).toBeLessThanOrEqual(PLAN.camBand[1] * R + 1e-6);
    expect(c[1]).toBeLessThan(PLAN.maxLift * R + PLAN.hover + PLAN.camAbove + 1e-6);
  }
});

test('ほかの軍勢（実際の場所で描かれる者）はカメラのすぐそばにいない', () => {
  for (const { plan } of cases()) {
    const ids = new Set(plan.riders.map((r) => r.id));
    for (const e of ARMY.filter((x) => x.state !== 'dead' && !ids.has(x.id))) {
      const p = [Math.cos(e.angle) * e.dist, 3, Math.sin(e.angle) * e.dist];
      expect(Math.hypot(p[0] - plan.camPos[0], p[2] - plan.camPos[2])).toBeGreaterThan(PLAN.othersClear - 1e-9);
    }
  }
});

test('逃げる道を後回しにできる: retreat: false なら null で、あとの planRetreat は同じ道を返す', () => {
  for (const seed of [3, 7]) {
    const city = generateCity(seed);
    for (const shot of SHOTS) {
      const args = { shot, buildings: city.buildings, enemies: ARMY, lead: lead(shot.radius) };
      const full = planFinale({ ...args, rng: createRng(5) });
      const lazy = planFinale({ ...args, rng: createRng(5), retreat: false });
      expect(lazy.retreat).toBeNull();
      expect({ ...lazy, retreat: full.retreat }).toEqual(full);
      expect(planRetreat(lazy, { buildings: city.buildings, radius: shot.radius, lead: lead(shot.radius) })).toEqual(full.retreat);
    }
  }
});

// 種ごとに分ける（3 つの種をまとめると、全部のテストを並べて走らせたときに 5 秒の時間切れになることがあった。確かめる中身は同じ）
test.each([3, 7, 11])('逃げる道（種 %i）: カメラの位置から始まり、ビルを通らず、地面より上で、爆心から離れていく（その一発の半径 + 先を行く距離まで）', (seed) => {
  for (const { city, shot, plan } of cases([seed])) {
    const path = plan.retreat;
    expect(retreatPoint(path, 0)).toEqual(plan.camPos);
    const end = shot.radius + lead(shot.radius);
    let prevR = -Infinity;
    for (let x = 0.5; x <= end; x += 1) {
      const p = retreatPoint(path, x);
      expect(p[1]).toBeGreaterThan(1);
      expect(city.buildings.filter((o) => inside(p, o, retreatMargin(path, x) - 0.3)).map((o) => o.id)).toEqual([]);
      const r = Math.hypot(p[0], p[1], p[2]);
      if (x > 6) expect(r).toBeGreaterThan(prevR);
      prevR = r;
    }
    // 道はふつう低く（街の上を引く）、まっすぐ上へ逃げるだけの道にはならない
    expect(path.rise).toBeLessThan(150);
  }
});

test('同じシードで同じ結果。ビルが一つもなくても撮れる', () => {
  const city = generateCity(7);
  const run = (s) => planFinale({ shot: SHOTS[2], buildings: city.buildings, enemies: ARMY, rng: createRng(s) });
  expect(run(4)).toEqual(run(4));
  const p = planFinale({ shot: SHOTS[0], buildings: [], enemies: [], rng: createRng(2) });
  expect(p.camPos[1]).toBeGreaterThan(1);
  expect(p.rider.pos[1]).toBeGreaterThan(1);
  expect(p.riders.length).toBeGreaterThanOrEqual(PLAN.minRiders);
});

test('facadeWindows: 窓は壁の幅と高さの内側に、重ならずに並ぶ', () => {
  const b = { x: 10, z: -30, w: 14, d: 12, h: 20, kind: 'office' };
  for (const n of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const ws = facadeWindows(b, n);
    expect(ws.length).toBeGreaterThan(4);
    const faceW = Math.abs(n[0]) > 0.5 ? b.d : b.w;
    for (const w of ws) {
      const u = Math.abs(n[0]) > 0.5 ? w.center[2] - b.z : w.center[0] - b.x;
      expect(Math.abs(u) + w.w / 2).toBeLessThan(faceW / 2);
      expect(w.center[1] + w.h / 2).toBeLessThan(b.h);
    }
  }
});

test('fix3 撮る一人の背後: 屋上の飾り（小屋・空調・給水塔。cityView.roofProps と同じ箱）を渡すと、それもない所を選ぶ', async () => {
  const { dressCity } = await import('../../src/render/cityDress.js');
  for (const seed of [3, 7]) {
    const city = generateCity(seed), dress = dressCity(city, { seed });
    const props = [
      ...dress.boxes.filter((b) => b.layer === 'roof' && b.h >= 1.5 && Math.min(b.w, b.d) >= 1).map((b) => ({ bid: b.bid, x: b.x, z: b.z, w: Math.max(b.w, b.d), d: Math.max(b.w, b.d), h: b.y + b.h })),
      ...dress.tanks.map((t) => ({ bid: t.bid, x: t.x, z: t.z, w: 2 * t.r, d: 2 * t.r, h: t.y + t.h + 1.5 })),
    ];
    expect(props.length).toBeGreaterThan(50);
    for (const shot of SHOTS) {
      const plan = planFinale({ shot, buildings: city.buildings, enemies: ARMY, rng: createRng(2), props, retreat: false });
      expect(plan.nearBack).toBe(true);
      const c = plan.camPos, p = plan.riders[0].pos, h = [p[0], p[1] + 1, p[2]], d = Math.hypot(h[0] - c[0], h[1] - c[1], h[2] - c[2]);
      const q = c.map((v, i) => v + (h[i] - v) * (d + PLAN.near.back) / d);
      expect([...city.buildings, ...props].filter((o) => segHitsBox(h, q, o, 0.29)).length, `seed ${seed} r=${shot.radius.toFixed(0)}`).toBe(0);
    }
  }
});

// R0b fix4: 縦長で撮る一人が入るか（nearFitFrac）。光の玉を小さめにするレンズ（ball を下げる）ほど入り、横長はまるごと入る
test('fix4 nearFitFrac: 横へ大きくずれた撮る一人は縦長で切れ、ball を minBall へ下げると多く入る。横長では入る', async () => {
  const { nearFitFrac, BEAT_LENS } = await import('../../src/render/finalePlan.js');
  const cam = [0, 40, 400], f0 = 44;
  const yaw = Math.atan2(0, -400);
  const rider = (side) => ({ pos: [side, 37, 383], yaw });
  expect(nearFitFrac(cam, rider(0), f0, 390 / 844)).toBe(1);
  const wide = nearFitFrac(cam, rider(3.5), f0, 390 / 844);
  const wider = nearFitFrac(cam, rider(3.5), f0, 390 / 844, BEAT_LENS.minBall);
  expect(wide).toBeLessThan(0.98);
  expect(wider).toBeGreaterThan(wide);
  expect(nearFitFrac(cam, rider(3.5), f0, 1280 / 720)).toBe(1);
});
