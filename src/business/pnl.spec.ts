import { businessPnl, monthsBetween } from './pnl';

const accounts = [
  { id: 'srv-biz', clientId: 'biz', ownership: 'business' },
  { id: 'srv-me', clientId: 'me', ownership: 'personal' },
  { id: 'mix', ownership: 'mixed' },
];
const d = (s: string) => new Date(`${s}T12:00:00+05:30`);

describe('businessPnl', () => {
  it('splits business revenue and expenses, ignoring personal and transfers', () => {
    const pnl = businessPnl(
      '2026-11',
      '2026-11',
      [
        { amount: -50000, scope: 'business', categoryId: 'income', accountId: 'biz', date: d('2026-11-02') },
        { amount: 1200, scope: 'business', categoryId: 'shopping.office', accountId: 'biz', date: d('2026-11-03') },
        { amount: 800, scope: 'business', categoryId: 'shopping', accountId: 'mix', date: d('2026-11-04') },
        { amount: 3000, scope: 'business', categoryId: 'bills', accountId: 'biz', date: d('2026-11-05') },
        { amount: 999, scope: 'personal', categoryId: 'food', accountId: 'me', date: d('2026-11-05') },
        { amount: -70000, scope: 'personal', categoryId: 'income', accountId: 'me', date: d('2026-11-01') },
        { amount: 500, scope: 'business', categoryId: 'food', accountId: 'biz', date: d('2026-10-31') },
      ],
      accounts,
      (id) => id.toUpperCase(),
    );
    expect(pnl.revenue).toBe(50000);
    expect(pnl.expenses).toBe(5000);
    expect(pnl.netProfit).toBe(45000);
    expect(pnl.expensesByCategory).toEqual([
      { categoryId: 'bills', category: 'BILLS', total: 3000, count: 1 },
      { categoryId: 'shopping', category: 'SHOPPING', total: 2000, count: 2 },
    ]);
    expect(pnl.months).toEqual([{ month: '2026-11', revenue: 50000, expenses: 5000, netProfit: 45000 }]);
    expect(pnl.ownerDraws).toBe(0);
    expect(pnl.owedToYou).toBe(0);
  });

  it('counts transfers from a business to a personal account as owner draws', () => {
    const pnl = businessPnl(
      '2026-11',
      '2026-11',
      [
        { amount: 20000, categoryId: 'transfers', accountId: 'biz', transferAccountId: 'me', date: d('2026-11-10') },
        // Recorded on the receiving side: money into `me` from `srv-biz`.
        { amount: -5000, categoryId: 'transfers', accountId: 'srv-me', transferAccountId: 'srv-biz', date: d('2026-11-11') },
        // Capital injection (personal -> business) is not a draw.
        { amount: 10000, categoryId: 'transfers', accountId: 'me', transferAccountId: 'biz', date: d('2026-11-12') },
        { amount: 700, categoryId: 'transfers', accountId: 'biz', transferAccountId: 'mix', date: d('2026-11-12') },
      ],
      accounts,
    );
    expect(pnl.ownerDraws).toBe(25000);
    expect(pnl.revenue).toBe(0);
    expect(pnl.expenses).toBe(0);
  });

  it('tracks business spend paid from personal accounts as owed to you', () => {
    const pnl = businessPnl(
      '2026-11',
      '2026-11',
      [
        { amount: 1500, scope: 'business', categoryId: 'travel', accountId: 'me', date: d('2026-11-08') },
        { amount: 400, scope: 'business', categoryId: 'travel', accountId: 'biz', date: d('2026-11-08') },
        { amount: 300, scope: 'personal', categoryId: 'travel', accountId: 'me', date: d('2026-11-08') },
      ],
      accounts,
    );
    expect(pnl.owedToYou).toBe(1500);
    expect(pnl.expenses).toBe(1900);
  });

  it('buckets a range by IST month, including empty months', () => {
    const pnl = businessPnl(
      '2026-12',
      '2027-02',
      [
        { amount: -1000, scope: 'business', categoryId: 'income', accountId: 'biz', date: '2026-12-31T19:00:00Z' }, // 1 Jan IST
        { amount: 250, scope: 'business', categoryId: 'food', accountId: 'biz', date: d('2027-02-14') },
      ],
      accounts,
    );
    expect(pnl.months).toEqual([
      { month: '2026-12', revenue: 0, expenses: 0, netProfit: 0 },
      { month: '2027-01', revenue: 1000, expenses: 0, netProfit: 1000 },
      { month: '2027-02', revenue: 0, expenses: 250, netProfit: -250 },
    ]);
    expect(pnl.netProfit).toBe(750);
  });

  it('excludes debits not counted as spend', () => {
    const pnl = businessPnl(
      '2026-11',
      '2026-11',
      [{ amount: 900, scope: 'business', categoryId: 'food', isCountedAsSpend: false, accountId: 'biz', date: d('2026-11-08') }],
      accounts,
    );
    expect(pnl.expenses).toBe(0);
  });
});

describe('monthsBetween', () => {
  it('lists months inclusively across a year end', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2026-05', '2026-05')).toEqual(['2026-05']);
  });
});
