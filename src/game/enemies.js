import { CONFIG } from '../config.js';
import { GRID } from '../world/cityGen.js';

const DEAD_KEEP_SEC = 3;
const PATROL_ID = 100000;
const LEAN_SEC = 0.12; // 傾きの見た目のなめらかさ（s）
const P = GRID.PITCH;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 湧く速さ（体/秒）。持ち主の決定（2026-11-21「終盤ほど一気に増やす」）: 序盤は spawnPerSec で平ら、surgeStart 秒から surgeEnd 秒へ
// なめらかに（smoothstep）一気に surgeMul 倍まで増え、その後は保つ
export function spawnRateAt(t, cfg = CONFIG) {
  const E = cfg.enemy;
  const k = Math.min(1, Math.max(0, (t - E.surgeStart) / (E.surgeEnd - E.surgeStart)));
  return E.spawnPerSec * (1 + (E.surgeMul - 1) * k * k * (3 - 2 * k));
}

// S8（持ち主 13:16「最大溜めなら軍勢を全員巻き込めるくらい」）: 街を見回る者（patrol）。広くなった街の外の帯
// （band × cityRadius の距離の交差点だけ）を、道路に沿って走り回る。主人公を探さず（気配も感じず、見つけない）、
// 広場へは来ない。主人公を探して掴みに来る者（ふだんの軍勢）の湧き方・動き・乱数には触れない（釣り合いは前のまま）。
// 始めに count 人を帯（patrolBand）の中に散らして置く（面積あたり同じくらいに）
// 軍勢が街のどこまで行きうるか（m、爆心＝主人公からの水平の距離）。最大溜めの一発の半径（CONFIG.radius.max）は、
// これに余裕を足した距離まで届く（tests/game/enemies.test.js、S9 の「最大溜めなら必ず全員倒せる」の前提）
//  探す者: 交差点は roamDist の内か、主人公へ近づく向きだけ。湧く道は spawnDist の外端から 1.5 区画まで
//  見回る者: 交差点は帯の外端まで。どちらも道の中の車線のずれと、角を丸く曲がるふくらみ（3 m）を足す
export function maxEnemyReach(cfg = CONFIG) {
  const E = cfg.enemy, lane = E.laneSpread * Math.SQRT2 + 3;
  const hunt = huntReach(cfg) + lane;
  const pat = E.patrol && E.patrol.count > 0 ? patrolBand(cfg)[1] + lane : 0;
  return Math.max(hunt, pat);
}
// 探す者の交差点が行きうる一番遠い距離（車線のずれを除く）
const huntReach = (cfg) => Math.max(cfg.enemy.roamDist, cfg.enemy.spawnDist[1] + 1.5 * P);

// 見回る者の帯（交差点の主人公からの距離 m）。持ち主 15:33「軍勢は街の全体にいた方が良い」: 内は探す者の動ける範囲の外端
// （roamDist + 半区画。そこから内は探す者の場所）、外は街の端（cityRadius）。定数ではなく、この式で決まる（テストで固定）
export function patrolBand(cfg = CONFIG) {
  return [cfg.enemy.roamDist + P / 2, cfg.cityRadius];
}

// 見つけたあと近づく速さ（m/s）。掴む手前の slowDist m で、なめらかに slowMin 倍まで落とす。距離は主人公からの水平の距離
export function approachSpeed(dist, cfg = CONFIG) {
  const E = cfg.enemy;
  const t = Math.min(1, Math.max(0, (dist - E.grabRange) / E.slowDist));
  return E.speed * (E.slowMin + (1 - E.slowMin) * t * t * (3 - 2 * t));
}

// R0（持ち主 22:15「まだ主人公前で止まる感じ」）: 掴む枠が埋まっていて群がる者（cling）が回る輪の半径（m）。
// layer 段目は swarm.r0 から swarm.perRing 人ごとに swarm.step ずつ外（swarm.maxRing 回りまで）。掴む者（grabRange の内）のすぐ外
export function swarmRing(layer, cfg = CONFIG) {
  const S = cfg.enemy.swarm;
  return S.r0 + S.step * Math.min(S.maxRing, Math.floor(Math.max(0, layer) / S.perRing));
}

