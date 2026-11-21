import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FIELD } from './heroBody.js';
import { RIDER, bikeParts, SUIT, PLATE, DARK, HELM, BOOT, HULL, DECK, BELLY, HOUSING } from './hoverBike.js';
import { srgb, part } from './figureGeo.js';

// 演出の肩越しのカットで大きく映る軍勢の一人（浮遊バイクの乗り手）の体。instanced の軍勢（hoverBike.js）は箱と筒の寄せ集めで、
// 遠くでは読みやすいが、背後から画面の 3 分の 1 を占めると箱に見える。この一人だけは主人公（heroBody.js）と同じやり方で、
// 距離の場を滑らかにつないで Surface Nets で網にする。背後から逆光の影絵になっても人として読めるように、輪郭に段と折れを作る:
// 卵形のヘルメット（あごから首へつながり、前に目の開き、中に覆面）、首から肩へ下りる僧帽筋、肩当ての二枚の段、
// 背中の広がりから細い腰への V、背骨に沿った段々の当て物、外へ張った肘と肘当て、握りを包む指の分かれた手袋。
// バイクの後ろ半分（座席・尾の盛り上がり・車体・輪をつなぐ腕）も距離の場で丸く、握り・安定板・足の板は丸い形で組み直す。
// 部位の番号・座り方は instanced の乗り手と同じ（figureGeo の aPart / aPivot / aCol）なので、同じ材質（enemyView の
// FIGURE_VERT）が前かがみ・腕・頭の向き（aPose.z）を同じように動かす。胴・頭は立った兵士の座標で組み、腰の高さへ動かす
// （hoverBike の riderParts と同じ）。腕は前かがみで握りを持った姿（バイクの座標）で組み、材質が回す分を逆に戻して置く
// （肘を外へ張って曲げた形が、材質の回転のあとにそのまま出る）。脚・座席・車体はバイクの座標で組む。

export const RIDER_BODY = {
  // 格子の間隔（m）: 胴・脚 / 頭 / 腕と手袋 / 車体
  detail: {
    high: { body: 0.016, head: 0.0095, arm: 0.0115, bike: 0.024 },
    mid: { body: 0.021, head: 0.0125, arm: 0.015, bike: 0.032 },
    low: { body: 0.032, head: 0.019, arm: 0.023, bike: 0.048 },
  },
  maxVerts: { low: 11500, mid: 25500, high: 43500 },
};

const { capsule, ellipsoid, roundBox, clip, makeField, meshField } = FIELD;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const [HX, HY, HZ] = RIDER.hip;
const DY = HY - 0.95, DZ = HZ; // 立った兵士の腰（0.95）から、鞍の上の腰へ
const HIP = V(HX, HY, HZ);
const rotX = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return V(v.x, v.y * c - v.z * s, v.y * s + v.z * c); };
// 立った兵士の座標 → 腰の高さへ動かした座標（材質が回す前）→ 前かがみの姿（バイクの座標）
const rest = (x, y, z) => V(x, y + DY, z + DZ);
const leaned = (p) => rotX(p.clone().sub(HIP), RIDER.lean).add(HIP);
// 腕の付け根（材質が握りへ回す軸。立った兵士の肩の関節）
const SHOULDER = (s) => rest(0.2 * s, 1.395, -0.012);

// 距離の場の道具（heroBody の部品に足りないもの）: 包む球を付ける・滑らかな和と差
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function bound(fn, c, r) {
  fn.cx = c.x; fn.cy = c.y; fn.cz = c.z; fn.r = r;
  fn.box = new THREE.Box3(V(c.x - r, c.y - r, c.z - r), V(c.x + r, c.y + r, c.z + r));
  return fn;
}

