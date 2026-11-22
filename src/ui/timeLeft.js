// R1c（持ち主 11:03「制限時間もわかりやすくしよう」）: 残り時間の見せ方。上の帯の右に大きな数字と、減っていく細い帯。
// 残り last 秒から色が琥珀 → 赤へ変わり、数字が 1 秒に 1 回脈打ち、整数の秒ごとに短い刻みの音（遊んでいる間だけ）。
// 純粋な関数（HUD と main.js が使う）
export const TIME_LEFT = {
  last: 10, // 残り何秒から急かすか
  amber: [255, 186, 64], // 10 秒の色
  red: [255, 56, 48], // redAt 秒より下の色
  redAt: 2,
  pulseTau: 0.16, // 脈打ちの減り方（秒）。秒が変わる瞬間に山
  pulseScale: 0.22, // 脈打ちの山での数字の大きさの増え（1 + 0.22 倍）
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const timeLeftText = (remaining) => String(Math.max(0, Math.ceil(remaining)));
export const isLastSeconds = (remaining, C = TIME_LEFT) => remaining <= C.last;
export const timeBarFrac = (remaining, total) => clamp01(remaining / Math.max(1e-9, total));
// 残り 10 秒の色（RGB）。その前は null（ふだんの白のまま）
export function timeColor(remaining, C = TIME_LEFT) {
  if (!isLastSeconds(remaining, C)) return null;
  const k = clamp01((C.last - remaining) / (C.last - C.redAt));
  return C.amber.map((v, i) => Math.round(v + (C.red[i] - v) * k));
}
// 脈打ち（0〜1）: 残り 10 秒の間、秒が変わった瞬間（数字が一つ減る）に 1、そのあと減る。1 Hz
export function timePulse(remaining, C = TIME_LEFT) {
  if (!isLastSeconds(remaining, C) || remaining <= 0) return 0;
  const since = Math.ceil(remaining) - remaining; // 今の数字になってからの秒（0〜1）
  return Math.exp(-since / C.pulseTau);
}

// 刻みの音: update(remaining, playing) が、このフレームで鳴らす秒（整数）の配列を返す。残り last 秒から 1 秒まで、
// 整数の秒をまたぐたびに 1 回（引っかかって何秒もまたいでも、最後の 1 回だけ）。遊んでいない間は鳴らさず、
// 戻った最初のフレームは今の時刻にそろえるだけ（まとめて鳴らさない）
export function createTimeTicks(C = TIME_LEFT) {
  let prev = null;
  return {
    update(remaining, playing) {
      if (!playing) { prev = null; return []; }
      const p = prev;
      prev = remaining;
      if (p == null || remaining >= p) return [];
      // (remaining, p] にある整数のうち一番小さいもの（1〜last）
      const n = Math.max(1, Math.ceil(remaining));
      if (n > C.last || n >= p) return [];
      return [n];
    },
  };
}
