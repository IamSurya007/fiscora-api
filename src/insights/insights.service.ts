import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Between, DataSource, IsNull, Not, Repository } from 'typeorm';
import { Expense } from '../database/entities/expense.entity';
import { User } from '../database/entities/user.entity';
import { CategoriesService } from '../categories/categories.service';
import { NotificationsService } from '../notifications/notifications.service';
import { istMonthRange } from '../utils/ledger';
import { monthsBefore } from '../budgets/rollover';
import { monthReview, weeklyRecap } from './review';
import { withCronLock } from '../utils/cron-lock';

const DAY = 86_400_000;

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @InjectRepository(Expense) private readonly expenses: Repository<Expense>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly categories: CategoriesService,
    private readonly notifications: NotificationsService,
  ) {}

  private async between(userId: string, start: Date, end: Date) {
    return this.expenses.find({
      where: { userId, isDeleted: false, date: Between(start, new Date(end.getTime() - 1)) },
    });
  }

  async monthReview(userId: string, month: string) {
    const cur = istMonthRange(month);
    const prev = istMonthRange(monthsBefore(month, 1));
    const [current, previous, names] = await Promise.all([
      this.between(userId, cur.start, cur.end),
      this.between(userId, prev.start, prev.end),
      this.categories.namesForUser(userId),
    ]);
    return monthReview(month, current, previous, (id) => names.name(id) ?? id);
  }

  async weekly(userId: string, now = new Date()) {
    const end = now;
    const start = new Date(end.getTime() - 7 * DAY);
    const prevStart = new Date(start.getTime() - 7 * DAY);
    const [thisWeek, lastWeek, names] = await Promise.all([
      this.between(userId, start, end),
      this.between(userId, prevStart, start),
      this.categories.namesForUser(userId),
    ]);
    return weeklyRecap(thisWeek, lastWeek, (id) => names.name(id) ?? id);
  }

  /**
   * Sundays 09:00 IST (03:30 UTC): one push with last week's spending. An
   * advisory lock makes sure only one API instance sends it.
   */
  @Cron('0 30 3 * * 0')
  async sendWeeklyRecaps(): Promise<void> {
    await withCronLock(this.dataSource, 'weekly-recap', async () => {
      const users = await this.users.find({ where: { fcmToken: Not(IsNull()) } });
      for (const u of users) {
        try {
          const recap = await this.weekly(u.id);
          if (recap) await this.notifications.sendCustom(u.id, recap.title, recap.body);
        } catch (e) {
          this.logger.warn(`Weekly recap failed for a user: ${(e as Error).message}`);
        }
      }
    });
  }
}
