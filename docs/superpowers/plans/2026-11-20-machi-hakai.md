# 街破壊3Dゲーム 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手の中で貯めた力を放ち、主人公を中心に膨らむ球で街ひとつを壊して破壊額を競う、スマホ・PC両対応のブラウザ3Dゲームを作る。

**Architecture:** ゲームの規則（力の器・貯め・時間・得点・軍勢・爆発の広がり・街の生成・カメラ位置の選択）は描画から切り離した純粋なJSモジュールにし、Vitestで検証する。描画はThree.jsで、1つのcanvasをシザーで2画面（上空の街／手のアップ）に分ける。破片は演出として動かすプールが主で、カメラ近くの破片だけcannon-esで物理計算する。

**Tech Stack:** Vite 8, Three.js 0.187, cannon-es 0.20, Vitest 5, Playwright（スクリーンショット確認用）, @webxr-input-profiles/assets 1.0.20（MITライセンスの手のモデル generic-hand）, Web Audio API（音は合成で作り、音声ファイルは使わない）

**Spec:** `docs/superpowers/specs/2026-11-20-machi-hakai-design.md`

## Global Constraints

- 動作基準: 3年ほど前の中くらいの性能のAndroidで安定して30fps以上、PCは60fps。2画面とも毎フレーム描く。
- 主人公は動かない。爆心は常に主人公の位置（ワールド原点 `(0,0,0)`）。
- 制限時間の目安は60秒。1回で街ひとつをまるごと吹き飛ばせる規模にする（最大の一発が街の端まで届く）。
- 力の器はA案: 自然に満ちる／長押しで引き出す／離すと使う／掴まれると減る／0でゲームオーバー。1回で引き出せる量には上限があり、器には必ず少し残る（自滅しない）。
- 一瞬止まる演出と時間停止は、貯めが一定以上の大きな一発だけ。演出中は制限時間を止める。
- 球に触れたものは外へ押し出すのが基本。中心近くだけ光に溶けて消える。遠くへ飛んだ破片は土煙・粉に変わって薄れる。
- 作風は「写実的なアニメ調」。街の人は描かない（避難済み）。軍団は顔がほぼ隠れて目だけ見える装備。
- 元の作品の固有の意匠（登場人物・名前・ロゴ・セリフ・特徴的な衣装や乗り物）は使わない。
- 画面に出る文言はすべて日本語。
- GitHub Pagesに置く。外部への通信はしない（ランキングは作らない）。

## Review Focus

1. **アプリの切り替えや画面ロックで裏に回ったとき**: 時間・器・軍勢がすべて止まり、戻ったら再開する。裏で掴まれ続けてゲームオーバーになってはいけない。→ Task 5 にテストを追加。
2. **スマホで長押ししたとき**: 文字選択・コンテキストメニュー・拡大・スクロールが起きない。2本目の指は無視し、`pointercancel` が来たら「離した」として扱う。→ Task 12 にテストを追加。
3. **一瞬止まる演出の最中の入力**: 演出中に押しても次の貯めは始まらず、演出が終わってから受け付ける。→ Task 5 にテストを追加。
4. **画面の回転・サイズ変更**: 2画面の配置が組み直され、引き伸ばされない。→ Task 7 にテストを追加。
5. **性能が足りない端末**: 平均fpsが基準を2秒下回ったら画質を1段下げる（上げ戻しはしない）。→ Task 6 にテストを追加。

---

## ファイル構成

```
machi-hakai/
  index.html  vite.config.js  package.json
  public/models/hand-right.glb        # Task 10 で npm パッケージからコピー
  scripts/snap.mjs                    # Playwrightでスクリーンショットを撮る
  src/
    main.js                           # 起動・ループ・各モジュールの接続
    config.js                         # 調整用の数値をすべてここに集める
    rng.js                            # シード付き乱数
    game/  reserve.js charge.js timer.js score.js blast.js enemies.js game.js
    world/ cityGen.js fracture.js debris.js nearPhysics.js
    render/ quality.js views.js style.js cityView.js explosionView.js
            handView.js enemyView.js cinematic.js
    input/ press.js
    ui/    format.js hud.js result.js
    audio/ audio.js
  tests/   （src と同じ並びで *.test.js）
```

## 共通の値（`src/config.js`）

Task 1 で作り、以後の数値はすべてここから読む。初期値:

