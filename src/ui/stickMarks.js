// M2（持ち主 15:20「ジョイスティックの外側の丸に敵の方向マークできるかな？」）: 浮かぶスティックの外側の輪に出す、近くの軍勢の向きの印。
// 近い順に max 個まで（追う・近づく者 chase / approach / stagger は距離を threatK 倍に縮めて先に）。range m より遠い者・倒れた者・
// もう掴んでいる者（主人公に重なって見える）・見回るだけの者は出さない。近いほど濃く（k）大きく（size 倍）。種類（大物・重い者・吸う者）も渡す
export const MARKS = { max: 8, range: 110, threatK: 0.4, minSize: 0.7, maxSize: 1.5 };

// 世界の向き（dx, dz）を、上空カメラの画面の角度（度。右 0、下 90、時計回り）へ。azimuthDeg: カメラの向き（views.js の CITY_CAMERA。0 で
// 画面の右 = 世界の +x、画面の上 = 世界の −z）
export function screenBearingDeg(dx, dz, azimuthDeg = 0) {
  const az = (azimuthDeg * Math.PI) / 180;
  const sx = dx * Math.cos(az) - dz * Math.sin(az);
  const sy = dx * Math.sin(az) + dz * Math.cos(az);
  return (Math.atan2(sy, sx) * 180) / Math.PI;
}

const THREAT = new Set(['chase', 'approach', 'stagger']);
export function stickMarks(hero, riders, { azimuthDeg = 0, M = MARKS } = {}) {
  const picks = [];
  for (const e of riders) {
    if (e.state === 'dead' || e.state === 'grab' || e.state === 'cling' || e.x == null) continue;
    if (e.patrol && !e.hunting) continue;
    const dx = e.x - hero.x, dz = e.z - hero.z, d = Math.hypot(dx, dz);
    if (d > M.range) continue;
    const chase = THREAT.has(e.state);
    picks.push({ e, dx, dz, d, chase, rank: chase ? d * M.threatK : d });
  }
  picks.sort((a, b) => a.rank - b.rank);
  return picks.slice(0, M.max).map(({ e, dx, dz, d, chase }) => {
    const near = 1 - d / M.range;
    const k = Math.min(1, Math.max(0.15, near ** 0.7 * (chase ? 1 : 0.75)));
    return { id: e.id, deg: screenBearingDeg(dx, dz, azimuthDeg), k, size: M.minSize + (M.maxSize - M.minSize) * near, kind: e.kind ?? null, chase };
  });
}
