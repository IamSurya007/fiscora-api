/**
 * Pure helpers for the customer credit ledger (udhaar) and invoices.
 * No I/O here so they can be unit-tested directly.
 */

export type EntryDirection = 'gave' | 'got';

export interface InvoiceItem {
  description: string;
  hsnSac?: string;
  qty: number;
  rate: number;
  /** GST rate in percent (0, 5, 12, 18, 28...). Only allowed for GST-registered sellers. */
  gstRate?: number;
}

export interface InvoiceLine extends InvoiceItem {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface InvoiceTotals {
  lines: InvoiceLine[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxTotal: number;
  total: number;
  gstApplicable: boolean;
  interState: boolean;
  title: 'Tax Invoice' | 'Invoice';
}

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const STATE_CODE_REGEX = /^(0[1-9]|[1-9][0-9])$/;
export const INVOICE_NUMBER_MAX = 16;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function isValidGstin(gstin: string | null | undefined): boolean {
  return !!gstin && GSTIN_REGEX.test(gstin);
}

/**
 * Normalise an Indian mobile number to its 10 digits.
 * Accepts "+91 98765 43210", "09876543210", "98765-43210" etc.
 * Returns null when it is not a valid Indian mobile (starts 6-9).
 */
export function normalizeIndianMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? digits : null;
}

/** Indian financial year label for a date: 1 April 2026 – 31 March 2027 -> "2026-27". */
export function financialYear(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Formats an invoice number, e.g. ("2026-27", 1) -> "2026-27/0001". Always <= 16 chars. */
export function formatInvoiceNumber(fy: string, serial: number): string {
  if (!Number.isInteger(serial) || serial < 1) throw new Error('serial must be a positive integer');
  const n = `${fy}/${String(serial).padStart(4, '0')}`;
  if (n.length > INVOICE_NUMBER_MAX) throw new Error('invoice number too long');
  return n;
}

/** Next serial in a financial year given the serials already used in that year. */
export function nextSerial(usedSerials: number[]): number {
  return usedSerials.reduce((m, s) => Math.max(m, s), 0) + 1;
}

/**
 * Decide whether the supply is inter-state. Place of supply (a 2-digit
 * state code) wins; otherwise the buyer's GSTIN state code; otherwise it is
 * treated as a local (intra-state) supply.
 */
export function isInterState(
  sellerGstin: string,
  buyerGstin?: string | null,
  placeOfSupply?: string | null,
): boolean {
  const seller = sellerGstin.slice(0, 2);
  const buyer = placeOfSupply || (buyerGstin ? buyerGstin.slice(0, 2) : seller);
  return seller !== buyer;
}

/**
 * Computes invoice totals. GST is only charged when the seller has a
 * GSTIN (an unregistered person cannot collect tax, CGST Act s.32).
 * Throws when GST fields are supplied without a seller GSTIN.
 */
export function computeInvoiceTotals(
  items: InvoiceItem[],
  sellerGstin?: string | null,
  buyerGstin?: string | null,
  placeOfSupply?: string | null,
): InvoiceTotals {
  const gstApplicable = isValidGstin(sellerGstin);
  if (!gstApplicable) {
    if (items.some((i) => (i.gstRate ?? 0) > 0)) {
      throw new Error('GST can only be charged when your GSTIN is set');
    }
    if (placeOfSupply) throw new Error('Place of supply applies only to GST invoices');
  }
  const interState = gstApplicable ? isInterState(sellerGstin!, buyerGstin, placeOfSupply) : false;

  const lines: InvoiceLine[] = items.map((item) => {
    const taxable = round2(item.qty * item.rate);
    const rate = gstApplicable ? item.gstRate ?? 0 : 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (rate > 0) {
      if (interState) igst = round2((taxable * rate) / 100);
      else {
        cgst = round2((taxable * rate) / 200);
        sgst = cgst;
      }
    }
    return { ...item, taxable, cgst, sgst, igst, total: round2(taxable + cgst + sgst + igst) };
  });

  const sum = (f: (l: InvoiceLine) => number) => round2(lines.reduce((a, l) => a + f(l), 0));
  const subtotal = sum((l) => l.taxable);
  const cgst = sum((l) => l.cgst);
  const sgst = sum((l) => l.sgst);
  const igst = sum((l) => l.igst);
  const taxTotal = round2(cgst + sgst + igst);
  return {
    lines,
    subtotal,
    cgst,
    sgst,
    igst,
    taxTotal,
    total: round2(subtotal + taxTotal),
    gstApplicable,
    interState,
    title: gstApplicable ? 'Tax Invoice' : 'Invoice',
  };
}

/** Balance = sum(gave) - sum(got). Positive means the party owes you. */
export function partyBalance(entries: { amount: number; direction: EntryDirection }[]): number {
  return round2(
    entries.reduce((b, e) => b + (e.direction === 'gave' ? Number(e.amount) : -Number(e.amount)), 0),
  );
}

export function balancesByParty(
  entries: { partyId: string; amount: number; direction: EntryDirection }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    const delta = e.direction === 'gave' ? Number(e.amount) : -Number(e.amount);
    out.set(e.partyId, round2((out.get(e.partyId) ?? 0) + delta));
  }
  return out;
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);
}

export function reminderMessage(partyName: string, amountDue: number, businessName: string): string {
  return (
    `Hello ${partyName}, this is a gentle reminder from ${businessName} that ` +
    `₹${formatInr(amountDue)} is pending on your account. ` +
    `Please make the payment at your earliest convenience. Thank you!`
  );
}

export function whatsappReminderLink(phone10: string, message: string): string {
  return `https://wa.me/91${phone10}?text=${encodeURIComponent(message)}`;
}
