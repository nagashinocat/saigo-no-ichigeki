// R1f（持ち主 18:14「画面切り替えしたら一時停止して、戻ったら静かに戻す」）: タブ・アプリを切り替えたときの一時停止の配線（main.js から出した）。
//  - タブを隠した（visibilitychange）・pagehide: いつでも leave。見えた・pageshow: back（tab の理由を外す。再開はメニューの「つづける」）
//  - window の blur:
//    タッチの端末（fix1 見直し Minor 7。iOS のコントロールセンターなどは visibilitychange が来ない）は、どの画面でも leave。
//    PC（最終レビュー I1。Alt+Tab・別のウィンドウへ移っても、ウィンドウが見えたままなので visibilitychange は来ない）は、
//    遊んでいる間と演出の間（inPlay）だけ leave。結果・導入の画面では何もしない
//  - window の focus（隠れていなければ）: back。タッチの端末も PC も同じ
//  - 同じページの中の要素（メニューの音量のスライダー・ボタン）の blur・focus は window へ泡立たないが、念のため target が window のときだけ数える
export function bindPageLeave({ win, doc, touch = false, inPlay = () => true, leave, back }) {
  const self = (e) => !e || e.target === undefined || e.target === win;
  win.addEventListener('blur', (e) => { if (self(e) && (touch || inPlay())) leave(); });
  win.addEventListener('focus', (e) => { if (self(e) && !doc.hidden) back(); });
  win.addEventListener('pagehide', () => leave());
  win.addEventListener('pageshow', () => { if (!doc.hidden) back(); });
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) leave(); else back(); });
}
