import { monthReview, weeklyRecap } from './review';

const tx = (id: string, amount: number, categoryId: string, date = '2026-11-05') => ({
  id,
  amount,
  categoryId,
  date: new Date(`${date}T10:00:00Z`),
  merchant: id,
});
const names = (id: string) => ({ food: 'Food', rent: 'Rent', income: 'Income', transfers: 'Transfers' })[id] ?? id;

describe('monthReview', () => {
  const current = [tx('salary', -100000, 'income'), tx('rent', 30000, 'rent'), tx('swiggy', 6000, 'food'), tx('atm', 5000, 'transfers')];
  const previous = [tx('salary', -100000, 'income'), tx('rent', 30000, 'rent'), tx('swiggy', 4000, 'food')];
  const r = monthReview('2026-11', current, previous, names);

  it('totals with transfers excluded', () => {
    expect(r.income).toBe(100000);
    expect(r.spent).toBe(36000);
    expect(r.net).toBe(64000);
    expect(r.savingsRate).toBe(64);
  });

  it('compares with last month', () => {
    expect(r.spentChangePct).toBe(6);
    expect(r.biggestUp?.categoryId).toBe('food');
    expect(r.biggestUp?.change).toBe(2000);
  });

  it('lists the largest purchases', () => {
    expect(r.biggest[0].merchant).toBe('rent');
    expect(r.biggest.find((b) => b.merchant === 'atm')).toBeUndefined();
  });
});

describe('weeklyRecap', () => {
  it('summarises the week', () => {
    const r = weeklyRecap([tx('a', 1500, 'food'), tx('b', 500, 'rent')], [tx('c', 1000, 'food')], names);
    expect(r?.body).toBe('You spent ₹2,000 this week, 100% more than last week. Most went to Food (₹1,500).');
  });

  it('stays quiet when nothing was spent', () => {
    expect(weeklyRecap([], [], names)).toBeNull();
  });
});

describe('monthReview with business transactions', () => {
  it('leaves business-scope spend and revenue out of personal totals', () => {
    const current = [
      tx('salary', -100000, 'income'),
      tx('swiggy', 6000, 'food'),
      { ...tx('client', -40000, 'income'), scope: 'business' },
      { ...tx('office', 9000, 'shopping'), scope: 'business' },
    ];
    const r = monthReview('2026-11', current, [], names);
    expect(r.income).toBe(100000);
    expect(r.spent).toBe(6000);
    expect(r.biggest.map((b) => b.id)).toEqual(['swiggy']);
  });
});
