import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Budget } from '../database/entities/budget.entity';
import { Expense } from '../database/entities/expense.entity';
import { UpsertBudgetDto } from './dto/upsert-budget.dto';
import { CategoriesService } from '../categories/categories.service';
import { resolveLegacyCategory, SYSTEM_BY_ID } from '../categories/category-resolver';
import { LEGACY_CATEGORY_MAP } from '../categories/taxonomy.generated';
import { istMonthOf, istMonthRange, isIncome, isSpend } from '../utils/ledger';
import { carryInto, monthsBefore, safeToSpend } from './rollover';
import { BillsService } from '../bills/bills.service';

@Injectable()
export class BudgetsService {
  constructor(
    @InjectRepository(Budget)
    private readonly budgetsRepository: Repository<Budget>,
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    private readonly categoriesService: CategoriesService,
    private readonly bills: BillsService,
  ) {}

  async findAll(userId: string, month: string): Promise<Budget[]> {
    return this.budgetsRepository.find({
      where: { userId, month, isDeleted: false },
    });
  }

  async upsertMany(userId: string, month: string, dto: UpsertBudgetDto): Promise<Budget[]> {
    const existingBudgets = await this.budgetsRepository.find({
      where: { userId, month },
    });

    // Budgets are keyed by parent category id; accept names from older clients.
    const wanted = new Map<string, number>();
    const rolloverFor = new Map<string, boolean>();
    for (const b of dto.budgets) {
      const key = normalizeBudgetKey(b.category);
      wanted.set(key, (wanted.get(key) ?? 0) + b.limit);
      if (b.rollover !== undefined) rolloverFor.set(key, b.rollover);
    }

    const existingCategoryMap = new Map(existingBudgets.map(b => [b.category, b]));
    const toSave: Budget[] = [];

    // Removed budgets are soft-deleted so the mobile app gets a tombstone.
    for (const eb of existingBudgets) {
      if (!wanted.has(eb.category) && !eb.isDeleted) {
        eb.isDeleted = true;
        eb.version = (eb.version || 1) + 1;
        toSave.push(eb);
      }
    }

    // Identify which to insert or update
    for (const [category, limit] of wanted) {
      const existing = existingCategoryMap.get(category);
      if (existing) {
        existing.limit = limit;
        if (rolloverFor.has(category)) existing.rollover = rolloverFor.get(category)!;
        existing.isDeleted = false;
        existing.version = (existing.version || 1) + 1;
        toSave.push(existing);
      } else {
        toSave.push(
          this.budgetsRepository.create({ userId, month, category, limit, rollover: rolloverFor.get(category) ?? false }),
        );
      }
    }

    const saved = await this.budgetsRepository.save(toSave);
    return saved.filter(b => !b.isDeleted);
  }

  async updateCategoryLimit(
    userId: string,
    month: string,
    rawCategory: string,
    limit: number,
  ): Promise<Budget> {
    const category = normalizeBudgetKey(rawCategory);
    let budget = await this.budgetsRepository.findOne({
      where: { userId, month, category },
    });

    if (budget) {
      budget.limit = limit;
      budget.isDeleted = false;
      budget.version = (budget.version || 1) + 1;
    } else {
      budget = this.budgetsRepository.create({
        userId,
        month,
        category,
        limit,
      });
    }

    return this.budgetsRepository.save(budget);
  }

  async getStatus(userId: string, month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('Month must be in YYYY-MM format');
    }

    // Month-specific budgets, plus the mobile app's every-month ('all') limits
    // for categories without a month-specific one.
    const [monthBudgets, allBudgets, names] = await Promise.all([
      this.budgetsRepository.find({ where: { userId, month, isDeleted: false } }),
      this.budgetsRepository.find({ where: { userId, month: 'all', isDeleted: false } }),
      this.categoriesService.namesForUser(userId),
    ]);
    const budgets = [
      ...monthBudgets,
      ...allBudgets.filter(a => !monthBudgets.some(m => normalizeBudgetKey(m.category) === normalizeBudgetKey(a.category))),
    ];

    const { start, end } = istMonthRange(month);

    const expenses = await this.expensesRepository.find({
      where: {
        userId,
        isDeleted: false,
        date: Between(start, new Date(end.getTime() - 1)),
      },
    });

    // Spend per parent category id (debits counted as spend only).
    const categorySpentMap = new Map<string, number>();
    for (const exp of expenses) {
      if (!isSpend(exp)) continue;
      const key = exp.categoryId ?? resolveLegacyCategory(exp.category).categoryId;
      categorySpentMap.set(key, (categorySpentMap.get(key) ?? 0) + exp.amount);
    }

