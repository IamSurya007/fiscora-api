import { carryInto, monthsBefore, safeToSpend } from './rollover';

it('steps back across years', () => {
  expect(monthsBefore('2026-02', 3)).toBe('2025-11');
});

describe('carryInto', () => {
  it('carries leftovers and overspending forward', () => {
    const spent: Record<string, number> = { '2026-08': 3000, '2026-09': 6000, '2026-10': 4500 };
    const carry = carryInto(
      '2026-11',
      (m) => (m >= '2026-08' ? 5000 : null), // budget created in August
      (m) => spent[m] ?? 0,
    );
    // +2000, -1000, +500
    expect(carry).toBe(1500);
  });

  it('is zero for a budget created this month', () => {
    expect(carryInto('2026-11', () => null, () => 0)).toBe(0);
  });
});

it('computes both safe-to-spend figures', () => {
  const r = safeToSpend({
    available: 20000,
    budgetedSpent: 12000,
    income: 80000,
    spent: 30000,
    upcomingBills: 15000,
    daysLeft: 16,
  });
  expect(r.fromBudgets).toBe(8000);
  expect(r.perDay).toBe(500);
  expect(r.fromIncome).toBe(35000);
});