```js
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
```

---

### Task 1: 土台・乱数・力の器・貯め

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/config.js`, `src/rng.js`, `src/game/reserve.js`, `src/game/charge.js`
- Test: `tests/game/reserve.test.js`, `tests/game/charge.test.js`

**Interfaces:**
- Produces:
  - `createRng(seed: number) -> () => number`（0以上1未満。mulberry32）
  - `createReserve(cfg = CONFIG.reserve) -> { value: number, regen(dt), draw(amount) -> number, drain(amount), isEmpty() -> boolean }`
  - `createCharge(reserve, cfg = CONFIG) -> { start(), update(dt), release() -> Shot | null, level() -> number, active: boolean }`
  - `Shot = { amount: number, radius: number, isBig: boolean }`
  - `radiusFor(amount: number, cfg = CONFIG) -> number`

- [ ] **Step 1: 土台を作る**
  （git リポジトリとブランチ `feature/game` は作成済み。`.gitignore` も既存なので追記する。）`npm init -y`、`npm i three@0.187.0 cannon-es@0.20.0`、`npm i -D vite@8 vitest@5 playwright @webxr-input-profiles/assets@1.0.20`。`vite.config.js` は `base: './'`（GitHub Pages用）。`package.json` の scripts: `dev`, `build`, `test: "vitest run"`。`index.html` は `<html lang="ja">`、`<canvas id="game">` を1つ置く。`.gitignore` に `node_modules`, `dist`。

- [ ] **Step 2: 失敗するテストを書く**

```js
// tests/game/reserve.test.js
test('自然に満ちるが max を超えない', () => { const r = createReserve(); r.regen(100); expect(r.value).toBe(100); });
test('draw は minLeft を残す', () => { const r = createReserve(); expect(r.draw(1000)).toBe(55); expect(r.value).toBe(5); });
test('drain は 0 まで減らせる', () => { const r = createReserve(); r.drain(1000); expect(r.value).toBe(0); expect(r.isEmpty()).toBe(true); });
// tests/game/charge.test.js
test('貯めは ratePerSec で引き出し、maxDraw で止まる', () => {
  const r = createReserve({ max:100, start:100, regenPerSec:0, minLeft:5 }); const c = createCharge(r);
  c.start(); c.update(1); expect(r.value).toBe(55); c.update(10); expect(c.release().amount).toBe(90); });
test('貯めは器の minLeft より下を引き出さない', () => { /* start:20 → release().amount === 15 */ });
test('release で active が false になり、2回目は null', () => {});
test('bigShotRatio 以上で isBig', () => { /* amount 31.5 → true, 31 → false */ });
test('radiusFor: 0→min, maxDraw→max, 単調増加', () => {
  expect(radiusFor(0)).toBe(10); expect(radiusFor(90)).toBeCloseTo(440); expect(radiusFor(40)).toBeGreaterThan(radiusFor(20)); });
