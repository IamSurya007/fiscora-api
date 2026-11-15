import { aggregateNetWorth, investmentValue, loanOutstanding } from './networth.calc';
import { AccountType, InvestmentType, LoanStatus, LoanType } from '../database/enums';

const acct = (id: string, type: string, currentBalance: number, isDeleted = false) => ({
  id,
  name: id,
  type,
  currentBalance,
  isDeleted,
});

describe('aggregateNetWorth', () => {
  it('adds asset accounts, investments and loans given; subtracts cards and loans taken', () => {
    const nw = aggregateNetWorth({
      accounts: [
        acct('hdfc', AccountType.BANK, 50000),
        acct('cash', AccountType.CASH, 1200.5),
        acct('paytm', AccountType.WALLET, 300),
        acct('locker', 'gold', 1000),
        acct('amex', AccountType.CREDIT_CARD, 8000),
      ],
      investments: [{ id: 'fd', name: 'FD', type: InvestmentType.FD, principal: 100000, isDeleted: false }],
      loans: [
        { id: 'l1', name: 'To Ravi', type: LoanType.GIVEN, total: 5000, status: LoanStatus.ACTIVE, isDeleted: false },
        { id: 'l2', name: 'Car', type: LoanType.TAKEN, total: 200000, status: LoanStatus.PARTIAL, isDeleted: false },
      ],
    });
    expect(nw.assets).toBe(50000 + 1200.5 + 300 + 1000 + 100000 + 5000);
    expect(nw.liabilities).toBe(208000);
    expect(nw.netWorth).toBe(157500.5 - 208000);
    expect(nw.breakdown.byType).toEqual({
      bank: 50000,
      cash: 1200.5,
      wallet: 300,
      other: 1000,
      investments: 100000,
      loansGiven: 5000,
      creditCards: 8000,
      loansTaken: 200000,
    });
    expect(nw.breakdown.accounts.find((a) => a.id === 'amex')?.side).toBe('liability');
    expect(nw.breakdown.loans.map((l) => l.side)).toEqual(['asset', 'liability']);
  });

  it('ignores deleted rows and paid loans', () => {
    const nw = aggregateNetWorth({
      accounts: [acct('old', AccountType.BANK, 999, true), acct('hdfc', AccountType.BANK, 10)],
      investments: [{ id: 'x', name: 'x', type: InvestmentType.SIP, principal: 50, isDeleted: true }],
      loans: [{ id: 'p', name: 'p', type: LoanType.TAKEN, total: 100, status: LoanStatus.PAID, isDeleted: false }],
    });
    expect(nw).toMatchObject({ assets: 10, liabilities: 0, netWorth: 10 });
    expect(nw.breakdown.loans).toHaveLength(0);
  });

  it('is zero for an empty user', () => {
    expect(aggregateNetWorth({ accounts: [], investments: [], loans: [] })).toMatchObject({
      assets: 0,
      liabilities: 0,
      netWorth: 0,
    });
  });

  it('rounds float noise to paise', () => {
    const nw = aggregateNetWorth({
      accounts: [acct('a', AccountType.BANK, 0.1), acct('b', AccountType.BANK, 0.2)],
      investments: [],
      loans: [],
    });
    expect(nw.assets).toBe(0.3);
  });
});

describe('value helpers', () => {
  it('values investments at principal until a current value exists', () => {
    expect(investmentValue({ principal: 1000 })).toBe(1000);
    expect(investmentValue({ principal: 1000, currentValue: 1200 })).toBe(1200);
    expect(investmentValue({ principal: 1000, currentValue: null })).toBe(1000);
  });

  it('treats paid loans as settled', () => {
    expect(loanOutstanding({ total: 500, status: LoanStatus.PAID })).toBe(0);
    expect(loanOutstanding({ total: 500, status: LoanStatus.OVERDUE })).toBe(500);
  });
});
