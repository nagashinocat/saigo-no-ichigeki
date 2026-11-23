# 最後の一撃 — Round 5: ゲーム性と共有 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add every gameplay-depth and share feature the owner approved on 2026-11-21 at 21:05.
**Spec:** docs/superpowers/specs/2026-11-20-machi-hakai-design.md §15 (binding), plus all earlier owner bullets.

## Global Constraints
- Portrait 390×844 primary; mid Android 30 fps; original content only; existing tests not weakened.
- Balance (owner 22:15 + controller ruling): best play reaches full at p50 ≈ 54 s (52–56, over runs that reach full); best-play clear rate 90–95% in each of the three periods (2026-07, 2026-11, 2027-03; 120 days each) under the BEST release policy (any charge level), and hide-only (no 払う) clear 20–30% as the path to rank S (owner 「間をとる」); the 払う-all-3-never-hide policy clears at least 40%, aiming for 50% (owner 10:06 + controller ruling); following the LOOK OUT! arrow clears at least as often as 払う-no-hide; no-払う never reaches full; a max charge always clears (bosses included).
- Sound follows the screen (owner 13:06). Text beats carry no SFX.
- Static hosting only (GitHub Pages), with no server.
- Title 「最後の一撃」; the score label is 「被害額」.

## Tasks (in order)

### R0: 難しく・止まらない軍勢（持ち主 22:15、最優先）
Files: src/game/enemies.js, config.js, render/enemyView.js / bikePose.js, scripts/balance-sim.mjs, tests.
- **Faster and converging harder.**
  - Raise search, chase and approach speeds again.
  - Spot from farther away so more riders converge at once.
  - Patrols near the plaza join the hunt in the last 20 s.
  - Keep the late surge.
- **New balance target (controller ruling, owner may adjust):**
  - Best-play full charge at p50 ≈ 54 s (52–56).
  - Best-play clear rate 70–80% (it must be possible to fail even when playing well).
  - No-払う reaches full 0/30.
  - Max charge still always clears.
  - Report the numbers.
- **Never looks stopped in front of the hero.**
  - Remove the spot glare pause entirely; spotting goes straight into the charge.
  - No braking until contact (only the last ~0.5 m).
  - Grabbing riders latch on and keep moving: a tight, jittery orbit and tug around the hero while draining, with their bikes leaning hard and thrust flaring.
  - Riders on full slots swarm and orbit outside the grabbers, never parking.
  - Diagnose the owner's "まだ主人公前で止まる感じ" by recording frame sequences of the approach and the grab from the overhead view, and find every place where speed drops near the hero (spot pause, brake, cling, grab, unpile).
  - Test: the speed of every non-dead rider within 25 m of the hero stays ≥ 6 m/s in every frame (grabbing riders included, via the orbit).
- **Shots:** approach, mass converge, grab swarm (overhead, frame sequence).

### R0b: ガラスの一拍をやめ、遠くの軍勢の後ろから一気に飲まれる（持ち主 22:15）
Files: src/render/cinematic.js, cinematicProps.js, finalePlan.js, finaleTimeline.js, enemyView setFocus/riderBody use, audio cues, tests.
- **Remove the glass beat entirely:** the over-the-shoulder near rider, the eye glass, the extreme slow-mo and the heartbeat-only beat. Delete the now-dead code (glass and eye props) or leave it unused, as long as tests are updated honestly.
- **New beat after the white.** The camera is placed behind a group of distant riders, ideally outer patrols several hundred metres from ground zero, in the street or on a rooftop line. It looks toward the far-off explosion, which glows on the horizon at the hero's position.
  - The blast erupts in the distance.
  - The light wall races across the city toward the camera, swallowing buildings, the expressway and the trains.
  - It engulfs these riders from behind them in one sweep: a silhouette against the wall, then blown away.
  - The camera is engulfed, and the cut goes into the existing chase/showcase/space flow.
  - Owner 22:18: from the blast's start, through its first slight swelling, time runs in SLOW MOTION (the creep, seen far away from behind the riders). Then it BURSTS into the huge explosion and time snaps to full speed, and the wall races in and engulfs them in one sweep (一気に). Keep the existing creep → burst → showcase front curve; the slow-mo applies to the creep and early swell only.
  - The focus rider body (riderBody) can be reused for the nearest rider in frame.