test('createRng は同じシードで同じ列', () => {});
```

- [ ] **Step 3: 実行して失敗を確認**　Run: `npx vitest run tests/game` → FAIL（モジュールがない）
- [ ] **Step 4: 実装**　`radiusFor = min + (max-min) * (amount/maxDraw)^exponent`。貯めは `update` ごとに `reserve.draw(min(ratePerSec*dt, maxDraw - 現在量))`。
- [ ] **Step 5: 実行して成功を確認**　Run: `npx vitest run tests/game` → PASS
- [ ] **Step 6: コミット**　`git add -A && git commit -m "feat: 土台、力の器と貯め"`

---

### Task 2: 時間・得点・金額表示

**Files:**
- Create: `src/game/timer.js`, `src/game/score.js`, `src/ui/format.js`
- Test: `tests/game/timer.test.js`, `tests/game/score.test.js`, `tests/ui/format.test.js`

**Interfaces:**
- Produces:
  - `createTimer(seconds) -> { update(dt), pause(), resume(), remaining: number, isOver() -> boolean, paused: boolean }`
  - `createScore(cfg = CONFIG.score) -> { addShot(values: number[]) -> number, total: number }`
  - `formatYen(n: number) -> string`

- [ ] **Step 1: 失敗するテストを書く**

```js
test('pause 中は減らない', () => { const t = createTimer(60); t.pause(); t.update(5); expect(t.remaining).toBe(60); t.resume(); t.update(5); expect(t.remaining).toBe(55); });
test('0 未満にならず isOver', () => { const t = createTimer(1); t.update(3); expect(t.remaining).toBe(0); expect(t.isOver()).toBe(true); });
test('一発で多く壊すほど倍率', () => { const s = createScore(); expect(s.addShot([100])).toBe(100); expect(s.addShot([100,100,100])).toBeCloseTo(300*1.2); });
test('倍率は comboMax で頭打ち', () => { const s = createScore(); expect(s.addShot(Array(100).fill(1))).toBeCloseTo(300); });
test('formatYen', () => { expect(formatYen(9800)).toBe('¥9,800'); expect(formatYen(32_000_000)).toBe('¥3,200万'); expect(formatYen(320_000_000)).toBe('¥3.2億'); expect(formatYen(1.5e12)).toBe('¥1.5兆'); });
```

- [ ] **Step 2: 失敗を確認**　Run: `npx vitest run tests/game/timer.test.js tests/game/score.test.js tests/ui` → FAIL
- [ ] **Step 3: 実装**　倍率は `min(1 + comboStep*(n-1), comboMax)`。`formatYen` は 1万未満そのまま、1億未満は「万」で整数、1兆未満は「億」で小数1桁（末尾の .0 は消す）、それ以上は「兆」で小数1桁。
- [ ] **Step 4: 成功を確認**　同じコマンドで PASS
- [ ] **Step 5: コミット**　`git commit -am "feat: 時間・得点・金額表示"`（新規ファイルは `git add` してから）

---

### Task 3: 街の生成とビルの分割

**Files:**
- Create: `src/world/cityGen.js`, `src/world/fracture.js`
- Test: `tests/world/cityGen.test.js`, `tests/world/fracture.test.js`

**Interfaces:**
- Consumes: `createRng`
- Produces:
  - `generateCity(seed: number, cfg = CONFIG) -> { buildings: Building[], props: Prop[] }`
  - `Building = { id: number, x: number, z: number, w: number, d: number, h: number, dist: number, value: number, kind: 'tower'|'office'|'house' }`
  - `Prop = { id: number, x: number, z: number, dist: number, value: number, kind: 'car'|'lamp'|'sign' }`
  - `fractureBox(size: {w,h,d}, pieces: number, seed: number) -> Chunk[]`
  - `Chunk = { min: [x,y,z], max: [x,y,z] }`（ビルのローカル座標、底面中心が原点）

- [ ] **Step 1: 失敗するテストを書く**

```js
test('同じシードで同じ街', () => expect(generateCity(1)).toEqual(generateCity(1)));
test('建物は広場の外、街の半径の内', () => { for (const b of generateCity(1).buildings) { expect(b.dist).toBeGreaterThan(12 + Math.max(b.w,b.d)/2); expect(b.dist).toBeLessThanOrEqual(420); } });
test('建物どうしが重ならない', () => {});
test('建物数は 400〜900、外側ほど低くなる傾向', () => { /* 内側1/3の平均 h > 外側1/3の平均 h */ });
test('value は h*w*d に比例し tower が最も高い', () => {});
test('fractureBox: 個数と体積が保たれる', () => { const c = fractureBox({w:10,h:40,d:10}, 24, 3); expect(c.length).toBe(24); expect(vol(c)).toBeCloseTo(4000); });
test('fractureBox: 破片はすべて元の箱の内側', () => {});
```

- [ ] **Step 2: 失敗を確認**　Run: `npx vitest run tests/world` → FAIL
- [ ] **Step 3: 実装**　街は格子状の道路区画（区画18m・道路8m）に、中心から外へ向かって高さが下がるビルを置く。区画にランダムなずれを入れて格子感を弱める。props は道路沿いに置く。`fractureBox` は最も長い軸を乱数の位置（30〜70%）で割る再帰分割で、`pieces` 個になるまで一番大きい箱を割る。
- [ ] **Step 4: 成功を確認**　Run: `npx vitest run tests/world` → PASS
- [ ] **Step 5: コミット**

---

### Task 4: 爆発の広がりと軍勢の規則

**Files:**
- Create: `src/game/blast.js`, `src/game/enemies.js`
- Test: `tests/game/blast.test.js`, `tests/game/enemies.test.js`

**Interfaces:**
- Consumes: `Shot`, `Building`, `Prop`, `createRng`
- Produces:
  - `createBlast(shot: Shot, targets: {id, dist}[], cfg = CONFIG) -> { update(dt) -> Hit[], front: number, done: boolean }`
  - `Hit = { id: number, kind: 'vaporize'|'push' }`
  - `createEnemies(rng, cfg = CONFIG) -> { list: Enemy[], update(dt) -> number /* 掴んでいる数 */, applyBlastFront(front: number) -> number /* 倒した数 */ }`
  - `Enemy = { id, angle, dist, state: 'approach'|'grab'|'dead' }`

- [ ] **Step 1: 失敗するテストを書く**

```js
test('front は speed で広がり shot.radius で止まって done', () => {});
test('各対象は front が dist を越えた更新で一度だけ Hit になる', () => {});
test('dist < radius*vaporizeRatio は vaporize、それ以外は push', () => {});
test('radius より遠い対象は Hit にならない', () => {});
test('軍勢は spawnPerSec で spawnDist の範囲（中心から60〜90m）に湧き、speed で近づく', () => {});
test('grabRange に入ると grab になり、update が掴んでいる数を返す（最大 maxGrabbing）', () => {});
test('applyBlastFront: front 内の軍勢は dead、掴んでいた者も外れる', () => {});
```

- [ ] **Step 2: 失敗を確認**　Run: `npx vitest run tests/game/blast.test.js tests/game/enemies.test.js` → FAIL
- [ ] **Step 3: 実装**　`blast` は対象を dist の昇順に並べ、カーソルを進めるだけにする（毎フレーム全件は見ない）。
- [ ] **Step 4: 成功を確認** → PASS
- [ ] **Step 5: コミット**

---

### Task 5: ゲーム全体の進行

**Files:**
- Create: `src/game/game.js`
- Test: `tests/game/game.test.js`

**Interfaces:**
- Consumes: Task 1〜4 のすべて
- Produces:
  - `createGame({ seed, cfg = CONFIG }) -> Game`
  - `Game = { city, enemies, reserve, charge, timer, score, phase: 'ready'|'playing'|'cinematic'|'over', update(dt), pressStart(), pressEnd(), setHidden(hidden: boolean), on(event, fn) }`
  - イベント: `'shot' (Shot)`, `'cinematicStart' (Shot)`, `'cinematicEnd'`, `'hit' ({ hit: Hit, target: Building|Prop })`, `'shotScored' ({ added: number, total: number })`, `'over' ({ reason: 'time'|'drained', total: number })`

- [ ] **Step 1: 失敗するテストを書く**

```js
test('小さな一発は cinematic を経ずにすぐ blast が始まる', () => {});
test('大きな一発は cinematic になり、freezeSec の間タイマーが止まり、その後 blast', () => {});
test('cinematic 中の pressStart は無視される', () => {});                       // Review Focus 3
test('blast が終わった時点で、その一発の Hit の value を addShot して shotScored', () => {});
test('掴まれている数 × drainPerSec で器が減り、0 で over(drained)', () => {});
test('時間切れで over(time)、blast 中なら終わってから over', () => {});
test('setHidden(true) の間は update(dt) で何も進まない', () => {             // Review Focus 1
  const g = createGame({ seed: 1 }); g.pressStart(); g.setHidden(true); const t = g.timer.remaining, v = g.reserve.value;
  g.update(30); expect(g.timer.remaining).toBe(t); expect(g.reserve.value).toBe(v); });
