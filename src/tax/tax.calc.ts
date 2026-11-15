/**
 * Pure tax calculators for freelancers / presumptive-tax businesses. No I/O.
 * All figures are estimates (see tax-rules.ts).
 */
import { isTransfer, LedgerEntry } from '../utils/ledger';
import {
  ADVANCE_TAX_MIN_LIABILITY,
  ADVANCE_TAX_PRESUMPTIVE,
  ADVANCE_TAX_REGULAR,
  AdvanceTaxInstalment,
  CASH_SHARE_CUTOFF,
  EXCEEDED_AT,
  GST_THRESHOLD,
  SEC_44AD,
  SEC_44ADA,
  TDS_194J,
  WARN_AT,
} from './tax-rules';

export type TaxRegime = '44ADA' | '44AD' | 'regular';
export type BusinessType = 'services' | 'goods';

export interface TaxProfileInput {
  regime: TaxRegime;
  businessType: BusinessType;
  setAsidePercent: number;
  gstRegistered: boolean;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

// ---------- Financial year (1 April – 31 March, IST) ----------

/** Start year of a FY label like "2026-27"; null when malformed. */
export function parseFy(fy: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy?.trim() ?? '');
  if (!m) return null;
  const start = Number(m[1]);
  if (Number(m[2]) !== (start + 1) % 100) return null;
  return start;
}

export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Start year of the IST financial year containing `date`. */
export function fyStartYearOf(date: Date | string): number {
  const ist = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  return ist.getUTCMonth() >= 3 ? y : y - 1;
}

export function fyOf(date: Date | string): string {
  return fyLabel(fyStartYearOf(date));
}

/** [start, end) instants of the FY: 1 Apr 00:00 IST to the next 1 Apr 00:00 IST. */
export function fyRange(startYear: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(startYear, 3, 1) - IST_OFFSET_MS),
    end: new Date(Date.UTC(startYear + 1, 3, 1) - IST_OFFSET_MS),
  };
}

function istDate(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().substring(0, 10);
}

// ---------- Receipts ----------

export interface TaxEntry extends LedgerEntry {
  scope?: string | null;
  method?: string | null;
  transferAccountId?: string | null;
  tdsAmount?: number | null;
  merchant?: string | null;
  note?: string | null;
  date?: Date | string;
}

/** A business credit that is not a transfer between own accounts. */
export function isBusinessReceipt(e: TaxEntry): boolean {
  return e.scope === 'business' && e.amount < 0 && !e.transferAccountId && !isTransfer(e);
}

/** A business debit that is not a transfer. */
export function isBusinessExpense(e: TaxEntry): boolean {
  return e.scope === 'business' && e.amount > 0 && !e.transferAccountId && !isTransfer(e);
}

