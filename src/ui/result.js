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
  const rank = outcome?.rank ? ` ランク ${outcome.rank}` : '';
  return `「${GAME_TITLE}」${head}${rank} ${AMOUNT_LABEL} ${formatYen(total)} #最後の一撃 ${url}`.trim();
}

// R2（spec §15 ギリギリのボーナス）: 被害額にかかった倍率の内訳（結果画面の小さな行）。bonus: outcome.bonus（game.js）
const mulText = (m) => `×${m.toFixed(2)}`;
export function breakdownLines(bonus) {
  if (!bonus) return [];
  return [`残り ${bonus.timeLeft.toFixed(1)} 秒　${mulText(bonus.timeMul)}`, `すぐそばの軍勢 ${bonus.near} 体　${mulText(bonus.closeMul)}`];
}

// 結果画面に出すもの。見出しが主、被害額は見出しより小さく。ブラックホールは被害額をつけない
export function resultContent(total, reason, outcome) {
  const released = reason !== 'blackhole' && !!outcome;
  const c = {
    title: GAME_TITLE,
    headline: headlineText(reason, outcome),
    clear: released ? outcome.clear : null,
    amount: released ? formatYen(total) : null,
    share: released,
  };
  // R2（spec §15 評価のランク）: ランク（game.js の outcome.rank。時間切れは C）と倍率の内訳
  const rank = released ? outcome.rank : 'C';
  if (rank) c.rank = rank;
  if (released && outcome.bonus) c.breakdown = breakdownLines(outcome.bonus);
  return c;
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
  // R2: ランクは大きく（見出しの上）、内訳は被害額の下に小さな行で
  const rankEl = el('div', 'result-rank');
  const rankLetter = el('b', null), rankCap = el('small', null, 'ランク');
  rankEl.append(rankCap, rankLetter);
  const breakdown = el('div', 'result-breakdown');
  const retry = el('button', 'result-btn primary', 'もう一度');
  const share = el('button', 'result-btn', '共有');
  const replay = el('button', 'result-btn ghost', 'リプレイ');
  const row = el('div', 'result-row');
  row.append(retry, share);
  const row2 = el('div', 'result-row sub');
  row2.append(replay);
  root.append(title, rankEl, headline, label, amount, breakdown, row, row2);
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
      rankLetter.textContent = c.rank ?? '';
      rankEl.hidden = !c.rank;
      for (const r of ['S', 'A', 'B', 'C']) rankEl.classList.toggle('rank-' + r.toLowerCase(), c.rank === r);
      breakdown.replaceChildren(...(c.breakdown ?? []).map((t) => el('div', 'result-bline', t)));
      breakdown.hidden = !c.breakdown?.length;
      label.hidden = amount.hidden = c.amount === null;
      share.hidden = !c.share;
      row2.hidden = replay.hidden = !(canReplay && onReplay);
      root.hidden = false;
    },
    hide() { root.hidden = true; },
  };
}