test('over の後は pressStart も update も何もしない', () => {});
```

- [ ] **Step 2: 失敗を確認** → FAIL
- [ ] **Step 3: 実装**　`update` 内の順序は「器の回復 → 貯め → 軍勢 → 掴みによる減少 → blast → タイマー → 終了判定」。最初の `pressStart` で `ready` から `playing` に移る。
- [ ] **Step 4: 成功を確認** → PASS
- [ ] **Step 5: コミット**

---

### Task 6: 画質の段階と自動調整

**Files:**
- Create: `src/render/quality.js`
- Test: `tests/render/quality.test.js`

**Interfaces:**
- Produces:
  - `TIERS = { high: {...}, mid: {...}, low: {...} }`。各段は `{ pixelRatioMax, debrisMax, nearPhysicsMax, piecesPerBuilding, dustMax, bloom, heatHaze, shadows }`
  - 値: high `{2, 6000, 400, 24, 3000, true, true, true}` / mid `{1.5, 2500, 120, 12, 1200, true, false, false}` / low `{1, 800, 40, 6, 400, false, false, false}`
  - `pickTier({ isMobile: boolean, deviceMemory?: number, cores?: number }) -> 'high'|'mid'|'low'`
  - `createFpsGovernor({ target: number, holdSec = 2 }) -> { sample(dt) -> 'down' | null }`

- [ ] **Step 1: 失敗するテストを書く**

```js
test('PC は high、スマホは mid、メモリ4GB未満のスマホは low', () => {});
test('平均fpsが target を2秒下回ると down を一度返し、また2秒たつまで返さない', () => {}); // Review Focus 5
test('一瞬落ちただけでは down を返さない', () => {});
```

- [ ] **Step 2〜4: 失敗確認 → 実装 → 成功確認**　Run: `npx vitest run tests/render`
- [ ] **Step 5: コミット**

---

### Task 7: 2画面の描画・作風・街の見た目

**Files:**
- Create: `src/render/views.js`, `src/render/style.js`, `src/render/cityView.js`, `src/main.js`, `scripts/snap.mjs`
- Test: `tests/render/views.test.js`

**Interfaces:**
- Consumes: `createGame`, `TIERS`, `pickTier`
- Produces:
  - `layoutViews(width: number, height: number) -> { city: Rect, hand: Rect, hud: Rect }`（`Rect = {x,y,w,h}`、WebGL の左下原点）
  - `createViews(renderer) -> { cityCamera, handCamera, resize(w,h), render(cityScene, handScene) }`
  - `createStyle(tier) -> { building(kind) -> Material, ground: Material, sky: Object3D, lights: Object3D[] }`
  - `createCityView(city, style, tier) -> { group: Object3D, getBuildingMesh(id), hideBuilding(id) }`
  - `scripts/snap.mjs <url> <out.png> [--wait ms] [--press ms]`：Playwright（`executablePath: '/usr/bin/google-chrome'`、ヘッドレス、`--use-gl=angle --use-angle=swiftshader`）でページを開き、指定時間長押ししてからスクリーンショットを撮る

- [ ] **Step 1: 失敗するテストを書く**

```js
test('縦長: 街が上 65%、下を手と HUD で左右に分ける', () => { const l = layoutViews(390, 844); expect(l.city.h).toBeCloseTo(844*0.65, 0); expect(l.hand.w + l.hud.w).toBe(390); });
test('横長: 街が左 70%、右列の上が手で下が HUD', () => {});
test('どの大きさでも3つの Rect は重ならず画面を埋める', () => {});        // Review Focus 4
```

- [ ] **Step 2: 失敗を確認** → FAIL
- [ ] **Step 3: `layoutViews` と `createViews` を実装**　1つの `WebGLRenderer` で `setScissorTest(true)` と `setViewport` を使い、2画面を描く。`resize` は `window` の `resize` と `orientationchange` の両方から呼ぶ。
- [ ] **Step 4: 成功を確認** → PASS
- [ ] **Step 5: 作風と街の見た目を実装**　「写実的なアニメ調」の決め方:
  - 夕方の空のグラデーションと、強い一方向の太陽光。影は濃く、輪郭がはっきりした色にする。
  - ビルは `MeshStandardMaterial` の `onBeforeCompile` で、光の当たり具合を3段に量子化しつつ、なめらかさを少し残す。窓の格子はシェーダーで描き、ガラスはわずかに空を映す。
  - 縁取り線は、低画質では使わない。高画質では法線を使った背面描画で細く出す。
  - ビルは種類ごとに `InstancedMesh` で描き、壊れたビルはインスタンスの拡大率を0にして隠す。
  上空カメラは主人公の斜め上（高さ約120m、距離約160m）から街の中心を見下ろす。
- [ ] **Step 6: 目で確認**　Run: `npm run dev -- --port 5173 &` と `node scripts/snap.mjs http://localhost:5173 /tmp/t7.png --wait 2000` → `/tmp/t7.png` を Read で開き、次の3点を確かめる: 上空から街が見えること、2画面に分かれていること、アニメ調の陰影になっていること。同じ確認を幅390×高さ844と1280×720の両方で行う。
- [ ] **Step 7: コミット**

