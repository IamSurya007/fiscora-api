import { detectRecurring, merchantKey, nextDueForDay } from './recurring';

const d = (s: string) => new Date(`${s}T10:00:00Z`);

describe('detectRecurring', () => {
  const now = d('2026-11-15');

  it('finds a monthly subscription and predicts the next charge', () => {
    const txs = ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03'].map((date) => ({
      date: d(date),
      amount: 649,
      merchant: 'NETFLIX.COM',
      categoryId: 'entertainment',
    }));
    const [r] = detectRecurring(txs, now);
    expect(r.cadence).toBe('monthly');
    expect(r.nextDueDate).toBe('2026-12-03');
    expect(r.averageAmount).toBe(649);
  });

  it('ignores irregular spending at the same merchant', () => {
    const txs = ['2026-09-01', '2026-09-04', '2026-10-20', '2026-11-02'].map((date, i) => ({
      date: d(date),
      amount: 200 + i * 150,
      merchant: 'Swiggy',
    }));
    expect(detectRecurring(txs, now)).toEqual([]);
  });

  it('drops series that stopped', () => {
    const txs = ['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10'].map((date) => ({
      date: d(date),
      amount: 199,
      merchant: 'Gym',
    }));
    expect(detectRecurring(txs, now)).toEqual([]);
  });

  it('skips credits and transfers', () => {
    const txs = ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'].map((date) => ({
      date: d(date),
      amount: 20000,
      merchant: 'Card bill',
      transferAccountId: 'card',
    }));
    expect(detectRecurring(txs, now)).toEqual([]);
  });
});

it('normalises merchant names', () => {
  expect(merchantKey('NETFLIX.COM 12345')).toBe(merchantKey('Netflix'));
});

it('finds the next card due date, clamped to month end', () => {
  expect(nextDueForDay(5, d('2026-11-15')).toISOString().substring(0, 10)).toBe('2026-12-05');
  expect(nextDueForDay(20, d('2026-11-15')).toISOString().substring(0, 10)).toBe('2026-11-20');
  expect(nextDueForDay(31, d('2027-02-01')).toISOString().substring(0, 10)).toBe('2027-02-28');
});