- **Timeline:** finaleTimeline is reworked accordingly; total length stays ≤ the current length + 0.5 s. finaleGameSync must hold at 60/30/20 fps.
- **Audio:** the boom opens when the blast erupts. The distant rumble arrives, then the roar as the wall hits. Sound tracks the screen (owner 13:06).
- **Debris sound after the replay (owner 23:01).** Today a thin crackling 「チリチリ」 sound plays after the blast replay. Turn it into real, weighty rubble collapse sound:
  - concrete chunks falling and settling
  - slabs crumbling
  - deep thuds and grinding
  - scattered glass and metal on top
  - Drive it from on-screen collapse/settle events (sound tracks the screen), panned and distance-attenuated, and rate-capped through the existing collapseGate.
  - Find what the 「チリチリ」 actually is (likely high-passed debris voices, or settle hits with too little low end) and fix it at its source.
  - It must also sound right in the live finale aftermath.
  - Keep the limiter headroom.
- **Pull the wide shots back (owner 23:01).** Every shot meant to show the whole explosion — the showcase wide, the replay's wide or overview cut, and the aftermath — pulls back further so the whole sphere and crater, plus the city edge, sit comfortably in the portrait frame with margin. Check this at 390×844 and in landscape.
- **Spot selection (finalePlan):** pick the riders, which must exist (fall back to a patrol), and a camera spot with a clear line of sight to ground zero. Test the selection.
- **Pacing everywhere (owner 22:18):** today the finale and the replay read as 「初めから早い → ちょっと止まる → 早い」 (fast at start, a stall, fast again), and that is wrong. Every presentation must follow ONE pacing: slow-mo creep and swell at the start → burst → full speed. This covers the live finale, the replay cuts (the replay timeline and replayPlan) and the clip recorder later. There must be no mid-sequence freeze or stall: remove the old near-stopped beat (slowRate 0.012) and anything that looks like a pause. Add a test that the visual time-scale is monotonic non-decreasing from the start of the blast to the burst, and does not dip after the burst, for both the finale and the replay timelines. Record a frame sequence of the replay to prove it.
- **Shots:** the new beat at several times, plus the transition into the chase.


### M1: 主人公が動く・ジョイスティック・爆心が主人公の位置（持ち主 09:11、§16）
Files: the input layer (a new src/ui/joystick.js and controls), src/game/game.js (hero position and velocity, collision against building footprints, slowdown while grabbed), src/main.js, src/render/views.js (overhead camera follow), and every place that assumes ground zero at the origin.
- **Controls (§16, owner 09:15):** no fixed left/right zones.
  - **First pointer** (anywhere): hold to charge, release to fire.
  - **A second pointer while charging:**
    - long-press (≥ about 0.18 s) → a floating joystick appears at that point; drag to move; it disappears on lift.
    - short tap (< about 0.18 s, < 10 px movement) → 払う.
  - With no first pointer down, nothing moves. The first touch always starts charging.
  - **PC:** arrows/WASD to move, mouse hold to charge and release to fire, Space or right-click for 払う.
  - Intro and title input rules stay (TAP, TAP START, queued-tap guard).
  - Show a visible stick ring and knob; keep it cheap.
  - **Edge cases to test:**
    - the charging pointer lifting while the stick is held (the shot fires; the stick is cancelled)
    - pointercancel
    - a third finger (ignored)
    - the stick finger lifting (it must never fire)
- **Hero motion:**
  - Floats along streets and plazas at about 10–12 m/s, with smooth acceleration.
  - Collides against building footprints, sliding along walls. It may not leave the city.
  - Each grabber slows it by about 20% (floor 40%).
  - The hero body faces the move direction and leans.