---

### Task 8: 破片（演出の動き＋手前だけ物理）

**Files:**
- Create: `src/world/debris.js`, `src/world/nearPhysics.js`
- Modify: `src/main.js`（`'hit'` を破片につなぐ）、`src/render/cityView.js`
- Test: `tests/world/debris.test.js`, `tests/world/nearPhysics.test.js`

**Interfaces:**
- Consumes: `fractureBox`, `Hit`, `TIERS`
- Produces:
  - `createDebrisPool(capacity: number, rng) -> { spawn(p: {pos:[x,y,z], vel:[x,y,z], size:number}) , update(dt) -> DustEvent[], count: number }`
  - `DustEvent = { pos:[x,y,z], size:number }`（破片が粉に変わった地点）
  - `createNearPhysics(budget: number) -> { add(chunkWorldBox, vel) -> boolean, step(dt), bodies: Body[] }`
  - `pushVelocity(chunkCenter:[x,y,z], blastFront:number, rng) -> [x,y,z]`

- [ ] **Step 1: 失敗するテストを書く**

```js
test('capacity を超えると一番古い破片から置き換える', () => {});
test('破片は重力で落ち、地面 y=0 で止まって弾む', () => {});
test('一定の距離か時間を過ぎた破片は DustEvent を出して消える', () => {});
test('pushVelocity は中心から外向き、上向き成分を持つ', () => {});
test('nearPhysics.add は budget を超えると false', () => {});
```

