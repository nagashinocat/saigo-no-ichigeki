export const CONFIG = {
  roundSeconds: 60,
  cityRadius: 680,          // m（S8: 420 → 680、面積 約 2.6 倍）。最大の一発は街の端より先まで届く
  plazaRadius: 12,          // 主人公の立つ広場。ここには建物を置かない
  // 貯めた力: 長押しの間だけ chargePerSec で貯まる（max で止まる）。離すと最後の一発（minRelease 未満なら放たず、貯めた力は残る）
  power:   { max: 100, chargePerSec: 3, minRelease: 10 },
  // 小爆発: 貯めた力を cost 使い、主人公のまわり radius m の軍勢を払う（ビルは壊さず、破壊額にも入らない）
  // 費用は持ち主の決定（2026-11-21、払うの費用・半径の調整を許可）で 8 → 4.5（速く群れる軍勢を何度も払えるように。釣り合いは下の enemy の説明）
  puff:    { cost: 4.5, radius: 22 },
  // 最後の一発の半径（貯めた力 / power.max で決まる）。S8: max 440 → 720（街の端 680 m と、見回る軍勢の一番外
  // （maxEnemyReach、約 603 m）より十分先まで。最大溜めなら街のどこにいる軍勢も必ず巻き込む）
  radius:  { min: 10, max: 720, exponent: 0.75 },
  // 爆発は「じわじわ → 突然弾ける」: creepSec/burstSec は最大の一発での秒数（小さい一発は sqrt で縮む）
  // fadeSec: 前線が届いてから球が消えるまで（上空カメラが全体の構図で球を見せる間）
  // （この creep/burst は払うの曲線。最後の一発のじわじわ期も同じ creepSec / creepFrac）
  // smallRef: 払うの秒の基準の半径（S7 までの最大の半径。S8 で最大を広げても払うの広がり方は前のまま）
  blast:   { smallRef: 440, creepSec: 0.8, creepMin: 0.25, creepFrac: 0.06, burstSec: 1.6, burstMin: 0.2, vaporizeRatio: 0.18, fadeSec: 1.5 },
  // 最後の一発（持ち主の要望 2026-11-21「爆発の広がるスピードをもう少し遅くして魅せるタイミング」）: じわじわ期のあと、
  // 弾ける期（burstSec で半径の burstFrac まで一気に。ease-out の次数 burstPow。終わりは見せる期のはじめの速さへ落ちる）、
  // 見せる期（showSec で半径まで、1 − (1 − u)^showPow でゆるんで止まる）
  // S8（街を広げ、最大の半径を 440 → 720 m）: 弾ける期で半径の 0.4 → 0.45 まで（大きく弾ける）、見せる期 3.4 → 4.3 秒
  // （光の壁が街を飲むのが見える速さ 150 m/s 以下のまま。最大の一発は 4.8 → 5.7 秒）
  finalBlast: { burstSec: 0.6, burstMin: 0.15, burstFrac: 0.45, burstPow: 4, showSec: 4.3, showMin: 0.5, showPow: 1.6 },
  cinematic: { freezeSec: 1.4, eyeBeatSec: 0.6 },
  // 湧く速さ（持ち主の決定「終盤ほど一気に増やす」）: 序盤は spawnPerSec で平ら、surgeStart 秒から surgeEnd 秒へ一気に surgeMul 倍まで増える
  // （残り 20 秒ほどで群れになる。60 秒で約 100）。掴んだ一人ごとに貯めた力が drainPerSec ずつ減る。
  // 浮遊バイクは spawnDist（近い上空カメラの画面の端のすぐ外〜少し内）の道路に湧き、道路に沿って searchSpeed m/s で探し回る
  // （交差点で曲がる。主人公に近づく向きは inwardBias 倍の重みで選ぶ。roamDist の外へは出ない。laneSpread: 道の中心線からのずれ）。
  // spotDist の内側で建物にさえぎられずに見えたら（spotEvery 秒ごとに確かめる。sightMargin: 建物の足元を広げる）見つけ、
  // spotDist は広場を囲む道（中心線 13m、車線は ±laneSpread）より余裕をもって外まで届くこと（届かないと誰も見つけられない。テストあり）。
  // 見つけた瞬間から spotPause 秒、急ブレーキ（brake）で止まりながらにらみ（見つけた一拍）、speed m/s へ chaseAccel で上げて一直線に突っ込む
  // （最後の slowDist m だけ slowMin 倍まで急ブレーキ、grabRange で掴む。枠が埋まっていても待たず、掴んでいる者の外に重なって飛びつく）。
  // 探して alertAfter 秒たつか、毎秒 alertRate の確率で（湧いたときに alertAtSpawn の確率で）気配を感じ、主人公に近づく道だけを選ぶ。
  // turnRate / chaseTurnRate: 曲がる速さ（rad/s）、lookAhead: 道の中心線からのずれをこの m 先で戻す、snapDist の内側では主人公へまっすぐ向く。accel / brake: m/s²。
  // 釣り合い（scripts/balance-sim.mjs）: 持ち主の「ギリギリのスリル」= 最善の操作で満タンが約 50 秒、払わなければ届かない。
  // 軍勢を速くした（探す 24 m/s・突っ込む 18 m/s）うえで、湧き方を「終盤ほど一気に増やす」（序盤 0.5/秒 → 40〜52 秒で 5.5/秒、60 秒で約 100）にし、
  // 掴まれると痛い（一人 1.2/秒、6 人で 7.2/秒）が払うは安い（4.5）ので、最善は「一人目に掴まれたら払う」。満タンは中央 50.6 秒、払わないと 60 秒で 0
  enemy:   {
    spawnPerSec: 0.5, surgeStart: 40, surgeEnd: 52, surgeMul: 11, drainPerSec: 1.2, maxGrabbing: 6,
    spawnDist: [50, 66], roamDist: 75, laneSpread: 1.6,
    searchSpeed: 24, inwardBias: 0.8, turnRate: 16, lookAhead: 2.5, accel: 30, brake: 70,
    spotDist: 17, spotEvery: 0.15, sightMargin: 0.8, alertAfter: 12, alertRate: 0.05, alertAtSpawn: 0.1,
    spotPause: 0.45, speed: 18, chaseAccel: 60, chaseTurnRate: 8, snapDist: 6, slowDist: 1.5, slowMin: 0.3, grabRange: 2.5,
    // S8: 広くなった街を見回る者（enemies.js）。始めから count 人が、band × cityRadius の距離の帯の道路を speed m/s で走り回る。
    // 主人公を探さず掴みにも来ない（釣り合いは前のまま）。最大溜めの一発はこの帯の外端より先まで届く（maxEnemyReach）
    patrol: { count: 26, band: [0.2, 0.88], speed: 22 },
  },
  score:   { comboStep: 0.1, comboMax: 3 },
};
