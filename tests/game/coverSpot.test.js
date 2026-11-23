import { test, expect } from 'vitest';
import { createEnemies, seesHero } from '../../src/game/enemies.js';
import { createLookout } from '../../src/game/lookout.js';
import { createRng } from '../../src/rng.js';
import { CONFIG } from '../../src/config.js';
import { GRID } from '../../src/world/cityGen.js';

// Fix round 3（見直し Important B「物陰の見破りがさいころ・警告なし」）:
//  - 物陰にいる主人公の確かめは毎フレーム（spotEvery の位相によらない）。真正面の seeDist m の内を通る者は、だれでも必ず見つける
//  - 物陰の近く（coverWarnK × seeDist m の内か、先読みの道すじがそこを通る）へ来る者がいたら、見つかる前に「LOOK OUT!」を字だけ出し（矢印なし）、
//    かくれ中の印を赤く脈打たせる（lookout の coverWarn）。タップは払うのまま
const E = CONFIG.enemy, HC = CONFIG.hide, L = CONFIG.lookout;
const DT = 1 / 30;
const quiet = { ...CONFIG, enemy: { ...E, spawnPerSec: 0, alertRate: 0, alertAtSpawn: 0, patrol: { ...E.patrol, count: 0 }, kinds: {} } };
// 道（z = ROAD_Z の横の道）を -x の向きへ走ってくる探す者。物陰の主人公は道から lat m 横（hero(lat)）
const ROAD_Z = GRID.PITCH / 2;
const hero = (lat) => ({ x: 0, z: ROAD_Z - lat, hidden: true });
const passer = (id, lat, x0 = 60) => ({ id, state: 'search', x: x0, z: ROAD_Z, heading: Math.PI, speed: E.searchSpeed, turn: 0, searchTime: 0, lane: [0, 0], di: -1, dj: 0, ni: -6, nj: 0, dist: Math.hypot(x0, lat), angle: Math.atan2(lat, x0) });

test('Fix round 3: 物陰の見つかる近さは 4.5 m 以下、知らせの近さはその倍ほど', () => {
  expect(HC.seeDist).toBeLessThanOrEqual(4.5);
  expect(L.coverWarnK).toBeGreaterThanOrEqual(1.5);
});

test('Fix round 3: 物陰の主人公は、真正面の seeDist の内を通る者に、どの位相（id）でも必ず見つかる（さいころなし）', () => {
  const lat = HC.seeDist * 0.5; // 主人公から道の横へ seeDist の半分
  for (let id = 1; id <= 12; id++) {
    const H = hero(lat);
    const en = createEnemies(createRng(id), quiet, { heroPos: H });
    const e = passer(id, lat);
    en.list.push(e);
    let found = false;
    for (let t = 0; t < 4 && !found; t += DT) { en.update(DT); if (e.state === 'chase') found = true; }
    expect(found, `id ${id}`).toBe(true);
  }
});

test('Fix round 3: 物陰の主人公の真正面の外（seeDist より遠い所）を通る者には見つからない', () => {
  const H = hero(HC.seeDist + 1.5);
  const en = createEnemies(createRng(1), quiet, { heroPos: H });
  const e = passer(3, HC.seeDist + 1.5);
  en.list.push(e);
  for (let t = 0; t < 4; t += DT) en.update(DT);
  expect(e.state).toBe('search');
});

test('Fix round 3: 物陰で見つかる前に、LOOK OUT! の字（矢印なし）とかくれ中の赤い知らせ（coverWarn）が出る', () => {
  for (const lat of [HC.seeDist * 0.3, HC.seeDist * 0.5]) {
    const H = hero(lat);
    const en = createEnemies(createRng(2), quiet, { heroPos: H });
    const e = passer(5, lat);
    en.list.push(e);
    const lo = createLookout();
    let warnAt = null, spotAt = null;
    for (let t = 0; t < 4 && spotAt == null; t += DT) {
      const s = lo.update(DT, { hero: H, enemies: en.list, buildings: [], hideBlock: 'cooldown', azimuthDeg: 0 });
      if (s.coverWarn && warnAt == null) { warnAt = t; expect(s.show).toBe(true); expect(s.deg).toBe(null); expect(s.spot).toBe(null); }
      en.update(DT);
      if (e.state === 'chase') spotAt = t;
    }
    expect(spotAt).not.toBe(null);
    expect(warnAt).not.toBe(null);
    expect(spotAt - warnAt).toBeGreaterThanOrEqual(0.3);
  }
});

test('Fix round 3: 物陰に近づく者がいなければ、隠れている間は何も出さない', () => {
  const H = hero(1);
  const lo = createLookout();
  const far = passer(9, 40, 200);
  let s;
  for (let i = 0; i < 10; i++) s = lo.update(DT, { hero: H, enemies: [far], buildings: [], hideBlock: 'cooldown', azimuthDeg: 0 });
  expect(s.show).toBe(false);
  expect(s.coverWarn).toBe(false);
});