- [ ] **Step 2〜4: 失敗確認 → 実装 → 成功確認**
- [ ] **Step 5: つなぐ**　`hit.kind === 'push'` のときはビルを隠し、`fractureBox(piecesPerBuilding)` の破片をプールに出す。カメラから60m以内の破片は `nearPhysics` に回し、空きがなければプールに回す。`'vaporize'` は Task 9 で溶ける演出にする（ここでは隠すだけ）。プールの描画は `InstancedMesh` を1つ使う。
- [ ] **Step 6: 目で確認**　`snap.mjs --press 2500 --wait 3000` で、ビルが外向きに崩れていることを確かめる。
- [ ] **Step 7: コミット**

---

### Task 9: 爆発の見た目

**Files:**
- Create: `src/render/explosionView.js`
- Modify: `src/main.js`, `src/render/views.js`（画面効果）

**Interfaces:**
- Consumes: `game.on('shot')`, `blast.front`, `DustEvent`, `TIERS`
- Produces: `createExplosionView(scene, tier) -> { begin(shot), update(dt, front), dust(events: DustEvent[]), vaporize(target), busy: boolean }`

- [ ] **Step 1: 実装**　見た目の要素:
  - 光の球: 白い芯から外側の色へのグラデーション。表面は時間で揺らぐノイズ。表面の帯だけ明るくする。
  - 衝撃波: 地面を走るリング状のゆがみと、舞い上がる土煙の輪。
  - 光のにじみ（UnrealBloomPass、high/mid のみ）。熱による空気のゆがみ（画面のゆがみパス、high のみ）。
  - 放つ瞬間の白い閃光。画面の揺れは front の速さに比例させる。
  - 溶ける演出: `vaporize` の対象は、端から光る粒に変わってほどける（ディゾルブ）。
  - 粉: `DustEvent` を、数が上限 `dustMax` までの、ふくらんで薄れる粒にする。
- [ ] **Step 2: 目で確認**　小さな一発（`--press 300`）と最大の一発（`--press 2500`）の両方を、放ってから 0.3 / 1.0 / 2.5 秒後に撮る。次の3点を確かめる: 球の表面がビルを飲み込んでいること、中心付近が溶けていること、遠くの破片が粉になっていること。
- [ ] **Step 3: 性能確認**　`snap.mjs` にフレーム時間の計測を加え、最大の一発の間の平均フレーム時間を出す。CPU を4倍遅くした設定（CDP の `Emulation.setCPUThrottlingRate`）と幅390で、mid段が33ms以下に収まることを確かめる。
- [ ] **Step 4: コミット**

---

### Task 10: 手と、手の中の力

**Files:**
- Create: `src/render/handView.js`, `public/models/hand-right.glb`
- Modify: `src/main.js`
- Test: `tests/render/handPose.test.js`

