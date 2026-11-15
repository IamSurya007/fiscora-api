import { Account } from '../database/entities/account.entity';
import { Investment } from '../database/entities/investment.entity';
import { Loan } from '../database/entities/loan.entity';
import { AccountType, LoanStatus, LoanType } from '../database/enums';
import { outstanding } from '../loans/emi';

export type AssetKind = 'bank' | 'cash' | 'wallet' | 'other';

export interface NetWorthByType {
  bank: number;
  cash: number;
  wallet: number;
  other: number;
  investments: number;
  loansGiven: number;
  creditCards: number;
  loansTaken: number;
}

export interface NetWorthLine {
  id: string;
  name: string;
  type: string;
  side: 'asset' | 'liability';
  value: number;
}

export interface NetWorthBreakdown {
  byType: NetWorthByType;
  accounts: NetWorthLine[];
  investments: NetWorthLine[];
  loans: NetWorthLine[];
}

export interface NetWorth {
  assets: number;
  liabilities: number;
  netWorth: number;
  breakdown: NetWorthBreakdown;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Value of an investment today. There is no market value yet, so this is the
 * principal; switch to a current-value field here once one exists.
 */
export function investmentValue(inv: Pick<Investment, 'principal'> & { currentValue?: number | null }): number {
  if (typeof inv.currentValue === 'number' && Number.isFinite(inv.currentValue)) return inv.currentValue;
  return inv.principal ?? 0;
}

/** Outstanding amount of a loan, matching LoansService.getSummary (total of non-paid loans). */
export function loanOutstanding(loan: Pick<Loan, 'total' | 'status'> & Record<string, any>): number {
  if (loan.status === LoanStatus.PAID) return 0;
  // Subtracts recorded repayments (and uses the EMI schedule for EMI loans).
  return Math.max(0, outstanding(loan as any));
}

function assetKind(type: string): AssetKind {
  switch (type) {
    case AccountType.BANK:
      return 'bank';
    case AccountType.CASH:
      return 'cash';
    case AccountType.WALLET:
      return 'wallet';
    default:
      return 'other';
  }
}

/**
 * Pure aggregation. Assets = bank/cash/wallet/other balances + investments +
 * outstanding loans given; liabilities = credit-card balances (amount owed) +
 * outstanding loans taken. Deleted rows are ignored.
 */
export function aggregateNetWorth(input: {
  accounts: Pick<Account, 'id' | 'name' | 'type' | 'currentBalance' | 'isDeleted'>[];
  investments: Pick<Investment, 'id' | 'name' | 'type' | 'principal' | 'isDeleted'>[];
  loans: Pick<Loan, 'id' | 'name' | 'type' | 'total' | 'status' | 'isDeleted'>[];
}): NetWorth {
  const byType: NetWorthByType = {
    bank: 0,
    cash: 0,
    wallet: 0,
    other: 0,
    investments: 0,
    loansGiven: 0,
    creditCards: 0,
    loansTaken: 0,
  };
  const accounts: NetWorthLine[] = [];
  const investments: NetWorthLine[] = [];
  const loans: NetWorthLine[] = [];

  for (const a of input.accounts) {
    if (a.isDeleted) continue;
    const value = round2(a.currentBalance ?? 0);
    if (a.type === AccountType.CREDIT_CARD) {
      byType.creditCards += value;
      accounts.push({ id: a.id, name: a.name, type: a.type, side: 'liability', value });
    } else {
      byType[assetKind(a.type)] += value;
      accounts.push({ id: a.id, name: a.name, type: a.type, side: 'asset', value });
    }
  }

  for (const inv of input.investments) {
    if (inv.isDeleted) continue;
    const value = round2(investmentValue(inv));
    byType.investments += value;
    investments.push({ id: inv.id, name: inv.name, type: inv.type, side: 'asset', value });
  }

  for (const loan of input.loans) {
    if (loan.isDeleted) continue;
    const value = round2(loanOutstanding(loan));
    if (value === 0) continue;
    if (loan.type === LoanType.GIVEN) {
      byType.loansGiven += value;
      loans.push({ id: loan.id, name: loan.name, type: loan.type, side: 'asset', value });
    } else if (loan.type === LoanType.TAKEN) {
      byType.loansTaken += value;
      loans.push({ id: loan.id, name: loan.name, type: loan.type, side: 'liability', value });
    }
  }

  for (const k of Object.keys(byType) as (keyof NetWorthByType)[]) byType[k] = round2(byType[k]);

  const assets = round2(byType.bank + byType.cash + byType.wallet + byType.other + byType.investments + byType.loansGiven);
  const liabilities = round2(byType.creditCards + byType.loansTaken);
  return {
    assets,
    liabilities,
    netWorth: round2(assets - liabilities),
    breakdown: { byType, accounts, investments, loans },
  };
}