// 胴（0、立った兵士の座標）: 骨盤・細い腰・胸郭・背中の広がり（腰へ細くなる V）・肩甲骨・僧帽筋・肩の張り・肩当て（二枚の段）・
// 背骨に沿った段々の当て物・腰の上のしわ・立った襟・ベルト
function torsoPrims() {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  add(ellipsoid(V(0, 0.95, -0.012), Q(), [0.15, 0.1, 0.112]), 0.04, SUIT);   // 骨盤
  add(ellipsoid(V(0, 1.075, -0.004), Q(), [0.138, 0.11, 0.1]), 0.05, SUIT);   // 腰（胸より細い）
  add(ellipsoid(V(0, 1.245, 0), Q(), [0.165, 0.16, 0.112]), 0.05, SUIT);      // 胸郭
  add(ellipsoid(V(0, 1.27, 0.052), Q(), [0.14, 0.1, 0.07]), 0.03, PLATE);     // 胸の当て物
  for (const s of [1, -1]) {
    add(ellipsoid(V(0.125 * s, 1.235, -0.035), Q(0, 0, -0.3 * s), [0.075, 0.16, 0.085]), 0.04, SUIT); // 背中の広がり（広背筋）
    add(ellipsoid(V(0.085 * s, 1.33, -0.068), Q(0, 0, 0.35 * s), [0.085, 0.085, 0.052]), 0.035, SUIT); // 肩甲骨
    add(capsule(V(0.035 * s, 1.49, -0.035), V(0.175 * s, 1.41, -0.022), 0.05, 0.048), 0.035, SUIT); // 僧帽筋（首から肩へ下りる）
    add(capsule(V(0.11 * s, 1.405, -0.015), V(0.2 * s, 1.385, -0.012), 0.062, 0.062), 0.035, SUIT);   // 肩の張り
    // 肩当て: 上の大きい一枚と、その下にずらして重なる小さい一枚（縁が段になる）
    const plate = (c, r, rz, cut) => clip(ellipsoid(c, Q(0, 0, rz), r), cut, V(-0.45 * s, -1, 0.05).normalize());
    add(plate(V(0.215 * s, 1.388, -0.012), [0.092, 0.056, 0.092], -0.42 * s, V(0.2 * s, 1.36, 0)), 0.006, PLATE);
    add(plate(V(0.255 * s, 1.34, -0.012), [0.07, 0.05, 0.08], -0.8 * s, V(0.25 * s, 1.31, 0)), 0.006, PLATE);
    // 脇から背へ斜めのしわ
    add(capsule(V(0.155 * s, 1.16, -0.045), V(0.075 * s, 1.07, -0.1), 0.01, 0.009), 0.012, SUIT);
  }
  // 背骨に沿った段々の当て物（上から下へ少しずつ細く、重なりの縁が段になる）
  // 背中の当て物: 肩甲骨の間で広く、腰へ細くなる一枚（縁が段になる）。縦の浅い溝
  {
    const up = ellipsoid(V(0, 1.315, -0.1), Q(-0.1), [0.115, 0.105, 0.036]);
    const lo = ellipsoid(V(0, 1.15, -0.094), Q(0.05), [0.068, 0.085, 0.032]);
    const groove = capsule(V(0, 1.41, -0.145), V(0, 1.08, -0.132), 0.008, 0.008);
    const fn = (x, y, z) => smax(smin(up(x, y, z), lo(x, y, z), 0.05), -groove(x, y, z), 0.006);
    add(bound(fn, V(0, 1.25, -0.1), 0.24), 0.005, PLATE);
  }
  // 腰の上の横じわ（上着が前かがみでたまる）
  add(capsule(V(-0.11, 1.035, -0.092), V(0.11, 1.038, -0.096), 0.011, 0.011), 0.022, SUIT);
  // 立った襟（前が開いた輪）
  const ring = 9;
  for (let i = 0; i < ring; i++) {
    const a0 = -2.5 + (i / ring) * 5, a1 = -2.5 + ((i + 1) / ring) * 5;
    const p = (a, dy) => V(Math.sin(a + Math.PI) * 0.078, 1.5 + dy - 0.014 * Math.cos(a), -0.03 + Math.cos(a + Math.PI) * 0.07);
    add(capsule(p(a0, 0), p(a1, 0), 0.026, 0.026), 0.03, DARK);
    add(capsule(p(a0, 0.03), p(a1, 0.03), 0.02, 0.02), 0.03, DARK); // 襟の上（首を包む）
  }
  add(ellipsoid(V(0, 0.985, -0.004), Q(), [0.158, 0.032, 0.12]), 0.016, DARK); // ベルト
  // 右肩から左の腰へ斜めに背を渡る負い紐
  {
    const pts = [V(-0.17, 1.4, -0.03), V(-0.11, 1.33, -0.1), V(-0.02, 1.22, -0.125), V(0.07, 1.11, -0.112), V(0.14, 1.0, -0.075)];
    for (let i = 0; i < pts.length - 1; i++) add(capsule(pts[i], pts[i + 1], 0.012, 0.012, V(0, 0, 1), 0.5), 0.006, DARK);
  }
  return P;
}