    // Rollover needs spend per category for the previous 12 months.
    const history = await this.monthlySpend(userId, monthsBefore(month, 12), month);
    const everyMonth = new Map(allBudgets.map((b) => [normalizeBudgetKey(b.category), b]));
    const overrides = await this.budgetsRepository.find({ where: { userId, isDeleted: false } });

    const budgetStatuses = budgets.map(budget => {
      const categoryId = normalizeBudgetKey(budget.category);
      const spent = categorySpentMap.get(categoryId) ?? 0;
      const base = everyMonth.get(categoryId);
      const rollover = Boolean(budget.rollover || base?.rollover);
      const carry = rollover
        ? carryInto(
            month,
            (m) => {
              const o = overrides.find((b) => b.month === m && normalizeBudgetKey(b.category) === categoryId);
              if (o) return o.limit;
              // The every-month limit applies from the month it was created.
              if (base && istMonthOf(base.createdAt) <= m) return base.limit;
              return null;
            },
            (m) => history.get(`${m}|${categoryId}`) ?? 0,
          )
        : 0;
      const available = budget.limit + carry;
      const remaining = available - spent;
      const percentUsed = available > 0 ? (spent / available) * 100 : spent > 0 ? 100 : 0;

      let status: 'OK' | 'WARNING' | 'EXCEEDED' = 'OK';
      if (percentUsed >= 100) {
        status = 'EXCEEDED';
      } else if (percentUsed >= 80) {
        status = 'WARNING';
      }

      return {
        category: names.name(categoryId) ?? budget.category,
        categoryId,
        month: budget.month,
        limit: budget.limit,
        rollover,
        carry,
        available,
        spent,
        remaining,
        percentUsed: Math.round(percentUsed),
        status,
      };
    });

    // Safe to spend: what's left across budgets, and from income after bills.
    const monthSpent = expenses.filter(isSpend).reduce((t, e) => t + e.amount, 0);
    const monthIncome = expenses.filter(isIncome).reduce((t, e) => t - e.amount, 0);
    const monthEnd = istMonthRange(month).end;
    const now = new Date();
    const isCurrent = month === istMonthOf(now);
    const daysLeft = isCurrent ? Math.max(0, Math.ceil((monthEnd.getTime() - now.getTime()) / 86_400_000)) : 0;
    const bills = isCurrent ? await this.bills.upcoming(userId, Math.max(daysLeft, 1), now) : [];
    const endDay = new Date(monthEnd.getTime() - 1).toISOString().substring(0, 10);
    const upcomingBills = bills.filter((b) => b.dueDate <= endDay).reduce((t, b) => t + b.amount, 0);

    const safe = safeToSpend({
      available: budgetStatuses.reduce((t, b) => t + b.available, 0),
      budgetedSpent: budgetStatuses.reduce((t, b) => t + b.spent, 0),
      income: monthIncome,
      spent: monthSpent,
      upcomingBills,
      daysLeft,
    });

    return {
      month,
      budgets: budgetStatuses,
      safeToSpend: { ...safe, upcomingBills: Math.round(upcomingBills * 100) / 100 },
    };
  }

  /** Spend per "YYYY-MM|parentCategoryId" for months in [fromMonth, toMonth). */
  private async monthlySpend(userId: string, fromMonth: string, toMonth: string) {
    const { start } = istMonthRange(fromMonth);
    const { start: end } = istMonthRange(toMonth);
    const rows = await this.expensesRepository.find({
      where: { userId, isDeleted: false, date: Between(start, new Date(end.getTime() - 1)) },
    });
    const out = new Map<string, number>();
    for (const e of rows) {
      if (!isSpend(e)) continue;
      const cat = (e.categoryId ?? resolveLegacyCategory(e.category).categoryId).split('.')[0];
      const key = `${istMonthOf(e.date)}|${cat}`;
      out.set(key, (out.get(key) ?? 0) + e.amount);
    }
    return out;
  }
}

/** Budget keys are parent category ids; older rows may still hold a name. */
function normalizeBudgetKey(category: string): string {
  const system = SYSTEM_BY_ID.get(category);
  if (system) return system.parentId ?? system.id;
  const lower = category.trim().toLowerCase();
  const isKnownName =
    LEGACY_CATEGORY_MAP[lower] !== undefined ||
    [...SYSTEM_BY_ID.values()].some((c) => c.name.toLowerCase() === lower);
  // Anything else is a custom category id.
  return isKnownName ? resolveLegacyCategory(category).categoryId : category;
}

export { normalizeBudgetKey };
