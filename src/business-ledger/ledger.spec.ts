import {
  balancesByParty,
  computeInvoiceTotals,
  financialYear,
  formatInvoiceNumber,
  isInterState,
  isValidGstin,
  nextSerial,
  normalizeIndianMobile,
  partyBalance,
  reminderMessage,
  whatsappReminderLink,
} from './ledger';

const KA_GSTIN = '29ABCDE1234F1Z5';
const KA_BUYER = '29PQRSX6789K1Z2';
const MH_BUYER = '27PQRSX6789K1Z2';

describe('financial year + serials', () => {
  it('starts the Indian FY on 1 April', () => {
    expect(financialYear('2026-03-31')).toBe('2025-26');
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2026-12-31')).toBe('2026-27');
    expect(financialYear('2099-05-01')).toBe('2099-00');
  });

  it('formats a running serial within 16 chars', () => {
    expect(formatInvoiceNumber('2026-27', 1)).toBe('2026-27/0001');
    expect(formatInvoiceNumber('2026-27', 12345)).toBe('2026-27/12345');
    expect(formatInvoiceNumber('2026-27', 12345).length).toBeLessThanOrEqual(16);
    expect(() => formatInvoiceNumber('2026-27', 0)).toThrow();
    expect(() => formatInvoiceNumber('2026-27', 1234567890)).toThrow();
  });

  it('picks the next serial after the highest used one', () => {
    expect(nextSerial([])).toBe(1);
    expect(nextSerial([1, 2, 5, 3])).toBe(6);
  });
});

describe('validation', () => {
  it('normalises Indian mobiles', () => {
    expect(normalizeIndianMobile('+91 98765 43210')).toBe('9876543210');
    expect(normalizeIndianMobile('09876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('919876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('98765-43210')).toBe('9876543210');
    expect(normalizeIndianMobile('5876543210')).toBeNull();
    expect(normalizeIndianMobile('12345')).toBeNull();
    expect(normalizeIndianMobile('')).toBeNull();
  });

  it('validates GSTIN shape', () => {
    expect(isValidGstin(KA_GSTIN)).toBe(true);
    expect(isValidGstin('29ABCDE1234F1X5')).toBe(false);
    expect(isValidGstin(null)).toBe(false);
  });
});

describe('invoice totals', () => {
  const items = [
    { description: 'Design work', hsnSac: '998391', qty: 2, rate: 1000, gstRate: 18 },
    { description: 'Printing', qty: 3, rate: 33.33, gstRate: 5 },
  ];

  it('splits CGST + SGST for same-state supply', () => {
    const t = computeInvoiceTotals(items, KA_GSTIN, KA_BUYER);
    expect(t.title).toBe('Tax Invoice');
    expect(t.interState).toBe(false);
    expect(t.subtotal).toBe(2099.99);
    expect(t.cgst).toBe(180 + 2.5);
    expect(t.sgst).toBe(182.5);
    expect(t.igst).toBe(0);
    expect(t.total).toBe(2464.99);
  });

  it('charges IGST for inter-state supply by buyer GSTIN', () => {
    const t = computeInvoiceTotals(items, KA_GSTIN, MH_BUYER);
    expect(t.interState).toBe(true);
    expect(t.igst).toBe(365);
    expect(t.cgst + t.sgst).toBe(0);
    expect(t.total).toBe(2464.99);
  });

  it('lets place of supply override the buyer GSTIN', () => {
    expect(isInterState(KA_GSTIN, MH_BUYER, '29')).toBe(false);
    expect(isInterState(KA_GSTIN, null, '27')).toBe(true);
    expect(isInterState(KA_GSTIN, null, null)).toBe(false);
  });

  it('issues a plain invoice without GST for unregistered sellers', () => {
    const t = computeInvoiceTotals([{ description: 'Tuition', qty: 1, rate: 5000 }], null);
    expect(t.title).toBe('Invoice');
    expect(t.gstApplicable).toBe(false);
    expect(t.taxTotal).toBe(0);
    expect(t.total).toBe(5000);
  });

  it('rejects GST fields when the seller has no GSTIN', () => {
    expect(() => computeInvoiceTotals(items, null)).toThrow(/GSTIN/);
    expect(() =>
      computeInvoiceTotals([{ description: 'x', qty: 1, rate: 1 }], undefined, null, '27'),
    ).toThrow(/Place of supply/);
  });
});

describe('balances + reminders', () => {
  it('computes gave minus got', () => {
    expect(
      partyBalance([
        { amount: 1000, direction: 'gave' },
        { amount: 250.5, direction: 'got' },
        { amount: 0.1, direction: 'gave' },
        { amount: 0.2, direction: 'gave' },
      ]),
    ).toBe(749.8);
    expect(partyBalance([])).toBe(0);
  });

  it('groups balances per party', () => {
    const m = balancesByParty([
      { partyId: 'a', amount: 500, direction: 'gave' },
      { partyId: 'b', amount: 100, direction: 'got' },
      { partyId: 'a', amount: 200, direction: 'got' },
    ]);
    expect(m.get('a')).toBe(300);
    expect(m.get('b')).toBe(-100);
    expect(m.get('c')).toBeUndefined();
  });

  it('builds an url-encoded wa.me link', () => {
    const msg = reminderMessage('Ravi', 125000, 'Sharma Traders');
    expect(msg).toContain('1,25,000');
    expect(msg).toContain('Sharma Traders');
    const link = whatsappReminderLink('9876543210', msg);
    expect(link.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    expect(decodeURIComponent(link.split('?text=')[1])).toBe(msg);
    expect(link).not.toContain(' ');
  });
});
