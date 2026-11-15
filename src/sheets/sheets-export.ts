import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { Investment } from '../database/entities/investment.entity';
import { Loan } from '../database/entities/loan.entity';
import { CategoryNames } from '../categories/category-resolver';
import { isIncome, isSpend, isTransfer } from '../utils/ledger';

/**
 * Fiscora only ever writes to its own tabs, so the user's other tabs are never
 * touched. Every row starts with a stable ID; the last column is Status.
 */
export const TAB = {
  transactions: 'Fiscora · Transactions',
  accounts: 'Fiscora · Accounts',
  loans: 'Fiscora · Loans',
  investments: 'Fiscora · Investments',
  monthly: 'Fiscora · Monthly',
} as const;

export type Cell = string | number | boolean;
export type Row = Cell[];

const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().substring(0, 10) : '');

export const TRANSACTION_HEADER: Row = [
  'ID', 'Date', 'Type', 'Amount', 'Category', 'Subcategory', 'Account', 'To account',
  'Merchant', 'Note', 'Method', 'Source', 'Counts as spend', 'Needs review', 'Status',
];

/** One row per transaction. Amount is always positive; Type says which way it went. */
export function transactionRows(
  expenses: Expense[],
  names: CategoryNames,
  accountName: (id: string | null | undefined) => string,
): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const e of expenses) {
    const type = isTransfer(e) || e.transferAccountId ? 'Transfer' : e.amount < 0 ? 'Income' : 'Expense';
    rows.set(e.id, [
      e.id,
      day(e.date),
      type,
      Math.abs(e.amount),
      names.name(e.categoryId) ?? e.category ?? '',
      names.name(e.subcategoryId) ?? e.subcategory ?? '',
      accountName(e.accountId),
      e.transferAccountId ? accountName(e.transferAccountId) : '',
      e.merchant ?? '',
      e.note ?? '',
      e.method ?? '',
      e.source ?? '',
      isSpend(e) ? 'Yes' : 'No',
      e.needsReview ? 'Yes' : 'No',
      'Active',
    ]);
  }
  return rows;
}

export const ACCOUNT_HEADER: Row = ['ID', 'Name', 'Type', 'Balance', 'Credit limit', 'Last 4', 'Status'];

export function accountRows(accounts: Account[]): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const a of accounts) {
    rows.set(a.id, [
      a.id, a.name, a.type, a.currentBalance, a.creditLimit ?? 0, a.accountNumberLast4 ?? '', 'Active',
    ]);
  }
  return rows;
}

export const LOAN_HEADER: Row = ['ID', 'Type', 'Name', 'Principal', 'Total', 'Interest %', 'Repayment date', 'Loan status', 'Status'];

export function loanRows(loans: Loan[]): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const l of loans) {
    rows.set(l.id, [
      l.id, l.type, l.name, l.principal, l.total, l.interestRate ?? '', day(l.repaymentDate), l.status, 'Active',
    ]);
  }
  return rows;
}

export const INVESTMENT_HEADER: Row = [
  'ID', 'Name', 'Type', 'Monthly amount', 'Principal', 'Maturity amount', 'Months', 'Start date', 'Maturity date', 'Institution', 'Status',
];

export function investmentRows(investments: Investment[]): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const i of investments) {
    rows.set(i.id, [
      i.id, i.name, i.type, i.monthlyAmount, i.principal, i.maturityAmount, i.durationMonths,
      day(i.startDate), day(i.maturityDate), i.institution ?? '', 'Active',
    ]);
  }
  return rows;
}

/** Monthly totals using the same rules as the app (transfers are neither side). */
export function monthTotals(expenses: Pick<Expense, 'amount' | 'isCountedAsSpend' | 'categoryId' | 'category'>[]) {
  const spent = expenses.filter(isSpend).reduce((s, e) => s + e.amount, 0);
  const income = expenses.filter(isIncome).reduce((s, e) => s - e.amount, 0);
  return { income, spent, net: income - spent };
}

/**
 * Builds the block to write over a Fiscora tab without disturbing the user:
 * rows already in the sheet keep their position (so columns the user added to
 * the right still line up), new ids are appended, and ids that no longer exist
 * are kept but marked "Deleted" rather than removed.
 *
 * [existing] is the current tab content (header first), [current] the live rows.
 */
export function mergeById(header: Row, existing: string[][], current: Map<string, Row>): Row[] {
  const width = header.length;
  const out: Row[] = [header];
  const seen = new Set<string>();

  for (const old of existing.slice(1)) {
    const id = old[0];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const live = current.get(id);
    if (live) {
      out.push(live);
    } else {
      // Gone from Fiscora: keep the user's row, flag it.
      const kept: Row = Array.from({ length: width }, (_, i) => old[i] ?? '');
      kept[width - 1] = 'Deleted';
      out.push(kept);
    }
  }
  for (const [id, row] of current) {
    if (!seen.has(id)) out.push(row);
  }
  return out;
}

/** "A1 notation" for a tab name, which must be quoted because of spaces and the dot. */
export const range = (tab: string, cells: string) => `'${tab.replace(/'/g, "''")}'!${cells}`;

/** Column letter for a 1-based index (1 -> A, 27 -> AA). */
export function columnLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
