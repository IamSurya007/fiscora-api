import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, ILike, LessThan, Like } from 'typeorm';
import { Expense } from '../database/entities/expense.entity';
import { Budget } from '../database/entities/budget.entity';
import { Account } from '../database/entities/account.entity';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AccountType } from '../database/enums';
import { currentIstMonth, istMonthOf, istMonthRange, isPersonalIncome, isPersonalSpend, LedgerEntry, defaultScopeFor } from '../utils/ledger';
import { ownAccountId } from '../accounts/account-id.util';
import { CategoriesService } from '../categories/categories.service';
import { resolveLegacyCategory } from '../categories/category-resolver';
import { recomputeBalances } from '../accounts/account-balance';

const TRANSFER_CATEGORY = { categoryId: 'transfers', subcategoryId: 'transfers.self' };

/** Split lines must account for the whole transaction (to the paisa). */
function assertSplitsAddUp(splits: { amount: number }[] | undefined, total: number) {
  if (!splits || splits.length === 0) return;
  const sum = splits.reduce((t, l) => t + l.amount, 0);
  if (Math.abs(sum - total) > 0.01) {
    throw new BadRequestException(`Split lines add up to ${sum}, not ${total}`);
  }
}

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    @InjectRepository(Budget)
    private readonly budgetsRepository: Repository<Budget>,
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    private readonly notificationsService: NotificationsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  /**
   * A transfer moves money between two of the user's own accounts, e.g. a
   * card bill paid from savings. It is always filed as a self transfer so it
   * never counts as spend or income.
   */
  private async validateTransferTarget(
    userId: string,
    fromAccountId: string,
    transferAccountId?: string | null,
  ): Promise<string | null> {
    if (!transferAccountId) return null;
    const to = await this.validateAndGetAccountId(userId, transferAccountId);
    if (to === fromAccountId) {
      throw new BadRequestException('A transfer needs two different accounts');
    }
    return to;
  }

  private async validateAndGetAccountId(userId: string, accountId?: string): Promise<string> {
    const targetId = accountId && accountId.trim() !== '' ? accountId.trim() : 'default_bank';

    const account = await this.accountsRepository.findOne({
      where: [
        { id: targetId, userId, isDeleted: false },
        { clientId: targetId, userId, isDeleted: false },
      ],
    });

    if (account) {
      // Store the id devices know the account by (mobile matches on clientId).
      return account.clientId ?? account.id;
    }

    if (targetId === 'default_bank') {
      const defaultAcc = this.accountsRepository.create({
        id: await ownAccountId(this.accountsRepository, userId, 'default_bank'),
        clientId: 'default_bank',
        userId,
        name: 'Default Bank Account',
        type: AccountType.BANK,
        currentBalance: 0,
        creditLimit: 0,
        accountNumberLast4: '0000',
        colorValue: 4280962800,
        version: 1,
        isDeleted: false,
      });
      await this.accountsRepository.save(defaultAcc);
      return defaultAcc.id;
    }

    throw new BadRequestException(`Account with id '${targetId}' not found for user`);
  }

  /** Without an explicit scope, a business account's transactions are business. */
  private async defaultScope(userId: string, accountId: string): Promise<'personal' | 'business'> {
    const account = await this.accountsRepository.findOne({
      where: [
        { id: accountId, userId, isDeleted: false },
        { clientId: accountId, userId, isDeleted: false },
      ],
    });
    return defaultScopeFor(account?.ownership);
  }

  async create(userId: string, dto: CreateExpenseDto): Promise<Expense> {
    const validAccountId = await this.validateAndGetAccountId(userId, dto.accountId);

    const ids = dto.categoryId
      ? { categoryId: dto.categoryId, subcategoryId: dto.subcategoryId ?? null }
      : resolveLegacyCategory(dto.category, false);

    assertSplitsAddUp(dto.splits, dto.amount);
    const { isCredit, transferAccountId, ...fields } = dto;
    const transferTo = await this.validateTransferTarget(userId, validAccountId, transferAccountId);
    const scope = dto.scope ?? (await this.defaultScope(userId, validAccountId));
    const expense = this.expensesRepository.create({
      ...fields,
      scope,
      amount: isCredit ? -dto.amount : dto.amount,
      transferAccountId: transferTo,
      ...(transferTo ? TRANSFER_CATEGORY : { categoryId: ids.categoryId, subcategoryId: ids.subcategoryId }),
      userId,
      accountId: validAccountId,
      isCountedAsSpend: dto.isCountedAsSpend ?? true,
      date: new Date(dto.date),
    });

    const savedExpense = await this.expensesRepository.save(expense);
    await this.refreshBalances(userId);

    // Trigger budget check asynchronously
    this.checkBudgetAlert(userId, savedExpense).catch(err => {
      console.error(`Failed to check budget alert: ${err.message}`);
    });

    return savedExpense;
  }

  async findAll(userId: string, query: QueryExpenseDto): Promise<Expense[]> {
    if (query.q && query.q.trim()) return this.search(userId, query);
    const { start, end } = istMonthRange(query.month);

    const whereConditions: any = {
      userId,
      isDeleted: false,
      date: Between(start, new Date(end.getTime() - 1)),
    };

    if (query.category) {
      whereConditions.category = query.category;
    }

    if (query.source) {
      whereConditions.source = query.source;
    }

    if (query.needsReview) {
      whereConditions.needsReview = true;
    }

    // A category id matches expenses in that category or subcategory.
    const categoryVariants: any[] = query.categoryId
      ? [{ categoryId: query.categoryId }, { subcategoryId: query.categoryId }]
      : [{}];
    const withCategory = (extra: any) => categoryVariants.map((v) => ({ ...whereConditions, ...v, ...extra }));

    // Apply cursor pagination if cursor is provided
    if (query.cursor) {
      const cursorExpense = await this.expensesRepository.findOne({
        where: { id: query.cursor, userId },
      });
      if (cursorExpense) {
        const cursorDate = cursorExpense.date;
        const cursorId = cursorExpense.id;

        // Stay inside the requested month: replacing `date` with LessThan
        // alone made later pages return every older month too.
        return this.expensesRepository.find({
          where: [
            ...withCategory({ date: Between(start, new Date(cursorDate.getTime() - 1)) }),
            ...withCategory({ date: cursorDate, id: LessThan(cursorId) }),
          ],
          order: {
            date: 'DESC',
            id: 'DESC',
          },
          take: query.limit,
        });
      }
    }

    return this.expensesRepository.find({
      where: withCategory({}),
      order: {
        date: 'DESC',
        id: 'DESC',
      },
      take: query.limit,
    });
  }

  /** Search across all months, newest first. Numbers also match the exact amount (either sign). */
  private async search(userId: string, query: QueryExpenseDto): Promise<Expense[]> {
    const term = query.q!.trim();
    // Escape LIKE wildcards so "50%" searches for the text, not a pattern.
    const like = ILike(`%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const base: any = { userId, isDeleted: false };
    if (query.needsReview) base.needsReview = true;
    const where: any[] = [
      { ...base, merchant: like },
      { ...base, note: like },
      { ...base, category: like },
      { ...base, subcategory: like },
    ];
    const amount = Number(term.replace(/[₹,\s]/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      where.push({ ...base, amount }, { ...base, amount: -amount });
    }
    return this.expensesRepository.find({
      where,
      order: { date: 'DESC', id: 'DESC' },
      take: Math.min(query.limit ?? 50, 100),
    });
  }

  async findOne(userId: string, id: string): Promise<Expense> {
    const expense = await this.expensesRepository.findOne({ where: { id } });
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }
    if (expense.userId !== userId) {
      throw new ForbiddenException("You cannot access another user's expense");
    }
    return expense;
  }

  async update(userId: string, id: string, dto: UpdateExpenseDto): Promise<Expense> {
    const expense = await this.findOne(userId, id);
    const before = { accountId: expense.accountId, amount: expense.amount, transferAccountId: expense.transferAccountId };

    if (dto.accountId !== undefined) {
      expense.accountId = await this.validateAndGetAccountId(userId, dto.accountId);
    }
    if (dto.isCountedAsSpend !== undefined) expense.isCountedAsSpend = dto.isCountedAsSpend;
    if (dto.amount !== undefined || dto.isCredit !== undefined) {
      const magnitude = dto.amount ?? Math.abs(expense.amount);
      const credit = dto.isCredit ?? expense.amount < 0;
      expense.amount = credit ? -magnitude : magnitude;
    }
    if (dto.category !== undefined) expense.category = dto.category;
    if (dto.categoryId !== undefined) {
      expense.categoryId = dto.categoryId;
      expense.subcategoryId = dto.subcategoryId ?? null;
      expense.subcategory = dto.subcategory ?? null;
    } else if (dto.category !== undefined) {
      const ids = resolveLegacyCategory(dto.category, expense.amount < 0);
      expense.categoryId = ids.categoryId;
      expense.subcategoryId = ids.subcategoryId;
    }
    if (dto.transferAccountId !== undefined) {
      expense.transferAccountId = await this.validateTransferTarget(userId, expense.accountId, dto.transferAccountId);
      if (expense.transferAccountId) Object.assign(expense, TRANSFER_CATEGORY);
    }
    if (dto.scope !== undefined) expense.scope = dto.scope;
    if (dto.splits !== undefined) {
      assertSplitsAddUp(dto.splits, Math.abs(expense.amount));
      expense.splits = dto.splits.length ? dto.splits : null;
    }
    if (dto.spreadMonths !== undefined) expense.spreadMonths = dto.spreadMonths;
    if (dto.tdsAmount !== undefined) expense.tdsAmount = dto.tdsAmount;
    if (dto.needsReview !== undefined) expense.needsReview = dto.needsReview;
    // Editing a captured transaction is reviewing it.
    else if (expense.needsReview) expense.needsReview = false;
    if (dto.note !== undefined) expense.note = dto.note;
    if (dto.date !== undefined) expense.date = new Date(dto.date);
    if (dto.method !== undefined) expense.method = dto.method;
    if (dto.source !== undefined) expense.source = dto.source;
    if (dto.merchant !== undefined) expense.merchant = dto.merchant;
    // Bump the version so offline clients accept this edit on their next pull.
    expense.version = (expense.version || 1) + 1;

    const saved = await this.expensesRepository.save(expense);
    if (
      before.accountId !== saved.accountId ||
      before.amount !== saved.amount ||
      before.transferAccountId !== saved.transferAccountId
    ) {
      await this.refreshBalances(userId);
    }

    if (dto.category !== undefined || dto.categoryId !== undefined || dto.amount !== undefined || dto.date !== undefined || dto.isCountedAsSpend !== undefined) {
      this.checkBudgetAlert(userId, saved).catch(err => {
        console.error(`Failed to check budget alert after update: ${err.message}`);
      });
    }

    return saved;
  }

  async remove(userId: string, id: string): Promise<void> {
    const expense = await this.findOne(userId, id);
    // Soft delete so the mobile app receives a tombstone on its next pull.
    expense.isDeleted = true;
    expense.version = (expense.version || 1) + 1;
    await this.expensesRepository.save(expense);
    await this.refreshBalances(userId);
  }

  /** Balances are derived from transactions (see accounts/account-balance.ts). */
  private async refreshBalances(userId: string) {
    await recomputeBalances(this.accountsRepository, this.expensesRepository, userId);
  }

  async getSummary(userId: string, month?: string) {
    let targetMonth = month;
    if (!targetMonth) {
      targetMonth = currentIstMonth();
    } else if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      throw new BadRequestException('Month must be in YYYY-MM format');
    }

    const { start, end } = istMonthRange(targetMonth);

    const [expenses, names] = await Promise.all([
      this.expensesRepository.find({
        where: {
          userId,
          isDeleted: false,
          date: Between(start, new Date(end.getTime() - 1)),
        },
      }),
      this.categoriesService.namesForUser(userId),
    ]);

    const spendExpenses = expenses.filter(isPersonalSpend);

    const totalExpenses = spendExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    // Credits are stored as negative amounts; transfers are neither side.
    const totalIncome = expenses.filter(isPersonalIncome).reduce((sum, exp) => sum - exp.amount, 0);
    const balance = totalIncome - totalExpenses;

    // Group by parent category, with a subcategory breakdown.
    type Bucket = { total: number; count: number; subs: Map<string, { total: number; count: number }> };
    const categoryMap = new Map<string, Bucket>();
    for (const exp of spendExpenses) {
      const ids = exp.categoryId
        ? { categoryId: exp.categoryId, subcategoryId: exp.subcategoryId }
        : resolveLegacyCategory(exp.category, false);
      const bucket = categoryMap.get(ids.categoryId) ?? { total: 0, count: 0, subs: new Map() };
      bucket.total += exp.amount;
      bucket.count += 1;
      if (ids.subcategoryId) {
        const sub = bucket.subs.get(ids.subcategoryId) ?? { total: 0, count: 0 };
        sub.total += exp.amount;
        sub.count += 1;
        bucket.subs.set(ids.subcategoryId, sub);
      }
      categoryMap.set(ids.categoryId, bucket);
    }

    const byCategory = [...categoryMap.entries()]
      .map(([categoryId, b]) => ({
        category: names.name(categoryId) ?? categoryId,
        categoryId,
        total: b.total,
        count: b.count,
        subcategories: [...b.subs.entries()]
          .map(([subcategoryId, s]) => ({
            subcategory: names.name(subcategoryId) ?? subcategoryId,
            subcategoryId,
            total: s.total,
            count: s.count,
          }))
          .sort((x, y) => y.total - x.total),
      }))
      .sort((x, y) => y.total - x.total);

    return {
      month: targetMonth,
      totalExpenses,
      totalIncome,
      balance,
      byCategory,
    };
  }

  /**
   * Budgets are keyed by parent category id. The mobile app stores limits
   * that apply to every month under month 'all'; a month-specific budget wins.
   * Alerts once when this expense pushes the category across 80% or 100%,
   * instead of on every expense after 80%. Public so synced expenses alert too.
   */
  async checkBudgetAlert(userId: string, expense: LedgerEntry & { date: Date | string }): Promise<void> {
    if (!isPersonalSpend(expense)) return;
    const categoryId = (expense.categoryId ?? resolveLegacyCategory(expense.category).categoryId)?.split('.')[0];
    if (!categoryId) return;
    const month = istMonthOf(expense.date);

    const budgets = await this.budgetsRepository.find({
      where: [
        { userId, month, category: categoryId, isDeleted: false },
        { userId, month: 'all', category: categoryId, isDeleted: false },
      ],
    });
    const budget = budgets.find(b => b.month === month) ?? budgets[0];
    if (!budget || budget.limit <= 0) return;

    const { start, end } = istMonthRange(month);
    const expenses = await this.expensesRepository.find({
      where: [
        { userId, categoryId, isDeleted: false, date: Between(start, new Date(end.getTime() - 1)) },
        { userId, categoryId: Like(`${categoryId}.%`), isDeleted: false, date: Between(start, new Date(end.getTime() - 1)) },
      ],
    });

    const totalSpent = expenses.filter(isPersonalSpend).reduce((sum, exp) => sum + exp.amount, 0);
    const percentNow = (totalSpent / budget.limit) * 100;
    const percentBefore = ((totalSpent - expense.amount) / budget.limit) * 100;
    const crossed = [100, 80].find(t => percentBefore < t && percentNow >= t);

    if (crossed) {
      const names = await this.categoriesService.namesForUser(userId);
      await this.notificationsService.sendBudgetAlert(userId, names.name(categoryId) ?? categoryId, percentNow);
    }
  }
}