// 頭（1、立った兵士の座標）: 首と覆面、卵形のヘルメット（前に目の開き、下の縁は後ろが上がる）、あごから首へのつながり
function headPrims() {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  add(capsule(V(0, 1.44, -0.03), V(0, 1.59, -0.01), 0.06, 0.055), 0.025, DARK);          // 首（覆面）
  add(capsule(V(0, 1.548, 0.045), V(0, 1.47, 0.008), 0.04, 0.044), 0.03, DARK);          // のど: あごから首へ
  add(ellipsoid(V(0, 1.6, 0.03), Q(), [0.066, 0.068, 0.074]), 0.02, DARK);               // 覆面の顔（目の開きの奥に見える）
  // ヘルメット: 後ろ上が大きく前下が細い卵形。下の縁（後ろは首の上、前はあご）で切り、前に目の開き
  const back = ellipsoid(V(0, 1.655, -0.02), Q(-0.2), [0.1, 0.11, 0.124]);
  const chin = ellipsoid(V(0, 1.59, 0.045), Q(0.3), [0.078, 0.072, 0.078]);
  const slot = roundBox(V(0, 1.634, 0.11), Q(0.12), [0.076, 0.02, 0.07], 0.012);
  const nape = ellipsoid(V(0, 1.6, -0.06), Q(-0.35), [0.098, 0.045, 0.085]); // 後ろの下の縁が首を覆うように少し張り出す
  const helmet = (x, y, z) => {
    let d = smin(smin(back(x, y, z), chin(x, y, z), 0.06), nape(x, y, z), 0.04);
    d = smax(d, -(y - 1.562) - 0.15 * z, 0.006);
    return smax(d, -slot(x, y, z), 0.006);
  };
  add(bound(helmet, V(0, 1.65, 0.0), 0.19), 0.012, HELM);
  return P;
}

