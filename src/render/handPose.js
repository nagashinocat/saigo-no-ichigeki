// 手の構え（純粋な計算。three.js には触れない）。
// 関節名は WebXR の手の関節名。各関節は [rx, ry, rz]（ラジアン）を返す:
//   rx: 手のひら側への曲げ（正が曲がる。0〜100°）
//   ry: 指の左右の開き（正が親指の側）
//   rz: 指のひねり
// 手首（wrist）だけは「前腕に対する手の曲げ」で、rx が負なら手の甲の側へ反らす（-70〜30°）。
// 関節の向きは WebXR の決まりどおり、-Z が指先、+Y が手の甲。描画側は rx を -X 軸まわりの回転として使う。
// 構えの意味は左右共通。鏡に映した左手の骨へ当てるときの符号の直しは handModel の setPose が受け持つ。

const DEG = Math.PI / 180;
// 手首の反らし（度）。構えでは手の甲の側へ大きく反らし、前腕を球の左右の下・外から低く寝かせて入れる
export const WRIST_EXT = 40;
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const FINGER_PARTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB_PARTS = ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'];

export const HAND_JOINTS = [
  'wrist',
  ...THUMB_PARTS.map((p) => `thumb-${p}`),
  ...FINGERS.flatMap((f) => FINGER_PARTS.map((p) => `${f}-finger-${p}`)),
];

// 度で書いた [rx, ry, rz]。どれも球を左右から包む構え（持ち主のスケッチ）: 手首を反らし、指は球の上へ丸くかぶさり、
// 親指は手のひらの側へ開いて球の下へ回る（親指は休みの形でもう大きく開いている。handModel の THUMB）。
// open: 力の抜けた、軽い鉤爪の手。tense: 力がこもりきった手。指を外へ張り、付け根・第二・第一関節を深く曲げた鉤爪でこわばる。
// 薬指・小指の中手骨も曲げて、手のひら全体をくぼませる。
const POSES = {
  open: {
    wrist: [-WRIST_EXT, 0, 0],
    'thumb-metacarpal': [0, 6, -6], 'thumb-phalanx-proximal': [0, 6, 0], 'thumb-phalanx-distal': [8, 0, 0],
    'index-finger-metacarpal': [0, 0, 0], 'index-finger-phalanx-proximal': [18, 4, 0], 'index-finger-phalanx-intermediate': [26, 0, 0], 'index-finger-phalanx-distal': [16, 0, 0],
    'middle-finger-metacarpal': [0, 0, 0], 'middle-finger-phalanx-proximal': [19, 0, 0], 'middle-finger-phalanx-intermediate': [27, 0, 0], 'middle-finger-phalanx-distal': [17, 0, 0],
    'ring-finger-metacarpal': [2, 0, 0], 'ring-finger-phalanx-proximal': [20, -3, 0], 'ring-finger-phalanx-intermediate': [28, 0, 0], 'ring-finger-phalanx-distal': [18, 0, 0],
    'pinky-finger-metacarpal': [4, 0, 0], 'pinky-finger-phalanx-proximal': [21, -6, 0], 'pinky-finger-phalanx-intermediate': [29, 0, 0], 'pinky-finger-phalanx-distal': [18, 0, 0],
  },
  tense: {
    wrist: [-WRIST_EXT, 0, 0],
    'thumb-metacarpal': [0, 16, -6], 'thumb-phalanx-proximal': [0, 10, 0], 'thumb-phalanx-distal': [22, 0, 0],
    'index-finger-metacarpal': [0, 0, 0], 'index-finger-phalanx-proximal': [44, 20, -4], 'index-finger-phalanx-intermediate': [62, 0, 0], 'index-finger-phalanx-distal': [30, 0, 0],
    'middle-finger-metacarpal': [1, 0, 0], 'middle-finger-phalanx-proximal': [45, 5, 0], 'middle-finger-phalanx-intermediate': [63, 0, 0], 'middle-finger-phalanx-distal': [31, 0, 0],
    'ring-finger-metacarpal': [5, 0, 3], 'ring-finger-phalanx-proximal': [46, -12, 3], 'ring-finger-phalanx-intermediate': [64, 0, 0], 'ring-finger-phalanx-distal': [31, 0, 0],
    'pinky-finger-metacarpal': [9, 0, 6], 'pinky-finger-phalanx-proximal': [48, -22, 6], 'pinky-finger-phalanx-intermediate': [65, 0, 0], 'pinky-finger-phalanx-distal': [31, 0, 0],
  },
  // 閉じた手: 放つと両手が寄り、指を球の上でさらに丸めて相手の指先へ、親指を球の下で相手の親指へ合わせ、輪を閉じる。
  // 手首は構えのまま反らしておく（前腕が跳ばない）
  join: {
    wrist: [-WRIST_EXT, 0, 0],
    'thumb-metacarpal': [10, 6, -6], 'thumb-phalanx-proximal': [0, 6, 0], 'thumb-phalanx-distal': [16, 0, 0],
    'index-finger-phalanx-proximal': [34, 2, 0], 'index-finger-phalanx-intermediate': [44, 0, 0], 'index-finger-phalanx-distal': [26, 0, 0],
    'middle-finger-phalanx-proximal': [35, 0, 0], 'middle-finger-phalanx-intermediate': [45, 0, 0], 'middle-finger-phalanx-distal': [27, 0, 0],
    'ring-finger-metacarpal': [2, 0, 0], 'ring-finger-phalanx-proximal': [36, -2, 0], 'ring-finger-phalanx-intermediate': [46, 0, 0], 'ring-finger-phalanx-distal': [28, 0, 0],
    'pinky-finger-metacarpal': [4, 0, 0], 'pinky-finger-phalanx-proximal': [37, -4, 0], 'pinky-finger-phalanx-intermediate': [47, 0, 0], 'pinky-finger-phalanx-distal': [28, 0, 0],
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
export const JOIN_POSE = Object.freeze(build('join'));

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
      const moves = j !== 'wrist' && (a[i] !== 0 || b[i] !== 0);
      const tremor = moves ? amp * TREMOR_DEG[i] * DEG * shake(time, k, i) : 0;
      r[i] = a[i] + (b[i] - a[i]) * s + tremor;
    }
    r[0] = j === 'wrist' ? clamp(r[0], -70 * DEG, 30 * DEG) : clamp(r[0], 0, 100 * DEG);
    r[1] = clamp(r[1], -30 * DEG, 30 * DEG);
    r[2] = clamp(r[2], -30 * DEG, 30 * DEG);
    out[j] = r;
  });
  return out;
}
