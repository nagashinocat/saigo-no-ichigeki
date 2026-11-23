// R3 fix1（点検 Important 1・持ち主 19:03「githubで公開」）: 共有のリンクの正式な URL。ここ一か所で決める。
// 既定は GitHub Pages（リポジトリ nagashinocat/saigo-no-ichigeki）。ビルドのときに VITE_SHARE_URL で上書きできる
// （例 VITE_SHARE_URL=https://… npm run build）。artifact（iframe の中）や別の場所で開いても、共有の文のリンクはこの URL になる（daily.js shareBase）
export const SHARE_BASE_URL = import.meta.env?.VITE_SHARE_URL || 'https://nagashinocat.github.io/saigo-no-ichigeki/';

export const CONFIG = {
  roundSeconds: 60,
  cityRadius: 680,          // m（S8: 420 → 680、面積 約 2.6 倍）。最大の一発は街の端より先まで届く
  plazaRadius: 12,          // 主人公の立つ広場。ここには建物を置かない
  // 貯めた力: 長押しの間だけ chargePerSec で貯まる（max で止まる）。離すと最後の一発（minRelease 未満なら放たず、貯めた力は残る）
  // M2（§16 の釣り合い。数は task-M2-report.md）: 払うが 3 回になり、隠れるで見失わせられるので、貯める速さ 3 → 1.9/秒
  // （見つからずに貯めきって約 53 秒。最善の操作で満タン p50 約 53 秒・撃退成功 7〜8 割）
  // R1f（持ち主 19:47「一回見つかって払うとほぼ詰む」・今日の街）: 1.9 → 1.92（見つからずに貯めきって約 52.1 秒）。fix2: 払う 3.5・吸う 1.2 と合わせて、
  // 一度見つかって払っても満タンに届く余り（60 秒で 115 − 払う 3.5 × 3）を作る。今日の街 360 日（2026-07・11、2027-03 から 120 日ずつ）で最善の撃退成功 75%
  // （数は task-R1f-report.md。scripts/daily-balance.mjs）
  power:   { max: 100, chargePerSec: 1.92, minRelease: 10 },
  // 小爆発: 貯めた力を cost 使い、主人公のまわり radius m の軍勢を払う（ビルは壊さず、破壊額にも入らない）
  // 費用は持ち主の決定（2026-11-21、払うの費用・半径の調整を許可）で 8 → 4.5（速く群れる軍勢を何度も払えるように。釣り合いは下の enemy の説明）
  // R0（持ち主 22:15「かなり簡単」）: 軍勢を速く・集まるようにしたので、払う回数が増える（最善の操作で 15 → 約 23 回）。費用 4.5 → 3 で釣り合わせる
  // R1: 一度の払うで combo.from 体以上を払うと「×k」を出す（見せるだけ。力は戻さない: 持ち主 09:11 で払うは回数制限になるため、
  // 力を戻す払うの腕前はやめた）
  // M2（持ち主 09:11「払うを 3 回くらいの回数制限」）: 1 回のゲームで uses 回まで。払うたびに力も cost 使う（2.8 → 4.5。持ち主の選択）
  // R1f fix1: 4.5 → 4（吸う 0.8 と合わせて）。表は task-R1f-report.md（Fix round 1）
  // fix2（まとめ役の判断）: 4 → 3.5（吸う 1.2 のまま）
  // Pass 2〜Fix round 3（まとめ役、持ち主 10:06「払う全部使って隠れる無しでもクリアできない」）: 払ったあと guardSec 秒は掴まれない
  // （その間に掴みに来た者は払いの残りで倒れる。重い者・大物はよろめく。guardKill。enemies.js guard。守りの間は輪と音 render/guardRing.js、
  // 音は 1 秒に 6 回まで）。隠れても守りは消えない（Fix round 3: LOOK OUT! の矢印に従う人を損させない）。払ったあと hideLockSec 秒は隠れられない。
  // 払う費用は 3.5 → 2.2（持ち主 09:11「払うたびに力も少し使う」の範囲。2.5 では 3 回払った最善の満タンが 56 秒を越える）
  puff:    { cost: 2.2, uses: 3, radius: 22, guardSec: 10.5, guardKill: true, hideLockSec: 4, combo: { from: 3 } },
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
  // R1i（持ち主 2026-11-23 10:29「宇宙の爆発の演出…規模によって大きさ変えられる？今のを最大にしてしょうもないやつと普通のやつ3段階」）:
  // 宇宙から見た爆発の段は、放った一撃の半径（m）で決める（finaleTimeline.js spaceTierFor）。max 以上が最大（今のまま。膝 = 力 97% の
  // kneeRadius から）、normal 以上が中（普通。力 約 50%）、それより小さいものが小（しょうもない）。見せるだけ（釣り合いは変えない）
  spaceTier: { normal: 390, max: 635 },
  // 湧く速さ（持ち主の決定「終盤ほど一気に増やす」）: 序盤は spawnPerSec で平ら、surgeStart 秒から surgeEnd 秒へ一気に surgeMul 倍まで増える
  // （残り 20 秒ほどで群れになる。60 秒で約 100）。掴んだ一人ごとに貯めた力が drainPerSec ずつ減る。
  // 浮遊バイクは spawnDist（上空カメラの画面の外。R1g でカメラを 0.8 倍に寄せてからは、ほとんどが画面の端より外）の道路に湧き、道路に沿って searchSpeed m/s で探し回る
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
    // R1f: 吸う 1.5 → 1.2/秒（6 人で 7.2/秒）。fix1 で 0.8 にしたのは、まとめ役の判断で 1.2 に戻した
    // fix2（まとめ役の判断）: 0.8 → 1.2 に戻す
    // 持ち主 10:06（「数値で85パーセントくらいのクリア確率にしたらいいかも」）・Fix round 1（まとめ役: 持ち主の決まりへ戻す）:
    // 群れは残り 20 秒（40 → 52 秒）のまま。数で釣り合いを取る: 序盤の湧く速さ 0.5 → 0.1/秒（隠れない主人公が広場で一人ずつ
    // 見つかり、払う 3 回を序盤で使い切っていた）、surgeMul 11 → 68（60 秒で約 100 のまま、終盤の山 5.5 → 6.8/秒）、吸う 1.2 → 0.85/秒。
    // 三つの時期の今日の街 360 で最善 99%（99.2 / 98.3 / 99.2%）、払う 3 回・隠れない 51%、隠れるだけ 27%（lookout-timing-report.md Fix round 3）
    spawnPerSec: 0.1, surgeStart: 40, surgeEnd: 52, surgeMul: 68, drainPerSec: 0.85, maxGrabbing: 6,
    spawnDist: [50, 66], roamDist: 75, laneSpread: 1.6, // 湧く輪（主人公から m）は R1g のカメラでは画面のほぼ外
    searchSpeed: 30, inwardBias: 0.8, turnRate: 16, lookAhead: 2.5, accel: 30, brake: 70,
    // M2（持ち主 09:11「敵の前方ライトを少し広くして」）: 見つけるのは前を照らすライトの中だけ。前の 28 m の丸 → 前向きの扇
    // （spotDist m まで、半分の角 spotHalfAngle rad）。ごく近く（spotNear m）だけは向きによらない（enemies.js seesHero）
    // M2: 前の「気配」（探して alertAfter 秒たつか毎秒 alertRate の確率で、主人公の今の位置へ寄っていく）はやめた（ライトで見つからなければ
    // 来ない。見つかれば知らせで集まる）。12 / 0.05 / 0.1 → Infinity / 0 / 0
    // R1f（持ち主 18:14）: sightMargin 0.8 → 0（壁に触れて立つ主人公への、角をかすめる見通しが、見えているのにさえぎられていた。
    // 壁のそばの格子で見えている 3454 件のうち 522 件。tests/game/wallSpot.test.js）
    // fix2（三つの時期の今日の街で 7 割を保つ）: ライトの扇の半分の角 0.8 → 0.7 rad（46° → 40°）
    // 持ち主 10:02（「ちょっとすぐ見つかりすぎな気がするから群勢のライトの距離と幅を今より5%くらい小さくしよう」）: 見つける距離 36 → 34.2 m・
    // 扇の半分の角 0.7 → 0.665 rad（どちらも × 0.95。見える光の扇 render/headlights.js も同じ値を読む）
    spotDist: 34.2, spotHalfAngle: 0.665, spotNear: 5, spotEvery: 0.15, sightMargin: 0, alertAfter: Infinity, alertRate: 0, alertAtSpawn: 0,
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
    // R1f（持ち主 19:47「払ったあとのよろめきの間に逃げ、撒いて、また溜められる」）: sec 0.55 → 0.77（約 4 割長く）
    stagger: { sec: 0.77, push: 20, spin: 9 },
    // R1f（持ち主 19:47「ビル貫通してバイクがくる」「撒けるように」）: 追う者（enemies.js）。ライト（扇・ごく近く・見通し。見つけるときと同じ）で
    // 見えない間が loseSec 秒を越えると見失い、最後に見た所を探す。見えない間は、最後に見た所へ（reachLastSeen m の内に着くまで。そこへの見通しが
    // なければ道しるべ flowField.js: navCell m の升、足元を navPad m 広げて通れない升に、主人公のまわり navHalf m の窓。rebuildSec 秒か rebuildDist m
    // ごとに作り直し、navAhead 升たどった先へ）、着いても見えなければ、そのままの向きで guessDist m 先へ行き過ぎる（角を曲がられれば外れる）。
    // hearDist m の内の見通しのある主人公は、ライトの向きによらず見えている（すぐ後ろは撒けない。見つけた直後に背を向けていても突っ込める）。
    // navTurnRate rad/s で向き直り、見えない間は blindSpeed m/s（探す 30・主人公の 28 より遅い。見えていれば突っ込む 32 のまま: 開けた所では追いつかれ、
    // 角を曲がって見えなくすれば速さで振り切れる）。動いたあと足元（riderPad m 広げた四角）から押し出す
    // fix1（見直し Important 3）: 見えない追う者が向かうのは、皆で一つの「最後に誰かが見た所」（今の主人公ではない。道しるべもそこへ作る）。
    // loseSec 2 → 1.5（spec「約 2 秒」の内。持ち主が直せる）、hearDist 15 → 9、blindSpeed 20 → 16（28〜34 m 後ろから角を 2 つ曲がれば、
    // 今日の街 24 のうち 15〜19 で撒ける。25 m では 3。tests/game/spottedChase.test.js）
    chase: { loseSec: 1.5, hearDist: 9, blindSpeed: 16, reachLastSeen: 3, guessDist: 20, navCell: 2, navPad: 0.9, navHalf: 64, rebuildSec: 0.2, rebuildDist: 3, navAhead: 3, navTurnRate: 18, riderPad: 0.6 },
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
  // R1f（持ち主 18:14「派手でかっこいいアクション」）: 物陰へ跳ぶ動き（game/hideMotion.js）。crouchSec 秒しゃがんで踏み切り（その間に道すじの
  // crouchCreep だけ進む）、高さ leapH m の弧で跳ぶ（道すじが kickMinLen m 以上で、真ん中から kickNear m の内にビルの面があれば、その壁を蹴る）。
  // 物陰に着くのは dashSec 秒（前のまま）。そのあと landSec 秒、着地のしゃがみ（見た目だけ）。残像・光の尾・着地の光は render/hideAction.js
  hideAction: { crouchSec: 0.06, crouchCreep: 0.04, leapH: 4, kickMinLen: 6, kickNear: 3.5, landSec: 0.16 },
  // fix2: 同じ物陰にいられる秒 holdSec 12 → 16（三つの時期の今日の街で 7 割を保つ。task-R1f-report.md Fix round 2）
  // Fix round 3（持ち主の判断「間をとる」・見直し Important B）: 物陰で見つかるのは真正面 seeDist 4.5 m の内だけで、物陰の確かめは毎フレーム
  // （さいころなし）。物陰に近づく者がいれば、見つかる前に字だけの LOOK OUT! とかくれ中の赤い脈（lookout.coverWarnK × seeDist）。
  // 隠れるだけ（払う 0 回、S ランクの道）を 2〜3 割にするのは holdSec と cooldown: 物陰にいられる 10 → 6.5 秒、撒いた隠れるの待ち時間 7 → 6 秒
  // （持ち主の 16 秒・3 秒からは離れる）。追われていない間の先回りの隠れる（矢印に従う）は evadeCooldown 3 秒
  hide: { holdSec: 6.5, evadeCooldown: 3, seeDist: 4.5, dashSec: 0.3, cooldown: 6, range: 26, minDist: 3, step: 1.5, wallDist: 1.6, offW: 6, leaveDist: 3 },
  // M1 の操作（持ち主 09:15、制作側の判断）: 溜めているあいだの 2 本目の指は、longPressSec 秒以上で浮かぶジョイスティック（押した所に出て、
  // 指を離すと消える。stickRadiusPx の輪いっぱいで全速、deadPx より内は止まる）、それより短く tapMovePx px 未満の動きで離せば払う
  // M2（持ち主 15:20）: PC の隠れる操作。向きのキーを同じ向きに素早く 2 回押す（keyTwice: mag より深く・window 秒の内・向きのずれ angleDeg° 以内、
  // 間に release より浅く戻す。input/keyTwice.js）。M2 のスティックを 2 回倒すはやめた（R1e、持ち主 16:45）
  // R1f: タップは、触れてから longPressSec 秒より前に離し、触れた所からの動きが tapSlopPx px 未満（tapMovePx で仮のスティックが出ていてもよい。
  // 実機の軽いタップの指の転がりで払うを取りこぼさない）。radar: スティックのまわりの敵の向きの印の輪（M2 の 65 px の約 1.5 倍）。印は markScale 倍。
  // 画面の端では、印が画面の内に収まるよう輪が同じ中心のまま minRadiusPx まで小さくなる（ui/joystick.js radarRadius）
  controls: {
    longPressSec: 0.18, tapMovePx: 10, tapSlopPx: 14, stickRadiusPx: 56, deadPx: 6,
    keyTwice: { mag: 0.7, release: 0.35, window: 0.35, angleDeg: 30 },
    radar: { radiusPx: 100, minRadiusPx: 65, markScale: 1.3 },
  },
  // R1e（持ち主 16:55「見つかりそうなときに隠れられそうな向きに矢印とLOOK OUT!」）: まだ見つかっていない・隠れられるときに、探す者のライトが
  // もうすぐ届く（spotDist × nearK m の内で、半分の角 spotHalfAngle × angleK の扇の内・見通しあり、または predictSec 秒後の位置から
  // ライトに入る）なら「LOOK OUT!」と、シュッで入れる物陰の向きの矢印（画面の dirs 向きで物陰を探す）。確かめるのは checkEvery 秒ごと。
  // 出ている間は nearK・angleK を holdK 倍に広げて出し続け（ヒステリシス）、最低 minShowSec 秒は出す（見つかった・隠れた・隠れられなくなったら
  // すぐ消す）。矢印は、その向きに払えば同じ物陰（agreeDeg° の内）へ入るものだけ
  // 持ち主 10:02（「隠れるの矢印を押すタイミングがない」。制作側の判断、持ち主が直せる）: 早めに知らせる nearK 1.4 → 1.8・angleK 1.2 → 1.4・
  // predictSec 0.6 → 1.2（道を走る者は次の交差点で曲がる道すじも predictStep m ごとに先読み。lookout.js inDanger）、確かめる checkEvery 0.2 → 0.1 秒、
  // 最低 minShowSec 0.4 → 1.0 秒は出す。見つかった直後も graceSec 秒は矢印を出す（掴まれていない・隠れられるとき）。
  // 今日の街 60 で、その前 1.5 秒見つかっていなかった回の知らせの先は p50 0.40 → 1.23 秒・1.0 秒以上 4% → 93%（Fix round 1 の出荷の値。
  // 待ち時間の間の字だけの LOOK OUT! も含む。scripts/lookout-lead.mjs）。物陰は arrowEvery 秒ごとに選び直す（一番重い所）
  lookout: { nearK: 1.8, angleK: 1.4, predictSec: 1.2, predictStep: 6, checkEvery: 0.1, arrowEvery: 0.3, coverWarnK: 2, coverStep: 2, minShowSec: 1.0, holdK: 1.15, graceSec: 0.8, dirs: 8, agreeDeg: 15, nearBuildings: 80 },
};
