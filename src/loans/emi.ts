/**
 * Pure EMI maths for loans (reducing balance). Dates are plain "YYYY-MM-DD"
 * calendar dates so the schedule does not drift with time zones.
 * Mirrored in fiscora-mobile lib/features/loans/domain/emi.dart.
 */
import { randomUUID } from 'crypto';

export interface LoanRepayment {
  id: string;
  date: string;
  amount: number;
  note?: string | null;
}

export interface EmiScheduleRow {
  /** 1-based instalment number. */
  month: number;
  /** "YYYY-MM-DD". */
  dueDate: string;
  emi: number;
  interest: number;
  principal: number;
  /** Balance left after this instalment. */
  balance: number;
}

export interface EmiLoanLike {
  isEmi?: boolean | null;
  principal: number;
  total?: number | null;
  interestRate?: number | null;
  emiAmount?: number | null;
  tenureMonths?: number | null;
  emiStartDate?: Date | string | null;
  emiDayOfMonth?: number | null;
  repayments?: LoanRepayment[] | null;
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Monthly instalment: P·r·(1+r)^n / ((1+r)^n − 1), r = annual% / 1200; r = 0 → P / n. */
export function computeEmi(principal: number, annualRatePercent: number, tenureMonths: number): number {
  if (!(principal > 0) || !(tenureMonths > 0)) return 0;
  const n = Math.round(tenureMonths);
  const r = (annualRatePercent || 0) / 1200;
  if (r <= 0) return round2(principal / n);
  const f = Math.pow(1 + r, n);
  return round2((principal * r * f) / (f - 1));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "YYYY-MM-DD" of a Date or ISO string (calendar part only). */
export function toDateOnly(d: Date | string): string {
  if (typeof d === 'string') return d.substring(0, 10);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Due date of instalment `index` (0-based), day clamped to the month's end. */
export function emiDueDate(start: Date | string, index: number, dayOfMonth?: number | null): string {
  const [y, m, d] = toDateOnly(start).split('-').map(Number);
  const day = dayOfMonth && dayOfMonth > 0 ? dayOfMonth : d;
  const total = (m - 1) + index;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth))}`;
}

/**
 * Amortisation schedule. `emiOverride` replaces the computed EMI; with a
 * larger EMI the loan closes early, and the last row always absorbs rounding
 * (or any remainder) so the balance ends at exactly 0.
 */
export function buildSchedule(params: {
  principal: number;
  annualRatePercent: number;
  tenureMonths: number;
  startDate: Date | string;
  dayOfMonth?: number | null;
  emiOverride?: number | null;
}): EmiScheduleRow[] {
  const n = Math.round(params.tenureMonths || 0);
  if (!(params.principal > 0) || n <= 0) return [];
  const r = (params.annualRatePercent || 0) / 1200;
  const emi = params.emiOverride && params.emiOverride > 0
    ? round2(params.emiOverride)
    : computeEmi(params.principal, params.annualRatePercent, n);
  const rows: EmiScheduleRow[] = [];
  let balance = round2(params.principal);
  for (let i = 0; i < n && balance > 0; i++) {
    const interest = round2(balance * r);
    let principalPart = round2(emi - interest);
    let rowEmi = emi;
    if (i === n - 1 || principalPart >= balance) {
      principalPart = balance;
      rowEmi = round2(interest + balance);
    }
    balance = round2(balance - principalPart);
    rows.push({
      month: i + 1,
      dueDate: emiDueDate(params.startDate, i, params.dayOfMonth),
      emi: rowEmi,
      interest,
      principal: principalPart,
      balance,
    });
  }
  return rows;
}

/** Schedule for a loan, or [] when it is not an EMI loan / lacks the inputs. */
export function scheduleForLoan(loan: EmiLoanLike): EmiScheduleRow[] {
  if (!loan.isEmi || !loan.tenureMonths || !loan.emiStartDate) return [];
  return buildSchedule({
    principal: loan.principal,
    annualRatePercent: loan.interestRate ?? 0,
    tenureMonths: loan.tenureMonths,
    startDate: loan.emiStartDate,
    dayOfMonth: loan.emiDayOfMonth,
    emiOverride: loan.emiAmount,
  });
}

export function totalRepaid(repayments?: LoanRepayment[] | null): number {
  return round2((repayments ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
}

/** Amount payable over the loan's life: the schedule's sum for EMI loans, else `total`. */
export function totalPayable(loan: EmiLoanLike): number {
  const rows = scheduleForLoan(loan);
  if (rows.length) return round2(rows.reduce((s, r) => s + r.emi, 0));
  return round2(loan.total || loan.principal || 0);
}

export function outstanding(loan: EmiLoanLike): number {
  return round2(totalPayable(loan) - totalRepaid(loan.repayments));
}

/**
 * The first instalment not yet covered by the repayments made so far
 * (repayments are applied to instalments in order), or null when all are paid.
 */
export function nextDueRow(loan: EmiLoanLike): EmiScheduleRow | null {
  const paid = totalRepaid(loan.repayments);
  let cumulative = 0;
  for (const row of scheduleForLoan(loan)) {
    cumulative = round2(cumulative + row.emi);
    if (cumulative > paid + 0.005) return row;
  }
  return null;
}

/** Normalises repayment items to { id, date: 'YYYY-MM-DD', amount, note }. */
export function normalizeRepayments(items: any): LoanRepayment[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((r) => r && r.date && Number(r.amount) > 0)
    .map((r) => ({
      id: String(r.id || randomUUID()),
      date: toDateOnly(String(r.date)),
      amount: Number(r.amount),
      note: r.note ? String(r.note) : null,
    }));
}
