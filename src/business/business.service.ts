import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { CategoriesService } from '../categories/categories.service';
import { currentIstMonth, istMonthRange } from '../utils/ledger';
import { businessPnl, monthsBetween } from './pnl';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class BusinessService {
  constructor(
    @InjectRepository(Expense) private readonly expenses: Repository<Expense>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    private readonly categories: CategoriesService,
  ) {}

  async pnl(userId: string, query: { month?: string; from?: string; to?: string }) {
    const from = query.from ?? query.month ?? currentIstMonth();
    const to = query.to ?? query.month ?? from;
    if (!MONTH.test(from) || !MONTH.test(to)) {
      throw new BadRequestException('Months must be in YYYY-MM format');
    }
    if (from > to) throw new BadRequestException('"from" must not be after "to"');
    if (monthsBetween(from, to).length > 24) throw new BadRequestException('Range is limited to 24 months');

    const start = istMonthRange(from).start;
    const end = istMonthRange(to).end;
    const [txs, accounts, names] = await Promise.all([
      this.expenses.find({
        where: { userId, isDeleted: false, date: Between(start, new Date(end.getTime() - 1)) },
      }),
      this.accounts.find({ where: { userId } }),
      this.categories.namesForUser(userId),
    ]);
    return businessPnl(from, to, txs, accounts, (id) => names.name(id) ?? id);
  }
}
