import { istDateOf, istMonthOf, istMonthRange, isIncome, isSpend, isTransfer } from './ledger';

describe('IST months', () => {
  it('starts the month at 00:00 IST, i.e. 18:30 UTC the day before', () => {
    const { start, end } = istMonthRange('2026-11');
    expect(start.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-11-30T18:30:00.000Z');
  });

  it('puts 02:00 IST on the 1st into the new month', () => {
    expect(istMonthOf('2026-10-31T20:30:00.000Z')).toBe('2026-11');
  });

  it('handles the year boundary', () => {
    expect(istMonthRange('2026-12').end.toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });
});

describe('ledger classification', () => {
  it('counts debits as spend and credits as income', () => {
    expect(isSpend({ amount: 500, categoryId: 'food' })).toBe(true);
    expect(isIncome({ amount: -50000, categoryId: 'income' })).toBe(true);
  });

  it('treats transfers as neither', () => {
    const atm = { amount: 5000, categoryId: 'transfers' };
    expect(isTransfer(atm)).toBe(true);
    expect(isSpend(atm)).toBe(false);
    expect(isIncome({ amount: -5000, categoryId: 'transfers' })).toBe(false);
  });

  it('honours the exclude-from-spend flag', () => {
    expect(isSpend({ amount: 500, categoryId: 'food', isCountedAsSpend: false })).toBe(false);
  });
});

describe('IST dates', () => {
  it('rolls over at 00:00 IST (18:30 UTC)', () => {
    expect(istDateOf('2026-11-15T18:29:59.000Z')).toBe('2026-11-15');
    expect(istDateOf('2026-11-15T18:30:00.000Z')).toBe('2026-11-16');
  });
});
