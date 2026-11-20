export const CONFIG = {
  roundSeconds: 60,
  cityRadius: 420,          // m。最大の一発がここまで届く
  plazaRadius: 12,          // 主人公の立つ広場。ここには建物を置かない
  // 貯めた力: 長押しの間だけ chargePerSec で貯まる（max で止まる）。離すと最後の一発（minRelease 未満なら放たず、貯めた力は残る）
  power:   { max: 100, chargePerSec: 3, minRelease: 10 },
  // 小爆発: 貯めた力を cost 使い、主人公のまわり radius m の軍勢を払う（ビルは壊さず、破壊額にも入らない）
  puff:    { cost: 8, radius: 22 },
  radius:  { min: 10, max: 440, exponent: 0.75 }, // 最後の一発の半径（貯めた力 / power.max で決まる）
  // 爆発は「じわじわ → 突然弾ける」: creepSec/burstSec は最大の一発での秒数（小さい一発は sqrt で縮む）
  // fadeSec: 前線が届いてから球が消えるまで（上空カメラが全体の構図で球を見せる間）
  blast:   { creepSec: 0.8, creepMin: 0.25, creepFrac: 0.06, burstSec: 1.6, burstMin: 0.2, vaporizeRatio: 0.18, fadeSec: 1.5 },
  cinematic: { freezeSec: 1.4, eyeBeatSec: 0.6 },
  // 湧く速さは spawnPerSec から、rampSec 秒で spawnRamp 倍へ一直線に増える。掴んだ一人ごとに貯めた力が drainPerSec ずつ減る
  // spawnDist は近い上空カメラの画面の端のすぐ外〜少し内（縦画面）。浮遊バイクは掴む手前の slowDist m で slowMin 倍まで速度を落とす。
  // 主人公に届くまでの秒（約 10.7〜14 秒）は前とほぼ同じになるよう speed を合わせた
  enemy:   { spawnPerSec: 0.8, spawnRamp: 3.5, rampSec: 60, spawnDist: [50, 66], speed: 4.9, slowDist: 10, slowMin: 0.45, grabRange: 2.5, drainPerSec: 1, maxGrabbing: 6 },
  score:   { comboStep: 0.1, comboMax: 3 },
};
