import { formatYen } from './format.js';

const pageUrl = () => (typeof location === 'undefined' ? '' : location.origin + location.pathname);

export function shareText(total, url = pageUrl()) {
  return `街を ${formatYen(total)} ぶん破壊した！ #街破壊ゲーム ${url}`.trim();
}

export function reasonText(reason) {
  return reason === 'blackhole' ? 'ブラックホールになった' : '最後の一発';
}

// 結果画面に出すもの。ブラックホール（時間切れまで放たなかった）は破壊額をつけない
export function resultContent(total, reason) {
  const released = reason !== 'blackhole';
  return { reason: reasonText(reason), amount: released ? formatYen(total) : null, share: released };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// 結果画面。「もう一度」は onRetry、「共有」は Web Share か、使えなければ X の投稿画面を開く
export function createResult(root, { onRetry }) {
  const reason = el('div', 'result-reason');
  const amount = el('div', 'result-amount');
  const label = el('div', 'result-label', '破壊額');
  const retry = el('button', 'result-btn primary', 'もう一度');
  const share = el('button', 'result-btn', '共有');
  const row = el('div', 'result-row');
  row.append(retry, share);
  root.append(reason, label, amount, row);
  root.hidden = true;
  let total = 0;
  retry.addEventListener('click', () => onRetry());
  share.addEventListener('click', async () => {
    const text = shareText(total);
    if (navigator.share) {
      try { await navigator.share({ text }); } catch { /* 取り消し */ }
    } else {
      window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text), '_blank', 'noopener');
    }
  });
  return {
    show(t, why) {
      total = t;
      const c = resultContent(t, why);
      reason.textContent = c.reason;
      amount.textContent = c.amount ?? '';
      label.hidden = amount.hidden = c.amount === null;
      share.hidden = !c.share;
      root.hidden = false;
    },
  };
}
