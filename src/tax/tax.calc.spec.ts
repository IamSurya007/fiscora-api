import {
  advanceTaxSchedule,
  buildCsv,
  buildSummary,
  fyLabel,
  fyOf,
  fyRange,
  fyStartYearOf,
  isBusinessReceipt,
  istDatePlus,
  meterLevel,
  nextAdvanceTaxDate,
  parseFy,
  presumptiveIncome,
  presumptiveLimit,
  projectAnnual,
  TaxEntry,
  TaxProfileInput,
  thresholdMeters,
  totalReceipts,
} from './tax.calc';
import { SEC_44AD, SEC_44ADA } from './tax-rules';

const LAKH = 100_000;

function receipt(amount: number, extra: Partial<TaxEntry> = {}): TaxEntry {
  return { amount: -amount, scope: 'business', categoryId: 'income', method: 'UPI', ...extra };
}

const profile = (p: Partial<TaxProfileInput> = {}): TaxProfileInput => ({
  regime: '44ADA',
  businessType: 'services',
  setAsidePercent: 20,
  gstRegistered: false,
  ...p,
});

describe('financial year (IST)', () => {
  it('parses and formats FY labels', () => {
    expect(parseFy('2026-27')).toBe(2026);
    expect(parseFy('1999-00')).toBe(1999);
    expect(parseFy('2026-28')).toBeNull();
    expect(parseFy('2026')).toBeNull();
    expect(parseFy('abcd-ef')).toBeNull();
    expect(fyLabel(2026)).toBe('2026-27');
    expect(fyLabel(2099)).toBe('2099-00');
  });

  it('1 Apr 00:00 IST starts the new FY even though it is still 31 Mar in UTC', () => {
    expect(fyOf('2026-03-31T18:29:59.999Z')).toBe('2025-26'); // 23:59:59 IST 31 Mar
    expect(fyOf('2026-03-31T18:30:00.000Z')).toBe('2026-27'); // 00:00 IST 1 Apr
  });

  it('January to March belong to the FY that started the previous April', () => {
    expect(fyStartYearOf('2027-01-15T06:00:00Z')).toBe(2026);
    expect(fyStartYearOf('2026-12-31T20:00:00Z')).toBe(2026); // 1 Jan 2027 01:30 IST
  });

  it('fyRange spans 1 Apr to 1 Apr in IST', () => {
    const { start, end } = fyRange(2026);
    expect(start.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(end.toISOString()).toBe('2027-03-31T18:30:00.000Z');
  });

  it('istDatePlus uses the IST calendar day', () => {
    expect(istDatePlus(new Date('2026-06-09T19:00:00Z'), 5)).toBe('2026-06-15'); // 10 Jun 00:30 IST
    expect(istDatePlus(new Date('2026-06-09T18:00:00Z'), 5)).toBe('2026-06-14');
  });
});

describe('receipts', () => {
  it('counts only business credits, excluding transfers and personal entries', () => {
    expect(isBusinessReceipt(receipt(100))).toBe(true);
    expect(isBusinessReceipt(receipt(100, { scope: 'personal' }))).toBe(false);
    expect(isBusinessReceipt({ amount: 100, scope: 'business', categoryId: 'shopping' })).toBe(false);
    expect(isBusinessReceipt(receipt(100, { transferAccountId: 'acc2' }))).toBe(false);
    expect(isBusinessReceipt(receipt(100, { categoryId: 'transfers' }))).toBe(false);
  });

  it('adds TDS back to get gross receipts and splits cash', () => {
    const t = totalReceipts([
      receipt(90_000, { tdsAmount: 10_000, merchant: 'Acme' }),
      receipt(5_000, { method: 'CASH' }),
      receipt(500, { scope: 'personal' }),
      { amount: 2_000, scope: 'business', categoryId: 'shopping' },
    ]);
    expect(t.received).toBe(95_000);
    expect(t.gross).toBe(105_000);
    expect(t.tds).toBe(10_000);
    expect(t.cash).toBe(5_000);
    expect(t.digital).toBe(100_000);
    expect(t.cashShare).toBeCloseTo(5_000 / 105_000);
    expect(t.count).toBe(2);
  });

  it('ignores negative or invalid TDS values', () => {
    const t = totalReceipts([receipt(1000, { tdsAmount: -5 }), receipt(1000, { tdsAmount: NaN })]);
    expect(t.tds).toBe(0);
    expect(t.gross).toBe(2000);
  });

  it('flags payers over the 194J threshold with no TDS recorded', () => {
    const t = totalReceipts([
      receipt(60_000, { merchant: 'NoTds Ltd' }),
      receipt(45_000, { merchant: 'Small Co' }),
      receipt(54_000, { merchant: 'Good Co', tdsAmount: 6_000 }),
      receipt(70_000),
    ]);
    const by = Object.fromEntries(t.byPayer.map((p) => [p.payer, p]));
    expect(by['NoTds Ltd'].checkTds).toBe(true);
    expect(by['Small Co'].checkTds).toBe(false);
    expect(by['Good Co'].checkTds).toBe(false);
    expect(by['Good Co'].gross).toBe(60_000);
    expect(by['Unspecified'].checkTds).toBe(false);
  });
});

describe('presumptive limits and income', () => {
  it('uses the higher limit when cash is at most 5% of receipts', () => {
    expect(presumptiveLimit('44ADA', 0)).toBe(75 * LAKH);
    expect(presumptiveLimit('44ADA', 0.05)).toBe(75 * LAKH);
    expect(presumptiveLimit('44ADA', 0.0501)).toBe(50 * LAKH);
    expect(presumptiveLimit('44AD', 0.05)).toBe(300 * LAKH);
    expect(presumptiveLimit('44AD', 0.2)).toBe(200 * LAKH);
    expect(presumptiveLimit('regular', 0)).toBeNull();
  });

  it('computes 44ADA at 50% and 44AD at 6% digital + 8% cash', () => {
    expect(presumptiveIncome('44ADA', 10 * LAKH, 1 * LAKH)).toBe(5 * LAKH);
    expect(presumptiveIncome('44AD', 10 * LAKH, 1 * LAKH)).toBe(9 * LAKH * SEC_44AD.digitalRate + LAKH * SEC_44AD.cashRate);
    expect(presumptiveIncome('regular', 10 * LAKH, 0)).toBeNull();
    expect(SEC_44ADA.presumptiveRate).toBe(0.5);
  });

  it('meter levels warn at 80% and flag at 100%', () => {
    expect(meterLevel(79, 100)).toBe('ok');
    expect(meterLevel(80, 100)).toBe('warning');
    expect(meterLevel(99.9, 100)).toBe('warning');
    expect(meterLevel(100, 100)).toBe('exceeded');
    expect(meterLevel(5, 0)).toBe('ok');
  });

  it('switches to the lower 44ADA limit when cash share crosses 5%', () => {
    // ₹45 lakh receipts, 10% cash: 90% of the ₹50 lakh limit, not 60% of ₹75 lakh.
    const t = totalReceipts([receipt(40.5 * LAKH), receipt(4.5 * LAKH, { method: 'CASH' })]);
    const [presumptive] = thresholdMeters(profile(), t);
    expect(presumptive.limit).toBe(50 * LAKH);
    expect(presumptive.percent).toBe(90);
    expect(presumptive.level).toBe('warning');
    expect(presumptive.message).toContain('lower limit');

    const lowCash = totalReceipts([receipt(45 * LAKH)]);
    const [p2] = thresholdMeters(profile(), lowCash);
    expect(p2.limit).toBe(75 * LAKH);
    expect(p2.level).toBe('ok');
  });

  it('GST meter follows business type and is quiet once registered', () => {
    const t = totalReceipts([receipt(25 * LAKH)]);
    const services = thresholdMeters(profile(), t).find((m) => m.key === 'gst')!;
    expect(services.limit).toBe(20 * LAKH);
    expect(services.level).toBe('exceeded');
    expect(services.message).toContain('registration');
    const goods = thresholdMeters(profile({ businessType: 'goods', regime: '44AD' }), t).find((m) => m.key === 'gst')!;
    expect(goods.limit).toBe(40 * LAKH);
    expect(goods.level).toBe('ok');
    const reg = thresholdMeters(profile({ gstRegistered: true }), t).find((m) => m.key === 'gst')!;
    expect(reg.message).toBeNull();
  });

  it('regular regime has no presumptive meter', () => {
    const meters = thresholdMeters(profile({ regime: 'regular' }), totalReceipts([receipt(LAKH)]));
    expect(meters.map((m) => m.key)).toEqual(['gst']);
  });
});

describe('advance tax', () => {
  it('lists the regular and presumptive schedules for the FY', () => {
    expect(advanceTaxSchedule(2026, false)).toEqual([
      { date: '2026-06-15', cumulativePercent: 15 },
      { date: '2026-09-15', cumulativePercent: 45 },
      { date: '2026-12-15', cumulativePercent: 75 },
      { date: '2027-03-15', cumulativePercent: 100 },
    ]);
    expect(advanceTaxSchedule(2026, true)).toEqual([{ date: '2027-03-15', cumulativePercent: 100 }]);
  });

  it('next date is on or after the IST date', () => {
    const s = advanceTaxSchedule(2026, false);
    expect(nextAdvanceTaxDate(s, new Date('2026-09-15T10:00:00Z'))?.date).toBe('2026-09-15');
    // 15 Sep 18:30 UTC is already 16 Sep in IST.
    expect(nextAdvanceTaxDate(s, new Date('2026-09-15T18:30:00Z'))?.date).toBe('2026-12-15');
    expect(nextAdvanceTaxDate(s, new Date('2027-03-20T00:00:00Z'))).toBeNull();
  });

  it('projects receipts linearly with a 30-day floor', () => {
    const { start } = fyRange(2026);
    const totalDays = 365;
    const at = (days: number) => new Date(start.getTime() + days * 86_400_000);
    expect(projectAnnual(1000, 2026, at(73))).toBeCloseTo((1000 * totalDays) / 73, 1);
    expect(projectAnnual(1000, 2026, at(5))).toBeCloseTo((1000 * totalDays) / 30, 1);
    expect(projectAnnual(1000, 2026, at(400))).toBe(1000);
  });
});

describe('buildSummary', () => {
  const entries = [receipt(9 * LAKH, { tdsAmount: LAKH, merchant: 'Acme' }), { amount: 50_000, scope: 'business', categoryId: 'shopping' }];

  it('defaults to the presumptive advance-tax rule for 44ADA', () => {
    const s = buildSummary(profile(), 2026, entries, new Date('2026-11-15T06:00:00Z'));
    expect(s.fy).toBe('2026-27');
    expect(s.receipts.gross).toBe(10 * LAKH);
    expect(s.presumptiveIncome).toBe(5 * LAKH);
    expect(s.setAside).toEqual({ percent: 20, amount: 2 * LAKH });
    expect(s.advanceTax.presumptiveRule).toBe(true);
    expect(s.advanceTax.next).toEqual({ date: '2027-03-15', cumulativePercent: 100 });
    expect(s.advanceTax.regularSchedule).toHaveLength(4);
    expect(s.tds.total).toBe(LAKH);
    expect(s.advanceTax.estimatedDueByNext).toBe(s.advanceTax.estimatedAnnualTax);
    expect(s.advanceTax.applies).toBe(true);
  });

  it('uses the instalment schedule for the regular regime', () => {
    const s = buildSummary(profile({ regime: 'regular' }), 2026, entries, new Date('2026-11-15T06:00:00Z'));
    expect(s.presumptiveIncome).toBeNull();
    expect(s.advanceTax.next).toEqual({ date: '2026-12-15', cumulativePercent: 75 });
    expect(s.advanceTax.estimatedDueByNext).toBeCloseTo(s.advanceTax.estimatedAnnualTax * 0.75, 1);
  });

  it('handles no receipts', () => {
    const s = buildSummary(profile(), 2026, [], new Date('2026-11-15T06:00:00Z'));
    expect(s.receipts.gross).toBe(0);
    expect(s.receipts.cashShare).toBe(0);
    expect(s.advanceTax.applies).toBe(false);
  });
});

describe('buildCsv', () => {
  it('has receipts, expenses by category and TDS sections', () => {
    const entries: TaxEntry[] = [
      receipt(90_000, { tdsAmount: 10_000, merchant: 'Acme, Inc', date: '2026-04-10T05:00:00Z' }),
      receipt(1000, { merchant: '=HYPERLINK("x")', date: '2026-05-01T05:00:00Z' }),
      { amount: 1200, scope: 'business', categoryId: 'shopping', date: '2026-05-02T05:00:00Z' },
      { amount: 300, scope: 'business', categoryId: 'shopping', date: '2026-05-03T05:00:00Z' },
    ];
    const s = buildSummary(profile(), 2026, entries, new Date('2026-11-15T06:00:00Z'));
    const csv = buildCsv(s, entries, (id) => (id === 'shopping' ? 'Shopping' : id));
    expect(csv).toContain('2026-04-10,"Acme, Inc",,UPI,90000,10000,100000');
    expect(csv).toContain('Shopping,1500');
    expect(csv).toContain('TDS by payer');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('estimate, not tax advice');
  });
});
