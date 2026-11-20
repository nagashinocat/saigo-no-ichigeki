// 手の構え（純粋な計算。three.js には触れない）。
// 関節名は WebXR の手の関節名。各関節は [rx, ry, rz]（ラジアン）を返す:
//   rx: 手のひら側への曲げ（正が曲がる。0〜100°）
//   ry: 指の左右の開き（正が親指の側）
//   rz: 指のひねり
// 関節の向きは WebXR の決まりどおり、-Z が指先、+Y が手の甲。描画側は rx を -X 軸まわりの回転として使う。

const DEG = Math.PI / 180;
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const FINGER_PARTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB_PARTS = ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'];

export const HAND_JOINTS = [
  'wrist',
  ...THUMB_PARTS.map((p) => `thumb-${p}`),
  ...FINGERS.flatMap((f) => FINGER_PARTS.map((p) => `${f}-finger-${p}`)),
];

// 度で書いた [rx, ry, rz]。open: 力の抜けた、手のひらを上へ向けて少し丸めた手。
// tense: 力がこもりきった手。付け根は浅く、第二・第一関節を深く曲げた鉤爪の形でこわばり、指は外へ張る。
// 薬指・小指の中手骨も曲げて、手のひら全体をくぼませる。
const POSES = {
  open: {
    'thumb-metacarpal': [8, 4, 0], 'thumb-phalanx-proximal': [8, 0, 0], 'thumb-phalanx-distal': [6, 0, 0],
    'index-finger-metacarpal': [0, 0, 0], 'index-finger-phalanx-proximal': [10, 6, 0], 'index-finger-phalanx-intermediate': [14, 0, 0], 'index-finger-phalanx-distal': [8, 0, 0],
    'middle-finger-metacarpal': [0, 0, 0], 'middle-finger-phalanx-proximal': [12, 0, 0], 'middle-finger-phalanx-intermediate': [16, 0, 0], 'middle-finger-phalanx-distal': [9, 0, 0],
    'ring-finger-metacarpal': [3, 0, 0], 'ring-finger-phalanx-proximal': [14, -5, 0], 'ring-finger-phalanx-intermediate': [18, 0, 0], 'ring-finger-phalanx-distal': [10, 0, 0],
    'pinky-finger-metacarpal': [6, 0, 0], 'pinky-finger-phalanx-proximal': [16, -10, 0], 'pinky-finger-phalanx-intermediate': [20, 0, 0], 'pinky-finger-phalanx-distal': [12, 0, 0],
  },
  tense: {
    'thumb-metacarpal': [24, 12, 0], 'thumb-phalanx-proximal': [24, 0, 0], 'thumb-phalanx-distal': [40, 0, 0],
    'index-finger-metacarpal': [2, 0, 0], 'index-finger-phalanx-proximal': [34, 20, -4], 'index-finger-phalanx-intermediate': [84, 0, 0], 'index-finger-phalanx-distal': [58, 0, 0],
    'middle-finger-metacarpal': [3, 0, 0], 'middle-finger-phalanx-proximal': [37, 4, 0], 'middle-finger-phalanx-intermediate': [88, 0, 0], 'middle-finger-phalanx-distal': [60, 0, 0],
    'ring-finger-metacarpal': [8, 0, 3], 'ring-finger-phalanx-proximal': [40, -14, 3], 'ring-finger-phalanx-intermediate': [88, 0, 0], 'ring-finger-phalanx-distal': [60, 0, 0],
    'pinky-finger-metacarpal': [14, 0, 6], 'pinky-finger-phalanx-proximal': [44, -28, 6], 'pinky-finger-phalanx-intermediate': [86, 0, 0], 'pinky-finger-phalanx-distal': [62, 0, 0],
  },
  // 放つ瞬間: 指を一気に開き切る（反らさず、まっすぐ大きく張る）
  release: {
    'thumb-metacarpal': [0, 14, 0], 'thumb-phalanx-proximal': [0, 0, 0], 'thumb-phalanx-distal': [0, 0, 0],
    'index-finger-phalanx-proximal': [0, 15, 0], 'middle-finger-phalanx-proximal': [0, 2, 0],
    'ring-finger-phalanx-proximal': [0, -11, 0], 'pinky-finger-phalanx-proximal': [0, -24, 0],
  },
};

const ZERO = [0, 0, 0];
export const TREMOR_FROM = 0.75;        // ここから震えが始まり、level 1 で最大
const TREMOR_DEG = [4.5, 1.6, 1.0]; // 最大の振れ幅（rx, ry, rz）
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function build(name) {
  const src = POSES[name], out = {};
  for (const j of HAND_JOINTS) out[j] = (src[j] ?? ZERO).map((d) => d * DEG);
  return out;
}
const OPEN = build('open'), TENSE = build('tense');
export const RELEASE_POSE = Object.freeze(build('release'));

// 関節ごとにずらした2つの波を重ねた、規則的に見えない震え（-1〜1）
const shake = (t, k, axis) => 0.6 * Math.sin(t * 29 + k * 1.7 + axis * 2.3) + 0.4 * Math.sin(t * 47 + k * 2.9 + axis * 0.7);

export function poseFor(level, t) {
  const l = Number.isFinite(level) ? clamp(level, 0, 1) : 0;
  const time = Number.isFinite(t) ? t : 0;
  // 曲がりは貯め始めに早く進み、終わりに向けてじわじわこわばる
  const s = 1 - Math.pow(1 - l, 1.6);
  const amp = clamp((l - TREMOR_FROM) / (1 - TREMOR_FROM), 0, 1);
  const out = {};
  HAND_JOINTS.forEach((j, k) => {
    const a = OPEN[j], b = TENSE[j];
    const r = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      // 曲がっていない関節（手首や指先）は震わせない
      const moves = a[i] !== 0 || b[i] !== 0;
      const tremor = moves ? amp * TREMOR_DEG[i] * DEG * shake(time, k, i) : 0;
      r[i] = a[i] + (b[i] - a[i]) * s + tremor;
    }
    r[0] = clamp(r[0], 0, 100 * DEG);
    r[1] = clamp(r[1], -30 * DEG, 30 * DEG);
    r[2] = clamp(r[2], -30 * DEG, 30 * DEG);
    out[j] = r;
  });
  return out;
}
