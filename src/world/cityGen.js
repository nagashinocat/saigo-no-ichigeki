import { createRng } from '../rng.js';
import { CONFIG } from '../config.js';

const BLOCK = 18;            // 区画の一辺 m
const ROAD = 8;              // 道路幅 m
const PITCH = BLOCK + ROAD;  // 格子の間隔 m
// 描画（道路の格子）が同じ寸法を使えるように公開する
export const GRID = { BLOCK, ROAD, PITCH };

const FOOTPRINT = [8, 17];   // 建物の幅・奥行き m（区画内に収まる）
const CENTER_MAX_H = 150;    // 中心付近の最大の高さ m
const EDGE_H = [6, 15];      // 街の端の高さ m
const TOWER_H = 60;          // これ以上は tower
const OFFICE_H = 20;         // これ以上は office、未満は house
const NEAR_DIST = 110;       // 中心からこの距離未満は低くする（上空から広場と軍勢が見えるように）
const NEAR_MAX_H = 28;       // その範囲の最大の高さ m

// 体積(m³)あたりの金額（円）
const RATE = { house: 20000, office: 60000, tower: 120000 };
// props の金額（円）
const PROP_VALUE = { car: 3000000, lamp: 500000, sign: 300000 };

const kindOf = (h) => (h >= TOWER_H ? 'tower' : h >= OFFICE_H ? 'office' : 'house');

export function generateCity(seed, cfg = CONFIG) {
  const rng = createRng(seed);
  const R = cfg.cityRadius;
  const n = Math.ceil(R / PITCH) + 1;
  const buildings = [];
  const props = [];

  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const cx = i * PITCH, cz = j * PITCH;
      const t0 = Math.hypot(cx, cz) / R;
      // 乱数の消費順を固定するため、先に全部引く
      const skip = rng(), w = FOOTPRINT[0] + (FOOTPRINT[1] - FOOTPRINT[0]) * rng();
      const d = FOOTPRINT[0] + (FOOTPRINT[1] - FOOTPRINT[0]) * rng();
      const ox = (rng() - 0.5) * (BLOCK - w), oz = (rng() - 0.5) * (BLOCK - d);
      const noise = 0.55 + 0.45 * rng(), edge = EDGE_H[0] + (EDGE_H[1] - EDGE_H[0]) * rng();
      const propRoll = rng(), propKind = rng(), propPos = rng(), propSide = rng(), propAcross = rng();

      const x = cx + ox, z = cz + oz;
      const dist = Math.hypot(x, z);
      if (skip >= 0.85 - 0.25 * t0 || dist > R || dist <= cfg.plazaRadius + Math.max(w, d) / 2) {
        // 建物なし
      } else {
        const t = dist / R;
        const maxH = dist < NEAR_DIST ? NEAR_MAX_H : CENTER_MAX_H;
        const h = Math.max(EDGE_H[0], Math.min(maxH, edge + (CENTER_MAX_H - edge) * (1 - t) ** 2 * noise));
        const kind = kindOf(h);
        buildings.push({ id: buildings.length, x, z, w, d, h, dist, value: w * h * d * RATE[kind], kind });
      }

      // 道路沿いの props。区画の東側か北側の道路に置く（交差点は避ける）
      if (propRoll < 0.45) {
        const along = (propPos - 0.5) * BLOCK, across = BLOCK / 2 + ROAD / 2 + (propAcross - 0.5) * (ROAD - 2);
        const px = propSide < 0.5 ? cx + across : cx + along;
        const pz = propSide < 0.5 ? cz + along : cz + across;
        const pd = Math.hypot(px, pz);
        if (pd > cfg.plazaRadius && pd <= R) {
          const kind = propKind < 0.5 ? 'car' : propKind < 0.8 ? 'lamp' : 'sign';
          props.push({ id: props.length, x: px, z: pz, dist: pd, value: PROP_VALUE[kind], kind });
        }
      }
    }
  }
  return { buildings, props };
}
