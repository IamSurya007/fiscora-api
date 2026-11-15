/**
 * Finds recurring payments (subscriptions, rent, EMIs, utilities) in a user's
 * history: the same merchant charged at a steady interval with similar
 * amounts. Pure so it can be tested without a database.
 */

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface TxLike {
  date: Date;
  amount: number; // > 0 = money out
  merchant: string | null;
  categoryId?: string | null;
  isDeleted?: boolean;
  transferAccountId?: string | null;
}

export interface RecurringPayment {
  key: string;
  merchant: string;
  categoryId: string | null;
  cadence: Cadence;
  averageAmount: number;
  lastAmount: number;
  lastDate: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD
  occurrences: number;
}

const DAY = 24 * 60 * 60 * 1000;

const CADENCES: { cadence: Cadence; days: number; tolerance: number }[] = [
  { cadence: 'weekly', days: 7, tolerance: 2 },
  { cadence: 'monthly', days: 30.4, tolerance: 5 },
  { cadence: 'quarterly', days: 91, tolerance: 10 },
  { cadence: 'yearly', days: 365, tolerance: 20 },
];

/** "NETFLIX.COM 12345", "Netflix" and "netflix*monthly" are the same payee. */
export function merchantKey(merchant: string | null | undefined): string {
  return (merchant ?? '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !['pvt', 'ltd', 'india', 'com', 'www', 'payment', 'upi'].includes(w))
    .slice(0, 2)
    .join(' ')
    .trim();
}

const iso = (d: Date) => d.toISOString().substring(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Adds whole calendar months, clamping to month end (31 Jan + 1 = 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
}

function nextAfter(last: Date, cadence: Cadence): Date {
  switch (cadence) {
    case 'weekly':
      return new Date(last.getTime() + 7 * DAY);
    case 'monthly':
      return addMonths(last, 1);
    case 'quarterly':
      return addMonths(last, 3);
    case 'yearly':
      return addMonths(last, 12);
  }
}

/**
 * Needs at least 3 payments (2 for yearly) whose gaps all fit one cadence and
 * whose amounts stay within 25% of the median. Series that stopped (last
 * payment more than two cycles ago) are dropped.
 */
export function detectRecurring(txs: TxLike[], now = new Date()): RecurringPayment[] {
  const groups = new Map<string, TxLike[]>();
  for (const t of txs) {
    if (t.isDeleted || t.amount <= 0 || t.transferAccountId) continue;
    const key = merchantKey(t.merchant);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const found: RecurringPayment[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    // Several charges on one day (e.g. a retry) count once.
    const series = list.filter((t, i) => i === 0 || iso(t.date) !== iso(list[i - 1].date));
    if (series.length < 2) continue;

    const gaps = series.slice(1).map((t, i) => (t.date.getTime() - series[i].date.getTime()) / DAY);
    const gap = median(gaps);
    const match = CADENCES.find((c) => Math.abs(gap - c.days) <= c.tolerance);
    if (!match) continue;
    const minCount = match.cadence === 'yearly' ? 2 : 3;
    if (series.length < minCount) continue;
    if (!gaps.every((g) => Math.abs(g - match.days) <= match.tolerance * 2)) continue;

    const amounts = series.map((t) => t.amount);
    const mid = median(amounts);
    if (!amounts.every((a) => Math.abs(a - mid) <= mid * 0.25)) continue;

    const last = series[series.length - 1];
    if (now.getTime() - last.date.getTime() > match.days * 2.2 * DAY) continue;

    let next = nextAfter(last.date, match.cadence);
    while (next.getTime() < now.getTime() - DAY) next = nextAfter(next, match.cadence);

    found.push({
      key,
      merchant: last.merchant ?? key,
      categoryId: last.categoryId ?? null,
      cadence: match.cadence,
      averageAmount: Math.round((amounts.reduce((s, a) => s + a, 0) / amounts.length) * 100) / 100,
      lastAmount: last.amount,
      lastDate: iso(last.date),
      nextDueDate: iso(next),
      occurrences: series.length,
    });
  }
  return found.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

/**
 * Next card payment due date given the statement's due day of month
 * (e.g. 5 = due on the 5th), on or after [from]. Clamped to month end.
 */
export function nextDueForDay(dueDay: number, from: Date): Date {
  const thisMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (const offset of [0, 1]) {
    const m = addMonths(thisMonth, offset);
    const lastDay = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
    const due = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), Math.min(dueDay, lastDay)));
    if (due.getTime() >= Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) return due;
  }
  return addMonths(thisMonth, 1);
}