// 腕（2 左 +x / 3 右 −x）: 前かがみで握りを持った姿（バイクの座標）。肩から肘を外へ張り、前腕は握りへ。肘当て・前腕の当て物・
// 手袋の袖口・手の甲・指の付け根の当て物・握りを包む 4 本の指と親指
const GRIP = { y: 0.98, z: 0.42, r: 0.021, x0: 0.2, x1: 0.315 };
function armPrims(s) {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  const S = leaned(SHOULDER(s));
  const E = V(0.335 * s, 0.995, 0.06);   // 肘（外へ張る）
  const W = V(0.27 * s, 1.0, 0.345);     // 手首
  const u = E.clone().sub(S), f = W.clone().sub(E);
  const along = (a, b, t) => a.clone().lerp(b, t);
  add(ellipsoid(along(S, E, 0.18).add(V(0.008 * s, 0.006, 0)), Q(0.75), [0.058, 0.06, 0.078]), 0.04, SUIT); // 三角筋
  add(capsule(S, E, 0.06, 0.048), 0.03, SUIT);                                       // 上腕
  add(capsule(along(S, E, 0.3), along(S, E, 0.72), 0.058, 0.052), 0.03, SUIT);       // 二頭・三頭のふくらみ
  add(ellipsoid(E.clone().add(V(0.022 * s, 0.012, -0.022)), Q(), [0.046, 0.042, 0.044]), 0.01, PLATE); // 肘当て
  add(capsule(E, W, 0.05, 0.039), 0.025, SUIT);                                      // 前腕
  add(capsule(along(E, W, 0.08), along(E, W, 0.45), 0.056, 0.05), 0.03, SUIT);       // 前腕のふくらみ
  add(capsule(along(E, W, 0.3).add(V(0, 0.03, 0)), along(E, W, 0.75).add(V(0, 0.022, 0)), 0.03, 0.026), 0.012, PLATE); // 前腕の当て物
  add(capsule(along(E, W, 0.78), W.clone().addScaledVector(f.clone().normalize(), 0.01), 0.046, 0.044), 0.008, DARK); // 手袋の袖口
  // 手: 手の甲は握りの上に前へ下がって載り、指は握りの前から下へ回り込む
  const gx = (t) => s * (GRIP.x0 + 0.035 + t * 0.07); // 人差し指（内）〜小指（外）
  add(roundBox(V(gx(0.5), GRIP.y + 0.03, GRIP.z - 0.03), Q(0.55), [0.043, 0.016, 0.042], 0.016), 0.014, DARK); // 手の甲
  add(capsule(W, V(gx(0.5), GRIP.y + 0.03, GRIP.z - 0.05), 0.036, 0.032), 0.02, DARK);   // 手首から手の甲へ
  add(capsule(V(gx(-0.05), GRIP.y + 0.036, GRIP.z + 0.004), V(gx(1.05), GRIP.y + 0.034, GRIP.z + 0.002), 0.015, 0.014), 0.006, PLATE); // 指の付け根の当て物
  const R = GRIP.r + 0.012;
  const ring = (x, a) => V(x, GRIP.y + R * Math.cos(a), GRIP.z + R * Math.sin(a));
  for (let i = 0; i < 4; i++) {
    const x = gx(i / 3), r0 = i === 3 ? 0.0105 : 0.0118;
    const as = [0.2, 0.95, 1.75, 2.45 - i * 0.08];
    for (let j = 0; j < 3; j++) add(capsule(ring(x, as[j]), ring(x, as[j + 1]), r0 - j * 0.0008, r0 - (j + 1) * 0.0008), 0.004, DARK);
  }
  // 親指: 手の内側から握りの下へ
  const tx = s * (GRIP.x0 + 0.03);
  add(capsule(V(tx, GRIP.y + 0.012, GRIP.z - 0.04), V(tx - 0.004 * s, GRIP.y - 0.022, GRIP.z - 0.02), 0.014, 0.013), 0.006, DARK);
  add(capsule(V(tx - 0.004 * s, GRIP.y - 0.022, GRIP.z - 0.02), V(tx + 0.006 * s, GRIP.y - 0.03, GRIP.z + 0.012), 0.013, 0.011), 0.004, DARK);
  return P;
}

// 脚（4、バイクの座標）: 尻、腿は腰から前へ、膝当て、すねは足の板へ、ふくらはぎ、すねの当て物、かかとのある靴
function legPrims() {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  for (const s of [1, -1]) {
    add(ellipsoid(V(0.078 * s, 0.735, -0.355), Q(), [0.085, 0.072, 0.085]), 0.04, SUIT);   // 尻
    add(capsule(V(0.11 * s, 0.755, -0.27), V(0.17 * s, 0.745, 0.1), 0.098, 0.068), 0.05, SUIT); // 腿
    add(ellipsoid(V(0.152 * s, 0.78, -0.09), Q(0, 0.1 * s, 0), [0.082, 0.062, 0.17]), 0.04, SUIT); // 腿の前のふくらみ
    add(ellipsoid(V(0.182 * s, 0.748, 0.13), Q(), [0.058, 0.064, 0.05]), 0.01, PLATE);      // 膝当て
    add(capsule(V(0.185 * s, 0.725, 0.105), V(0.225 * s, 0.5, 0.085), 0.06, 0.046), 0.03, SUIT); // すね
    add(ellipsoid(V(0.205 * s, 0.63, 0.055), Q(0.1), [0.05, 0.08, 0.048]), 0.03, SUIT);     // ふくらはぎ
    add(ellipsoid(V(0.207 * s, 0.6, 0.132), Q(0.1), [0.04, 0.09, 0.022]), 0.008, PLATE);   // すねの当て物
    add(capsule(V(0.225 * s, 0.52, 0.08), V(0.232 * s, 0.445, 0.07), 0.05, 0.05), 0.02, BOOT); // 足首
    add(capsule(V(0.232 * s, 0.44, 0.03), V(0.245 * s, 0.432, 0.22), 0.043, 0.036, V(0, 1, 0), 0.8), 0.025, BOOT); // 靴
  }
  return P;
}

