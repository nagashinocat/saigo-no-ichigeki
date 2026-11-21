export const CONFIG = {
  roundSeconds: 60,
  cityRadius: 680,          // m（S8: 420 → 680、面積 約 2.6 倍）。最大の一発は街の端より先まで届く
  plazaRadius: 12,          // 主人公の立つ広場。ここには建物を置かない
  // 貯めた力: 長押しの間だけ chargePerSec で貯まる（max で止まる）。離すと最後の一発（minRelease 未満なら放たず、貯めた力は残る）
  power:   { max: 100, chargePerSec: 3, minRelease: 10 },
  // 小爆発: 貯めた力を cost 使い、主人公のまわり radius m の軍勢を払う（ビルは壊さず、破壊額にも入らない）
  // 費用は持ち主の決定（2026-11-21、払うの費用・半径の調整を許可）で 8 → 4.5（速く群れる軍勢を何度も払えるように。釣り合いは下の enemy の説明）
  // R0（持ち主 22:15「かなり簡単」）: 軍勢を速く・集まるようにしたので、払う回数が増える（最善の操作で 15 → 約 23 回）。費用 4.5 → 3 で釣り合わせる
  puff:    { cost: 3, radius: 22 },
  // 最後の一発の半径（貯めた力 / power.max で決まる）。S8: max 440 → 720（街の端 680 m と、見回る軍勢の一番外
  // （maxEnemyReach、約 603 m）より十分先まで。最大溜めなら街のどこにいる軍勢も必ず巻き込む）
  // fix1（持ち主 15:33「軍勢は街の全体に」）: 見回る者が街の端まで行くので max 720 → 730（maxEnemyReach 約 685 m + 40 m より先）
  // R0 fix1（制作側の判断「撃退には ほぼ満タン（97% 以上）が要る」）: knee（97%）までは kneeRadius（635 m、街の端の見回る者の
  // 多くより内）まで前と同じ形、そこから満タンで max まで一気に広がる（charge.js radiusFor）
  radius:  { min: 10, max: 730, exponent: 0.75, knee: 0.97, kneeRadius: 635 },
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
  // R0（持ち主 22:15「まだ主人公前で止まる感じ」）: 見つけても止まらない（にらむ一拍はやめた）。探す速さのまま speed m/s へ chaseAccel で上げて
  // 一直線に突っ込み（最後の slowDist m だけ slowMin 倍まで、grabRange で掴む）、掴んだら主人公のまわりを回りながら吸う。
  // 枠が埋まっていても待たず、掴んでいる者の外の輪（swarm）を回って群がる。主人公から 25 m 以内では誰もが 6 m/s 以上で動く（テストあり）。
  // 探して alertAfter 秒たつか、毎秒 alertRate の確率で（湧いたときに alertAtSpawn の確率で）気配を感じ、主人公に近づく道だけを選ぶ。
  // turnRate / chaseTurnRate: 曲がる速さ（rad/s）、lookAhead: 道の中心線からのずれをこの m 先で戻す、snapDist の内側では主人公へまっすぐ向く。accel / brake: m/s²。
  // 釣り合い（scripts/balance-sim.mjs）: 持ち主の「ギリギリのスリル」= 最善の操作で満タンが最後の数秒、払わなければ届かない。
  // R0（持ち主 22:15「かなり簡単だからもっとスピード上げて集まってくるように」、制作側の判断で目標は最善の操作で満タンが p50 約 54 秒・
  // 撃退成功 7〜8 割）: 探す 24 → 30 m/s、突っ込む 18 → 32 m/s、見つける距離 17 → 28 m、残り 20 秒から広場の近くの見回る者も加わる。
  // 湧き方（序盤 0.5/秒 → 40〜52 秒で 5.5/秒、60 秒で約 100）はそのまま。掴まれると一人 1.4/秒（6 人で 8.4/秒）、払うは 3。
  // fix1: 撃退には ほぼ満タンが要る（radius の knee）。満タンの時刻 p50 は届いた回だけで数えて 53.6 秒、最善の放ち方（L=99）で撃退成功 22/30
  // 数は .superpowers/sdd/2026-11-21-machi-hakai-round5/task-R0-report.md
  enemy:   {
    spawnPerSec: 0.5, surgeStart: 40, surgeEnd: 52, surgeMul: 11, drainPerSec: 1.4, maxGrabbing: 6,
    spawnDist: [50, 66], roamDist: 75, laneSpread: 1.6,
    searchSpeed: 30, inwardBias: 0.8, turnRate: 16, lookAhead: 2.5, accel: 30, brake: 70,
    spotDist: 28, spotEvery: 0.15, sightMargin: 0.8, alertAfter: 12, alertRate: 0.05, alertAtSpawn: 0.1,
    speed: 32, chaseAccel: 60, chaseTurnRate: 8, snapDist: 6, slowDist: 0.5, slowMin: 0.35, grabRange: 2.5,
    // R0（持ち主 22:15「まだ主人公前で止まる感じ」）: 掴んだ者は orbitSpeed m/s で主人公のまわりを回りながら吸う。
    // 枠が埋まっていて群がる者は swarmRing（r0 m から perRing 人ごとに step m 外、maxRing 回りまで）を speed m/s で回り、
    // 輪より外にいれば inSpeed m/s で内へ寄る。orbitSpeed は描く輪（bikePose の clingRadius 1.35 m、引っ張る揺れで 1.21 m まで）でも
    // 6 m/s より速く見える速さ（角速度 orbitSpeed / grabRange = 6 rad/s、描く速さ 7.3 m/s 以上。fix1: 12 → 15）
    orbitSpeed: 15,
    swarm: { r0: 4.2, step: 1.4, perRing: 6, maxRing: 5, speed: 14, inSpeed: 8 },
    // S8: 広くなった街を見回る者（enemies.js）。始めから count 人が、探す者の外から街の端まで（patrolBand）の道路を speed m/s で走り回る
    // （持ち主 15:33「軍勢は街の全体にいた方が良い」で 26 → 70 人、帯を街の端まで）。主人公を探さず掴みにも来ない（釣り合いは前のまま）。
    // 最大溜めの一発はこの帯の外端より先まで届く（maxEnemyReach）
    // R0: 残り 20 秒（joinAt 秒）からは、主人公から joinDist m の内の見回る者も狩りに加わる（気配を感じた探す者として集まる）
    patrol: { count: 70, speed: 22, joinAt: 40, joinDist: 220 },
  },
  score:   { comboStep: 0.1, comboMax: 3 },
};