- **Camera:** the overhead camera follows the hero smoothly, keeping it centred, at the same framing distance as now.
- **Ground zero = the hero's position at release.** Everything below must take a centre point, not assume the origin:
  - blast, crater and sphereDeform (JS and GLSL)
  - cityView crush/veil
  - explosionView
  - finalePlan (beat spot search around the release point)
  - finaleTimeline radii
  - cinematic, spaceView and replay* (snapshot includes the centre)
  - S9 outcome (distance from the release point)
  - patrolGlow
  - maxEnemyReach semantics: a max-charge clear is guaranteed only near the city centre
  - the results aftermath
  
  Add a test that the blast at an off-centre point kills exactly the riders within radius of that point. Test the JS and GLSL crater formulas for parity with a non-zero centre.
- **HUD:** 「中心まで ◯ m」 plus a small arrow to the city centre.
- **Balance:** `scripts/balance-sim.mjs` needs a movement policy. Use a reasonable bot: drift toward the centre, sidestep incoming chargers, and use 払う when grabbed. Report the numbers; the deep retune happens in M2.
- **Tests:** joystick logic (tap vs drag, pointer ids, multi-touch with the charge thumb), collision, camera follow, off-centre blast/crater/outcome, and replay determinism with movement.

### M2: 敵のライトと知らせ・払う 3 回・釣り合い（§16）
Files: src/game/enemies.js, config.js, game.js, render/enemyView.js (headlight cones), the HUD, balance tooling.
- **Headlight spotting:** a forward cone that is wider than now, with a longer reach, and requires line of sight. Draw the cone on the ground as a soft light wedge, visible from the overhead view and cheap.
- **Alert propagation:**
  - When a rider spots the hero it flashes and calls nearby riders: those within about 120 m switch to hunt, and they relay.
  - The horde converges more and more while the hero stays seen.
  - Once sight is lost, riders sweep the last known position.
  - Patrols take part too.
- **払う:**
  - 3 uses per game, shown as 3 pips near the stick.
  - Each use costs some power (start around 4–5%; tune it).
  - When no uses remain, a stick tap shows 「もう払えない」.
- **Balance targets (§16):**
  - best-play full charge at p50 about 54 s, over the runs that reach full
  - best-policy clear rate 70–80%
  - no-払う never reaches full
  - a max charge near the centre always clears
  
  Add a policy that releases far from the centre and confirm it is worse.
- **Carried over from the R1 review:**
  - **Type readability overhead is an acceptance criterion.** Add non-colour cues: a pulsing ground ring for drainers (about 2 Hz, at least 8 px on screen), a thicker trail plus a double-edged marker for heavies, and marker inner shapes per type.
  - **Revisit HP against the 3-use 払う budget.** Boss hp 3 and heavy hp 2 would need every 払う. Decide whether to lower hp, or to count a stagger as one 払う use, and state the rule in the HUD and how-to text.
  - **Restore the 「早く払うほうが早く満タン」 balance test** to its original median comparison, or add a continuous metric such as 60 s power or grabbed person-seconds. Remove the TODO.
- **Shots:** spotted → alert spreading → converge; headlight cones overhead; 払う pips; 「もう払えない」.

### R1: 払うの腕前 + 軍勢の種類
Files: src/game/enemies.js, game.js, config.js, render/enemyView.js (+bikePose/hoverBike for looks), audio for the hits, scripts/balance-sim.mjs, tests.

**払う combo**
- A 払う that hits k ≥ 3 enemies refunds power: +1.5 per enemy beyond 2, capped at +6.
- Show a 「×k」 combo popup at the blast.
- Play a distinct, screen-tied sound on the combo.

**Heavy rider**
- Needs 2 払う to dislodge. The first 払う staggers it back. Slower (×0.8).
- Bulkier bike silhouette, amber trim.
- About 15% of hunters after 20 s.

**Drainer**
- Drain ×2.5 while grabbing.
- Red-violet thrust glow, distinct from the bike green.
- About 15% of hunters after 30 s.

**Boss**
- Exactly one, at about 48–50 s.
- Arrives with a visual and sound announcement: a bigger rider and a bike with a searchlight.
- Needs 3 払う. Drain ×4 while grabbing.
- Counts toward the clear. A max charge reaches it.

**Balance**
- Re-tune spawn, drain and costs so that best play reaches full at p50 48–52 s and the no-払う play gets 0/30.
- Report clear rates by charge level.