**Interfaces:**
- Consumes: `charge.level()`, `charge.active`, `game.on('shot')`
- Produces:
  - `poseFor(level: number, t: number) -> Record<jointName, [rx, ry, rz]>`（WebXR の関節名。例: `'index-finger-phalanx-proximal'`）
  - `createHandView(gltf, tier) -> { scene, camera, update(dt, level, active), release(shot) }`

- [ ] **Step 1: 手のモデルを用意**　`cp node_modules/@webxr-input-profiles/assets/dist/profiles/generic-hand/right.glb public/models/hand-right.glb`。MITライセンスの表記を `public/models/LICENSE-hand.txt` に置く。
- [ ] **Step 2: 失敗するテストを書く**

```js
test('level 0 は軽く開いた手、1 は指が強く曲がりこわばる', () => { /* 人差し指の近位関節の曲がりが 0 < 1 */ });
test('level 0.8 以上で震えの振れ幅が出て、t で変化する', () => {});
test('どの level でも関節の角度は自然な範囲（曲げ 0〜100°）に収まる', () => {});
```

- [ ] **Step 3〜5: 失敗確認 → `poseFor` を実装 → 成功確認**
- [ ] **Step 6: 見た目を実装**　手の肌は Task 7 と同じ3段の陰影に、縁の光（リムライト）を足す。力の球は手のひらの上に置き、`level` に合わせて大きさ・明るさ・揺らぎを増やす。指のすき間から光が漏れるように、手に球の色を照り返す点光源を置く。0.8を超えたら手全体を震わせ、光をちらつかせる。器が少ないときは光を弱く不安定にする（限界の知らせ）。放つ瞬間は、指が一気に開いて閃光が出る。
- [ ] **Step 7: 目で確認**　level 0 / 0.5 / 0.9 の3つを撮り、手の構えと光の違いがひと目でわかることを確かめる。
- [ ] **Step 8: コミット**

---

### Task 11: 軍勢の見た目・放つ瞬間のカメラ・目が映る一拍

**Files:**
- Create: `src/render/enemyView.js`, `src/render/cinematic.js`
- Modify: `src/main.js`
- Test: `tests/render/cinematic.test.js`

**Interfaces:**
- Consumes: `Enemy`, `Building`, `Shot`, `createRng`, `game.on('cinematicStart' | 'cinematicEnd')`
- Produces:
  - `chooseShot({ shot, buildings, enemies, rng }) -> { camPos:[x,y,z], lookAt:[x,y,z], reflector: { type:'glass'|'visor'|'puddle', enemyId:number|null, pos:[x,y,z] } }`
  - `createCinematic(views, enemyView, explosionView) -> { play(plan, shot), update(dt), active: boolean }`
  - `createEnemyView(scene, tier) -> { sync(enemies: Enemy[]), eyeCloseup(enemyId) -> Object3D }`

- [ ] **Step 1: 失敗するテストを書く**

```js
test('カメラは front が届く途中のビル（radius の 0.4〜0.7）を画面に入れる位置にある', () => {});
test('カメラは地面より上、街の半径の内側', () => {});
test('近くに生きた軍勢がいれば reflector.enemyId はその一人、いなければ null で type は glass', () => {});
test('同じシードで同じ結果、シードを変えると type や角度が変わる', () => {});
```

- [ ] **Step 2〜4: 失敗確認 → `chooseShot` を実装 → 成功確認**
- [ ] **Step 5: 軍勢の見た目**　揃いの暗い装備で、顔はヘルメットと覆面でほぼ隠し、目の部分だけ開ける。目は光を受けて光るようにする。人数が多いので `InstancedMesh` で描き、歩く動きは頂点シェーダーで揺らす。掴んでいる者は主人公にしがみつく姿勢にする。
- [ ] **Step 6: 演出の流れを実装**　`cinematicStart` の時間 `freezeSec` を次のように使う。
  1. 0〜0.25秒: カメラが手から `camPos` へ飛ぶ。
  2. 0.25〜0.4秒: 小さく弾け、ガラス片が手前へ飛んでくる。
  3. 0.4〜1.0秒（`eyeBeatSec`）: ほぼ止まった時間の中で、ガラス（またはバイザー・水たまり）に軍団の一人の目が映る。映り込みは `eyeCloseup` を別の小さなレンダーターゲットに描き、それをガラス片の表面に貼る。音は無音。
  4. 1.0〜1.4秒: 本爆発が広がり始め、カメラは少し引く。
  `cinematicEnd` で上空カメラに戻す。
