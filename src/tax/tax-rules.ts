/**
 * Indian tax figures used by the tax helpers. All amounts in rupees.
 *
 * These come from secondary sources — verify on incometax.gov.in / cbic-gst.gov.in
 * before relying on them, and update here (the only place they live) when the
 * law or the Finance Act changes. Everything built on them is an estimate, not
 * tax advice.
 */

/** Share of receipts in cash at or below which the higher presumptive limit applies. */
export const CASH_SHARE_CUTOFF = 0.05;

/** Section 44ADA — specified professionals (presumptive). */
export const SEC_44ADA = {
  /** Presumptive income as a share of gross receipts. */
  presumptiveRate: 0.5,
  /** Receipts limit when cash receipts are ≤ CASH_SHARE_CUTOFF of total receipts. */
  limitLowCash: 7_500_000,
  /** Receipts limit otherwise. */
  limitHighCash: 5_000_000,
} as const;

/** Section 44AD — eligible businesses (presumptive). */
export const SEC_44AD = {
  /** Presumptive income rate on receipts by digital modes (bank, UPI, card, cheque). */
  digitalRate: 0.06,
  /** Presumptive income rate on cash receipts. */
  cashRate: 0.08,
  limitLowCash: 30_000_000,
  limitHighCash: 20_000_000,
} as const;

/** GST registration thresholds on aggregate turnover (normal-category states). */
export const GST_THRESHOLD = {
  services: 2_000_000,
  goods: 4_000_000,
  /** Special category states have lower thresholds; not modelled here. */
  note: 'Special category states have lower GST registration thresholds (e.g. ₹10 lakh / ₹20 lakh).',
} as const;

export interface AdvanceTaxInstalment {
  /** Calendar month (1-12) and day of the due date. */
  month: number;
  day: number;
  /** Cumulative share of the year's tax due by this date, in percent. */
  cumulativePercent: number;
}

/** Advance-tax due dates (in the FY: Jun/Sep/Dec of the start year, Mar of the end year). */
export const ADVANCE_TAX_REGULAR: readonly AdvanceTaxInstalment[] = [
  { month: 6, day: 15, cumulativePercent: 15 },
  { month: 9, day: 15, cumulativePercent: 45 },
  { month: 12, day: 15, cumulativePercent: 75 },
  { month: 3, day: 15, cumulativePercent: 100 },
];

/** 44AD / 44ADA taxpayers may pay the whole year's advance tax by 15 March. */
export const ADVANCE_TAX_PRESUMPTIVE: readonly AdvanceTaxInstalment[] = [
  { month: 3, day: 15, cumulativePercent: 100 },
];

/** Advance tax applies only when the year's tax liability is at least this much. */
export const ADVANCE_TAX_MIN_LIABILITY = 10_000;

/** TDS on professional / technical fees, section 194J. */
export const TDS_194J = {
  rate: 0.1,
  /** Per payer per FY, from 1 April 2025. */
  thresholdPerPayer: 50_000,
  thresholdEffectiveFrom: '2025-04-01',
} as const;

/** Meter levels: warn at 80% of a limit, flag at 100%. */
export const WARN_AT = 0.8;
export const EXCEEDED_AT = 1.0;

/** Default share of receipts to set aside for tax, in percent. */
export const DEFAULT_SET_ASIDE_PERCENT = 20;

/** Days before an advance-tax due date that the reminder push goes out. */
export const ADVANCE_TAX_REMINDER_DAYS = 5;

export const TAX_DISCLAIMER =
  'Estimates only, not tax advice. Figures are based on rules from secondary sources; verify on incometax.gov.in / cbic-gst.gov.in or with a CA.';
