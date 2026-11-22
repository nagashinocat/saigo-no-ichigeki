import { test, expect } from 'vitest';
import { screenBearingDeg, stickMarks, MARKS } from '../../src/ui/stickMarks.js';

// M2（持ち主 15:20「ジョイスティックの外側の丸に敵の方向マーク」）: スティックの外側の輪に、近くの軍勢の向きの印
test('M2: 画面の向き（度。右 0、下 90、時計回り）: 上空カメラの向き（azimuthDeg）で回す', () => {
  // azimuth 0: 画面の右 = 世界の +x、画面の上 = 世界の −z
  expect(screenBearingDeg(10, 0)).toBeCloseTo(0, 6);
  expect(screenBearingDeg(0, 10)).toBeCloseTo(90, 6);
  expect(screenBearingDeg(0, -10)).toBeCloseTo(-90, 6);
  expect(Math.abs(screenBearingDeg(-10, 0))).toBeCloseTo(180, 6);
  // azimuth 90（カメラが +x の側から −x を見る）: 画面の右 = 世界の −z、上 = −x
  expect(screenBearingDeg(0, -10, 90)).toBeCloseTo(0, 6);
  expect(screenBearingDeg(-10, 0, 90)).toBeCloseTo(-90, 6);
});

test('M2: 印は近い順に最大 MARKS.max 個。追う・近づく者を先に、近いほど濃く大きく。種類（大物・重い者・吸う者）を持つ。掴む者・倒れた者・見回るだけの者・遠い者は出さない', () => {
  const H = { x: 100, z: 50 };
  const rs = [];
  for (let k = 0; k < 14; k++) rs.push({ id: k, state: 'search', x: H.x + 10 + k * 6, z: H.z, dist: 10 + k * 6 });
  rs.push({ id: 50, state: 'chase', x: H.x, z: H.z - 70, dist: 70, kind: 'boss' });
  rs.push({ id: 51, state: 'grab', x: H.x + 2, z: H.z, dist: 2 });
  rs.push({ id: 52, state: 'dead', x: H.x - 5, z: H.z, dist: 5 });
  rs.push({ id: 53, state: 'search', patrol: true, x: H.x - 8, z: H.z, dist: 8 });
  rs.push({ id: 54, state: 'chase', x: H.x, z: H.z + MARKS.range + 5, dist: MARKS.range + 5 });
  const m = stickMarks(H, rs);
  expect(m.length).toBe(MARKS.max);
  const ids = m.map((x) => x.id);
  expect(ids).toContain(50); // 追う大物は遠くても先に
  expect(ids).not.toContain(51);
  expect(ids).not.toContain(52);
  expect(ids).not.toContain(53);
  expect(ids).not.toContain(54);
  const boss = m.find((x) => x.id === 50);
  expect(boss.kind).toBe('boss');
  expect(boss.deg).toBeCloseTo(-90, 6); // 画面の上
  expect(boss.chase).toBe(true);
  const a = m.find((x) => x.id === 0), b = m.find((x) => x.id === 5);
  expect(a.k).toBeGreaterThan(b.k);
  expect(a.size).toBeGreaterThan(b.size);
  for (const x of m) { expect(x.k).toBeGreaterThan(0); expect(x.k).toBeLessThanOrEqual(1); }
});
