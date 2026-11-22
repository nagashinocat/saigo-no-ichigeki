export const CONFIG = {
  roundSeconds: 60,
  cityRadius: 680,          // m（S8: 420 → 680、面積 約 2.6 倍）。最大の一発は街の端より先まで届く
  plazaRadius: 12,          // 主人公の立つ広場。ここには建物を置かない
  // 貯めた力: 長押しの間だけ chargePerSec で貯まる（max で止まる）。離すと最後の一発（minRelease 未満なら放たず、貯めた力は残る）
  // M2（§16 の釣り合い。数は task-M2-report.md）: 払うが 3 回になり、隠れるで見失わせられるので、貯める速さ 3 → 1.9/秒
  // （見つからずに貯めきって約 53 秒。最善の操作で満タン p50 約 53 秒・撃退成功 7〜8 割）
  power:   { max: 100, chargePerSec: 1.9, minRelease: 10 },
  // 小爆発: 貯めた力を cost 使い、主人公のまわり radius m の軍勢を払う（ビルは壊さず、破壊額にも入らない）
  // 費用は持ち主の決定（2026-11-21、払うの費用・半径の調整を許可）で 8 → 4.5（速く群れる軍勢を何度も払えるように。釣り合いは下の enemy の説明）
  // R0（持ち主 22:15「かなり簡単」）: 軍勢を速く・集まるようにしたので、払う回数が増える（最善の操作で 15 → 約 23 回）。費用 4.5 → 3 で釣り合わせる
  // R1: 一度の払うで combo.from 体以上を払うと「×k」を出す（見せるだけ。力は戻さない: 持ち主 09:11 で払うは回数制限になるため、
  // 力を戻す払うの腕前はやめた）
  // M2（持ち主 09:11「払うを 3 回くらいの回数制限」）: 1 回のゲームで uses 回まで。払うたびに力も cost 使う（2.8 → 4.5。持ち主の選択）
  puff:    { cost: 4.5, uses: 3, radius: 22, combo: { from: 3 } },
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
  cinematic: { freezeSec: 1.4 },
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
    // R1（重い者・吸う者・大物を入れた仮の釣り合い。持ち主 09:11 で動く主人公と払うの回数制限に変わるので、そこで作り直す）:
    // 払う 3 → 2.8、吸う 1.4 → 1.5/秒（tests/game/balance.test.js の範囲に戻す。数は task-R1-report.md）
    spawnPerSec: 0.5, surgeStart: 40, surgeEnd: 52, surgeMul: 11, drainPerSec: 1.5, maxGrabbing: 6,
    spawnDist: [50, 66], roamDist: 75, laneSpread: 1.6,
    searchSpeed: 30, inwardBias: 0.8, turnRate: 16, lookAhead: 2.5, accel: 30, brake: 70,
    // M2（持ち主 09:11「敵の前方ライトを少し広くして」）: 見つけるのは前を照らすライトの中だけ。前の 28 m の丸 → 前向きの扇
    // （spotDist m まで、半分の角 spotHalfAngle rad）。ごく近く（spotNear m）だけは向きによらない（enemies.js seesHero）
    // M2: 前の「気配」（探して alertAfter 秒たつか毎秒 alertRate の確率で、主人公の今の位置へ寄っていく）はやめた（ライトで見つからなければ
    // 来ない。見つかれば知らせで集まる）。12 / 0.05 / 0.1 → Infinity / 0 / 0
    spotDist: 36, spotHalfAngle: 0.8, spotNear: 5, spotEvery: 0.15, sightMargin: 0.8, alertAfter: Infinity, alertRate: 0, alertAtSpawn: 0,
    // M2（「見つかったらどんどん集まってくる」）: 見つけた者は光り、radius m の内の探す者・見回る者へ知らせる。知らされた者は relayDelay 秒で
    // 次へ伝える（hops 段まで）。主人公が見えている追う者・掴む者は callEvery 秒ごとに知らせ直す（最後に見えた所が今の主人公へ）。
    // 知らされただけの者は最後に見えた所へ向かい、そこから sweepDist m の内を探し回る（自分で見つけたら今の主人公を追う）
    alert: { radius: 120, relayDelay: 0.5, hops: 2, callEvery: 1, sweepDist: 25, flashSec: 0.6 },
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
    // R1（spec §15「軍勢の種類」）: 探す者の種類。どれも撃退の数に入り、最後の一発は 1 回で倒す（hp は払うの回数）。
    //  heavy（重い者）: after 秒からの探す者の share。払う 2 回ではがれる（1 回目は後ろへよろめく）。速さ ×speedMul
    //  drainer（吸う者）: after 秒からの探す者の share。掴んでいる間、drainPerSec の drainMul 倍を吸う
    //  boss（大物）: at 秒に 1 体だけ（気配を感じた者として主人公へ）。払う 3 回、吸う ×4、大きく描き、探照灯を持つ
    // 種類の乱数は探す者の乱数とは別（game.js の typeRng）。探す者の乱数の並びが前と同じなのは種類のある者が初めて湧くまで
    // （重い者は 20 秒から。速さが違い、道を選ぶ時刻がずれる。大物は 49 秒）
    kinds: {
      // M2（主人公 28 m/s）: 重い者 0.8 → 0.92、大物 0.9 → 0.95（突っ込む 29.4 / 30.4 m/s。主人公より遅いと、見つけても追いつけない）
      heavy: { share: 0.15, after: 20, hp: 2, speedMul: 0.92, drainMul: 1 },
      drainer: { share: 0.15, after: 30, hp: 1, speedMul: 1, drainMul: 2.5 },
      boss: { at: 49, hp: 3, speedMul: 0.95, drainMul: 4 },
    },
    // 払うが当たって倒れなかった者（重い者・大物）のよろめき: sec 秒、外へ push m/s（なめらかに 0 へ）と、回る向きへ spin m/s。
    // 止まって見えない（どの瞬間も spin 以上の速さ）。そのあと突っ込み直す
    stagger: { sec: 0.55, push: 20, spin: 9 },
  },
  score:   { comboStep: 0.1, comboMax: 3 },
  // M1（持ち主 09:11 / 09:15、spec §16）: 主人公が動く。通りと広場の上を浮いたまま speed m/s（軍勢より遅い）で、なめらかに（accelRate 1/秒の
  // ばねで目標の速さへ）動く。ビルの足元（radius m 広げた四角）は通り抜けず、壁に沿って滑る。街の中心から cityRadius − edgePad m より外へは出ない。
  // 掴んでいる者 1 人ごとに grabSlow（20%）遅くなり、minSpeedFrac（40%）より遅くはならない。動くのは溜めている間だけ（1 本目の指がないと動かない）。
  // 体は進む向きへ turnRate rad/s で向き直り、速さに応じて leanMax rad まで前へ傾く
  // R1d（持ち主 13:36「キャラクターの移動速度をかなり上げよう」）: 11 → 22 m/s（軍勢の突っ込む 32 m/s より遅いまま）。加速 7 → 12（約 0.25 秒で全速の 9 割強）、
  // 向き直り 9 → 16 rad/s、前への傾き 0.3 → 0.42 rad。一歩が radius より長いときは刻んで動かす（薄い足元を飛び越えない）
  // M2（持ち主 15:20「足の速さはバイクよりほんのちょっと遅いくらいじゃないとすぐ捕まるね」）: 22 → 28 m/s（探す 30・突っ込む 32 より少しだけ遅い）
  hero: { speed: 28, accelRate: 12, radius: 1.2, edgePad: 30, grabSlow: 0.2, minSpeedFrac: 0.4, turnRate: 16, leanMax: 0.42 },
  // M2（持ち主 15:20「物陰にシュッと入る」）: 隠れる。向きの先 minDist〜range m の物陰（ビルの壁から wallDist m の内で、追っている者から見えない所。
  // step m 刻み、向きのずれ 1 rad ごとに offW m 遠いのと同じに数える）へ dashSec 秒でシュッと滑り込む。そこから leaveDist m 離れるまで見つからない。
  // 次の隠れるまで cooldown 秒。掴まれている間はできない
  // 物陰では、ライトが真正面から seeDist m の内を照らさない限り見つからない。同じ物陰にいられるのは holdSec 秒まで（ずっと隠れたままにしない）
  hide: { holdSec: 12, seeDist: 4, dashSec: 0.3, cooldown: 3, range: 26, minDist: 3, step: 1.5, wallDist: 1.6, offW: 6, leaveDist: 3 },
  // M1 の操作（持ち主 09:15、制作側の判断）: 溜めているあいだの 2 本目の指は、longPressSec 秒以上で浮かぶジョイスティック（押した所に出て、
  // 指を離すと消える。stickRadiusPx の輪いっぱいで全速、deadPx より内は止まる）、それより短く tapMovePx px 未満の動きで離せば払う
  // M2（持ち主 15:20）: 隠れる操作。スティックを同じ向きに素早く 2 回倒す（mag より深く・window 秒の内・向きのずれ angleDeg° 以内、
  // 間に release より浅く戻す）。PC は向きのキーの 2 回押し
  controls: { longPressSec: 0.18, tapMovePx: 10, stickRadiusPx: 56, deadPx: 6, flick: { mag: 0.7, release: 0.35, window: 0.35, angleDeg: 30 } },
};
