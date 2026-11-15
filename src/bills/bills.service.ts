import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { AccountType } from '../database/enums';
import { recomputeBalances } from '../accounts/account-balance';
import { detectRecurring, nextDueForDay } from './recurring';

export interface UpcomingBill {
  kind: 'recurring' | 'card' | 'loan';
  name: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  cadence?: string;
  categoryId?: string | null;
  accountId?: string;
  loanId?: string;
}

const iso = (d: Date) => d.toISOString().substring(0, 10);

@Injectable()
export class BillsService {
  constructor(
    @InjectRepository(Expense) private readonly expenses: Repository<Expense>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Loan) private readonly loans: Repository<Loan>,
  ) {}

  /** Recurring payments seen in the last 15 months. */
  async recurring(userId: string, now = new Date()) {
    const since = new Date(now.getTime() - 460 * 24 * 60 * 60 * 1000);
    const txs = await this.expenses.find({
      where: { userId, isDeleted: false, date: MoreThanOrEqual(since) },
      select: { id: true, date: true, amount: true, merchant: true, categoryId: true, transferAccountId: true },
    });
    return detectRecurring(txs, now);
  }

  /** Everything due in the next [days] days: subscriptions, card bills and loan dues. */
  async upcoming(userId: string, days = 45, now = new Date()): Promise<UpcomingBill[]> {
    const horizon = iso(new Date(now.getTime() + days * 24 * 60 * 60 * 1000));
    const today = iso(now);
    const out: UpcomingBill[] = [];

    for (const r of await this.recurring(userId, now)) {
      if (r.nextDueDate <= horizon) {
        out.push({
          kind: 'recurring',
          name: r.merchant,
          amount: r.lastAmount,
          dueDate: r.nextDueDate,
          cadence: r.cadence,
          categoryId: r.categoryId,
        });
      }
    }

    await recomputeBalances(this.accounts, this.expenses, userId);
    const cards = await this.accounts.find({ where: { userId, isDeleted: false, type: AccountType.CREDIT_CARD } });
    for (const c of cards) {
      if (!c.dueDay || c.currentBalance <= 0) continue;
      const due = iso(nextDueForDay(c.dueDay, now));
      if (due <= horizon) {
        out.push({ kind: 'card', name: c.name, amount: c.currentBalance, dueDate: due, accountId: c.clientId ?? c.id });
      }
    }

    const loans = await this.loans.find({ where: { userId, isDeleted: false } });
    for (const l of loans as any[]) {
      if (!l.repaymentDate || String(l.status).toLowerCase() === 'paid') continue;
      const due = iso(new Date(l.repaymentDate));
      if (due >= today && due <= horizon) {
        out.push({ kind: 'loan', name: l.name, amount: l.currentTotal ?? l.total, dueDate: due, loanId: l.id });
      }
    }

    return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }
}
