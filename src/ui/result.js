import { formatYen } from './format.js';

const pageUrl = () => (typeof location === 'undefined' ? '' : location.origin + location.pathname);

export function shareText(total, url = pageUrl()) {
  return `街を ${formatYen(total)} ぶん破壊した！ #街破壊ゲーム ${url}`.trim();
}

export function reasonText(reason) {
  return reason === 'drained' ? '力を奪われた' : '時間切れ';
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
      reason.textContent = reasonText(why);
      amount.textContent = formatYen(t);
      root.hidden = false;
    },
  };
}
