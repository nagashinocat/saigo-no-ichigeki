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
export const WRIST_EXT = 34;
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const FINGER_PARTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB_PARTS = ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'];

export const HAND_JOINTS = [
  'wrist',
  ...THUMB_PARTS.map((p) => `thumb-${p}`),
  ...FINGERS.flatMap((f) => FINGER_PARTS.map((p) => `${f}-finger-${p}`)),
];

// 度で書いた [rx, ry, rz]。どれも球を左右から包む構え（持ち主のスケッチ）: 手首を反らして手を立て、
// 親指は手のひらの側へ開いて球の下へ回る（親指は休みの形でもう大きく開いている。handModel の THUMB）。
// 指は鷲掴みの形（持ち主 15:24）: 付け根と第二関節はほとんど伸ばしたまま、第一関節（DIP）から先を鉤に曲げて球へ向ける。
// open: 力の抜けた鉤爪。tense: 力がこもりきった手。指を外へ張り、指先をさらに深く鉤に曲げてこわばる。
// 薬指・小指の中手骨も曲げて、手のひら全体をくぼませる。
const POSES = {
  open: {
    wrist: [-WRIST_EXT, 0, 0],
    'thumb-metacarpal': [0, 6, -6], 'thumb-phalanx-proximal': [0, 6, 0], 'thumb-phalanx-distal': [24, 0, 0],
    'index-finger-metacarpal': [0, 0, 0], 'index-finger-phalanx-proximal': [6, 4, 0], 'index-finger-phalanx-intermediate': [12, 0, 0], 'index-finger-phalanx-distal': [42, 0, 0],
    'middle-finger-metacarpal': [0, 0, 0], 'middle-finger-phalanx-proximal': [6, 0, 0], 'middle-finger-phalanx-intermediate': [13, 0, 0], 'middle-finger-phalanx-distal': [44, 0, 0],
    'ring-finger-metacarpal': [2, 0, 0], 'ring-finger-phalanx-proximal': [7, -3, 0], 'ring-finger-phalanx-intermediate': [14, 0, 0], 'ring-finger-phalanx-distal': [44, 0, 0],
    'pinky-finger-metacarpal': [4, 0, 0], 'pinky-finger-phalanx-proximal': [8, -6, 0], 'pinky-finger-phalanx-intermediate': [15, 0, 0], 'pinky-finger-phalanx-distal': [44, 0, 0],
  },
  tense: {
    wrist: [-WRIST_EXT, 0, 0],
    'thumb-metacarpal': [0, 16, -6], 'thumb-phalanx-proximal': [0, 10, 0], 'thumb-phalanx-distal': [40, 0, 0],
    'index-finger-metacarpal': [0, 0, 0], 'index-finger-phalanx-proximal': [12, 20, -4], 'index-finger-phalanx-intermediate': [22, 0, 0], 'index-finger-phalanx-distal': [68, 0, 0],
    'middle-finger-metacarpal': [1, 0, 0], 'middle-finger-phalanx-proximal': [13, 5, 0], 'middle-finger-phalanx-intermediate': [23, 0, 0], 'middle-finger-phalanx-distal': [70, 0, 0],
    'ring-finger-metacarpal': [5, 0, 3], 'ring-finger-phalanx-proximal': [14, -12, 3], 'ring-finger-phalanx-intermediate': [24, 0, 0], 'ring-finger-phalanx-distal': [70, 0, 0],
    'pinky-finger-metacarpal': [9, 0, 6], 'pinky-finger-phalanx-proximal': [16, -22, 6], 'pinky-finger-phalanx-intermediate': [25, 0, 0], 'pinky-finger-phalanx-distal': [70, 0, 0],
  },
  // 鷲掴み: 放つと両手が球へかぶさって指が交差し、第一関節から先を球へ食い込ませて締めつける（指先どうしは合わせない）。
  // 親指は球の下で内・下へ寄せる。先を上へ巻き上げない（巻き上げると球を下から囲むハートの下の弧になる）。
  // 左右の親指の先は合わせない。手首は構えのまま反らしておく（前腕が跳ばない）
  join: {
    wrist: [-WRIST_EXT, 0, 0],
    'thumb-metacarpal': [0, 0, -6], 'thumb-phalanx-proximal': [35, 0, 0], 'thumb-phalanx-distal': [25, 0, 0],
    'index-finger-phalanx-proximal': [22, 12, 0], 'index-finger-phalanx-intermediate': [30, 0, 0], 'index-finger-phalanx-distal': [85, 0, 0],
    'middle-finger-phalanx-proximal': [24, 3, 0], 'middle-finger-phalanx-intermediate': [32, 0, 0], 'middle-finger-phalanx-distal': [88, 0, 0],
    'ring-finger-metacarpal': [4, 0, 2], 'ring-finger-phalanx-proximal': [26, -6, 2], 'ring-finger-phalanx-intermediate': [33, 0, 0], 'ring-finger-phalanx-distal': [88, 0, 0],
    'pinky-finger-metacarpal': [8, 0, 4], 'pinky-finger-phalanx-proximal': [28, -14, 4], 'pinky-finger-phalanx-intermediate': [34, 0, 0], 'pinky-finger-phalanx-distal': [88, 0, 0],
  },
  // 払う: 手首を大きく反らし、指をまっすぐ伸ばして広げ、手のひらで突き出す
  push: {
    wrist: [-55, 0, 0],
    'thumb-metacarpal': [0, 6, -6], 'thumb-phalanx-proximal': [0, 0, 0], 'thumb-phalanx-distal': [4, 0, 0],
    'index-finger-phalanx-proximal': [0, 18, 0], 'index-finger-phalanx-intermediate': [4, 0, 0], 'index-finger-phalanx-distal': [6, 0, 0],
    'middle-finger-phalanx-proximal': [0, 4, 0], 'middle-finger-phalanx-intermediate': [4, 0, 0], 'middle-finger-phalanx-distal': [6, 0, 0],
    'ring-finger-phalanx-proximal': [0, -10, 0], 'ring-finger-phalanx-intermediate': [4, 0, 0], 'ring-finger-phalanx-distal': [6, 0, 0],
    'pinky-finger-phalanx-proximal': [0, -24, 0], 'pinky-finger-phalanx-intermediate': [5, 0, 0], 'pinky-finger-phalanx-distal': [6, 0, 0],
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
export const PUSH_POSE = Object.freeze(build('push'));

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
