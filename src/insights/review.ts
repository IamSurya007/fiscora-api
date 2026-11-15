import { isPersonalIncome, isPersonalSpend, LedgerEntry } from '../utils/ledger';

export interface ReviewTx extends LedgerEntry {
  id: string;
  date: Date;
  merchant?: string | null;
  note?: string | null;
}

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const parentOf = (t: LedgerEntry) => (t.categoryId ?? 'misc').split('.')[0];

function totals(txs: ReviewTx[]) {
  const spent = txs.filter(isPersonalSpend).reduce((s, t) => s + t.amount, 0);
  const income = txs.filter(isPersonalIncome).reduce((s, t) => s - t.amount, 0);
  return { spent: round(spent), income: round(income) };
}

function byCategory(txs: ReviewTx[]) {
  const m = new Map<string, number>();
  for (const t of txs.filter(isPersonalSpend)) m.set(parentOf(t), (m.get(parentOf(t)) ?? 0) + t.amount);
  return m;
}

/**
 * Month in review: totals against last month, the categories that moved most,
 * and the largest purchases. Uses the same spend/income rules as the app.
 */
export function monthReview(
  month: string,
  current: ReviewTx[],
  previous: ReviewTx[],
  nameOf: (categoryId: string) => string,
) {
  const now = totals(current);
  const before = totals(previous);
  const cats = byCategory(current);
  const prevCats = byCategory(previous);

  const categories = [...new Set([...cats.keys(), ...prevCats.keys()])]
    .map((id) => {
      const spent = round(cats.get(id) ?? 0);
      const prevSpent = round(prevCats.get(id) ?? 0);
      return { categoryId: id, name: nameOf(id), spent, prevSpent, change: round(spent - prevSpent), changePct: pct(spent, prevSpent) };
    })
    .filter((c) => c.spent > 0 || c.prevSpent > 0)
    .sort((a, b) => b.spent - a.spent);

  const biggest = current
    .filter(isPersonalSpend)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      date: t.date.toISOString().substring(0, 10),
      amount: round(t.amount),
      merchant: t.merchant || t.note || nameOf(parentOf(t)),
      category: nameOf(parentOf(t)),
    }));

  const net = round(now.income - now.spent);
  return {
    month,
    income: now.income,
    spent: now.spent,
    net,
    savingsRate: now.income > 0 ? Math.round((net / now.income) * 100) : null,
    previous: { income: before.income, spent: before.spent },
    spentChangePct: pct(now.spent, before.spent),
    incomeChangePct: pct(now.income, before.income),
    topCategories: categories.slice(0, 6),
    biggestUp: [...categories].filter((c) => c.change > 0).sort((a, b) => b.change - a.change)[0] ?? null,
    biggestDown: [...categories].filter((c) => c.change < 0).sort((a, b) => a.change - b.change)[0] ?? null,
    biggest,
    transactionCount: current.length,
  };
}

/** One-line weekly recap for a push notification; null when nothing happened. */
export function weeklyRecap(thisWeek: ReviewTx[], lastWeek: ReviewTx[], nameOf: (id: string) => string) {
  const spent = totals(thisWeek).spent;
  if (spent <= 0) return null;
  const before = totals(lastWeek).spent;
  const cats = [...byCategory(thisWeek).entries()].sort((a, b) => b[1] - a[1]);
  const top = cats[0];
  const change = pct(spent, before);
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const trend = change === null ? '' : change === 0 ? ', same as last week' : `, ${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than last week`;
  return {
    spent,
    changePct: change,
    topCategory: top ? { name: nameOf(top[0]), spent: round(top[1]) } : null,
    title: 'Your week in Fiscora',
    body: `You spent ${fmt(spent)} this week${trend}.${top ? ` Most went to ${nameOf(top[0])} (${fmt(top[1])}).` : ''}`,
  };
}
