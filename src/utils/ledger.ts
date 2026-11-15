import { SYSTEM_BY_ID, resolveLegacyCategory } from '../categories/category-resolver';

/**
 * Fiscora's users are in India, so a "month" is an IST calendar month.
 * IST is a fixed UTC+05:30 with no daylight saving. Using UTC boundaries put
 * spending between 00:00 and 05:30 IST on the 1st into the previous month.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;

/** [start, end) instants of an IST month given as "YYYY-MM". */
export function istMonthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS),
    end: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS),
  };
}

/** "YYYY-MM" of the IST month containing `date`. */
export function istMonthOf(date: Date | string): string {
  const shifted = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentIstMonth(): string {
  return istMonthOf(new Date());
}

/** "YYYY-MM-DD" of the IST calendar day containing `date`. */
export function istDateOf(date: Date | string): string {
  return new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().substring(0, 10);
}

export function currentIstDate(): string {
  return istDateOf(new Date());
}

export interface LedgerEntry {
  amount: number; // positive = money out (debit), negative = money in (credit)
  isCountedAsSpend?: boolean | null;
  categoryId?: string | null;
  category?: string | null;
  /** 'personal' (default) or 'business'. */
  scope?: string | null;
}

/** Transfers between the user's own accounts are neither spend nor income. */
export function isTransfer(e: LedgerEntry): boolean {
  const id = e.categoryId ?? resolveLegacyCategory(e.category, e.amount < 0).categoryId;
  const parentId = id?.split('.')[0];
  return SYSTEM_BY_ID.get(parentId ?? '')?.kind === 'transfer';
}

/** Debits that count towards spending and budgets. */
export function isSpend(e: LedgerEntry): boolean {
  return e.amount > 0 && e.isCountedAsSpend !== false && !isTransfer(e);
}

/** Credits that count as income (refunds and salary alike; transfers excluded). */
export function isIncome(e: LedgerEntry): boolean {
  return e.amount < 0 && !isTransfer(e);
}

/**
 * Personal views (home totals, budgets, insights) leave out business-scope
 * transactions; those belong to the business P&L instead.
 */
export function isPersonal(e: LedgerEntry): boolean {
  return (e.scope ?? 'personal') !== 'business';
}

/** Spend that counts in the user's personal totals and budgets. */
export function isPersonalSpend(e: LedgerEntry): boolean {
  return isSpend(e) && isPersonal(e);
}

/** Income that counts in the user's personal totals. */
export function isPersonalIncome(e: LedgerEntry): boolean {
  return isIncome(e) && isPersonal(e);
}

/** Scope for a new transaction that didn't specify one, from its account's ownership. */
export function defaultScopeFor(ownership?: string | null): 'personal' | 'business' {
  return ownership === 'business' ? 'business' : 'personal';
}

/** One line of a split transaction (amounts are positive and add up to the total). */
export interface SplitLine {
  categoryId: string;
  subcategoryId?: string | null;
  amount: number;
}

export interface BudgetEntry extends LedgerEntry {
  date: Date | string;
  splits?: SplitLine[] | null;
  /** Count the cost over this many months (1 = only the month it was paid). */
  spreadMonths?: number | null;
}

/** Whole months from "YYYY-MM" a to b (b - a). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/**
 * The parent-category amounts of [e] that count towards [month]'s budgets.
 * A split transaction counts in each of its categories; a spread one counts
 * 1/n of its amount in each of the n months starting with the month it was
 * paid (an annual insurance premium spread over 12 months, for example).
 * The account balance is unaffected: this is only for budgets and reports.
 */
export function budgetParts(e: BudgetEntry, month: string): { categoryId: string; amount: number }[] {
  if (!isPersonalSpend(e)) return [];
  const n = Math.max(1, Math.floor(e.spreadMonths ?? 1));
  const index = monthsBetween(istMonthOf(e.date), month);
  if (index < 0 || index >= n) return [];
  const share = e.amount / n;

  const lines =
    e.splits && e.splits.length > 0
      ? e.splits.filter((l) => l && l.amount > 0)
      : [{ categoryId: e.categoryId ?? resolveLegacyCategory(e.category).categoryId, amount: e.amount }];
  const lineTotal = lines.reduce((t, l) => t + l.amount, 0) || 1;
  return lines.map((l) => ({
    categoryId: (l.categoryId || 'misc').split('.')[0],
    amount: Math.round(((share * l.amount) / lineTotal) * 100) / 100,
  }));
}

/** Longest spread allowed, so budget queries know how far back to look. */
export const MAX_SPREAD_MONTHS = 24;
