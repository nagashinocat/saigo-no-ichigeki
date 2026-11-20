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
  // （この creep/burst は払うの曲線。最後の一発のじわじわ期も同じ creepSec / creepFrac）
  blast:   { creepSec: 0.8, creepMin: 0.25, creepFrac: 0.06, burstSec: 1.6, burstMin: 0.2, vaporizeRatio: 0.18, fadeSec: 1.5 },
  // 最後の一発（持ち主の要望 2026-11-21「爆発の広がるスピードをもう少し遅くして魅せるタイミング」）: じわじわ期のあと、
  // 弾ける期（burstSec で半径の burstFrac まで一気に。ease-out の次数 burstPow。終わりは見せる期のはじめの速さへ落ちる）、
  // 見せる期（showSec で半径まで、1 − (1 − u)^showPow でゆるんで止まる）
  finalBlast: { burstSec: 0.6, burstMin: 0.15, burstFrac: 0.4, burstPow: 4, showSec: 3.4, showMin: 0.5, showPow: 1.6 },
  cinematic: { freezeSec: 1.4, eyeBeatSec: 0.6 },
  // 湧く速さは spawnPerSec から、rampSec 秒で spawnRamp 倍へ一直線に増える。掴んだ一人ごとに貯めた力が drainPerSec ずつ減る。
  // 浮遊バイクは spawnDist（近い上空カメラの画面の端のすぐ外〜少し内）の道路に湧き、道路に沿って searchSpeed m/s で探し回る
  // （交差点で曲がる。主人公に近づく向きは inwardBias 倍の重みで選ぶ。roamDist の外へは出ない。laneSpread: 道の中心線からのずれ）。
  // spotDist の内側で建物にさえぎられずに見えたら（spotEvery 秒ごとに確かめる。sightMargin: 建物の足元を広げる）見つけ、
  // 急に止まって spotPause 秒にらみ（見つけた一拍）、speed m/s へ chaseAccel で上げて一直線に近づく
  // （掴む手前の slowDist m で slowMin 倍まで減速、grabRange で掴む。枠が埋まっていれば queueDist で待つ）。
  // 探して alertAfter 秒たつか、毎秒 alertRate の確率で（湧いたときに alertAtSpawn の確率で）気配を感じ、主人公に近づく道だけを選ぶ。
  // turnRate / chaseTurnRate: 曲がる速さ（rad/s）、lookAhead: 道の中心線からのずれをこの m 先で戻す、snapDist の内側では主人公へまっすぐ向く。accel / brake: m/s²。
  // 釣り合い（scripts/balance-sim.mjs）: 届くまでの秒は平均 12 秒（前と同じ）で、探し回る分だけ長い者もいる。spotDist を払う半径（22m）の
  // 少し外にしたので、払ったあと次に掴まれるまでの間が前と同じほどになり、最善の操作で満タンになる時刻も前（約 50 秒）とほぼ同じ
  enemy:   {
    spawnPerSec: 0.8, spawnRamp: 3.5, rampSec: 60, drainPerSec: 1, maxGrabbing: 6,
    spawnDist: [50, 66], roamDist: 75, laneSpread: 1.6,
    searchSpeed: 16, inwardBias: 0.8, turnRate: 7, lookAhead: 3, accel: 14, brake: 24,
    spotDist: 26, spotEvery: 0.15, sightMargin: 0.8, alertAfter: 12, alertRate: 0.05, alertAtSpawn: 0.1,
    spotPause: 1, speed: 9, chaseAccel: 5, chaseTurnRate: 5, snapDist: 6, slowDist: 12, slowMin: 0.35, grabRange: 2.5, queueDist: 3.75,
  },
  score:   { comboStep: 0.1, comboMax: 3 },
};
