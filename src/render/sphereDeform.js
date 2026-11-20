// 爆発の球（中心は原点）に沿って街をゆがめる式。JS の基準実装と、同じ式のシェーダー（GLSL）。
// - deformPoint: 球の内側に入った点を、中心からの向きを保ったまま球の表面へ押し出す（ビルが球の壁に押し付けられて曲がる）
// - craterDepth: 地面の水平距離 r の点が、球の形にえぐれる深さ（主人公の足元 PILLAR.radius の内側は元の高さに残り、その下は裾の広がる岩の塔になる）
// - crushPoint: つぶれていく途中（k: 0→1）。高さを押しつぶしてから deformPoint をかける
// fronts は球の半径の一覧。球はどれも原点が中心なので、点を含む球のうち一番大きなものが効く。

export const MAX_FRONTS = 4;
export const CRUSH_SQUASH = 0.72; // k=1 で高さがこの割合だけ縮む

function containingFront(d, fronts) {
  let F = 0;
  for (const f of fronts) if (d < f && f > F) F = f;
  return F;
}

export function deformPoint(p, fronts) {
  const d = Math.hypot(p[0], p[1], p[2]);
  const F = containingFront(d, fronts);
  if (F <= 0) return [p[0], p[1], p[2]];
  if (d < 1e-6) return [0, F, 0];
  const k = F / d;
  return [p[0] * k, p[1] * k, p[2] * k];
}

// 主人公の足元の柱: 半径 radius の内側は元の地面の高さ（y=0）のまま残る。その外の深さは slope·(r - radius) を超えないので、
// 下へ行くほど広がる岩の塔になる（傾き tan = slope、裾の半径はおよそ radius + 穴の深さ / slope）
export const PILLAR = { radius: 4, slope: 3.5 };

export function craterDepth(r, fronts) {
  const a = Math.abs(r);
  if (a < PILLAR.radius) return 0;
  const rr = r * r;
  let best = 0;
  for (const f of fronts) if (a < f) best = Math.max(best, Math.sqrt(f * f - rr));
  return Math.min(best, PILLAR.slope * (a - PILLAR.radius));
}

// 地面の高さ（地面のシェーダーと同じ式）。最大の球の内側は穴で craterDepth だけ下がり（柱の上は 0）、縁の外は少し盛り上がる。
// 軍勢や主人公をえぐれた地面の上に立たせるために使う。
export const CRATER_LIP = { height: 0.022, width: 0.045 }; // 縁の盛り上がり（球の半径に対する割合）
export function groundHeight(r, fronts) {
  let F = 0;
  for (const f of fronts) if (f > F) F = f;
  if (F <= 0) return 0;
  if (Math.abs(r) < F) return 0 - craterDepth(r, fronts); // 柱の上は +0
  const L = CRATER_LIP.height * F + 0.5, W = CRATER_LIP.width * F + 3;
  const x = (Math.abs(r) - F) / W;
  return L * x * Math.exp(1 - x);
}

const smooth = (k) => { const t = Math.min(1, Math.max(0, k)); return t * t * (3 - 2 * t); };

export function crushPoint(p, fronts, k) {
  return deformPoint([p[0], p[1] * (1 - CRUSH_SQUASH * smooth(k)), p[2]], fronts);
}

// シェーダーの uFronts へ、大きい順に最大 MAX_FRONTS 個を詰める。残りは 0。詰めた数を返す。
export function packFronts(fronts, out) {
  const list = fronts.filter((f) => f > 0).sort((a, b) => b - a).slice(0, MAX_FRONTS);
  out.fill(0);
  list.forEach((f, i) => { out[i] = f; });
  return list.length;
}

// 地面のえぐれは爆発が終わっても残る。crater: これまでに届いた最大の半径。
// update(blasts) は game.blasts（[{ id, front, shot: { radius } }]）を受け、[crater, ...今の front] を返す（毎回同じ配列を使い回す）。
// 終わった一発は一覧から消える前の最後の front が見えないので、消えたら shot.radius まで届いたものとする。
export function createFrontTracker() {
  let crater = 0;
  const live = new Map(); // id -> radius
  const seen = new Set();
  const out = [];
  return {
    get crater() { return crater; },
    update(blasts) {
      seen.clear();
      out.length = 0;
      for (const b of blasts) {
        seen.add(b.id);
        live.set(b.id, b.shot.radius);
        crater = Math.max(crater, b.front);
      }
      for (const [id, radius] of live) if (!seen.has(id)) { crater = Math.max(crater, radius); live.delete(id); }
      if (crater > 0) out.push(crater);
      for (const b of blasts) out.push(b.front);
      return out;
    },
  };
}

const CRATER_LIP_GLSL = { h: CRATER_LIP.height.toFixed(4), w: CRATER_LIP.width.toFixed(4) };
const PILLAR_GLSL = { r: PILLAR.radius.toFixed(4), s: PILLAR.slope.toFixed(4) };

// 上と同じ式の GLSL。uniform: uFronts[4], uFrontCount
export const SPHERE_DEFORM_GLSL = /* glsl */`
uniform float uFronts[${MAX_FRONTS}];
uniform int uFrontCount;
float sdContainingFront(float d) {
  float F = 0.0;
  for (int i = 0; i < ${MAX_FRONTS}; i++) {
    if (i >= uFrontCount) break;
    if (d < uFronts[i]) F = max(F, uFronts[i]);
  }
  return F;
}
vec3 deformPoint(vec3 p) {
  float d = length(p);
  float F = sdContainingFront(d);
  if (F <= 0.0) return p;
  if (d < 1e-6) return vec3(0.0, F, 0.0);
  return p * (F / d);
}
float craterDepth(float r) {
  float a = abs(r);
  if (a < ${PILLAR_GLSL.r}) return 0.0;
  float best = 0.0;
  for (int i = 0; i < ${MAX_FRONTS}; i++) {
    if (i >= uFrontCount) break;
    float f = uFronts[i];
    if (abs(r) < f) best = max(best, sqrt(f * f - r * r));
  }
  best = min(best, ${PILLAR_GLSL.s} * (a - ${PILLAR_GLSL.r}));
  return best;
}
// uFronts[0] は最大の球（packFronts が大きい順に詰める）
float groundHeight(float r) {
  if (uFrontCount <= 0) return 0.0;
  float F = uFronts[0];
  if (abs(r) < F) return -craterDepth(r);
  float L = ${CRATER_LIP_GLSL.h} * F + 0.5, W = ${CRATER_LIP_GLSL.w} * F + 3.0;
  float x = (abs(r) - F) / W;
  return L * x * exp(1.0 - x);
}
vec3 crushSquash(vec3 p, float k) {
  float t = clamp(k, 0.0, 1.0);
  p.y *= 1.0 - ${CRUSH_SQUASH.toFixed(4)} * t * t * (3.0 - 2.0 * t);
  return p;
}
vec3 crushPoint(vec3 p, float k) { return deformPoint(crushSquash(p, k)); }
`;

// 半径 F の穴が1つだけのときの地面の高さ（穴の外は 0。縁の盛り上がりは入れない）。uniform を持たないシェーダー（土煙の粒）用
export const CRATER_FLOOR_GLSL = /* glsl */`
float craterFloor(float r, float F) {
  float a = abs(r);
  if (a < ${PILLAR_GLSL.r} || a >= F) return 0.0;
  return -min(sqrt(F * F - r * r), ${PILLAR_GLSL.s} * (a - ${PILLAR_GLSL.r}));
}
`;