// 車体（7、バイクの座標）: 六角の車体を丸めた板（上の明るい板・胴・下の暗い板が段に重なる）、座席の下から尾へ下る盛り上がり、
// 低い座席、輪をつなぐ腕。どれも丸い
// 六角（鼻先と尾が尖り、脇がまっすぐ。半幅 w・鼻先まで l）の 2 次元の符号付き距離。左右・前後が対称なので 4 分の 1 に折って、
// 斜めの辺と脇の辺の 2 本だけを見る
function sdHex(px, pz, w, l) {
  const x = Math.abs(px), z = Math.abs(pz);
  const seg = (ax, az, bx, bz) => {
    const ex = bx - ax, ez = bz - az, t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    return Math.hypot(x - ax - ex * t, z - az - ez * t);
  };
  const d = Math.min(seg(0, l, w, l / 2), seg(w, l / 2, w, 0));
  // 内側: 脇の辺より内、斜めの辺より下
  const inside = x < w && (z - l) * w + (l / 2) * x < 0;
  return inside ? -d : d;
}
// 角の丸い六角の板: 半幅 w・鼻先まで l・高さの半分 hh、上から見た角の丸み rp・縁の丸み re
function hexSlab(cy, cz, hh, w, l, rp, re) {
  const o = rp + re, wi = w - o, li = l - o * 1.9;
  const fn = (x, y, z) => {
    const d2 = sdHex(x, z - cz, wi, li) - rp, dy = Math.abs(y - cy) - (hh - re);
    return Math.min(Math.max(d2, dy), 0) + Math.hypot(Math.max(d2, 0), Math.max(dy, 0)) - re;
  };
  bound(fn, V(0, cy, cz), Math.hypot(w, hh, l));
  fn.box = new THREE.Box3(V(-w, cy - hh, cz - l), V(w, cy + hh, cz + l)); // 包む箱は板の大きさ（網にする格子を小さく）
  return fn;
}
function hullPrims() {
  const P = [];
  const add = (d, k, tag) => P.push({ d, k, tag });
  add(hexSlab(0.3, 0, 0.13, 0.38 * Math.sin(Math.PI / 3), 1.05, 0.09, 0.055), 0.02, HULL);
  add(hexSlab(0.135, 0, 0.07, 0.3 * Math.sin(Math.PI / 3), 0.85, 0.08, 0.04), 0.012, BELLY);
  add(hexSlab(0.44, 0.05, 0.022, 0.27 * Math.sin(Math.PI / 3), 0.74, 0.07, 0.016), 0.006, DECK);
  // 輪をつなぐ腕
  add(capsule(V(0, 0.3, 0.85), V(0, 0.3, 1.0), 0.04, 0.036, V(0, 1, 0), 0.7), 0.03, HOUSING);
  add(capsule(V(0, 0.3, -0.85), V(0, 0.3, -1.04), 0.05, 0.045, V(0, 1, 0), 0.7), 0.03, HOUSING);
  // 座席の下から尾へ下る盛り上がり（車体と同じ明るい色。座席の柱と箱の代わり）
  const hump = clip(ellipsoid(V(0, 0.47, -0.47), Q(0.08), [0.17, 0.17, 0.3]), V(0, 0.32, 0), V(0, -1, 0));
  add(hump, 0.07, HULL);
  add(clip(ellipsoid(V(0, 0.46, -0.84), Q(0.12), [0.11, 0.07, 0.22]), V(0, 0.32, 0), V(0, -1, 0)), 0.07, HULL);
  // 低い座席（乗り手の尻の下だけ）
  add(ellipsoid(V(0, 0.64, -0.37), Q(0.06), [0.14, 0.04, 0.2]), 0.02, BELLY);
  return P;
}

