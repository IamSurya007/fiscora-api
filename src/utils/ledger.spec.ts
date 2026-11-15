import {
  defaultScopeFor,
  istDateOf,
  istMonthOf,
  istMonthRange,
  isIncome,
  isPersonal,
  isPersonalIncome,
  isPersonalSpend,
  isSpend,
  isTransfer,
} from './ledger';

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

describe('personal vs business', () => {
  it('treats missing scope as personal', () => {
    expect(isPersonal({ amount: 100, categoryId: 'food' })).toBe(true);
    expect(isPersonal({ amount: 100, categoryId: 'food', scope: null })).toBe(true);
    expect(isPersonal({ amount: 100, categoryId: 'food', scope: 'business' })).toBe(false);
  });

  it('leaves business spend and income out of personal totals', () => {
    expect(isPersonalSpend({ amount: 500, categoryId: 'food', scope: 'personal' })).toBe(true);
    expect(isPersonalSpend({ amount: 500, categoryId: 'food', scope: 'business' })).toBe(false);
    expect(isPersonalIncome({ amount: -500, categoryId: 'income', scope: 'business' })).toBe(false);
    expect(isPersonalIncome({ amount: -500, categoryId: 'income' })).toBe(true);
  });

  it('still excludes personal transfers', () => {
    expect(isPersonalSpend({ amount: 500, categoryId: 'transfers', scope: 'personal' })).toBe(false);
  });

  it('defaults scope from account ownership', () => {
    expect(defaultScopeFor('business')).toBe('business');
    expect(defaultScopeFor('mixed')).toBe('personal');
    expect(defaultScopeFor('personal')).toBe('personal');
    expect(defaultScopeFor(undefined)).toBe('personal');
  });
});

describe('budgetParts', () => {
  const { budgetParts } = require('./ledger');
  const premium = { amount: 12000, categoryId: 'insurance', date: '2026-04-10T06:00:00Z', spreadMonths: 12 };

  it('spreads a yearly cost evenly over its months', () => {
    expect(budgetParts(premium, '2026-04')).toEqual([{ categoryId: 'insurance', amount: 1000 }]);
    expect(budgetParts(premium, '2027-03')).toEqual([{ categoryId: 'insurance', amount: 1000 }]);
    expect(budgetParts(premium, '2027-04')).toEqual([]);
    expect(budgetParts(premium, '2026-03')).toEqual([]);
  });

  it('counts a split transaction in each category', () => {
    const bill = {
      amount: 3000,
      categoryId: 'groceries',
      date: '2026-11-05T06:00:00Z',
      splits: [
        { categoryId: 'groceries.supermarket', amount: 2000 },
        { categoryId: 'shopping', amount: 1000 },
      ],
    };
    expect(budgetParts(bill, '2026-11')).toEqual([
      { categoryId: 'groceries', amount: 2000 },
      { categoryId: 'shopping', amount: 1000 },
    ]);
  });

  it('ignores business spend and transfers', () => {
    expect(budgetParts({ ...premium, scope: 'business' }, '2026-04')).toEqual([]);
    expect(budgetParts({ amount: 500, categoryId: 'transfers', date: '2026-04-10T06:00:00Z' }, '2026-04')).toEqual([]);
  });
});
