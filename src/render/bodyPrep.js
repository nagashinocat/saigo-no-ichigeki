// 画質の段の主人公の体（heroBody）と、演出で大きく映る乗り手の体（riderBody）の組み立ての段取り。
// 起動時は粗い体で始め、最初のフレームのあとの手の空いた時間（startIdle）と、TAP を待つ画面の毎フレーム（step）で
// 区切り 1 つずつ組み立てる（主人公 → 乗り手の順）。TAP の直後（画面は黒）に finish で残りを一度に組み立てて渡す:
// 導入のバイクの拍の近いバイクは、最初のフレームから乗り手の専用の体で描く（箱の寄せ集めの体にならない）。
// paused が true の間（導入の再生中）は手の空いた時間の組み立てを進めない（音の時計に合わせた絵が飛ばないように）
export function createBodyPrep({ heroBuilder = null, riderBuilder, enemyView, idle = null, paused = () => false }) {
  const giveHero = () => { if (enemyView.heroBody !== heroBuilder.body) enemyView.setHeroBody(heroBuilder.body); };
  const giveRider = () => { if (enemyView.focusMesh?.geometry !== riderBuilder.body.geometry) enemyView.setRiderBody(riderBuilder.body); };
  const prep = {
    get done() { return (!heroBuilder || heroBuilder.done) && riderBuilder.done; },
    // 区切りを 1 つ進める（できあがったら渡す）。すべてできていれば true
    step() {
      if (heroBuilder && !heroBuilder.done) {
        if (heroBuilder.step()) giveHero();
        return false;
      }
      if (riderBuilder.done) return true;
      if (riderBuilder.step()) { giveRider(); return true; }
      return false;
    },
    // 残りを一度に組み立てて渡す
    finish() {
      if (heroBuilder) { heroBuilder.finish(); giveHero(); }
      riderBuilder.finish();
      giveRider();
    },
    // 手の空いた時間に区切り 1 つずつ（paused の間は待つだけ）
    startIdle() {
      const tick = () => {
        if (prep.done) return;
        if (!paused()) prep.step();
        if (!prep.done) idle(tick);
      };
      idle(tick);
    },
  };
  return prep;
}