// 道路の交差点の位置（格子の番号 i, j → m）。道路の中心線は街区の中心から半分の間隔ずれたところ
export const roadNode = (i, j) => [(i + 0.5) * P, (j + 0.5) * P];

// (x, z) から主人公（原点）までの線分が、建物の足元（margin m 広げた四角）にさえぎられないか
export function lineOfSight(x, z, buildings, margin = 0) {
  for (const b of buildings) {
    const hx = b.w / 2 + margin, hz = b.d / 2 + margin;
    // 線分 p(t) = (x, z) * (1 - t), t∈[0,1] と四角の交わり（スラブ法）
    let t0 = 0, t1 = 1;
    for (const [p, c, h] of [[x, b.x, hx], [z, b.z, hz]]) {
      const d = -p; // 向き
      if (Math.abs(d) < 1e-9) { if (Math.abs(p - c) > h) { t0 = 2; break; } continue; }
      let a = (c - h - p) / d, bb = (c + h - p) / d;
      if (a > bb) [a, bb] = [bb, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, bb);
      if (t0 > t1) break;
    }
    if (t0 <= t1) return false;
  }
  return true;
}

// 軍勢。浮遊バイクで街の道路（26m 間隔の街区の間の道）をビュンビュン飛んで主人公を探し回り（search）、
// 交差点で曲がる。主人公から spotDist m の内側で建物にさえぎられずに見えたら見つけて（chase）、止まらずにそのまま
// 一直線に全速で突っ込み（R0: 見つけた一拍のにらみはやめた）、最後の slowDist m（0.5 m ほど）だけ減速して掴む（grab）。
// 掴んだ者は止まらず、主人公のまわりを orbitSpeed で回り続けながら吸う（R0、持ち主 22:15）。
// 掴む枠がいっぱいでも止まって待たない（持ち主 10:01「そのまま突っ込んで」）: そのまま突っ込み、掴んでいる者のすぐ外の輪
// （swarmRing）に着いたら、その輪を回って群がる（cling。力は減らさない）。枠が空けば、先に群がった者からすぐ掴み、回りながら内へ入る。
// どの段でも主人公からの距離は増えない（外へ押し戻さない）。
// 残り 20 秒（patrol.joinAt）からは、広場の近く（patrol.joinDist の内）の見回る者も狩りに加わる（R0）。
// 爆発の前線に触れると倒れる（dead）。時間がたつほど多く湧く。判定（払う・爆発・掴む）は主人公からの水平の距離 dist。
// 一人ごと: x, z（m）、dist、angle（主人公から見た向き）、heading（進む向き。x 軸から z 軸へ）、turn（曲がる速さ rad/s）、speed、
//   searchTime（探した秒）、alert（気配を感じて主人公の方へ寄っていく）、grabTime（掴んだ・群がってからの秒）、
//   layer（群がった者の段 0, 1, …）、unpile（群がりから掴んでからの秒）、lean（なめらかにした turn。見た目の傾き）、
//   spotT（見つけてからの秒。見た目の推進の光の一瞬の強まり）、hunting（狩りに加わった見回る者）
// buildings: 見通しを確かめる建物（遊んでいる間は壊れない）
// patrolRng: 見回る者の乱数（省けば見回る者は置かない。探す者の乱数 rng とは別にして、釣り合いを変えない）
export function createEnemies(rng, cfg = CONFIG, { buildings = [], patrolRng = null } = {}) {
  const E = cfg.enemy;
  const near = buildings.filter((b) => b.dist - Math.hypot(b.w, b.d) / 2 < E.spotDist);
  let list = [];
  let nextId = 1;
  let acc = 0;
  let time = 0;

  const place = (e) => { e.dist = Math.hypot(e.x, e.z); e.angle = Math.atan2(e.z, e.x); };
  const target = (e) => { const [nx, nz] = roadNode(e.ni, e.nj); return [nx + e.lane[0], nz + e.lane[1]]; };

  // 交差点で次に進む向きを選ぶ（戻らない。主人公に近づく向きを選びやすい。気配を感じた者は近づく向きだけ。roamDist の外へは出ない）。
  // 主人公から同じ距離の交差点へ進む（広場を囲む道を回る）のも近づく向きに数える（広場の角で行き止まりにして引き返さない）
  function chooseNext(e, rand = rng) {
    const [cx, cz] = roadNode(e.ni, e.nj);
    const here = Math.hypot(cx, cz);
    const opts = [];
    for (const [di, dj] of DIRS) {
      if (di === -e.di && dj === -e.dj) continue;
      const [nx, nz] = roadNode(e.ni + di, e.nj + dj);
      const d = Math.hypot(nx, nz);
      const inward = d < here + 1e-6;
      if (d > E.roamDist && !inward) continue;
      if (e.alert && !inward) continue;
      opts.push({ di, dj, w: inward ? E.inwardBias : 1 });
    }
    if (!opts.length) opts.push({ di: -e.di, dj: -e.dj, w: 1 });
    const sum = opts.reduce((s, o) => s + o.w, 0);
    let r = rand() * sum, pick = opts[opts.length - 1];
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    e.di = pick.di; e.dj = pick.dj; e.ni += pick.di; e.nj += pick.dj;
  }

  function spawn() {
    const a = rng() * Math.PI * 2;
    const r = E.spawnDist[0] + rng() * (E.spawnDist[1] - E.spawnDist[0]);
    const lane = [(rng() - 0.5) * 2 * E.laneSpread, (rng() - 0.5) * 2 * E.laneSpread];
    const fwd = rng(), alertRoll = rng();
    const e = { id: nextId++, x: Math.cos(a) * r, z: Math.sin(a) * r, state: 'search', speed: E.searchSpeed, turn: 0, searchTime: 0, alert: alertRoll < E.alertAtSpawn, lane };
    // 広場の中に湧く（試しの設定）なら、すぐに近づく
    if (r < cfg.plazaRadius) {
      e.state = 'chase'; e.speed = approachSpeed(r, cfg); e.heading = a + Math.PI;
      place(e);
      return e;
    }
    // いちばん近い道路の中心線へ寄せ、その道に沿って（内向きになりやすく）進む
    const gx = Math.round(e.x / P - 0.5), gz = Math.round(e.z / P - 0.5);
    const rx = (gx + 0.5) * P + lane[0], rz = (gz + 0.5) * P + lane[1];
    const pIn = E.inwardBias / (1 + E.inwardBias);
    if (Math.abs(e.x - rx) < Math.abs(e.z - rz)) {
      e.x = rx; // 縦の道（z に沿う）
      const inward = -Math.sign(e.z) || 1, s = fwd < pIn ? inward : -inward;
      const u = e.z / P - 0.5;
      e.di = 0; e.dj = s; e.ni = gx; e.nj = s > 0 ? Math.floor(u) + 1 : Math.ceil(u) - 1;
    } else {
      e.z = rz; // 横の道（x に沿う）
      const inward = -Math.sign(e.x) || 1, s = fwd < pIn ? inward : -inward;
      const u = e.x / P - 0.5;
      e.dj = 0; e.di = s; e.nj = gz; e.ni = s > 0 ? Math.floor(u) + 1 : Math.ceil(u) - 1;
    }
    e.heading = Math.atan2(e.dj, e.di);
    place(e);
    return e;
  }

  // ---- 見回る者 ----
  let patrolCount = 0; // 見回る者の id は PATROL_ID から（探す者の id の並びを変えない。見つける確かめの間合いが id で決まる）
  const PB = E.patrol ? patrolBand(cfg) : [0, 0];
  const inBand = (i, j) => { const [x, z] = roadNode(i, j); const d = Math.hypot(x, z); return d >= PB[0] && d <= PB[1]; };
  function patrolNext(e) {
    const opts = [];
    for (const [di, dj] of DIRS) {
      if (di === -e.di && dj === -e.dj) continue;
      if (inBand(e.ni + di, e.nj + dj)) opts.push([di, dj]);
    }
    if (!opts.length) opts.push([-e.di, -e.dj]);
    const [di, dj] = opts[Math.floor(patrolRng() * opts.length) % opts.length];
    e.di = di; e.dj = dj; e.ni += di; e.nj += dj;
  }
  const spin = patrolRng ? patrolRng() * Math.PI * 2 : 0;
  function spawnPatrol() {
    // 帯の中の交差点を、面積あたり同じくらいに（ひまわりの種の並び: k 人目は面積の k/count の半径、黄金角ずつ回す）。
    // 街のどの方角・どの距離にも見回る者がいる
    const k = patrolCount, n = E.patrol.count;
    let i = 0, j = 0;
    for (let t = 0; t < 40; t++) {
      const u = Math.min(1, (k + 0.5 + (t ? (patrolRng() - 0.5) : 0)) / n);
      const a = spin + k * 2.39996 + (t ? (patrolRng() - 0.5) * 0.4 : 0), r = Math.sqrt(PB[0] ** 2 + u * (PB[1] ** 2 - PB[0] ** 2));
      i = Math.round((Math.cos(a) * r) / P - 0.5); j = Math.round((Math.sin(a) * r) / P - 0.5);
      if (inBand(i, j)) break;
    }
    const lane = [(patrolRng() - 0.5) * 2 * E.laneSpread, (patrolRng() - 0.5) * 2 * E.laneSpread];
    const [x, z] = roadNode(i, j);
    const d = DIRS[Math.floor(patrolRng() * 4) % 4];
    const e = { id: PATROL_ID + patrolCount++, patrol: true, x: x + lane[0], z: z + lane[1], state: 'search', speed: E.patrol.speed, turn: 0, searchTime: 0, alert: false, lane, ni: i, nj: j, di: d[0], dj: d[1] };
    patrolNext(e); // 最初の行き先
    e.heading = Math.atan2(e.dj, e.di);
    place(e);
    return e;
  }
  function patrolStep(e, dt) {
    let [tx, tz] = target(e);
    const lead = Math.max(1, e.speed / E.turnRate);
    if ((tx - e.x) * e.di + (tz - e.z) * e.dj < lead) { patrolNext(e); [tx, tz] = target(e); }
    const off = e.di * (e.z - tz) - e.dj * (e.x - tx);
    steer(e, Math.atan2(e.dj, e.di) - Math.atan(off / E.lookAhead), E.turnRate, dt);
    accel(e, E.patrol.speed, dt);
    e.x += Math.cos(e.heading) * e.speed * dt;
    e.z += Math.sin(e.heading) * e.speed * dt;
    place(e);
  }

  // 向きを want へ、毎秒 rate rad までで回す
  function steer(e, want, rate, dt) {
    const d = wrap(want - e.heading);
    const step = Math.max(-rate * dt, Math.min(rate * dt, d));
    e.heading = wrap(e.heading + step);
    e.turn = dt > 0 ? step / dt : 0;
  }
  const accel = (e, v, dt) => { e.speed += Math.max(-E.brake * dt, Math.min(E.accel * dt, v - e.speed)); };

  function searchStep(e, dt) {
    e.searchTime += dt;
    if (!e.alert && (e.searchTime >= E.alertAfter || rng() < E.alertRate * dt)) e.alert = true;
    let [tx, tz] = target(e);
    // 交差点の手前（曲がりの半径ぶん）で次の道を選び、角を丸く曲がる
    const lead = Math.max(1, e.speed / E.turnRate);
    if ((tx - e.x) * e.di + (tz - e.z) * e.dj < lead) { chooseNext(e, e.patrol ? patrolRng : rng); [tx, tz] = target(e); }
    // 道の中心線（交差点を通り、進む向きに沿う線）へ寄せながら進む: 線からのずれを lookAhead m 先で戻す向き
    const off = e.di * (e.z - tz) - e.dj * (e.x - tx);
    steer(e, Math.atan2(e.dj, e.di) - Math.atan(off / E.lookAhead), E.turnRate, dt);
    accel(e, E.searchSpeed, dt);
    e.x += Math.cos(e.heading) * e.speed * dt;
    e.z += Math.sin(e.heading) * e.speed * dt;
    place(e);
    // 見つける: spotDist の内側で、建物にさえぎられずに主人公が見えたら（spotEvery 秒ごとに確かめる）
    e.spotClock = (e.spotClock ?? (e.id * 0.37) % E.spotEvery) - dt;
    if (e.spotClock <= 0) {
      e.spotClock += E.spotEvery;
      if (e.dist <= E.spotDist && lineOfSight(e.x, e.z, near, E.sightMargin)) { e.state = 'chase'; e.spotT = 0; }
    }
  }

  // 見つけた者: 止まらずに主人公へ一直線に突っ込む（曲がりきれる速さで向きを変える）。速さは探す速さから speed へ上げ、
  // 減速は最後の slowDist m だけ（approachSpeed）。ring（掴める枠があれば grabRange、なければ群がる輪）に着いたら、
  // 残りの一歩はその輪を回る向きに進めて true を返す（着いたフレームも止まって見えない）。
  // 主人公からの距離は一度も増えない: 向き直る途中で外へ向かう分は、主人公のまわりを回る向きへ逃がす（一歩の長さは保つ）
  function chaseStep(e, dt, ring) {
    e.spotT = (e.spotT ?? 0) + dt;
    const toHero = Math.atan2(-e.z, -e.x);
    steer(e, toHero, e.dist < E.snapDist ? Math.PI * 8 : E.chaseTurnRate, dt);
    e.speed = Math.min(approachSpeed(e.dist, cfg), Math.max(e.speed, 0) + E.chaseAccel * dt); // 減速の曲線より速くならない
    const step = e.speed * dt;
    let dx = Math.cos(e.heading) * step, dz = Math.sin(e.heading) * step;
    const ux = e.x / e.dist, uz = e.z / e.dist;
    const out = dx * ux + dz * uz;
    if (out > 0) { // 外へ向かう分を除き、残りの向き（主人公のまわりを回る向き）に一歩の長さで進む
      let tx = dx - out * ux, tz = dz - out * uz;
      const tl = Math.hypot(tx, tz);
      if (tl < 1e-9) { const s = e.turn < 0 ? -1 : 1; tx = -uz * s; tz = ux * s; } else { tx /= tl; tz /= tl; }
      dx = tx * step; dz = tz * step;
    }
    let nx = e.x + dx, nz = e.z + dz;
    let nd = Math.hypot(nx, nz);
    if (nd > e.dist) { const k = e.dist / nd; nx *= k; nz *= k; nd = e.dist; }
    if (nd <= ring) { // 輪に着いた: 主人公へ向かう線の上の輪の点へ。残りの一歩は輪を回る向き（左回り）に
      const left = Math.max(0, step - (e.dist - ring));
      const a = Math.atan2(e.z, e.x) + left / Math.max(ring, 0.5);
      e.x = Math.cos(a) * ring; e.z = Math.sin(a) * ring;
      place(e);
      return true;
    }
    e.x = nx; e.z = nz;
    place(e);
    return false;
  }

  // 掴んだ者（grab）・群がる者（cling）: 主人公のまわりを左回り（角度が増える向き）に回り続ける。輪の半径 R より外にいれば
  // swarm.inSpeed で内へ寄る（外へは出ない）。回る速さは掴む者 orbitSpeed、群がる者 swarm.speed（m/s）
  function orbitStep(e, dt, R, v) {
    const r0 = e.dist;
    const r = r0 > R ? Math.max(R, r0 - E.swarm.inSpeed * dt) : r0;
    const w = v / Math.max(r, 0.5);
    const a = e.angle + w * dt;
    e.x = Math.cos(a) * r; e.z = Math.sin(a) * r;
    const radial = dt > 0 ? (r0 - r) / dt : 0;
    e.speed = Math.hypot(v, radial);
    e.heading = wrap(a + Math.PI / 2 + Math.atan2(radial, v));
    e.turn = w;
    place(e);
  }

  // 飛びついた者に重なりの段を、飛びついた順に 0, 1, … と振り直す
  const relayer = () => { let k = 0; for (const e of list) if (e.state === 'cling') e.layer = k++; };
  if (patrolRng && E.patrol?.count > 0) for (let k = 0; k < E.patrol.count; k++) list.push(spawnPatrol());

  return {
    get list() { return list; },
    update(dt) {
      for (const e of list) if (e.state === 'dead') e.deadTime += dt;
      list = list.filter((e) => e.state !== 'dead' || e.deadTime < DEAD_KEEP_SEC);

      let grabbing = list.reduce((n, e) => n + (e.state === 'grab' ? 1 : 0), 0);
      // 枠が空いていれば、先に群がった者からすぐ掴む（回りながら掴む者の輪へ内へ寄る）
      for (const e of list) {
        if (grabbing >= E.maxGrabbing) break;
        if (e.state !== 'cling') continue;
        e.state = 'grab'; e.unpile = 0; grabbing++; // layer は残す（群がりから下りる見た目）
      }
      let clinging = 0;
      for (const e of list) if (e.state === 'cling') e.layer = clinging++;
      // R0: 残り 20 秒からは、広場の近くの見回る者も狩りに加わる（気配を感じた者として、主人公に近づく道だけを選ぶ）
      const PJ = E.patrol;
      if (PJ?.joinAt != null && time >= PJ.joinAt) {
        for (const e of list) if (e.patrol && !e.hunting && e.state === 'search' && e.dist <= PJ.joinDist) { e.hunting = true; e.alert = true; e.searchTime = 0; }
      }
      for (const e of list) {
        if (e.state === 'dead') continue;
        if (e.state === 'grab' || e.state === 'cling') { // 掴んでからの秒（見た目が主人公の横へ寄るのに使う）
          e.grabTime += dt;
          if (e.unpile != null) e.unpile += dt;
          if (e.state === 'grab') orbitStep(e, dt, E.grabRange, E.orbitSpeed);
          else orbitStep(e, dt, swarmRing(e.layer, cfg), E.swarm.speed);
          e.lean = (e.lean ?? e.turn) + (e.turn - (e.lean ?? e.turn)) * (1 - Math.exp(-dt / LEAN_SEC));
          continue;
        }
        if (e.x == null) { e.x = Math.cos(e.angle) * e.dist; e.z = Math.sin(e.angle) * e.dist; } // 角度と距離だけの者（試し）
        if (e.state === 'approach') e.state = 'chase';
        e.heading ??= e.angle + Math.PI;
        e.speed ??= approachSpeed(e.dist, cfg);
        e.turn ??= 0;
        if (e.patrol && !e.hunting) { patrolStep(e, dt); e.lean = (e.lean ?? e.turn) + (e.turn - (e.lean ?? e.turn)) * (1 - Math.exp(-dt / LEAN_SEC)); continue; }
        if (e.state === 'search') searchStep(e, dt);
        let arrived = false;
        const free = grabbing < E.maxGrabbing;
        const ring = free ? E.grabRange : swarmRing(clinging, cfg);
        if (e.state === 'chase' && e.dist <= ring) { // もう輪の内側（大きな群れの外の輪・試しの置き方）: その場から回り始める
          orbitStep(e, dt, ring, free ? E.orbitSpeed : E.swarm.speed);
          arrived = true;
        } else if (e.state === 'chase') arrived = chaseStep(e, dt, ring);
        // 傾きの見た目に使う、なめらかにした曲がる速さ（交差点の一瞬の曲がりでちらつかない）
        e.lean = (e.lean ?? e.turn) + (e.turn - (e.lean ?? e.turn)) * (1 - Math.exp(-dt / LEAN_SEC));
        if (!arrived) continue;
        e.grabTime = 0;
        // 着いた瞬間から回り始める（速さ・向きは回る者のもの）。外へは出ない
        e.speed = Math.max(e.speed, free ? E.orbitSpeed : E.swarm.speed);
        e.heading = wrap(e.angle + Math.PI / 2);
        if (free) { e.state = 'grab'; grabbing++; } else { e.state = 'cling'; e.layer = clinging++; }
      }
      relayer();

      // 区間の真ん中の速さで足す（台形と同じで、刻み幅によらず同じ数が湧く）
      acc += spawnRateAt(time + dt / 2, cfg) * dt;
      time += dt;
      while (acc >= 1) {
        acc -= 1;
        list.push(spawn());
      }
      return grabbing;
    },
    applyBlastFront(front) {
      let killed = 0;
      for (const e of list) {
        if (e.state === 'dead' || e.dist > front) continue;
        e.state = 'dead';
        e.deadTime = 0;
        killed++;
      }
      if (killed) relayer();
      return killed;
    },
  };
}
