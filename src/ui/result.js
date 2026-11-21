import { formatYen } from './format.js';

// ゲームのタイトル（持ち主 2026-11-21 15:57。仮題「街破壊」から変更）
export const GAME_TITLE = '最後の一撃';
// 金額の見出し（持ち主 16:48「被害額だけでおまけは書かなくていいよ」）。勝ち負けの見出しより小さく出す
export const AMOUNT_LABEL = '被害額';

const pageUrl = () => (typeof location === 'undefined' ? '' : location.origin + location.pathname);

// S9（持ち主 13:16）: 放った一発で街の軍勢を全員倒せたら撃退成功、一人でも残れば撃退失敗（残り N 体）。
// outcome: game.outcome（{ clear, total, survivors }）。時間切れはブラックホール（勝ち負けも破壊額もない）
export function headlineText(reason, outcome) {
  if (reason === 'blackhole' || !outcome) return 'ブラックホールになった';
  return outcome.clear ? '撃退成功' : `撃退失敗　残り ${outcome.survivors.length} 体`;
}

export function shareText(total, outcome, url = pageUrl()) {
  const head = outcome?.clear ? '撃退成功！' : `撃退失敗…残り ${outcome?.survivors.length ?? 0} 体。`;
  return `「${GAME_TITLE}」${head} ${AMOUNT_LABEL} ${formatYen(total)} #最後の一撃 ${url}`.trim();
}

// 結果画面に出すもの。見出しが主、被害額は見出しより小さく。ブラックホールは被害額をつけない
export function resultContent(total, reason, outcome) {
  const released = reason !== 'blackhole' && !!outcome;
  return {
    title: GAME_TITLE,
    headline: headlineText(reason, outcome),
    clear: released ? outcome.clear : null,
    amount: released ? formatYen(total) : null,
    share: released,
  };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// 結果画面。「もう一度」は onRetry、「リプレイ」は onReplay（最後の一発をもう一度見る）、
// 「共有」は Web Share か、使えなければ X の投稿画面を開く
export function createResult(root, { onRetry, onReplay = null }) {
  const title = el('div', 'result-title', GAME_TITLE);
  const headline = el('div', 'result-headline');
  const amount = el('div', 'result-amount');
  const label = el('div', 'result-label', AMOUNT_LABEL);
  const retry = el('button', 'result-btn primary', 'もう一度');
  const share = el('button', 'result-btn', '共有');
  const replay = el('button', 'result-btn ghost', 'リプレイ');
  const row = el('div', 'result-row');
  row.append(retry, share);
  const row2 = el('div', 'result-row sub');
  row2.append(replay);
  root.append(title, headline, label, amount, row, row2);
  root.hidden = true;
  let total = 0, outcome = null;
  retry.addEventListener('click', () => onRetry());
  replay.addEventListener('click', () => onReplay?.());
  share.addEventListener('click', async () => {
    const text = shareText(total, outcome);
    if (navigator.share) {
      try { await navigator.share({ text }); } catch { /* 取り消し */ }
    } else {
      window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text), '_blank', 'noopener');
    }
  });
  return {
    // o: game.outcome（時間切れは null）。opts.replay: 「リプレイ」を出す（最後の一発を見せ直せるとき）
    show(t, why, o = null, { replay: canReplay = false } = {}) {
      total = t; outcome = o;
      const c = resultContent(t, why, o);
      headline.textContent = c.headline;
      // 勝ち負けで色を変える（撃退成功は明るく、失敗は生き残りの光と同じ赤緑の気配）
      root.classList.toggle('clear', c.clear === true);
      root.classList.toggle('fail', c.clear === false);
      amount.textContent = c.amount ?? '';
      label.hidden = amount.hidden = c.amount === null;
      share.hidden = !c.share;
      row2.hidden = replay.hidden = !(canReplay && onReplay);
      root.hidden = false;
    },
    hide() { root.hidden = true; },
  };
}