// 安定板: 薄く丸い翼の形（前縁が丸く後ろが細い。先は丸く閉じる）。root は付け根、span は外へ開く向き
function finGeometry(root, tilt, { span = 0.26, c0 = 0.36, c1 = 0.2, t = 0.11, sweep = 0.1, nu = 14, nv = 10 } = {}) {
  const pos = [], idx = [];
  const yt = (u) => 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
  const ring = 2 * nu;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const tip = v > 0.75 ? Math.sqrt(Math.max(0, 1 - ((v - 0.75) / 0.25) ** 2)) : 1; // 先は丸く閉じる
    const c = (c0 + (c1 - c0) * v) * (0.35 + 0.65 * tip), y = span * v;
    const lead = c0 / 2 - sweep * v - (c0 + (c1 - c0) * v - c) / 2; // 前縁の z
    for (let i = 0; i < ring; i++) {
      const k = i < nu ? i : ring - i, side = i < nu ? 1 : -1;
      const u = (1 - Math.cos((k / nu) * Math.PI)) / 2;
      pos.push(side * yt(u) * c * Math.max(tip, 0.02), y, lead - u * c);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < ring; i++) {
    const a = j * ring + i, b = j * ring + ((i + 1) % ring), c = a + ring, d = b + ring;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.rotateZ(tilt).translate(root.x, root.y, root.z);
  g.computeVertexNormals();
  // 巻きを外向きに（中心から外へ向かない三角形が多ければ裏返す）
  return g;
}

// 握り（丸い柱と棒・握りのゴム・端の小さな鍔）と、角の丸い足の板。どれもバイクの座標
function rideParts() {
  const at = (g, p) => g.translate(p.x, p.y, p.z);
  const rod = (a, b, r, seg = 12) => {
    const d = b.clone().sub(a), L = d.length();
    const g = new THREE.CapsuleGeometry(r, L, 4, seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
    return at(g, a.clone().lerp(b, 0.5));
  };
  const P7 = (g, col) => part(g, 7, [0, 0, 0], col);
  const out = [
    P7(rod(V(0, 0.43, 0.56), V(0, GRIP.y, GRIP.z), 0.032, 14), HOUSING),                      // 柱
    P7(rod(V(-GRIP.x0, GRIP.y, GRIP.z), V(GRIP.x0, GRIP.y, GRIP.z), 0.017, 12), BELLY),         // 棒
  ];
  for (const s of [1, -1]) {
    out.push(P7(rod(V(s * GRIP.x0, GRIP.y, GRIP.z), V(s * GRIP.x1, GRIP.y, GRIP.z), GRIP.r, 16), DARK)); // 握りのゴム
    out.push(P7(at(new THREE.TorusGeometry(0.026, 0.008, 6, 16).rotateY(Math.PI / 2), V(s * (GRIP.x0 - 0.004), GRIP.y, GRIP.z)), BELLY)); // 鍔
    out.push(P7(at(new RoundedBoxGeometry(0.15, 0.04, 0.3, 2, 0.018), V(0.27 * s, 0.38, 0.08)), HULL)); // 足の板
    out.push(P7(finGeometry(V(0.13 * s, 0.43, -0.66), -0.5 * s), HULL));                       // 安定板
  }
  return out;
}

const boxOf = (prims) => { const b = new THREE.Box3(); for (const { d } of prims) b.union(d.box); return b; };

// 距離の場の網を、figure の材質の形へ（色は最も近い部品、部位と付け根は一つ）。place: 組んだ座標から材質が回す前の座標へ
function fieldPart(prims, h, id, pivot, place) {
  const box = boxOf(prims);
  const m = meshField(makeField(prims, box, 0.06, 0.1), box, h);
  const n = m.positions.length / 3;
  const cols = prims.map((p) => srgb(p.tag)), fs = prims.map((p) => p.d);
  const col = new Float32Array(n * 3), piv = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
    let best = Infinity, c = cols[0];
    for (let j = 0; j < fs.length; j++) { const d = fs[j](x, y, z); if (d < best) { best = d; c = cols[j]; } }
    col.set([c.r, c.g, c.b], i * 3);
    piv.set(pivot, i * 3);
  }
  if (place) place(m.positions, m.normals);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
  g.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

// 立った兵士の座標から腰の高さへ
const shiftUp = (pos) => { for (let i = 0; i < pos.length; i += 3) { pos[i + 1] += DY; pos[i + 2] += DZ; } };
// 頭は首の付け根で後ろへ起こす（前かがみの胴の上で、顔が前を見る）
const HEAD_UP = 0.32, NECK_BASE = V(0, 1.47, -0.03);
const raiseHead = (pos, nor) => {
  const c = Math.cos(-HEAD_UP), s = Math.sin(-HEAD_UP);
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1] - NECK_BASE.y, z = pos[i + 2] - NECK_BASE.z;
    pos[i + 1] = y * c - z * s + NECK_BASE.y; pos[i + 2] = y * s + z * c + NECK_BASE.z;
    const ny = nor[i + 1], nz = nor[i + 2];
    nor[i + 1] = ny * c - nz * s; nor[i + 2] = ny * s + nz * c;
  }
  shiftUp(pos);
};
// 前かがみで握りを持った姿から、材質が回す前の腕へ（前かがみと握りへの回転を逆に）
const unposeArm = (pivot) => (pos, nor) => {
  const cl = Math.cos(-RIDER.lean), sl = Math.sin(-RIDER.lean), ca = Math.cos(-RIDER.armRide), sa = Math.sin(-RIDER.armRide);
  for (let i = 0; i < pos.length; i += 3) {
    let y = pos[i + 1] - HIP.y, z = pos[i + 2] - HIP.z;
    let y1 = y * cl - z * sl + HIP.y - pivot.y, z1 = y * sl + z * cl + HIP.z - pivot.z;
    pos[i + 1] = y1 * ca - z1 * sa + pivot.y; pos[i + 2] = y1 * sa + z1 * ca + pivot.z;
    y = nor[i + 1]; z = nor[i + 2];
    y1 = y * cl - z * sl; z1 = y * sl + z * cl;
    nor[i + 1] = y1 * ca - z1 * sa; nor[i + 2] = y1 * sa + z1 * ca;
  }
};

