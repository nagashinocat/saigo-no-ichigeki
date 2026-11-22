import { test, expect } from 'vitest';
import * as THREE from 'three';
import { createEnemyView, DRAIN_SRGB, HEAVY_SRGB, KIND_CODE, KIND_SCALE } from '../../src/render/enemyView.js';
import { buildRiderBikeGeometry, ONLY, PART_TRIM, PART_LENS } from '../../src/render/hoverBike.js';
import { bikePose, BIKE } from '../../src/render/bikePose.js';
import { NEON } from '../../src/render/cityDress.js';
import { CONFIG } from '../../src/config.js';

// R1（spec §15 軍勢の種類）: 種類は上空の画面でもひと目で見分けられる（推進の光の色・形・大きさ・探照灯）
const hueOf = ([r, g, b]) => { const c = new THREE.Color(r, g, b); const hsl = {}; c.getHSL(hsl); return hsl.h * 360; };
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

test('吸う者の赤紫は、バイクの緑から十分離れ（120° 以上）、ネオンのどの色からも 15° 以上離れる', () => {
  const h = hueOf(DRAIN_SRGB);
  expect(hueDist(h, 150)).toBeGreaterThan(120);
  for (const [name, c] of Object.entries(NEON)) if (name !== 'warmWhite') expect(hueDist(h, hueOf(c)), name).toBeGreaterThanOrEqual(15);
  // 重い者の琥珀もバイクの緑から離れる（上空で緑の尾と見分ける）
  expect(hueDist(hueOf(HEAVY_SRGB), 150)).toBeGreaterThan(90);
});

test('形は一つの網: 装甲（重い者・大物）と探照灯（大物）の部品を持ち、どの頂点にも出る種類（aOnly）がある', () => {
  const g = buildRiderBikeGeometry();
  const only = g.attributes.aOnly.array, part = g.attributes.aPart.array;
  expect(only.length).toBe(g.attributes.position.count);
  const count = (f) => { let n = 0; for (let i = 0; i < only.length; i++) if (f(i)) n++; return n; };
  expect(count((i) => only[i] === ONLY.armored)).toBeGreaterThan(100);
  expect(count((i) => only[i] === ONLY.boss)).toBeGreaterThan(20);
  expect(count((i) => part[i] === PART_TRIM && only[i] === ONLY.armored)).toBeGreaterThan(20);
  expect(count((i) => part[i] === PART_LENS && only[i] === ONLY.boss)).toBeGreaterThan(5);
});

test('描くときの種類と大きさ: 大物は 1.6 倍で、探照灯が点く。よろめく者は当たった光（aKind.y）が 1 から消えていく', () => {
  const view = createEnemyView(new THREE.Scene(), 'mid');
  const mk = (id, kind, extra = {}) => ({ id, kind, x: 20, z: id, dist: Math.hypot(20, id), angle: Math.atan2(id, 20), state: 'chase', speed: 30, heading: Math.PI, turn: 0, ...extra });
  const list = [mk(1, undefined), mk(2, 'heavy', { state: 'stagger', staggerT: 0 }), mk(3, 'drainer'), mk(4, 'boss')];
  view.sync(list, { dt: 1 / 60 });
  const kind = view.mesh.geometry.attributes.aKind.array, anim = view.mesh.geometry.attributes.aAnim.array;
  expect([0, 1, 2, 3].map((i) => kind[i * 2])).toEqual([0, KIND_CODE.heavy, KIND_CODE.drainer, KIND_CODE.boss]);
  expect(kind[1 * 2 + 1]).toBeCloseTo(1, 6);
  expect(kind[0 * 2 + 1]).toBe(0);
  expect(anim[3 * 4 + 2]).toBeCloseTo(KIND_SCALE.boss, 5);
  expect(anim[1 * 4 + 2]).toBeCloseTo(KIND_SCALE.heavy, 5);
  expect(view.searchlight.beam.visible).toBe(true);
  view.sync(list.slice(0, 3), { dt: 1 / 60 });
  expect(view.searchlight.beam.visible).toBe(false);
});

test('よろめく者（stagger）は鼻先が上がり、手を伸ばさない。大物は掴んで回る輪が外（大きな車体が主人公にめり込まない）', () => {
  const base = { id: 7, x: 6, z: 0, dist: 6, angle: 0, heading: 0, speed: 20, turn: 0 };
  const run = bikePose({ ...base, state: 'chase' }, [], 0);
  const st = bikePose({ ...base, state: 'stagger', staggerT: 0 }, [], 0);
  expect(st.pitch).toBeLessThan(run.pitch - 0.3);
  expect(st.reach).toBe(0);
  const g = { id: 8, angle: 0, dist: CONFIG.enemy.grabRange, state: 'grab', grabTime: 2, speed: 15, turn: 6 };
  const r = (p) => Math.hypot(p.x, p.z);
  expect(r(bikePose({ ...g, kind: 'boss' }, [], 0)) - r(bikePose(g, [], 0))).toBeCloseTo(BIKE.kindCling.boss, 1);
});

test('fix1: sync の heroPos が探照灯へ届く（近づいた大物は、渡した主人公の位置を照らす）', () => {
  const view = createEnemyView(new THREE.Scene(), 'mid');
  const hero = { x: 50, z: 30 };
  const boss = { id: 4, kind: 'boss', x: 50, z: 22, dist: Math.hypot(50, 22), angle: Math.atan2(22, 50), state: 'chase', speed: 20, heading: Math.PI / 2, turn: 0 };
  for (let i = 0; i < 300; i++) view.sync([boss], { dt: 1 / 60, heroPos: hero }); // 来た直後の掃き（3.2 秒）を過ぎる
  const beam = view.searchlight.beam, dir = new THREE.Vector3(0, 0, 1).applyQuaternion(beam.quaternion);
  const to = new THREE.Vector3(hero.x, 1.1, hero.z).sub(beam.position).normalize();
  expect(dir.dot(to)).toBeGreaterThan(0.999);
});
