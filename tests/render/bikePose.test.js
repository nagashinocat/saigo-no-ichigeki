import { test, expect } from 'vitest';
import { bikePose, BIKE, anchorFor } from '../../src/render/bikePose.js';
import { ENEMY_LOOK } from '../../src/render/enemyView.js';
import { groundHeight } from '../../src/render/sphereDeform.js';
import { CONFIG } from '../../src/config.js';

const E = CONFIG.enemy;
const rider = (id, dist, state = 'approach', extra = {}) => ({ id, angle: id * 0.7, dist, state, ...extra });
const ids = Array.from({ length: 40 }, (_, i) => i + 1);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

test('浮く高さ: 平らな地面・穴の縁・穴の上のどこでも、地面から 2〜4m（わずかな揺れを含む）。位置は水平の距離のまま', () => {
  for (const fronts of [[], [30], [80], [200, 60]]) {
    for (const id of ids) {
      for (const dist of [16, 22, 31, 40, 50, 58, 66]) {
        for (const time of [0, 0.7, 2.3, 5.1]) {
          const p = bikePose(rider(id, dist), fronts, time);
          expect(Math.hypot(p.x, p.z)).toBeCloseTo(dist, 6);
          const above = p.y - groundHeight(dist, fronts);
          expect(above).toBeGreaterThanOrEqual(BIKE.hover[0] - BIKE.bob - 1e-9);
          expect(above).toBeLessThanOrEqual(BIKE.hover[1] + BIKE.bob + 1e-9);
        }
      }
    }
  }
  // 人ごとに高さがばらつく
  const ys = ids.map((id) => bikePose(rider(id, 40), [], 0).y);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
});

test('主人公の近くでは、深い穴の上でも y=-1 より下がらず、浮いている主人公の高さへ上がってくる', () => {
  for (const fronts of [[], [40], [440]]) {
    for (const id of ids) {
      for (let dist = E.grabRange; dist <= 8; dist += 0.25) {
        expect(bikePose(rider(id, dist), fronts, 1.3).y).toBeGreaterThanOrEqual(-1);
      }
    }
  }
});

test('掴む: バイクは主人公の横（水平 clingRadius）に y≈0 で止まり、車体は主人公の向きと直角。乗り手の右手側（-x）に主人公がいて、手を伸ばす', () => {
  for (const fronts of [[], [440]]) {
    for (const id of ids) {
      const e = rider(id, E.grabRange, 'grab', { grabTime: BIKE.grabSettle + 0.01 });
      const p = bikePose(e, fronts, 2);
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeCloseTo(BIKE.clingRadius, 6);
      expect(BIKE.clingRadius).toBeGreaterThan(1);
      expect(BIKE.clingRadius).toBeLessThan(2);
      expect(Math.abs(p.y)).toBeLessThan(0.3);
      const out = [p.x / r, p.z / r];
      const fwd = [Math.sin(p.yaw), Math.cos(p.yaw)];
      expect(Math.abs(fwd[0] * out[0] + fwd[1] * out[1])).toBeLessThan(1e-6);
      const localX = [Math.cos(p.yaw), -Math.sin(p.yaw)]; // 乗り手の左（+x）は外向き = 右手側に主人公
      expect(localX[0] * out[0] + localX[1] * out[1]).toBeGreaterThan(0.999);
      expect(p.reach).toBe(1);
      expect(p.anchor).toBe(1);
      expect(p.keep).toBe(1);
    }
  }
});