// 組み立ての本体。部位（胴・頭・腕・脚・車体）ごとに yield する（手の空いた時間に少しずつ組み立てられる）
function* buildSteps(detail) {
  let ms = 0, t0 = performance.now();
  const pause = function* () { ms += performance.now() - t0; yield; t0 = performance.now(); };
  const D = RIDER_BODY.detail[detail];
  const neck = rest(0, 1.5, 0);
  const parts = [];
  parts.push(fieldPart(torsoPrims(), D.body, 0, [HX, HY, HZ], shiftUp));
  yield* pause();
  parts.push(fieldPart(headPrims(), D.head, 1, [neck.x, neck.y, neck.z], raiseHead));
  yield* pause();
  for (const [s, id] of [[1, 2], [-1, 3]]) {
    const pv = SHOULDER(s);
    parts.push(fieldPart(armPrims(s), D.arm, id, [pv.x, pv.y, pv.z], unposeArm(pv)));
  }
  yield* pause();
  parts.push(fieldPart(legPrims(), D.body, 4, [0, 0, 0], null));
  yield* pause();
  parts.push(fieldPart(hullPrims(), D.bike, 7, [0, 0, 0], null));
  yield* pause();
  for (const g of [...bikeParts({ focus: true }), ...rideParts()]) parts.push(g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]));
  const geometry = mergeGeometries(parts.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aPart', 'aPivot', 'aCol'].includes(k)) g.deleteAttribute(k);
    return g;
  }));
  geometry.computeBoundingSphere();
  ms += performance.now() - t0;
  return { geometry, detail, buildMs: ms };
}

const cache = new Map(), pending = new Map();
const detailOf = (d) => (RIDER_BODY.detail[d] ? d : 'mid');

// 少しずつ組み立てる（heroBody の createHeroBodyBuilder と同じ使い方）。step() は区切り 1 つぶん進めて、できあがったら true。
// finish() は残りを一度に進めて体を返す。同じ細かさはもう組み立てない（fresh: true なら、覚えたものを使わず組み立て直す。確かめ用）
export function createRiderBodyBuilder({ detail = 'mid', fresh = false } = {}) {
  const d = detailOf(detail);
  let gen = null, own = null;
  if (fresh) gen = buildSteps(d);
  else if (!cache.has(d) && !pending.has(d)) pending.set(d, buildSteps(d));
  const step = () => {
    if (fresh) {
      if (own) return true;
      const r = gen.next();
      if (r.done) own = r.value;
      return r.done;
    }
    if (cache.has(d)) return true;
    const r = pending.get(d).next();
    if (!r.done) return false;
    cache.set(d, r.value);
    pending.delete(d);
    return true;
  };
  return {
    step,
    get done() { return fresh ? !!own : cache.has(d); },
    get body() { return fresh ? own : cache.get(d) ?? null; },
    finish() { while (!step()); return fresh ? own : cache.get(d); },
  };
}

export function buildRiderBody({ detail = 'mid' } = {}) {
  return createRiderBodyBuilder({ detail }).finish();
}
