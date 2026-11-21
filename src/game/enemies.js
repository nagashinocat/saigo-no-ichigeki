import { CONFIG } from '../config.js';
import { GRID } from '../world/cityGen.js';

const DEAD_KEEP_SEC = 3;
const LEAN_SEC = 0.12; // 傾きの見た目のなめらかさ（s）
const P = GRID.PITCH;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 湧く速さ（体/秒）。始まりから rampSec 秒で spawnRamp 倍へ一直線に増え、その後は保つ
export function spawnRateAt(t, cfg = CONFIG) {
  const E = cfg.enemy;
  const k = Math.min(1, Math.max(0, t / E.rampSec));
  return E.spawnPerSec * (1 + (E.spawnRamp - 1) * k);
}

// 見つけたあと近づく速さ（m/s）。掴む手前の slowDist m で、なめらかに slowMin 倍まで落とす。距離は主人公からの水平の距離
export function approachSpeed(dist, cfg = CONFIG) {
  const E = cfg.enemy;
  const t = Math.min(1, Math.max(0, (dist - E.grabRange) / E.slowDist));
  return E.speed * (E.slowMin + (1 - E.slowMin) * t * t * (3 - 2 * t));
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
// 交差点で曲がる。主人公から spotDist m の内側で建物にさえぎられずに見えたら見つけて（chase）、急に止まって短くにらみ、
// 一直線に全速で突っ込み、最後の slowDist m だけ急ブレーキして横に飛びつき、掴む（grab）。
// 掴む枠がいっぱいでも止まって待たない（持ち主の要望 2026-11-21 10:01「主人公の手前でまだ待ってるからそのまま突っ込んで」）:
// そのまま突っ込み、掴んでいる者の外に重なって飛びつく（cling。力は減らさない）。枠が空けば、先に飛びついた者からすぐ掴む。
// 爆発の前線に触れると倒れる（dead）。時間がたつほど多く湧く。判定（払う・爆発・掴む）は主人公からの水平の距離 dist。
// 一人ごと: x, z（m）、dist、angle（主人公から見た向き）、heading（進む向き。x 軸から z 軸へ）、turn（曲がる速さ rad/s）、speed、
//   searchTime（探した秒）、alert（気配を感じて主人公の方へ寄っていく）、grabTime（掴んだ・飛びついてからの秒）、
//   layer（飛びついた者の重なりの段 0, 1, …）、unpile（重なりから下りて掴んでからの秒）、lean（なめらかにした turn。見た目の傾き）
// buildings: 見通しを確かめる建物（遊んでいる間は壊れない）
export function createEnemies(rng, cfg = CONFIG, { buildings = [] } = {}) {
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
  function chooseNext(e) {
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
    let r = rng() * sum, pick = opts[opts.length - 1];
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
    if ((tx - e.x) * e.di + (tz - e.z) * e.dj < lead) { chooseNext(e); [tx, tz] = target(e); }
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
      if (e.dist <= E.spotDist && lineOfSight(e.x, e.z, near, E.sightMargin)) { e.state = 'chase'; e.pause = E.spotPause; }
    }
  }

  // 見つけた者: 急に止まって主人公の方へ向き直り、spotPause 秒にらんでから（見つけた一拍）、主人公へ一直線に突っ込む
  // （曲がりきれる速さで向きを変える）。減速は最後の slowDist m だけ（approachSpeed）。掴む距離 grabRange で止まる。
  // 主人公からの距離は一度も増えない（向き直る途中の惰性で外へ向かう分は、主人公のまわりを回る向きへ逃がす）
  function chaseStep(e, dt) {
    const toHero = Math.atan2(-e.z, -e.x);
    steer(e, toHero, e.dist < E.snapDist ? Math.PI * 8 : E.chaseTurnRate, dt);
    if (e.pause > 0) {
      accel(e, 0, dt);
      if (e.speed < 0.5) e.pause -= dt;
    } else {
      e.speed = Math.min(approachSpeed(e.dist, cfg), e.speed + E.chaseAccel * dt); // 減速の曲線より速くならない
    }
    if (e.dist <= E.grabRange) { e.speed = 0; return; } // もう掴む距離の内側（試しの置き方など）: 外へ押し戻さない
    const step = e.speed * dt;
    let nx = e.x + Math.cos(e.heading) * step, nz = e.z + Math.sin(e.heading) * step;
    let nd = Math.hypot(nx, nz);
    if (nd > e.dist) { const k = e.dist / nd; nx *= k; nz *= k; nd = e.dist; }
    if (nd <= E.grabRange) { // 掴む距離で止まる（今いる所から主人公へ向かう線の上。行き過ぎない）
      const k = E.grabRange / Math.max(1e-9, e.dist);
      nx = e.x * k; nz = e.z * k;
      e.speed = 0;
    }
    e.x = nx; e.z = nz;
    place(e);
  }

  // 飛びついた者に重なりの段を、飛びついた順に 0, 1, … と振り直す
  const relayer = () => { let k = 0; for (const e of list) if (e.state === 'cling') e.layer = k++; };

  return {
    get list() { return list; },
    update(dt) {
      for (const e of list) if (e.state === 'dead') e.deadTime += dt;
      list = list.filter((e) => e.state !== 'dead' || e.deadTime < DEAD_KEEP_SEC);

      let grabbing = list.reduce((n, e) => n + (e.state === 'grab' ? 1 : 0), 0);
      // 枠が空いていれば、先に飛びついた者からすぐ掴む（もう主人公の横にいるので動かない）
      for (const e of list) {
        if (grabbing >= E.maxGrabbing) break;
        if (e.state !== 'cling') continue;
        e.state = 'grab'; e.unpile = 0; grabbing++; // layer は残す（重なりから下りる見た目）
      }
      for (const e of list) {
        if (e.state === 'grab' || e.state === 'cling') { // 掴んでからの秒（見た目が主人公の横へ寄るのに使う）
          e.grabTime += dt;
          if (e.unpile != null) e.unpile += dt;
          continue;
        }
        if (e.state === 'dead') continue;
        if (e.x == null) { e.x = Math.cos(e.angle) * e.dist; e.z = Math.sin(e.angle) * e.dist; } // 角度と距離だけの者（試し）
        if (e.state === 'approach') e.state = 'chase';
        e.heading ??= e.angle + Math.PI;
        e.speed ??= approachSpeed(e.dist, cfg);
        e.turn ??= 0;
        if (e.state === 'search') searchStep(e, dt);
        if (e.state === 'chase') chaseStep(e, dt);
        // 傾きの見た目に使う、なめらかにした曲がる速さ（交差点の一瞬の曲がりでちらつかない）
        e.lean = (e.lean ?? e.turn) + (e.turn - (e.lean ?? e.turn)) * (1 - Math.exp(-dt / LEAN_SEC));
        if (e.state !== 'chase') continue;
        if (e.dist > E.grabRange + 1e-9) continue;
        e.grabTime = 0; e.speed = 0; e.turn = 0; e.lean = 0;
        if (grabbing < E.maxGrabbing) { e.state = 'grab'; grabbing++; } else e.state = 'cling';
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