test('近づく → 掴むは切れ目なくつながる: 最後の数 m で横を向き、掴んだら grabSettle 秒で横へ寄る。順番待ちの輪はない', () => {
  expect(E.queueDist).toBeUndefined();
  expect(BIKE.queueY).toBeUndefined();
  for (const id of ids) {
    const a = bikePose(rider(id, E.grabRange), [], 3);
    const g0 = bikePose(rider(id, E.grabRange, 'grab', { grabTime: 0 }), [], 3);
    expect(Math.hypot(a.x - g0.x, a.y - g0.y, a.z - g0.z)).toBeLessThan(1e-9);
    expect(angDiff(a.yaw, g0.yaw)).toBeLessThan(1e-9);
    // 主人公のすぐ手前の高さは主人公の近く
    expect(a.y).toBeGreaterThanOrEqual(BIKE.nearY[0] - BIKE.bob - 0.3);
    expect(a.y).toBeLessThanOrEqual(BIKE.nearY[1] + BIKE.bob + 0.3);
    // 寄っていく間、主人公へ近づき続ける
    let prev = Infinity;
    for (let t = 0; t <= BIKE.grabSettle + 0.05; t += 0.05) {
      const g = bikePose(rider(id, E.grabRange, 'grab', { grabTime: t }), [], 3);
      const r = Math.hypot(g.x, g.z);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
    expect(prev).toBeCloseTo(BIKE.clingRadius, 6);
    // 遠くでは進む向き（heading がないときは主人公の方）を向く
    const far = bikePose(rider(id, 40), [], 3);
    const fwd = [Math.sin(far.yaw), Math.cos(far.yaw)];
    const toHero = [-far.x / 40, -far.z / 40];
    expect(fwd[0] * toHero[0] + fwd[1] * toHero[1]).toBeGreaterThan(0.999);
    expect(far.reach).toBe(0);
    expect(far.anchor).toBe(0);
    const h = 0.4 + id;
    const along = bikePose({ ...rider(id, 40), heading: h }, [], 3);
    expect(Math.sin(along.yaw)).toBeCloseTo(Math.cos(h), 9);
    expect(Math.cos(along.yaw)).toBeCloseTo(Math.sin(h), 9);
    // 突っ込んでくる: 横を向くのも主人公の高さへ寄せるのも、掴む距離のすぐ手前から（遠くから減速して待つ見た目にしない）
    expect(BIKE.turnDist).toBeLessThanOrEqual(4);
    const before = bikePose({ ...rider(id, E.grabRange + BIKE.turnDist + 0.5), heading: id * 0.7 + Math.PI }, [], 3);
    expect(angDiff(before.yaw, Math.PI / 2 - (id * 0.7 + Math.PI))).toBeLessThan(1e-6);
  }
});

test('枠が埋まっていて飛びついた者（cling）は、掴んでいる者の外の上に重なる。段ごとに高く、手を伸ばし、切れ目なくつながる', () => {
  for (const id of ids) {
    const a = bikePose(rider(id, E.grabRange), [], 3);
    const c0 = bikePose(rider(id, E.grabRange, 'cling', { grabTime: 0, layer: 0 }), [], 3);
    expect(Math.hypot(a.x - c0.x, a.y - c0.y, a.z - c0.z)).toBeLessThan(1e-9); // 飛びついた瞬間は近づいていた所
    const g = bikePose(rider(id, E.grabRange, 'grab', { grabTime: 2 }), [], 3);
    const c = bikePose(rider(id, E.grabRange, 'cling', { grabTime: 2, layer: 0 }), [], 3);
    const c2 = bikePose(rider(id, E.grabRange, 'cling', { grabTime: 2, layer: 2 }), [], 3);
    expect(Math.hypot(c.x, c.z)).toBeGreaterThan(BIKE.clingRadius + 0.4);
    expect(Math.hypot(c.x, c.z)).toBeLessThan(E.grabRange + 1);
    expect(c.y).toBeGreaterThan(g.y + 0.6);
    expect(c2.y).toBeGreaterThan(c.y + 0.4);
    // 大きな山（4 段目から）は、同じ高さに戻らず、もう一回り外の上に重なる（段どうしが重ならない）
    const c3 = bikePose(rider(id, E.grabRange, 'cling', { grabTime: 2, layer: 3 }), [], 3);
    expect(c3.y).toBeGreaterThan(c.y + 0.25);
    expect(Math.hypot(c3.x, c3.z)).toBeGreaterThan(Math.hypot(c.x, c.z) + 0.2);
    expect(Math.hypot(c3.x, c3.z)).toBeLessThan(E.grabRange + 2.5);
    expect(c.reach).toBe(1);
    expect(c.trail).toBe(0);
    // 枠が空いて掴む（unpile）: その瞬間は重なっていた所、すぐ（0.3 秒ほどで）掴む者の場所へ下りる
    const p0 = bikePose(rider(id, E.grabRange, 'grab', { grabTime: 2, layer: 2, unpile: 0 }), [], 3);
    expect(Math.hypot(p0.x - c2.x, p0.y - c2.y, p0.z - c2.z)).toBeLessThan(1e-9);
    const p1 = bikePose(rider(id, E.grabRange, 'grab', { grabTime: 2.4, layer: 2, unpile: 0.4 }), [], 3);
    const g1 = bikePose(rider(id, E.grabRange, 'grab', { grabTime: 2.4 }), [], 3);
    expect(Math.hypot(p1.x - g1.x, p1.y - g1.y, p1.z - g1.z)).toBeLessThan(1e-9);
  }
});

test('スピード感: 推進の光の尾（trail）は速さに比例し、速いほど車体が前へ傾く。見つけて急に止まる間は鼻先が上がる', () => {
  const base = { id: 3, x: 13, z: -30, dist: Math.hypot(13, 30), angle: Math.atan2(-30, 13), state: 'search', heading: Math.PI / 2, turn: 0 };
  const fast = bikePose({ ...base, speed: E.searchSpeed }, [], 1);
  const slow = bikePose({ ...base, speed: 4 }, [], 1);
  const still = bikePose({ ...base, speed: 0 }, [], 1);
  expect(fast.trail).toBeCloseTo(1, 6);
  expect(still.trail).toBe(0);
  expect(slow.trail).toBeCloseTo(4 / E.searchSpeed, 6);
  expect(fast.pitch - still.pitch).toBeGreaterThan(0.12); // 正の pitch は鼻先が下がる
  const charge = bikePose({ ...base, state: 'chase', speed: E.speed }, [], 1);
  expect(charge.trail).toBeCloseTo(E.speed / E.searchSpeed, 6);
  const brake = bikePose({ ...base, state: 'chase', pause: 0.4, speed: 15 }, [], 1);
  expect(brake.pitch).toBeLessThan(-0.1);
  // 尾は曲がる道すじに沿って曲がる（曲がりの強さ = 曲がる速さ / 速さ）
  const bend = bikePose({ ...base, speed: 20, turn: 8 }, [], 1);
  expect(bend.curve).toBeCloseTo(8 / 20, 6);
  // 掴んでいる者・倒れた者は尾を引かない
  expect(bikePose(rider(2, E.grabRange, 'grab', { grabTime: 1, speed: 0 }), [], 1).trail).toBe(0);
  expect(bikePose(rider(2, 20, 'dead', { deadTime: 0.2, speed: 18 }), [], 1).trail).toBe(0);
});

test('位置は x, z のまま（道路を飛ぶ者）。曲がるときは内へ傾く', () => {
  const e = { id: 3, x: 13, z: -30, dist: Math.hypot(13, 30), angle: Math.atan2(-30, 13), state: 'search', heading: Math.PI / 2, turn: 0 };
  const p = bikePose(e, [], 1);
  expect(p.x).toBe(13);
  expect(p.z).toBe(-30);
  const right = bikePose({ ...e, turn: 6 }, [], 1), left = bikePose({ ...e, turn: -6 }, [], 1);
  expect(right.roll - p.roll).toBeGreaterThan(0.5);   // 右へ曲がる（heading が増える）→ 右（-x）へ深く傾く
  expect(left.roll - p.roll).toBeLessThan(-0.5);
  expect(Math.abs(bikePose({ ...e, turn: 1e3 }, [], 1).roll - p.roll)).toBeLessThanOrEqual(BIKE.bankMax + 1e-9);
  expect(BIKE.bankMax).toBeGreaterThanOrEqual(0.7); // 曲がるときの深い傾き（持ち主の要望「バイクのスピード感」）
  // 傾きは、なめらかにした曲がる速さ（lean）があればそれで決まる（交差点の一瞬の曲がりでちらつかない）
  expect(bikePose({ ...e, turn: 0, lean: 6 }, [], 1).roll).toBeCloseTo(right.roll, 9);
});

// 描かれる位置（enemyView の頂点シェーダーと同じ: 中心を anchor だけ主人公へ寄せて boost 倍に大きく描く）
const drawnR = (p, boost) => { const r = Math.hypot(p.x, p.z); return r + (boost - 1) * p.anchor * r; };

test('近くまで来たバイクが一瞬離れて見えない: どの大きさで描いても、近づく → 掴む → 横へ寄るの間、描かれる位置は主人公へ近づき続ける', () => {
  for (const boost of [1, 1.5, 2, 2.5, ENEMY_LOOK.maxBoost]) {
    for (const id of [1, 7, 23]) {
      let prev = Infinity;
      for (let d = 30; d >= E.grabRange; d -= 0.05) {
        const r = drawnR(bikePose(rider(id, Math.max(d, E.grabRange)), [], 2), boost);
        expect(r).toBeLessThanOrEqual(prev + 1e-9);
        prev = r;
      }
      for (let t = 0; t <= BIKE.grabSettle + 0.1; t += 0.02) {
        const r = drawnR(bikePose(rider(id, E.grabRange, 'grab', { grabTime: t }), [], 2), boost);
        expect(r).toBeLessThanOrEqual(prev + 1e-9);
        prev = r;
      }
    }
  }
  // 主人公の横では主人公を中心に、遠くでは自分の足元を中心に大きく描く
  expect(anchorFor(BIKE.clingRadius)).toBe(1);
  expect(anchorFor(0.5)).toBe(1);
  expect(anchorFor(BIKE.anchorFar)).toBe(0);
  expect(anchorFor(40)).toBe(0);
});

test('倒れる: バイクごと外へ吹き飛び、上がってから落ち、deadFling 秒で消える', () => {
  for (const state of ['approach', 'grab']) {
    const e = rider(5, state === 'grab' ? E.grabRange : 20, 'dead', state === 'grab' ? { deadTime: 0, grabTime: 3 } : { deadTime: 0 });
    const r0 = Math.hypot(bikePose({ ...e, state }, [], 0).x, bikePose({ ...e, state }, [], 0).z);
    let prevR = r0, peak = -Infinity;
    for (let t = 0.05; t < BIKE.deadFling; t += 0.1) {
      const p = bikePose({ ...e, deadTime: t }, [], 0);
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThan(prevR);
      prevR = r;
      peak = Math.max(peak, p.y);
      expect(p.keep).toBeGreaterThan(0);
      expect(p.keep).toBeLessThanOrEqual(1);
    }
    expect(prevR - r0).toBeGreaterThan(15);
    expect(peak).toBeGreaterThan(bikePose({ ...e, deadTime: 0 }, [], 0).y + 3);
    expect(bikePose({ ...e, deadTime: BIKE.deadFling }, [], 0)).toBeNull();
    // 倒れた瞬間は、倒れる前と同じ場所（掴んでいた者は主人公の横から飛ぶ）
    const before = bikePose({ ...e, state }, [], 0), at0 = bikePose(e, [], 0);
    expect(Math.hypot(before.x - at0.x, before.y - at0.y, before.z - at0.z)).toBeLessThan(1e-9);
  }
});

test('見つけた一拍（chase で止まってにらむ間）は推進の光が強く明滅し、走り出したら元に戻る', () => {
  const e = { id: 4, x: 20, z: 5, dist: Math.hypot(20, 5), angle: Math.atan2(5, 20), state: 'chase', heading: Math.PI, pause: 0.5 };
  const ts = Array.from({ length: 20 }, (_, i) => i * 0.03);
  const th = ts.map((t) => bikePose(e, [], t).thrust);
  expect(Math.max(...th)).toBeGreaterThan(1.5);
  expect(Math.min(...th)).toBeGreaterThanOrEqual(1 - 1e-9);
  expect(bikePose({ ...e, pause: 0 }, [], 0.1).thrust).toBe(1);
  expect(bikePose({ ...e, state: 'search', pause: 0.5 }, [], 0.1).thrust).toBe(1);
});
