export const CONFIG = {
  roundSeconds: 60,
  cityRadius: 420,          // m。最大の一発がここまで届く
  plazaRadius: 12,          // 主人公の立つ広場。ここには建物を置かない
  reserve: { max: 100, start: 60, regenPerSec: 9, minLeft: 5 },
  charge:  { ratePerSec: 45, maxDraw: 90 },
  radius:  { min: 10, max: 440, exponent: 0.75 },
  bigShotRatio: 0.35,       // maxDraw に対するこの割合以上が「大きな一発」
  blast:   { speed: 160, vaporizeRatio: 0.18 },
  cinematic: { freezeSec: 1.4, eyeBeatSec: 0.6 },
  enemy:   { spawnPerSec: 1.2, spawnDist: [60, 90], speed: 6, grabRange: 2.5, drainPerSec: 10, maxGrabbing: 6 },
  score:   { comboStep: 0.1, comboMax: 3 },
};
