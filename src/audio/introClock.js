// 導入の音の時計（持ち主 22:15「初めのムービー音出てない」）。
// 導入の 0 秒は、AudioContext が running になってから決める（resume() は約束を返すだけで、すぐには動かない。
// 動いていない時計の currentTime は止まったままで、そこへ 0 秒を置くと、動き出したときに絵とずれる）。
//   'wait'  begin のあと、running になるのを少しだけ（waitMs、実時間）待つ。絵は 0 秒で待つ（'hold'）
//   'audio' 0 秒を決めて音を組んだ。絵は音の時計に合わせる（導入の秒を返す）
//   'dt'    鳴らせない（ブラウザが許さない・Web Audio がない・途中で止まった）: 絵はフレームの dt で無音のまま進む。
//           あとの操作で running になったら、絵の今の時刻に音の時計を合わせ、次の拍の頭から組む
//           （過去の時刻の音がまとめて鳴らない。曲は拍の頭からきれいに入る）
//   'done'  飛ばした・ゲームを始めた（cut）
// getOutput(): { ctx, dest } か null。schedule(ctx, dest, t0, { from }): 組んで { cut() } を返す（introSfx の scheduleIntroSfx）。
// grid: 曲の拍の格子 { start（導入の秒での曲の頭）, beatSec }
export const INTRO_CLOCK = {
  lead: 0.12, // 0 秒を、音の時計のこれだけ先に置く（最初の音が欠けない）
  waitMs: 500, // running になるのを待つ長さ（実時間）。過ぎたら絵は dt で進む
  joinMargin: 0.06, // 途中から入るとき、組む最初の拍は今よりこれだけ先から（予約が間に合う）
};

// t + margin 以上の最初の拍の頭（導入の秒）
export function nextBeatAt(t, { start, beatSec }, margin = INTRO_CLOCK.joinMargin) {
  const k = Math.ceil((t + margin - start) / beatSec - 1e-9);
  return start + k * beatSec;
}

export function createIntroClock({ getOutput, schedule, grid, lead = INTRO_CLOCK.lead, waitMs = INTRO_CLOCK.waitMs, margin = INTRO_CLOCK.joinMargin }) {
  let mode = 'idle', t0 = null, sfx = null, waitFrom = 0;
  const running = (out) => !!out && out.ctx.state === 'running';
  const drop = () => { sfx?.cut(); sfx = null; };
  return {
    get mode() { return mode; },
    get t0() { return t0; },
    // TAP の直後の準備（onBegin）が終わったときに呼ぶ。nowMs: performance.now()
    begin(nowMs) {
      drop();
      t0 = null;
      mode = getOutput() ? 'wait' : 'dt';
      waitFrom = nowMs;
    },
    // 毎フレーム（導入の間）。picture: 今の絵の導入の秒。
    // 戻り値: 'hold'（絵を止めて待つ）・'dt'（絵を dt で進める）・数（音の時計の導入の秒。syncTo へ）
    tick(nowMs, picture) {
      const out = getOutput();
      if (mode === 'wait') {
        if (running(out)) {
          t0 = out.ctx.currentTime + lead;
          sfx = schedule(out.ctx, out.dest, t0, { from: 0 });
          mode = 'audio';
          return out.ctx.currentTime - t0;
        }
        if (nowMs - waitFrom < waitMs) return 'hold';
        mode = 'dt';
        return 'dt';
      }
      if (mode === 'dt') {
        if (!running(out)) return 'dt';
        // 絵は止めない: 音の時計を今の絵の時刻へ合わせ、次の拍の頭から先の音だけを組む
        drop();
        t0 = out.ctx.currentTime - picture;
        sfx = schedule(out.ctx, out.dest, t0, { from: nextBeatAt(picture, grid, margin) });
        mode = 'audio';
        return picture;
      }
      if (mode === 'audio') {
        if (running(out)) return out.ctx.currentTime - t0;
        // 途中で止まった（iOS の interrupted・タブを隠した）: 組んだ音を切り、絵は dt で。戻ったら次の拍から組み直す
        drop();
        mode = 'dt';
        return 'dt';
      }
      return 'dt';
    },
    // 飛ばした・ゲームを始めた: 組んだ音をすぐ切る。そのあとは何も組まない
    cut() {
      drop();
      mode = 'done';
    },
  };
}