function tdsOf(e: TaxEntry): number {
  const t = Number(e.tdsAmount);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

export interface PayerTds {
  payer: string;
  /** Gross amount billed to this payer (received + TDS). */
  gross: number;
  tds: number;
  /** Gross ≥ the 194J threshold but no TDS recorded: worth checking against 26AS/AIS. */
  checkTds: boolean;
}

export interface ReceiptTotals {
  /** Amount actually received (net of TDS). */
  received: number;
  /** Received + TDS: the gross receipts that count for 44AD/44ADA and GST. */
  gross: number;
  cash: number;
  digital: number;
  /** Cash share of gross receipts (0..1). */
  cashShare: number;
  tds: number;
  count: number;
  byPayer: PayerTds[];
}

/**
 * Totals business receipts. When a client paid net of TDS, the recorded credit
 * is the amount received and `tdsAmount` holds the TDS, so gross = received + TDS.
 * TDS is never cash, so it counts towards digital receipts.
 */
export function totalReceipts(entries: TaxEntry[]): ReceiptTotals {
  let received = 0;
  let cash = 0;
  let tds = 0;
  let count = 0;
  const payers = new Map<string, { gross: number; tds: number }>();
  for (const e of entries) {
    if (!isBusinessReceipt(e)) continue;
    const amt = -e.amount;
    const t = tdsOf(e);
    received += amt;
    tds += t;
    count++;
    if (e.method === 'CASH') cash += amt;
    const payer = (e.merchant || '').trim() || 'Unspecified';
    const p = payers.get(payer) ?? { gross: 0, tds: 0 };
    p.gross += amt + t;
    p.tds += t;
    payers.set(payer, p);
  }
  const gross = received + tds;
  const byPayer = [...payers.entries()]
    .map(([payer, p]) => ({
      payer,
      gross: round2(p.gross),
      tds: round2(p.tds),
      checkTds: payer !== 'Unspecified' && p.tds === 0 && p.gross >= TDS_194J.thresholdPerPayer,
    }))
    .sort((a, b) => b.gross - a.gross);
  return {
    received: round2(received),
    gross: round2(gross),
    cash: round2(cash),
    digital: round2(gross - cash),
    cashShare: gross > 0 ? cash / gross : 0,
    tds: round2(tds),
    count,
    byPayer,
  };
}

// ---------- Presumptive income and limits ----------

/** 44ADA / 44AD receipts limit given the cash share; null for the regular regime. */
export function presumptiveLimit(regime: TaxRegime, cashShare: number): number | null {
  const lowCash = cashShare <= CASH_SHARE_CUTOFF;
  if (regime === '44ADA') return lowCash ? SEC_44ADA.limitLowCash : SEC_44ADA.limitHighCash;
  if (regime === '44AD') return lowCash ? SEC_44AD.limitLowCash : SEC_44AD.limitHighCash;
  return null;
}

/** Presumptive income: 50% of gross (44ADA); 6% digital + 8% cash (44AD); null otherwise. */
export function presumptiveIncome(regime: TaxRegime, gross: number, cash: number): number | null {
  if (regime === '44ADA') return round2(gross * SEC_44ADA.presumptiveRate);
  if (regime === '44AD') return round2((gross - cash) * SEC_44AD.digitalRate + cash * SEC_44AD.cashRate);
  return null;
}

export type MeterLevel = 'ok' | 'warning' | 'exceeded';

export interface Meter {
  key: 'presumptive' | 'gst';
  label: string;
  value: number;
  limit: number;
  percent: number;
  level: MeterLevel;
  message: string | null;
}

export function meterLevel(value: number, limit: number): MeterLevel {
  if (limit <= 0) return 'ok';
  const r = value / limit;
  if (r >= EXCEEDED_AT) return 'exceeded';
  if (r >= WARN_AT) return 'warning';
  return 'ok';
}

function meter(key: Meter['key'], label: string, value: number, limit: number, messages: Record<MeterLevel, string | null>): Meter {
  const level = meterLevel(value, limit);
  return {
    key,
    label,
    value: round2(value),
    limit,
    percent: limit > 0 ? Math.round((value / limit) * 1000) / 10 : 0,
    level,
    message: messages[level],
  };
}

export function thresholdMeters(profile: TaxProfileInput, totals: ReceiptTotals): Meter[] {
  const out: Meter[] = [];
  const limit = presumptiveLimit(profile.regime, totals.cashShare);
  if (limit !== null) {
    const lakh = limit / 100_000;
    const cashNote =
      totals.cashShare > CASH_SHARE_CUTOFF
        ? ` Cash is over ${CASH_SHARE_CUTOFF * 100}% of receipts, so the lower limit applies.`
        : '';
    out.push(
      meter('presumptive', `Section ${profile.regime} limit (₹${lakh} lakh)`, totals.gross, limit, {
        ok: cashNote.trim() || null,
        warning: `Receipts are over ${WARN_AT * 100}% of the ${profile.regime} limit.${cashNote}`,
        exceeded: `Receipts are over the ${profile.regime} limit; presumptive taxation may not be available.${cashNote}`,
      }),
    );
  }
  const gstLimit = GST_THRESHOLD[profile.businessType];
  out.push(
    meter('gst', `GST registration threshold (₹${gstLimit / 100_000} lakh, ${profile.businessType})`, totals.gross, gstLimit, {
      ok: null,
      warning: profile.gstRegistered ? null : `Turnover is over ${WARN_AT * 100}% of the GST registration threshold.`,
      exceeded: profile.gstRegistered ? null : 'Turnover is over the GST registration threshold; registration may be required.',
    }),
  );
  return out;
}

// ---------- Advance tax ----------

export interface AdvanceTaxDate {
  /** IST date, YYYY-MM-DD. */
  date: string;
  cumulativePercent: number;
}

function instalmentDate(fyStartYear: number, i: AdvanceTaxInstalment): string {
  const year = i.month >= 4 ? fyStartYear : fyStartYear + 1;
  return `${year}-${String(i.month).padStart(2, '0')}-${String(i.day).padStart(2, '0')}`;
}

export function advanceTaxSchedule(fyStartYear: number, presumptive: boolean): AdvanceTaxDate[] {
  return (presumptive ? ADVANCE_TAX_PRESUMPTIVE : ADVANCE_TAX_REGULAR).map((i) => ({
    date: instalmentDate(fyStartYear, i),
    cumulativePercent: i.cumulativePercent,
  }));
}

/** First due date on or after today's IST date; null when the FY's dates have passed. */
export function nextAdvanceTaxDate(schedule: AdvanceTaxDate[], now: Date): AdvanceTaxDate | null {
  const today = istDate(now);
  return schedule.find((d) => d.date >= today) ?? null;
}

/**
 * Full-year receipts projected from receipts so far (linear in days elapsed,
 * at least 30 days to avoid wild early projections). Past FYs return as-is.
 */
export function projectAnnual(grossSoFar: number, fyStartYear: number, now: Date): number {
  const { start, end } = fyRange(fyStartYear);
  if (now >= end) return grossSoFar;
  if (now < start) return grossSoFar;
  const totalDays = (end.getTime() - start.getTime()) / 86_400_000;
  const elapsed = Math.max(30, (now.getTime() - start.getTime()) / 86_400_000);
  return round2(grossSoFar * (totalDays / Math.min(elapsed, totalDays)));
}

// ---------- Summary ----------

export interface TaxSummary {
  fy: string;
  regime: TaxRegime;
  receipts: ReceiptTotals;
  presumptiveIncome: number | null;
  meters: Meter[];
  setAside: { percent: number; amount: number };
  advanceTax: {
    presumptiveRule: boolean;
    schedule: AdvanceTaxDate[];
    regularSchedule: AdvanceTaxDate[];
    presumptiveSchedule: AdvanceTaxDate[];
    next: AdvanceTaxDate | null;
    /** Rough full-year tax: projected receipts × set-aside percent. */
    estimatedAnnualTax: number;
    /** estimatedAnnualTax × next cumulative percent (before any advance tax already paid). */
    estimatedDueByNext: number | null;
    applies: boolean;
  };
  tds: { total: number; rate: number; thresholdPerPayer: number; byPayer: PayerTds[] };
}

export function buildSummary(profile: TaxProfileInput, fyStartYear: number, entries: TaxEntry[], now: Date): TaxSummary {
  const receipts = totalReceipts(entries);
  const presumptive = profile.regime === '44ADA' || profile.regime === '44AD';
  const regularSchedule = advanceTaxSchedule(fyStartYear, false);
  const presumptiveSchedule = advanceTaxSchedule(fyStartYear, true);
  const schedule = presumptive ? presumptiveSchedule : regularSchedule;
  const next = nextAdvanceTaxDate(schedule, now);
  const estimatedAnnualTax = round2((projectAnnual(receipts.gross, fyStartYear, now) * profile.setAsidePercent) / 100);
  return {
    fy: fyLabel(fyStartYear),
    regime: profile.regime,
    receipts,
    presumptiveIncome: presumptiveIncome(profile.regime, receipts.gross, receipts.cash),
    meters: thresholdMeters(profile, receipts),
    setAside: { percent: profile.setAsidePercent, amount: round2((receipts.gross * profile.setAsidePercent) / 100) },
    advanceTax: {
      presumptiveRule: presumptive,
      schedule,
      regularSchedule,
      presumptiveSchedule,
      next,
      estimatedAnnualTax,
      estimatedDueByNext: next ? round2((estimatedAnnualTax * next.cumulativePercent) / 100) : null,
      applies: estimatedAnnualTax >= ADVANCE_TAX_MIN_LIABILITY,
    },
    tds: {
      total: receipts.tds,
      rate: TDS_194J.rate,
      thresholdPerPayer: TDS_194J.thresholdPerPayer,
      byPayer: receipts.byPayer,
    },
  };
}

// ---------- CSV export ----------

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function row(...cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

export function buildCsv(summary: TaxSummary, entries: TaxEntry[], categoryName: (id: string) => string): string {
  const lines: string[] = [];
  lines.push(row(`Fiscora tax export FY ${summary.fy} (estimate, not tax advice)`));
  lines.push('');
  lines.push(row('Summary'));
  lines.push(row('Regime', summary.regime));
  lines.push(row('Gross receipts', summary.receipts.gross));
  lines.push(row('Received (net of TDS)', summary.receipts.received));
  lines.push(row('Cash receipts', summary.receipts.cash));
  lines.push(row('Digital receipts', summary.receipts.digital));
  lines.push(row('Presumptive income', summary.presumptiveIncome));
  lines.push(row('TDS total', summary.tds.total));
  lines.push('');

  lines.push(row('Receipts'));
  lines.push(row('Date', 'Payer', 'Note', 'Method', 'Received', 'TDS', 'Gross'));
  const receipts = entries.filter(isBusinessReceipt).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const e of receipts) {
    const t = tdsOf(e);
    lines.push(row(e.date ? istDate(new Date(e.date)) : '', e.merchant, e.note, e.method, round2(-e.amount), t || '', round2(-e.amount + t)));
  }
  lines.push('');

  lines.push(row('Business expenses by category'));
  lines.push(row('Category', 'Amount'));
  const byCat = new Map<string, number>();
  for (const e of entries) {
    if (!isBusinessExpense(e)) continue;
    const name = e.categoryId ? categoryName(e.categoryId) : e.category || 'Other';
    byCat.set(name, (byCat.get(name) ?? 0) + e.amount);
  }
  for (const [name, amt] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) lines.push(row(name, round2(amt)));
  lines.push('');

  lines.push(row('TDS by payer (check against Form 26AS / AIS)'));
  lines.push(row('Payer', 'Gross', 'TDS'));
  for (const p of summary.tds.byPayer) lines.push(row(p.payer, p.gross, p.tds));
  return lines.join('\r\n') + '\r\n';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "YYYY-MM-DD" of the IST calendar day `days` after `now`. */
export function istDatePlus(now: Date, days: number): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().substring(0, 10);
}
