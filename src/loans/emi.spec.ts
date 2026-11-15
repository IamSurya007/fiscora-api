import { buildSchedule, computeEmi, emiDueDate, nextDueRow, outstanding, totalPayable } from './emi';

describe('emi maths', () => {
  it('computes the reducing-balance EMI', () => {
    // 1,00,000 at 12% for 12 months -> 8884.88
    expect(computeEmi(100000, 12, 12)).toBeCloseTo(8884.88, 2);
    // 5,00,000 at 8.5% for 60 months -> 10258.27
    expect(computeEmi(500000, 8.5, 60)).toBeCloseTo(10258.27, 2);
  });

  it('splits evenly when the rate is zero', () => {
    expect(computeEmi(12000, 0, 12)).toBe(1000);
    expect(computeEmi(0, 10, 12)).toBe(0);
    expect(computeEmi(1000, 10, 0)).toBe(0);
  });

  it('clamps due dates to the month end', () => {
    expect(emiDueDate('2026-01-31', 0)).toBe('2026-01-31');
    expect(emiDueDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(emiDueDate('2026-01-31', 2)).toBe('2026-03-31');
    expect(emiDueDate('2027-12-15', 1, 5)).toBe('2028-01-05');
    expect(emiDueDate('2028-01-10', 1, 30)).toBe('2028-02-29');
  });

  it('builds a schedule that ends at exactly zero', () => {
    const rows = buildSchedule({ principal: 100000, annualRatePercent: 12, tenureMonths: 12, startDate: '2026-01-05' });
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ month: 1, dueDate: '2026-01-05', emi: 8884.88, interest: 1000, principal: 7884.88, balance: 92115.12 });
    expect(rows[11].balance).toBe(0);
    expect(rows[11].dueDate).toBe('2026-12-05');
    const principalSum = rows.reduce((s, r) => s + r.principal, 0);
    expect(principalSum).toBeCloseTo(100000, 2);
    // only the last row may differ from the EMI, and only by rounding
    expect(Math.abs(rows[11].emi - 8884.88)).toBeLessThan(0.1);
  });

  it('closes early with a larger override EMI', () => {
    const rows = buildSchedule({ principal: 12000, annualRatePercent: 0, tenureMonths: 12, startDate: '2026-01-01', emiOverride: 5000 });
    expect(rows.map((r) => r.emi)).toEqual([5000, 5000, 2000]);
    expect(rows[2].balance).toBe(0);
  });

  it('puts any remainder of a small override EMI in the last row', () => {
    const rows = buildSchedule({ principal: 12000, annualRatePercent: 0, tenureMonths: 3, startDate: '2026-01-01', emiOverride: 1000 });
    expect(rows.map((r) => r.emi)).toEqual([1000, 1000, 10000]);
  });

  it('derives outstanding and next due from repayments', () => {
    const loan = {
      isEmi: true,
      principal: 12000,
      interestRate: 0,
      tenureMonths: 12,
      emiStartDate: '2026-01-10',
      repayments: [
        { id: 'a', date: '2026-01-10', amount: 1000 },
        { id: 'b', date: '2026-02-10', amount: 500 },
      ],
    };
    expect(totalPayable(loan)).toBe(12000);
    expect(outstanding(loan)).toBe(10500);
    expect(nextDueRow(loan)?.dueDate).toBe('2026-02-10');
    expect(nextDueRow({ ...loan, repayments: [{ id: 'c', date: '2026-01-01', amount: 12000 }] })).toBeNull();
  });

  it('uses total for non-EMI loans', () => {
    const loan = { principal: 1000, total: 1100, repayments: [{ id: 'a', date: '2026-01-01', amount: 100 }] };
    expect(outstanding(loan)).toBe(1000);
    expect(nextDueRow(loan)).toBeNull();
  });
});
