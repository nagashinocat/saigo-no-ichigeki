import { CONFIG } from '../config.js';

// M1（持ち主 09:15、spec §16）: 指の操作（左右に分けない）。描画もゲームも知らず、指の id・画面の px・時刻（秒）だけで決める。
//  1 本目の指（どこでも）: 触れたら溜め（onChargeStart）、離すと放つ（onChargeEnd）。pointercancel・reset は放たずに打ち切る（onChargeCancel）
//  溜めている間の 2 本目の指:
//    longPressSec 秒以上押す、または tapMovePx px 以上動かす → 押した所に浮かぶジョイスティック（stick）。滑らせた向きと量が dir。
//      離すと消える（払わず、放たない）
//    それより短く、動きも tapMovePx px 未満で離す → 払う（onPuff(x, y)。押した所に「足りない」を出せるように）
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

export function createControls({ onChargeStart = () => {}, onChargeEnd = () => {}, onChargeCancel = () => {}, onPuff = () => {}, cfg = CONFIG } = {}) {
  const C = cfg.controls;
  let charge = null; // 溜めの指の id
  let second = null; // 2 本目: { id, x0, y0, t0, stick, dir }
  const dead = new Set(); // 溜めの指が離れたあとも残っている指（離れるまで何もしない）
  let stick = null; // { cx, cy, kx, ky }（画面の px。描く側が読む）

  const toStick = (s) => { s.stick = true; stick = { cx: s.x0, cy: s.y0, kx: s.x0, ky: s.y0 }; };
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
      second = { id, x0: x, y0: y, t0: t, stick: false, dir: ZERO };
    },
    move(id, x, y, t) {
      if (!second || id !== second.id) return;
      if (!second.stick && (Math.hypot(x - second.x0, y - second.y0) >= C.tapMovePx || t - second.t0 >= C.longPressSec)) toStick(second);
      if (!second.stick) return;
      const v = stickVector(x - second.x0, y - second.y0, C);
      second.dir = v;
      // つまみは指の所（輪の外なら輪の縁）
      const dx = x - second.x0, dy = y - second.y0, d = Math.hypot(dx, dy), k = d > C.stickRadiusPx ? C.stickRadiusPx / d : 1;
      stick.kx = second.x0 + dx * k; stick.ky = second.y0 + dy * k;
    },
    up(id, x, y, t) {
      if (dead.delete(id)) return;
      if (id === charge) { endCharge(onChargeEnd); return; }
      if (!second || id !== second.id) return;
      const tap = !second.stick && t - second.t0 < C.longPressSec && Math.hypot(x - second.x0, y - second.y0) < C.tapMovePx;
      dropSecond();
      if (tap) onPuff(x, y);
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
