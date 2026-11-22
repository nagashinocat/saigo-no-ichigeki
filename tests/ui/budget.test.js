import { test, expect } from 'vitest';
import { budgetLine, NATIONAL_BUDGET } from '../../src/ui/format.js';

// R3（spec §15 被害額のたとえ）: 「国家予算（一般会計 約112兆円）の約◯日分」。数が読みやすいよう 日 / 時間 / 年 を選ぶ
const T = 1e12;
const P = '国家予算（一般会計 約112兆円）の';

test('R3: 基準の値は一つの定数（約 112 兆円）', () => {
  expect(NATIONAL_BUDGET.yen).toBeGreaterThan(112 * T);
  expect(NATIONAL_BUDGET.yen).toBeLessThan(113 * T);
  expect(NATIONAL_BUDGET.label).toBe('一般会計 約112兆円');
});

test('R3: 日（1 日分〜1 年分未満）。10 以上は整数、10 未満は小数 1 桁', () => {
  const day = NATIONAL_BUDGET.yen / 365;
  expect(budgetLine(2.7 * T)).toBe(`${P}約8.8日分`);
  expect(budgetLine(day * 3)).toBe(`${P}約3日分`);
  expect(budgetLine(day * 42.4)).toBe(`${P}約42日分`);
  expect(budgetLine(day * 1)).toBe(`${P}約1日分`);
  expect(budgetLine(day * 364)).toBe(`${P}約364日分`);
});

test('R3: 時間（1 日分に満たない）', () => {
  const hour = NATIONAL_BUDGET.yen / 365 / 24;
  expect(budgetLine(hour * 5.24)).toBe(`${P}約5.2時間分`);
  expect(budgetLine(hour * 20)).toBe(`${P}約20時間分`);
  expect(budgetLine(hour * 0.3)).toBe(`${P}約0.3時間分`);
  expect(budgetLine(hour * 0.01)).toBe(`${P}1時間分にも満たない`);
});

test('R3: 年（1 年分以上）', () => {
  expect(budgetLine(NATIONAL_BUDGET.yen * 1.5)).toBe(`${P}約1.5年分`);
  expect(budgetLine(NATIONAL_BUDGET.yen * 12.2)).toBe(`${P}約12年分`);
});

test('R3: 0 やない金額は一言を出さない', () => {
  expect(budgetLine(0)).toBe(null);
  expect(budgetLine(null)).toBe(null);
  expect(budgetLine(NaN)).toBe(null);
});
