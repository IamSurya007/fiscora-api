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
