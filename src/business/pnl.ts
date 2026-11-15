import { resolveLegacyCategory } from '../categories/category-resolver';
import { isIncome, isSpend, istMonthOf, LedgerEntry } from '../utils/ledger';

export interface PnlTx extends LedgerEntry {
  date: Date | string;
  accountId?: string | null;
  transferAccountId?: string | null;
}

export interface PnlAccount {
  id: string;
  clientId?: string | null;
  ownership?: string | null;
}

export interface PnlMonth {
  month: string;
  revenue: number;
  expenses: number;
  netProfit: number;
}

export interface BusinessPnl {
  from: string;
  to: string;
  revenue: number;
  expenses: number;
  expensesByCategory: { categoryId: string; category: string; total: number; count: number }[];
  netProfit: number;
  /** Money moved from a business account to a personal account. */
  ownerDraws: number;
  /** Business-scope spend paid from a personal account. */
  owedToYou: number;
  months: PnlMonth[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Every "YYYY-MM" from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Business profit and loss over [from, to] IST months. Revenue is business
 * credits, expenses are business debits (transfers are neither, as in the
 * personal ledger). Owner draws and money the business owes the owner are
 * reported separately; they don't change profit.
 */
export function businessPnl(
  from: string,
  to: string,
  txs: PnlTx[],
  accounts: PnlAccount[],
  nameOf: (categoryId: string) => string = (id) => id,
): BusinessPnl {
  const ownership = new Map<string, string>();
  for (const a of accounts) {
    const o = a.ownership ?? 'personal';
    ownership.set(a.id, o);
    if (a.clientId) ownership.set(a.clientId, o);
  }
  const ownerOf = (id?: string | null) => (id ? ownership.get(id) : undefined);

  const months = new Map(monthsBetween(from, to).map((m) => [m, { revenue: 0, expenses: 0 }]));
  const categories = new Map<string, { total: number; count: number }>();
  let revenue = 0;
  let expenses = 0;
  let ownerDraws = 0;
  let owedToYou = 0;

  for (const t of txs) {
    const bucket = months.get(istMonthOf(t.date));
    if (!bucket) continue;

    if (t.transferAccountId) {
      // amount > 0 moves money out of accountId into transferAccountId.
      const out = t.amount >= 0;
      const fromAcc = out ? t.accountId : t.transferAccountId;
      const toAcc = out ? t.transferAccountId : t.accountId;
      if (ownerOf(fromAcc) === 'business' && ownerOf(toAcc) === 'personal') ownerDraws += Math.abs(t.amount);
      continue;
    }

    if (t.scope !== 'business') continue;
    if (isIncome(t)) {
      revenue -= t.amount;
      bucket.revenue -= t.amount;
    } else if (isSpend(t)) {
      expenses += t.amount;
      bucket.expenses += t.amount;
      const id = (t.categoryId ?? resolveLegacyCategory(t.category, false).categoryId).split('.')[0];
      const c = categories.get(id) ?? { total: 0, count: 0 };
      c.total += t.amount;
      c.count += 1;
      categories.set(id, c);
      if (ownerOf(t.accountId) === 'personal') owedToYou += t.amount;
    }
  }

  return {
    from,
    to,
    revenue: round(revenue),
    expenses: round(expenses),
    expensesByCategory: [...categories.entries()]
      .map(([categoryId, c]) => ({ categoryId, category: nameOf(categoryId), total: round(c.total), count: c.count }))
      .sort((a, b) => b.total - a.total),
    netProfit: round(revenue - expenses),
    ownerDraws: round(ownerDraws),
    owedToYou: round(owedToYou),
    months: [...months.entries()].map(([month, b]) => ({
      month,
      revenue: round(b.revenue),
      expenses: round(b.expenses),
      netProfit: round(b.revenue - b.expenses),
    })),
  };
}