- [ ] **Step 7: 目で確認**　大きな一発の演出を 0.2 / 0.6 / 1.2 秒で撮る。次の3点を確かめる: 目が映っていること、ビルが飲み込まれる瞬間が画面に大きく入っていること、シードを変えると構図が変わること。
- [ ] **Step 8: コミット**

---

### Task 12: 入力・HUD・結果と共有・音

**Files:**
- Create: `src/input/press.js`, `src/ui/hud.js`, `src/ui/result.js`, `src/audio/audio.js`
- Modify: `src/main.js`, `index.html`（CSS）
- Test: `tests/input/press.test.js`, `tests/ui/result.test.js`

**Interfaces:**
- Consumes: `Game`, `formatYen`
- Produces:
  - `createPressTracker({ onStart, onEnd }) -> { down(pointerId), up(pointerId), cancel(pointerId) }`
  - `shareText(total: number) -> string`
  - `createHud(root) -> { update({ total, remaining, reserve, max }) }`
  - `createResult(root, { onRetry }) -> { show(total, reason) }`
  - `createAudio() -> { unlock(), chargeHum(level), releaseSilence(sec), boom(size), crumble(count) }`

- [ ] **Step 1: 失敗するテストを書く**

```js
test('最初の指だけ有効、2本目の down/up は無視', () => {});                     // Review Focus 2
test('cancel は up と同じく onEnd を一度呼ぶ', () => {});                       // Review Focus 2
test('shareText は金額と遊ぶ場所のURLを含む日本語', () => { expect(shareText(3.2e8)).toMatch(/¥3\.2億/); });
```

- [ ] **Step 2〜4: 失敗確認 → 実装 → 成功確認**
- [ ] **Step 5: 画面側をつなぐ**
  - canvas と HUD に `touch-action: none; user-select: none; -webkit-touch-callout: none;` を指定し、`contextmenu` は `preventDefault` する（Review Focus 2）。
  - `visibilitychange` を `game.setHidden` と音の一時停止につなぐ（Review Focus 1）。
  - HUD には破壊額、残り時間、器の量を表示する。器は手の画面の横に細い縦の帯で示す。
  - 開始画面は「長押しで力を貯め、離して放て」の一行だけにする。
  - 結果画面には破壊額と終わった理由（「時間切れ」または「力を奪われた」）を出す。「もう一度」と「共有」のボタンを置く。共有は `navigator.share` を使い、使えない端末ではXの投稿画面のURLを開く。
- [ ] **Step 6: 音を実装**　音はWeb Audioで合成する。
  - 貯めの唸り: 低い正弦波にうなりを足し、level に合わせて音程と大きさを上げる。
  - 放つ瞬間: 0.3秒の無音。大きな一発では目が映る一拍の間も無音にする。
  - 爆発: ノイズに低域のフィルタをかけ、大きさで長さを変える。
  - 崩落: 短いノイズの粒を、壊れた数に応じて重ねる。
  最初の `pointerdown` で `unlock()` を呼ぶ。
- [ ] **Step 7: 通しで遊んで確認**　`snap.mjs` で開始 → 長押し → 放つ → 時間切れまでを流し、結果画面の金額が HUD の最後の金額と一致することを確かめる。
- [ ] **Step 8: コミット**

---

### Task 13: 公開と最終確認

**Files:**
- Create: `.github/workflows/pages.yml`, `README.md`
- Modify: `index.html`（タイトル・OGP）

- [ ] **Step 1: 全テスト**　Run: `npx vitest run` → すべて PASS
- [ ] **Step 2: ビルド**　Run: `npm run build` → `dist/` ができ、`npx vite preview` で起動したページを `snap.mjs` で撮ると、Task 12 の通しと同じ画面になる。
- [ ] **Step 3: 性能の最終確認**　Task 9 Step 3 の計測を通しのプレイで行い、mid段（幅390・CPU 4倍遅く）で平均33ms以下、high段（1280×720）で平均16.7ms以下であることを確かめる。
- [ ] **Step 4: 公開の準備**　`pages.yml` は main への push で `npm ci && npm run build` を実行し、`dist` を Pages に出す。リポジトリ名と公開の実行は持ち主に確認してから行う。
- [ ] **Step 5: コミット**
