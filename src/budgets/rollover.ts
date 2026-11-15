/**
 * Rollover budgets carry what is left (or overspent) into the next month, so
 * an annual cost saved up monthly, or a lean month, isn't lost at month end.
 * Pure helpers; the service supplies spend per (month, category).
 */

/** "YYYY-MM" n months before [month]. */
export function monthsBefore(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Carry into [month] for a rollover budget: the sum of (limit - spent) over
 * the previous months the budget existed, looking back at most [maxMonths].
 * Overspending carries as a negative amount.
 *
 * [limitFor] returns the limit in force for a month (month-specific override
 * or the every-month limit), or null if the budget didn't exist then.
 */
export function carryInto(
  month: string,
  limitFor: (month: string) => number | null,
  spentIn: (month: string) => number,
  maxMonths = 12,
): number {
  let carry = 0;
  for (let i = maxMonths; i >= 1; i--) {
    const m = monthsBefore(month, i);
    const limit = limitFor(m);
    if (limit === null) {
      carry = 0; // budget didn't exist yet: start counting from scratch
      continue;
    }
    carry += limit - spentIn(m);
  }
  return Math.round(carry * 100) / 100;
}

export interface SafeToSpendInput {
  /** Sum over budgets of (limit + carry) for the month. */
  available: number;
  /** Spend this month in budgeted categories. */
  budgetedSpent: number;
  /** All income and spend this month (transfers excluded). */
  income: number;
  spent: number;
  /** Bills still expected before month end. */
  upcomingBills: number;
  daysLeft: number;
}

/**
 * Two "safe to spend" figures:
 * - fromBudgets: what's left across budgets, and per day for the rest of the month;
 * - fromIncome: income so far minus spending and the bills still due this month.
 */
export function safeToSpend(i: SafeToSpendInput) {
  const fromBudgets = Math.max(0, i.available - i.budgetedSpent);
  const fromIncome = i.income - i.spent - i.upcomingBills;
  const days = Math.max(1, i.daysLeft);
  return {
    fromBudgets: Math.round(fromBudgets * 100) / 100,
    perDay: Math.round((fromBudgets / days) * 100) / 100,
    fromIncome: Math.round(fromIncome * 100) / 100,
    daysLeft: i.daysLeft,
  };
}