**Tests**
- combo refund
- heavy 2-hit
- drainer rate
- boss spawn time, count, 3-hit, and inclusion in the clear
- balance

**Shots**
- each type close-up
- the combo popup
- the boss arrival

### R2: 届く範囲の輪 + ギリギリのボーナス + ランク
Files: src/render (an overhead ring overlay), src/ui HUD, src/game/score.js and outcome, result.js, tests.

**Reach ring**
- A thin ring on the ground at radiusFor(power) around the hero, drawn in the overhead view only.
- It pulses when it crosses an enemy.
- When the ring is off-screen, show an edge indicator.

**HUD**
- 「届かない軍勢 あと N 体」: the number of living enemies (patrols included) beyond the current radius.
- When N reaches 0, the text turns to 「今なら全滅できる」 with a subtle glow.

**Bonus multiplier on 被害額**
- Time bonus: ×(1 + 0.5·clamp((10 − timeLeft)/10, 0, 1)).
- Closeness bonus: +4% per enemy within 15 m at release, capped at +40%.
- Show the breakdown on the result as small lines.

**Rank S/A/B/C**
- Inputs: clear (required for S and A), time left at release, 払う count, and 被害額.
- Define the thresholds from balance-sim distributions so that S ≈ the top 10% of best-play runs.
- Show the rank large on the result.

**Tests**
- N count
- ring radius
- multipliers
- rank thresholds and determinism

**Shots**
- the ring mid-charge
- 「今なら全滅できる」
- the result with the rank and the breakdown

### R3: 今日の街 + リンクで挑戦 + 被害額のたとえ + 称号
Files: src/world/cityGen seed plumbing, main.js URL parsing, result.js/share text, a new src/game/titles.js, localStorage, tests.

**Daily seed**
- Derived from the JST date (YYYYMMDD).
- The city, enemy RNG and patrols are deterministic per seed.
- `?city=YYYYMMDD` overrides it. A friend's link plays the same city.
- The result shows 「今日の街 11/21」 or 「◯◯の街（リンク）」.
- The per-city local best (localStorage) shows 「自己ベスト」 and NEW!.

**被害額のたとえ**
- Add one line: 「国家予算（一般会計 約112兆円）の約◯日分」, choosing the unit (日/時間/年) to keep the number readable.
- Keep the reference value in one constant with a comment naming the source year. Say 「約」.

**Titles**
- Black-hole ending → 「すべてを飲み込んだ者」.
- Clear with ≤1 s left → 「ギリギリの英雄」.
- Clear with 0 払う used → 「払わぬ者」 (likely impossible; make it a rare legit edge if not).
- Max 払う combo ≥ 6 → 「一掃」.
- Boss dragged into the blast while grabbing → 「道連れ」.
- Titles are stored per device and shown on the result as a badge, with first-time NEW.

**Share text**
- Title, rank, outcome, 被害額 + たとえ, title badge, a city link with ?city=, and #最後の一撃.

**Tests**
- seed determinism (same seed gives the same city and enemy schedule)
- URL override
- the たとえ unit choice
- title conditions
- local best

### R4: 爆発の縦動画の共有
Files: a new src/share/clip.js, main.js, result.js UI, tests (logic only).

**Recording**
- From the result, a 「動画で共有」 button re-renders a short highlight of the player's own shot, deterministically from the replay snapshot: the blast close → showcase → space → the vertical line of light, 6–10 s.
- Render to an offscreen 9:16 canvas, recorded with MediaRecorder (video/mp4 if supported, else webm).
- Overlay: 「最後の一撃」, the rank, the outcome, 被害額, and the title badge if any.
- Audio: capture the finale audio through a MediaStreamDestination tap of the master bus, in sync.

**Sharing**
- If `navigator.canShare({files})`, use the Web Share API with the file; otherwise download.
- Show progress UI, allow cancel, and keep the game state intact.

**Rare endings**
- The black-hole ending gets its own clip button on its game-over screen.

**Performance**
- Record at the device tier's resolution, capped at 720×1280 on mid/low.

**Tests**
- the clip timeline (cuts, length)
- format selection
- the share/download fallback logic

**Proof**
- Use headless Chrome to produce a real clip file, checked by ffprobe and a few extracted frames.
