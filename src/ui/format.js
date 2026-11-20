const trim = (x) => x.toFixed(1).replace(/\.0$/, '');

export function formatYen(n) {
  if (n < 1e4) return '¥' + Math.round(n).toLocaleString('en-US');
  if (n < 1e8) return '¥' + Math.floor(n / 1e4).toLocaleString('en-US') + '万';
  if (n < 1e12) return '¥' + trim(n / 1e8) + '億';
  return '¥' + trim(n / 1e12) + '兆';
}
