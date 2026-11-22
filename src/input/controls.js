import { CONFIG } from '../config.js';

// M1（持ち主 09:15、spec §16）: 指の操作（左右に分けない）。描画もゲームも知らず、指の id・画面の px・時刻（秒）だけで決める。
//  1 本目の指（どこでも）: 触れたら溜め（onChargeStart）、離すと放つ（onChargeEnd）。pointercancel・reset は放たずに打ち切る（onChargeCancel）
//  溜めている間の 2 本目の指:
//    longPressSec 秒以上押す、または tapMovePx px 以上動かす → 押した所に浮かぶジョイスティック（stick）。滑らせた向きと量が dir
//      （つまみと向きは最後の指の所から。動かずに長押しでなっても、それまでのずれを捨てない）。離すと消える（払わず、放たない）
//    R1f（持ち主 18:14「払うが反応し辛いのかスワイプと誤認識してるのか…似た操作はやめよう」）: R1e のシュッ（なぞって隠れる）はやめた。
//    タップ: 触れてから longPressSec 秒より前に離し、触れた所からの動きがいちばん遠くでも tapSlopPx px 未満（10 px で仮のスティックが出ていてもよい）。
//      タップが hideHit(x, y)（LOOK OUT! の矢印の当たり。触れた所で見る）に入れば onHide(x, y)、外なら払う（onPuff(x, y)。押した所に「足りない」を出せるように）
//    M2 のスティックを同じ向きに 2 回倒して隠れるはやめた（R1e。溜めながらでは使えなかった。PC の向きのキーの 2 回押しは keyTwice.js）
//  3 本目からの指は無視する。溜めの指が離れたら、2 本目（スティック）は消え、その指は離れるまで何もしない
//  溜めていない（1 本目がない）ときは、動きも払うもない（最初の指は必ず溜め）

// スティックの中心からのずれ（px）→ 動く向き（画面の x 右・y 下、長さ 0〜1）。deadPx の内は 0、輪（stickRadiusPx）で 1
export function stickVector(dx, dy, c = CONFIG.controls) {
  const d = Math.hypot(dx, dy);
  if (d <= c.deadPx) return { x: 0, y: 0 };
  const m = Math.min(1, (d - c.deadPx) / (c.stickRadiusPx - c.deadPx));
  return { x: (dx / d) * m, y: (dy / d) * m };
}

// PC: 押しているキー（KeyboardEvent.code の集まり）→ 動く向き（画面の x 右・y 下、斜めも長さ 1）
const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
export const MOVE_KEYS = Object.keys(KEYS);
export function keyVector(down) {
  let x = 0, y = 0;
  const seen = new Set();
  for (const k of down) {
    const v = KEYS[k];
    if (!v || seen.has(v.join())) continue; // 矢印と WASD の同じ向きは二重に数えない
    seen.add(v.join());
    x += v[0]; y += v[1];
  }
  const m = Math.hypot(x, y);
  return m > 0 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
}

const ZERO = Object.freeze({ x: 0, y: 0 });

// R1e: 画面の向き（x 右・y 下）→ 街の向き（x, z）。上空カメラの向き azimuthDeg（views.js の CITY_CAMERA。0 で画面の右 = 世界の +x、
// 画面の下 = 世界の +z）で回す。ui/stickMarks.js の screenBearingDeg（街 → 画面）の逆。スティックの動く向き・PC の向きのキーの隠れるもこれで直す
export function screenToWorld(sx, sy, azimuthDeg = 0) {
  if (!azimuthDeg) return { x: sx + 0, z: sy + 0 };
  const az = (azimuthDeg * Math.PI) / 180, c = Math.cos(az), s = Math.sin(az);
  return { x: sx * c + sy * s, z: -sx * s + sy * c };
}

