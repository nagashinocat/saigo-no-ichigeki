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
// 軍勢が街のどこまで行きうるか（m、主人公が街の中心（原点）にいるときの、中心からの水平の距離）。最大溜めの一発の半径（CONFIG.radius.max）は、
// これに余裕を足した距離まで届く（tests/game/enemies.test.js、S9 の「最大溜めなら必ず全員倒せる」の前提。M1 で主人公が動くので、
// それが言えるのは街の中心のそばで放ったときだけ。中心から離れた所からは maxEnemyReachFrom）
//  探す者: 交差点は roamDist の内か、主人公へ近づく向きだけ。湧く道は spawnDist の外端から 1.5 区画まで
//  見回る者: 交差点は帯の外端まで。どちらも道の中の車線のずれと、角を丸く曲がるふくらみ（3 m）を足す
export function maxEnemyReach(cfg = CONFIG) {
  const E = cfg.enemy, lane = E.laneSpread * Math.SQRT2 + 3;
  const hunt = huntReach(cfg) + lane;
  const pat = E.patrol && E.patrol.count > 0 ? patrolBand(cfg)[1] + lane : 0;
  return Math.max(hunt, pat);
}
// M1（spec §16「最大溜めで必ず撃退できるのは、街の中心のそばで放ったときだけ」）: 街の中心から heroDist m の所にいる主人公（爆心）から、
// 軍勢が行きうる一番遠い距離。見回る者の帯は街に決まっている（中心から）ので、反対側の端は heroDist だけ遠くなる。探す者は主人公のまわり
export function maxEnemyReachFrom(cfg = CONFIG, heroDist = 0) {
  if (!(heroDist > 0)) return maxEnemyReach(cfg);
  const E = cfg.enemy, lane = E.laneSpread * Math.SQRT2 + 3;
  const hunt = huntReach(cfg) + lane;
  const pat = E.patrol && E.patrol.count > 0 ? patrolBand(cfg)[1] + lane + heroDist : 0;
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

// R1: 種類（e.kind: 'heavy' / 'drainer' / 'boss'。ふつうの者と見回る者は無し）の決まり（CONFIG.enemy.kinds）
const kindOf = (e, E) => (e.kind ? E.kinds?.[e.kind] ?? null : null);
// 速さの倍率（重い者 0.8、大物 0.9）と吸う力の倍率（吸う者 2.5、大物 4）
export const speedMulOf = (e, cfg = CONFIG) => kindOf(e, cfg.enemy)?.speedMul ?? 1;
export const drainMulOf = (e, cfg = CONFIG) => kindOf(e, cfg.enemy)?.drainMul ?? 1;

// 道路の交差点の位置（格子の番号 i, j → m）。道路の中心線は街区の中心から半分の間隔ずれたところ
export const roadNode = (i, j) => [(i + 0.5) * P, (j + 0.5) * P];

// (x, z) から主人公（M1: (px, pz)。省けば原点）までの線分が、建物の足元（margin m 広げた四角）にさえぎられないか
export function lineOfSight(x, z, buildings, margin = 0, px = 0, pz = 0) {
  for (const b of buildings) {
    const hx = b.w / 2 + margin, hz = b.d / 2 + margin;
    // 線分 p(t) = (x, z) + t·((px, pz) − (x, z)), t∈[0,1] と四角の交わり（スラブ法）
    let t0 = 0, t1 = 1;
    for (const [p, c, h, q] of [[x, b.x, hx, px], [z, b.z, hz, pz]]) {
      const d = q - p; // 向き
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

// M2（持ち主 09:11「敵の前方ライトを少し広くして」、spec §16）: 前を照らすライトに主人公が入ったか。ライトは進む向き（heading）の前の扇
// （半分の角 spotHalfAngle、spotDist m まで）。ごく近く（spotNear m の内）は向きによらない（気配）。どちらも建物にさえぎられない所だけ。
// H: 主人公の位置 { x, z }。buildings: 見通しを確かめる建物
export function seesHero(e, H, buildings, cfg = CONFIG) {
  const E = cfg.enemy;
  if (H.hidden) return false; // M2: 物陰に隠れている間は誰にも見つからない
  const rx = H.x - e.x, rz = H.z - e.z, d = Math.hypot(rx, rz);
  if (d > E.spotDist) return false;
  if (d > (E.spotNear ?? 0)) {
    const off = Math.abs(wrap(Math.atan2(rz, rx) - (e.heading ?? 0)));
    if (off > (E.spotHalfAngle ?? Math.PI)) return false;
  }
  return lineOfSight(e.x, e.z, buildings, E.sightMargin, H.x, H.z);
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
// typeRng（R1）: 探す者の種類（重い者・吸う者）と大物の湧く場所の乱数（省けば種類はなく、大物も来ない。rng とは別にして、
//   湧く場所の乱数を使わない）。ただし rng の並びが前と同じなのは、種類のある者が初めて湧くまで（重い者は 20 秒から）。
//   重い者・大物は速さが違い、曲がり角で次の道を選ぶ（rng を使う）時刻がずれるので、そこから先の並びは前と変わる
// 払うが当たって倒れなかった者（重い者・大物、e.hp が残る）は stagger（よろめき）: 後ろへ押し戻されながら回り、掴む枠から外れ、
//   stagger.sec 秒で突っ込み直す。同じ一発には二度当たらない（e.lastHit）
// heroPos（R1）: 主人公の位置 { x, z }（既定は原点）。M1: game.js が同じ物を、主人公が動くたびに書き換えて渡す。湧く場所・探す道・見つける・
//   突っ込む・掴んで回る・群がる・よろめく・判定の dist / angle は、どれも今の主人公からの水平の距離と向き。見回る者の帯だけは街（原点）に決まっている。
//   掴んでいる者・群がる者は、主人公が動くと同じだけついてくる（掴んだまま）
export function createEnemies(rng, cfg = CONFIG, { buildings = [], patrolRng = null, typeRng = null, heroPos = { x: 0, z: 0 } } = {}) {
  const E = cfg.enemy;
  const KB = typeRng ? E.kinds?.boss : null;
  let bossBorn = false, drainLoad = 0;
  const arrivals = [];
  const H = heroPos;
  // 探す者が行ける交差点の、街の中心からの一番遠い距離（m）
  const EDGE = cfg.cityRadius - P / 2;
  const AL = E.alert ?? null;
  // 見通しを確かめる建物: 主人公のそば（spotDist + NEAR_SLACK の内）だけ。主人公が NEAR_SLACK m 動いたら選び直す
  // （線分は主人公から spotDist の内なので、選んだ所から NEAR_SLACK 内にいる間は、選んだ建物で足りる）
  const NEAR_SLACK = 10;
  let near = [], nearAt = null;
  const nearBuildings = () => {
    if (!nearAt || Math.hypot(H.x - nearAt.x, H.z - nearAt.z) > NEAR_SLACK) {
      nearAt = { x: H.x, z: H.z };
      near = buildings.filter((b) => Math.hypot(b.x - H.x, b.z - H.z) - Math.hypot(b.w, b.d) / 2 < E.spotDist + NEAR_SLACK);
    }
    return near;
  };
  let list = [];
  let nextId = 1;
  let acc = 0;
  let time = 0;

  // 主人公（H）からの水平の距離と向き
  const place = (e) => { const rx = e.x - H.x, rz = e.z - H.z; e.dist = Math.hypot(rx, rz); e.angle = Math.atan2(rz, rx); };
  const target = (e) => { const [nx, nz] = roadNode(e.ni, e.nj); return [nx + e.lane[0], nz + e.lane[1]]; };

  // 交差点で次に進む向きを選ぶ（戻らない。主人公に近づく向きを選びやすい。気配を感じた者は近づく向きだけ。roamDist の外へは出ない）。
  // 主人公から同じ距離の交差点へ進む（広場を囲む道を回る）のも近づく向きに数える（広場の角で行き止まりにして引き返さない）
  // M2: 知らされただけの者（e.heard）は、主人公ではなく知らされた位置（最後に見えた所）へ近づき、そこから alert.sweepDist m の内を探し回る。
  // 街の端（cityRadius − 半区画）より外の交差点へは行かない（M1 の見直しの持ち越し: 外の畑の道へ出ない）
  function chooseNext(e, rand = rng) {
    const T = e.heard ?? H;
    const [cx, cz] = roadNode(e.ni, e.nj);
    const here = Math.hypot(cx - T.x, cz - T.z);
    const sweeping = !!e.heard && here <= (E.alert?.sweepDist ?? 0);
    const roam = e.heard ? E.alert.sweepDist : E.roamDist;
    const opts = [];
    for (const [di, dj] of DIRS) {
      if (di === -e.di && dj === -e.dj) continue;
      const [nx, nz] = roadNode(e.ni + di, e.nj + dj);
      if (!e.patrol && Math.hypot(nx, nz) > EDGE) continue;
      const d = Math.hypot(nx - T.x, nz - T.z);
      const inward = d < here + 1e-6;
      if (d > roam && !inward) continue;
      if (e.alert && !inward && !sweeping) continue;
      opts.push({ di, dj, w: inward ? E.inwardBias : 1 });
    }
    if (!opts.length) opts.push({ di: -e.di, dj: -e.dj, w: 1 });
    const sum = opts.reduce((s, o) => s + o.w, 0);
    let r = rand() * sum, pick = opts[opts.length - 1];
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    e.di = pick.di; e.dj = pick.dj; e.ni += pick.di; e.nj += pick.dj;
  }

  // 種類を決める（湧いた時刻 time で。typeRng は湧くたびに一つ使う）
  function pickKind() {
    if (!typeRng || !E.kinds) return null;
    const u = typeRng(), H = E.kinds.heavy, D = E.kinds.drainer;
    if (H && time >= H.after && u < H.share) return 'heavy';
    if (D && time >= D.after && u >= (H?.share ?? 0) && u < (H?.share ?? 0) + D.share) return 'drainer';
    return null;
  }
  function spawn(rand = rng, kind = pickKind()) {
    let a = rand() * Math.PI * 2;
    const r = E.spawnDist[0] + rand() * (E.spawnDist[1] - E.spawnDist[0]);
    // M2（M1 の見直しの持ち越し）: 主人公が街の端のそばにいると、湧く所が街の外（畑の道）になる。そのときは向きを街の中心の方へ寄せる
    // （乱数は使わない。湧き方の並びは街の中では前と同じ）
    if (Math.hypot(H.x + Math.cos(a) * r, H.z + Math.sin(a) * r) > EDGE - P) {
      const c = Math.atan2(-H.z, -H.x), off = wrap(a - c);
      for (const k of [0.6, 0.3, 0]) { a = c + off * k; if (Math.hypot(H.x + Math.cos(a) * r, H.z + Math.sin(a) * r) <= EDGE - P) break; }
    }
    const lane = [(rand() - 0.5) * 2 * E.laneSpread, (rand() - 0.5) * 2 * E.laneSpread];
    const fwd = rand(), alertRoll = rand();
    const e = { id: nextId++, x: H.x + Math.cos(a) * r, z: H.z + Math.sin(a) * r, state: 'search', speed: E.searchSpeed, turn: 0, searchTime: 0, alert: alertRoll < E.alertAtSpawn, lane };
    if (kind) { e.kind = kind; e.hp = E.kinds[kind].hp; e.speed *= E.kinds[kind].speedMul; }
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
      const inward = -Math.sign(e.z - H.z) || 1, s = fwd < pIn ? inward : -inward;
      const u = e.z / P - 0.5;
      e.di = 0; e.dj = s; e.ni = gx; e.nj = s > 0 ? Math.floor(u) + 1 : Math.ceil(u) - 1;
    } else {
      e.z = rz; // 横の道（x に沿う）
      const inward = -Math.sign(e.x - H.x) || 1, s = fwd < pIn ? inward : -inward;
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

  // M2: 道を外れていた者（chase・よろめき）が探す者へ戻るとき、近い交差点と、今の向きに近い道の向きを選び直す（そのあとは道へ寄せながら進む）
  function resumeRoad(e) {
    const c = Math.cos(e.heading ?? 0), s = Math.sin(e.heading ?? 0);
    if (Math.abs(c) >= Math.abs(s)) { e.di = Math.sign(c) || 1; e.dj = 0; } else { e.di = 0; e.dj = Math.sign(s) || 1; }
    const u = e.x / P - 0.5, v = e.z / P - 0.5;
    e.ni = e.di > 0 ? Math.floor(u) + 1 : e.di < 0 ? Math.ceil(u) - 1 : Math.round(u);
    e.nj = e.dj > 0 ? Math.floor(v) + 1 : e.dj < 0 ? Math.ceil(v) - 1 : Math.round(v);
    e.lane ??= [0, 0];
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
    accel(e, E.searchSpeed * speedMulOf(e, cfg), dt);
    e.x += Math.cos(e.heading) * e.speed * dt;
    e.z += Math.sin(e.heading) * e.speed * dt;
    place(e);
    // 見つける: spotDist の内側で、建物にさえぎられずに主人公が見えたら（spotEvery 秒ごとに確かめる）
    trySpot(e, dt);
  }
  // 見つける（M2: 前を照らすライトの中か、ごく近く。spotEvery 秒ごとに確かめる）。見つけたら chase へ、まわりへ知らせる
  function trySpot(e, dt) {
    e.spotClock = (e.spotClock ?? (e.id * 0.37) % E.spotEvery) - dt;
    if (e.spotClock > 0) return;
    e.spotClock += E.spotEvery;
    if (e.dist <= E.spotDist && seesHero(e, H, nearBuildings(), cfg)) {
      e.state = 'chase'; e.spotT = 0;
      if (e.patrol) { e.hunting = true; e.alert = true; }
      delete e.heard; e.relayAt = null;
      e.recall = AL?.callEvery ?? Infinity;
      call(e, 0);
    }
  }

  // ---- M2: 知らせ（spec §16「見つかると周りの軍勢へ知らせが広がり、どんどん集まってくる」）----
  // from が alert.radius m の内の探す者（見回る者も）へ、主人公の今の位置（最後に見えた所）を知らせる。hops は from の段（見つけた者は 0）。
  // 知らされた者は heard を覚え（もっと新しい知らせなら書き換える）、hops + 1 < alert.hops なら relayDelay 秒あとに次へ伝える。
  // chase・掴む・群がる・よろめく者は変わらない（自分で見つけた者は今の主人公を追い続ける。持ち主 13:36）
  function call(from, hops) {
    if (!AL || H.hidden) return;
    from.callT = 0;
    const known = { x: H.x, z: H.z, t: time };
    const R2 = AL.radius * AL.radius;
    for (const o of list) {
      if (o === from || o.state !== 'search') continue;
      if (o.heard && o.heard.t >= known.t) continue;
      const dx = o.x - from.x, dz = o.z - from.z;
      if (dx * dx + dz * dz > R2) continue;
      hear(o, known, hops + 1);
    }
  }
  function hear(o, known, hops) {
    o.heard = { x: known.x, z: known.z, t: known.t };
    o.hops = hops;
    o.alert = true;
    if (o.patrol) o.hunting = true;
    o.relayAt = hops < AL.hops ? time + AL.relayDelay : null;
  }
  // 知らされた者が次へ伝える（覚えた位置のまま）
  function relay(o) {
    o.relayAt = null;
    if (H.hidden) return; // M2: 隠れている間は知らせが止まる
    o.callT = 0;
    const R2 = AL.radius * AL.radius;
    for (const p of list) {
      if (p === o || p.state !== 'search') continue;
      if (p.heard && p.heard.t >= o.heard.t) continue;
      const dx = p.x - o.x, dz = p.z - o.z;
      if (dx * dx + dz * dz > R2) continue;
      hear(p, o.heard, o.hops + 1);
    }
  }

  // 見つけた者: 止まらずに主人公へ一直線に突っ込む（曲がりきれる速さで向きを変える）。速さは探す速さから speed へ上げ、
  // 減速は最後の slowDist m だけ（approachSpeed）。ring（掴める枠があれば grabRange、なければ群がる輪）に着いたら、
  // 残りの一歩はその輪を回る向きに進めて true を返す（着いたフレームも止まって見えない）。
  // 主人公からの距離は一度も増えない: 向き直る途中で外へ向かう分は、主人公のまわりを回る向きへ逃がす（一歩の長さは保つ）
  function chaseStep(e, dt, ring) {
    e.spotT = (e.spotT ?? 0) + dt;
    place(e); // 主人公はこのフレームで動いたかもしれない
    const rx = e.x - H.x, rz = e.z - H.z;
    const toHero = Math.atan2(-rz, -rx);
    steer(e, toHero, e.dist < E.snapDist ? Math.PI * 8 : E.chaseTurnRate, dt);
    e.speed = Math.min(approachSpeed(e.dist, cfg) * speedMulOf(e, cfg), Math.max(e.speed, 0) + E.chaseAccel * dt); // 減速の曲線より速くならない
    const step = e.speed * dt;
    let dx = Math.cos(e.heading) * step, dz = Math.sin(e.heading) * step;
    const ux = rx / e.dist, uz = rz / e.dist;
    const out = dx * ux + dz * uz;
    if (out > 0) { // 外へ向かう分を除き、残りの向き（主人公のまわりを回る向き）に一歩の長さで進む
      let tx = dx - out * ux, tz = dz - out * uz;
      const tl = Math.hypot(tx, tz);
      if (tl < 1e-9) { const s = e.turn < 0 ? -1 : 1; tx = -uz * s; tz = ux * s; } else { tx /= tl; tz /= tl; }
      dx = tx * step; dz = tz * step;
    }
    let nx = rx + dx, nz = rz + dz; // 主人公から見た位置
    let nd = Math.hypot(nx, nz);
    if (nd > e.dist) { const k = e.dist / nd; nx *= k; nz *= k; nd = e.dist; }
    if (nd <= ring) { // 輪に着いた: 主人公へ向かう線の上の輪の点へ。残りの一歩は輪を回る向き（左回り）に
      const left = Math.max(0, step - (e.dist - ring));
      const a = Math.atan2(rz, rx) + left / Math.max(ring, 0.5);
      e.x = H.x + Math.cos(a) * ring; e.z = H.z + Math.sin(a) * ring;
      place(e);
      return true;
    }
    e.x = H.x + nx; e.z = H.z + nz;
    place(e);
    return false;
  }

  // 掴んだ者（grab）・群がる者（cling）: 主人公のまわりを左回り（角度が増える向き）に回り続ける。輪の半径 R より外にいれば
  // swarm.inSpeed で内へ寄る（外へは出ない）。回る速さは掴む者 orbitSpeed、群がる者 swarm.speed（m/s）。
  // M1: 距離と向き（e.dist / e.angle）は前のフレームの主人公から見たもの。今の主人公のまわりに置くので、主人公が動いた分だけついてくる
  function orbitStep(e, dt, R, v) {
    const r0 = e.dist;
    const r = r0 > R ? Math.max(R, r0 - E.swarm.inSpeed * dt) : r0;
    const w = v / Math.max(r, 0.5);
    const a = e.angle + w * dt;
    e.x = H.x + Math.cos(a) * r; e.z = H.z + Math.sin(a) * r;
    const radial = dt > 0 ? (r0 - r) / dt : 0;
    e.speed = Math.hypot(v, radial);
    e.heading = wrap(a + Math.PI / 2 + Math.atan2(radial, v));
    e.turn = w;
    place(e);
  }

  // よろめく者（R1）: 主人公から外へ push m/s（stagger.sec 秒でなめらかに 0 へ）押し戻されながら、左回りに spin m/s で回る。
  // 終われば chase へ戻り、そのまま突っ込み直す（速さは今の速さから上げる）
  function staggerStep(e, dt) {
    const S = E.stagger;
    e.staggerT += dt;
    if (e.x == null) { e.x = H.x + Math.cos(e.angle) * e.dist; e.z = H.z + Math.sin(e.angle) * e.dist; }
    const u = Math.min(1, e.staggerT / S.sec);
    const out = S.push * (1 - u) * (1 - u * 0.5);
    const rx = e.x - H.x, rz = e.z - H.z;
    const r0 = Math.max(Math.hypot(rx, rz), 0.5), r = r0 + out * dt;
    const a = Math.atan2(rz, rx) + (S.spin / r) * dt;
    e.x = H.x + Math.cos(a) * r; e.z = H.z + Math.sin(a) * r;
    e.speed = Math.hypot(out, S.spin);
    e.heading = wrap(a + Math.atan2(S.spin, out));
    e.turn = S.spin / r;
    place(e);
    // M2（R1d の持ち越し「よろめきからすぐ突っ込み直す」）: 突っ込み直す速さは探す速さから（よろめきの遅い速さから上げ直さない）。
    // 主人公が物陰に隠れていれば（hidden）、見失って最後に見えた所を探す
    if (u >= 1) {
      delete e.layer; e.unpile = null; e.alert = true;
      if (H.hidden) { e.state = 'search'; e.heard = { ...(H.lastSeen ?? { x: H.x, z: H.z }), t: time }; e.hops = AL?.hops ?? 0; e.relayAt = null; e.searchTime = 0; resumeRoad(e); }
      else { e.state = 'chase'; e.spotT = 0; e.speed = Math.max(e.speed, E.searchSpeed * speedMulOf(e, cfg)); }
    }
  }

  // 群がった者を群がった順に（swarmSeq。試しで直に置いた者は前）並べ、段を 0, 1, … と振り直す（数を返す）。
  // list の並び（見回る者は始めから前にいる）では決めない: あとから群がった見回る者が段 0 に割り込み、皆の高さと掴む順が入れ替わらないように
  let swarmSeq = 0;
  const clingers = () => list.filter((e) => e.state === 'cling').sort((a, b) => (a.swarmSeq ?? -1) - (b.swarmSeq ?? -1));
  const relayer = () => { const cs = clingers(); cs.forEach((e, k) => { e.layer = k; }); return cs.length; };
  if (patrolRng && E.patrol?.count > 0) for (let k = 0; k < E.patrol.count; k++) list.push(spawnPatrol());

  return {
    get list() { return list; },
    update(dt) {
      for (const e of list) if (e.state === 'dead') e.deadTime += dt;
      list = list.filter((e) => e.state !== 'dead' || e.deadTime < DEAD_KEEP_SEC);

      let grabbing = list.reduce((n, e) => n + (e.state === 'grab' ? 1 : 0), 0);
      // 枠が空いていれば、先に群がった者からすぐ掴む（回りながら掴む者の輪へ内へ寄る）。順は群がった順（swarmSeq）
      for (const e of clingers()) {
        if (grabbing >= E.maxGrabbing) break;
        e.state = 'grab'; e.unpile = 0; grabbing++; // layer は残す（群がりから下りる見た目）
      }
      let clinging = relayer();
      // R0: 残り 20 秒からは、広場の近くの見回る者も狩りに加わる（気配を感じた者として、主人公に近づく道だけを選ぶ）
      const PJ = E.patrol;
      if (PJ?.joinAt != null && time >= PJ.joinAt) {
        for (const e of list) if (e.patrol && !e.hunting && e.state === 'search' && e.dist <= PJ.joinDist) { e.hunting = true; e.alert = true; e.searchTime = 0; }
      }
      // M2: 知らせ。光る間合い（callT）を進め、伝える時刻の来た者は次へ伝え、主人公が見えている追う者は callEvery 秒ごとに知らせ直す
      if (AL) {
        for (const e of list) {
          if (e.callT != null) e.callT += dt;
          if (e.state === 'dead') continue;
          if (e.state === 'search') { if (e.relayAt != null && time >= e.relayAt) relay(e); continue; }
          if (e.state !== 'chase' && e.state !== 'grab' && e.state !== 'cling') continue;
          e.recall = (e.recall ?? AL.callEvery) - dt;
          if (e.recall > 0) continue;
          e.recall += AL.callEvery;
          const sees = !H.hidden && (e.state !== 'chase' || (e.dist <= E.spotDist && e.x != null && lineOfSight(e.x, e.z, nearBuildings(), E.sightMargin, H.x, H.z)));
          if (sees) call(e, 0);
        }
      }
      for (const e of list) {
        if (e.state === 'dead') continue;
        if (e.state === 'stagger') { staggerStep(e, dt); e.lean = (e.lean ?? e.turn) + (e.turn - (e.lean ?? e.turn)) * (1 - Math.exp(-dt / LEAN_SEC)); continue; }
        const mul = speedMulOf(e, cfg);
        if (e.state === 'grab' || e.state === 'cling') { // 掴んでからの秒（見た目が主人公の横へ寄るのに使う）
          e.grabTime = (e.grabTime ?? 0) + dt;
          if (e.unpile != null) e.unpile += dt;
          if (e.state === 'grab') orbitStep(e, dt, E.grabRange, E.orbitSpeed * mul);
          else orbitStep(e, dt, swarmRing(e.layer, cfg), E.swarm.speed * mul);
          e.lean = (e.lean ?? e.turn) + (e.turn - (e.lean ?? e.turn)) * (1 - Math.exp(-dt / LEAN_SEC));
          continue;
        }
        if (e.x == null) { e.x = H.x + Math.cos(e.angle) * e.dist; e.z = H.z + Math.sin(e.angle) * e.dist; } // 角度と距離だけの者（試し。主人公から）
        if (e.state === 'approach') e.state = 'chase';
        e.heading ??= e.angle + Math.PI;
        e.speed ??= approachSpeed(e.dist, cfg);
        e.turn ??= 0;
        if (e.patrol && !e.hunting) { patrolStep(e, dt); if (e.dist <= E.spotDist) trySpot(e, dt); e.lean = (e.lean ?? e.turn) + (e.turn - (e.lean ?? e.turn)) * (1 - Math.exp(-dt / LEAN_SEC)); continue; }
        if (e.state === 'search') searchStep(e, dt);
        let arrived = false;
        const free = grabbing < E.maxGrabbing;
        const ring = free ? E.grabRange : swarmRing(clinging, cfg);
        if (e.state === 'chase' && e.dist <= ring) { // もう輪の内側（大きな群れの外の輪・試しの置き方）: その場から回り始める
          orbitStep(e, dt, ring, (free ? E.orbitSpeed : E.swarm.speed) * mul);
          arrived = true;
        } else if (e.state === 'chase') arrived = chaseStep(e, dt, ring);
        // 傾きの見た目に使う、なめらかにした曲がる速さ（交差点の一瞬の曲がりでちらつかない）
        e.lean = (e.lean ?? e.turn) + (e.turn - (e.lean ?? e.turn)) * (1 - Math.exp(-dt / LEAN_SEC));
        if (!arrived) continue;
        e.grabTime = 0;
        // 着いた瞬間から回り始める（速さ・向きは回る者のもの）。外へは出ない
        e.speed = Math.max(e.speed, (free ? E.orbitSpeed : E.swarm.speed) * mul);
        e.heading = wrap(e.angle + Math.PI / 2);
        if (free) { e.state = 'grab'; grabbing++; } else { e.state = 'cling'; e.swarmSeq = swarmSeq++; e.layer = clinging++; }
      }
      relayer();

      // 区間の真ん中の速さで足す（台形と同じで、刻み幅によらず同じ数が湧く）
      acc += spawnRateAt(time + dt / 2, cfg) * dt;
      time += dt;
      while (acc >= 1) {
        acc -= 1;
        list.push(spawn());
      }
      // R1: 大物は boss.at 秒に 1 体だけ（気配を感じた者として、すぐ主人公へ向かう）。湧いた場所は arrivals で知らせる
      if (KB && !bossBorn && time >= KB.at) {
        bossBorn = true;
        const b = spawn(typeRng, 'boss');
        b.alert = true;
        list.push(b);
        arrivals.push({ id: b.id, x: b.x, z: b.z, t: time, dist: Math.hypot(b.x - H.x, b.z - H.z) });
      }
      drainLoad = 0;
      for (const e of list) if (e.state === 'grab') drainLoad += drainMulOf(e, cfg);
      return grabbing;
    },
    // M2（持ち主 15:20）: 主人公が物陰に隠れた。追っている者（chase）は見失い、at（最後に見た所）を探す者へ戻る（知らせは伝えない）。
    // 伝える途中の知らせも止める。見失った者の数を返す
    loseHero(at) {
      let n = 0;
      for (const e of list) {
        if (e.state === 'search') { e.relayAt = null; continue; }
        if (e.state !== 'chase' && e.state !== 'approach') continue;
        if (e.x == null) { e.x = H.x + Math.cos(e.angle) * e.dist; e.z = H.z + Math.sin(e.angle) * e.dist; }
        e.state = 'search'; e.alert = true; e.searchTime = 0; e.relayAt = null;
        e.heard = { x: at.x, z: at.z, t: time }; e.hops = AL?.hops ?? 0;
        e.speed = Math.max(e.speed ?? 0, E.searchSpeed * speedMulOf(e, cfg) * 0.6);
        resumeRoad(e);
        n++;
      }
      return n;
    },
    // 掴んでいる者の吸う力の合計（ふつうの者 1 人を 1。吸う者 2.5、大物 4）。update のあとの値
    get drainLoad() { return drainLoad; },
    // 主人公の位置（heroPos。種類の仕組みが使う）
    get heroPos() { return heroPos; },
    // 大物が湧いた知らせ（{ id, x, z, t, dist（主人公から）}）。読んだら空にする
    takeArrivals() { return arrivals.splice(0); },
    // 前線 front m の内の者に当てる。当たった数（倒れた者とよろめいた者）を返す。
    // blast: { id, small }。small（払う）なら、hp の残る者（重い者・大物）は倒れずによろめき、同じ一発（id）には二度当たらない。
    // 省けば（最後の一発）、当たった者はみな倒れる
    // centre（M1）: 一発の爆心 { x, z }（放った・払った瞬間の主人公の位置）。距離はそこから測る（省けば今の主人公からの e.dist）
    applyBlastFront(front, blast = null, centre = null) {
      let hits = 0;
      const small = !!blast?.small;
      for (const e of list) {
        if (e.state === 'dead') continue;
        const d = centre && e.x != null ? Math.hypot(e.x - centre.x, e.z - centre.z) : e.dist;
        if (d > front) continue;
        if (small && blast.id != null) { if (e.lastHit === blast.id) continue; e.lastHit = blast.id; }
        hits++;
        const hp = e.hp ?? kindOf(e, E)?.hp ?? 1;
        if (small && hp > 1) {
          e.hp = hp - 1;
          if (e.state === 'grab' || e.state === 'cling') { delete e.layer; e.unpile = null; }
          e.state = 'stagger'; e.staggerT = 0;
          continue;
        }
        e.state = 'dead';
        e.deadTime = 0;
      }
      if (hits) relayer();
      return hits;
    },
  };
}
