const trim = (x) => x.toFixed(1).replace(/\.0$/, '');

export function formatYen(n) {
  if (n < 1e4) return '¥' + Math.round(n).toLocaleString('en-US');
  if (n < 1e8) return '¥' + Math.floor(n / 1e4).toLocaleString('en-US') + '万';
  if (n < 1e12) return '¥' + trim(n / 1e8) + '億';
  return '¥' + trim(n / 1e12) + '兆';
}

// R3（spec §15 被害額のたとえ）: 比べる国家予算。令和8年度（2026年度）の一般会計予算 122兆3,092億円（財務省「令和8年度予算のポイント」）。
// 持ち主 19:03「国家予算は122にしとこう」。画面と共有の文では「約122兆円」と言う
export const NATIONAL_BUDGET = { yen: 122.3092e12, label: '一般会計 約122兆円' };

// 小数 1 桁（10 以上は整数）。末尾の .0 は落とす
const readable = (x) => (x >= 10 ? String(Math.round(x)) : trim(x));

// 「国家予算（一般会計 約122兆円）の約◯日分」（文言は NATIONAL_BUDGET.label から）。数が読みやすいよう、1 年分以上は年、1 日分以上は日、それ未満は時間。0 や無い金額は null
export function budgetLine(yen, B = NATIONAL_BUDGET) {
  if (!(yen > 0)) return null;
  const head = `国家予算（${B.label}）の`;
  const years = yen / B.yen, days = years * 365, hours = days * 24;
  const eps = 1e-9;
  if (years >= 1 - eps) return `${head}約${readable(years)}年分`;
  if (days >= 1 - eps) return `${head}約${readable(days)}日分`;
  if (hours < 0.05) return `${head}1時間分にも満たない`;
  return `${head}約${readable(hours)}時間分`;
}