export function createControls({ onChargeStart = () => {}, onChargeEnd = () => {}, onChargeCancel = () => {}, onPuff = () => {}, onHide = () => {}, hideHit = null, cfg = CONFIG } = {}) {
  const C = cfg.controls;
  const slop = C.tapSlopPx ?? C.tapMovePx;
  let charge = null; // 溜めの指の id
  let second = null; // 2 本目: { id, x0, y0, t0, x, y（最後の指の所）, far（触れた所からいちばん遠くまで動いた px）, stick, dir }
  const dead = new Set(); // 溜めの指が離れたあとも残っている指（離れるまで何もしない）
  let stick = null; // { cx, cy, kx, ky }（画面の px。描く側が読む）

  // つまみと向きを最後の指の所 (s.x, s.y) から（輪の外なら輪の縁）
  function aim(s) {
    s.dir = stickVector(s.x - s.x0, s.y - s.y0, C);
    const dx = s.x - s.x0, dy = s.y - s.y0, d = Math.hypot(dx, dy), k = d > C.stickRadiusPx ? C.stickRadiusPx / d : 1;
    stick.kx = s.x0 + dx * k; stick.ky = s.y0 + dy * k;
  }
  const toStick = (s) => { s.stick = true; stick = { cx: s.x0, cy: s.y0, kx: s.x0, ky: s.y0 }; aim(s); };
  function track(s, x, y) {
    s.x = x; s.y = y;
    s.far = Math.max(s.far, Math.hypot(x - s.x0, y - s.y0));
  }
  function dropSecond(keep = false) {
    if (second && keep) dead.add(second.id);
    second = null; stick = null;
  }
  function endCharge(fn) {
    charge = null;
    dropSecond(true);
    fn();
  }
  return {
    get charging() { return charge !== null; },
    // 溜めの指の id（無ければ null。DOM の配線 bindDom.js が、溜めの指の離す操作を見分けるのに使う）
    get chargeId() { return charge; },
    // 浮かぶスティック（無ければ null）
    get stick() { return stick; },
    // 動く向き（画面の x 右・y 下、長さ 0〜1）
    get dir() { return second?.stick && second.dir ? second.dir : ZERO; },
    down(id, x, y, t) {
      if (charge === null) {
        if (dead.has(id)) return;
        charge = id;
        onChargeStart();
        return;
      }
      if (id === charge || second || dead.has(id)) return; // 3 本目は無視
      second = { id, x0: x, y0: y, t0: t, x, y, far: 0, stick: false, dir: ZERO };
    },
    move(id, x, y, t) {
      if (!second || id !== second.id) return;
      track(second, x, y);
      if (!second.stick && (Math.hypot(x - second.x0, y - second.y0) >= C.tapMovePx || t - second.t0 >= C.longPressSec)) { toStick(second); return; }
      if (second.stick) aim(second);
    },
    up(id, x, y, t) {
      if (dead.delete(id)) return;
      if (id === charge) { endCharge(onChargeEnd); return; }
      if (!second || id !== second.id) return;
      const s = second;
      track(s, x, y);
      dropSecond();
      // R1f: タップ（0.18 秒より前に離し、触れた所から slop 未満）。仮のスティックが出ていてもタップ。矢印の当たりなら隠れる、外なら払う
      if (t - s.t0 >= C.longPressSec || s.far >= slop) return;
      if (hideHit?.(s.x0, s.y0)) onHide(s.x0, s.y0);
      else onPuff(x, y);
    },
    cancel(id) {
      if (dead.delete(id)) return;
      if (id === charge) { endCharge(onChargeCancel); return; }
      if (second && id === second.id) dropSecond();
    },
    // 時刻を進める（指が動かなくても、長押しでスティックが出る）
    update(t) {
      if (second && !second.stick && t - second.t0 >= C.longPressSec) toStick(second);
    },
    // タブを隠した・blur: 放たずに打ち切る。残っている指も忘れる（up が来ないことがある）
    reset() {
      dead.clear();
      if (charge !== null) { charge = null; dropSecond(); onChargeCancel(); } else dropSecond();
    },
  };
}
