import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, Repository } from 'typeorm';
import { Expense } from '../database/entities/expense.entity';
import { TaxProfile } from '../database/entities/tax-profile.entity';
import { CategoriesService } from '../categories/categories.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ADVANCE_TAX_REMINDER_DAYS, DEFAULT_SET_ASIDE_PERCENT, TAX_DISCLAIMER } from './tax-rules';
import {
  advanceTaxSchedule,
  buildCsv,
  buildSummary,
  fyRange,
  fyStartYearOf,
  istDatePlus,
  parseFy,
  TaxProfileInput,
  TaxSummary,
} from './tax.calc';
import { UpdateTaxProfileDto } from './tax-profile.dto';

/** Arbitrary constant key for pg_try_advisory_lock; one instance sends reminders. */
export const ADVANCE_TAX_REMINDER_LOCK_KEY = 74_201_002;

export interface TaxProfileView extends TaxProfileInput {
  /** False until the user saves a profile; the defaults are returned meanwhile. */
  saved: boolean;
}

export function profileInput(p: TaxProfile | null): TaxProfileView {
  return {
    regime: (p?.regime as TaxProfileInput['regime']) ?? '44ADA',
    businessType: (p?.businessType as TaxProfileInput['businessType']) ?? 'services',
    setAsidePercent: p?.setAsidePercent ?? DEFAULT_SET_ASIDE_PERCENT,
    gstRegistered: p?.gstRegistered ?? false,
    saved: Boolean(p),
  };
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(
    @InjectRepository(Expense) private readonly expenses: Repository<Expense>,
    @InjectRepository(TaxProfile) private readonly profiles: Repository<TaxProfile>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly categories: CategoriesService,
    private readonly notifications: NotificationsService,
  ) {}

  async getProfile(userId: string): Promise<TaxProfileView> {
    return profileInput(await this.profiles.findOne({ where: { userId } }));
  }

  async updateProfile(userId: string, dto: UpdateTaxProfileDto): Promise<TaxProfileView> {
    const { saved: _saved, ...base } = await this.getProfile(userId);
    await this.profiles.save(this.profiles.create({ userId, ...base, ...dto }));
    return this.getProfile(userId);
  }

  resolveFy(fy?: string): number {
    if (!fy) return fyStartYearOf(new Date());
    const start = parseFy(fy);
    if (start === null) throw new BadRequestException('fy must look like 2026-27');
    return start;
  }

  private async fyEntries(userId: string, fyStartYear: number): Promise<Expense[]> {
    const { start, end } = fyRange(fyStartYear);
    return this.expenses.find({
      where: { userId, isDeleted: false, scope: 'business', date: Between(start, new Date(end.getTime() - 1)) },
    });
  }

  async summary(
    userId: string,
    fy?: string,
    now = new Date(),
  ): Promise<TaxSummary & { profile: TaxProfileView; disclaimer: string }> {
    const fyStart = this.resolveFy(fy);
    const [profile, entries] = await Promise.all([this.getProfile(userId), this.fyEntries(userId, fyStart)]);
    return { ...buildSummary(profile, fyStart, entries, now), profile, disclaimer: TAX_DISCLAIMER };
  }

  async exportCsv(userId: string, fy?: string): Promise<{ filename: string; csv: string }> {
    const fyStart = this.resolveFy(fy);
    const [profile, entries, names] = await Promise.all([
      this.getProfile(userId),
      this.fyEntries(userId, fyStart),
      this.categories.namesForUser(userId),
    ]);
    const summary = buildSummary(profile, fyStart, entries, new Date());
    return {
      filename: `fiscora-tax-${summary.fy}.csv`,
      csv: buildCsv(summary, entries, (id) => names.name(id) ?? id),
    };
  }

  /**
   * Daily 09:00 IST (03:30 UTC): when an advance-tax due date is
   * ADVANCE_TAX_REMINDER_DAYS away, push an estimate to users with a tax profile
   * and business receipts this FY. Presumptive (44AD/44ADA) users are reminded
   * only for the dates on their schedule (15 Mar).
   */
  @Cron('0 30 3 * * *')
  async sendAdvanceTaxReminders(now: Date = new Date()): Promise<{ ran: boolean; sent: number }> {
    const target = istDatePlus(now, ADVANCE_TAX_REMINDER_DAYS);
    const fyStart = fyStartYearOf(new Date(`${target}T12:00:00+05:30`));
    if (!advanceTaxSchedule(fyStart, false).some((d) => d.date === target)) return { ran: false, sent: 0 };

    // Session-level advisory locks belong to one connection, so hold a
    // dedicated query runner for the whole job.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        ADVANCE_TAX_REMINDER_LOCK_KEY,
      ]);
      if (!locked) return { ran: false, sent: 0 };
      try {
        let sent = 0;
        const profiles = await this.profiles.find();
        for (const p of profiles) {
          try {
            const s = buildSummary(profileInput(p), fyStart, await this.fyEntries(p.userId, fyStart), now);
            if (s.receipts.count === 0) continue;
            const due = s.advanceTax.schedule.find((d) => d.date === target);
            if (!due) continue;
            const amount = (s.advanceTax.estimatedAnnualTax * due.cumulativePercent) / 100;
            const [, mm, dd] = target.split('-');
            await this.notifications.sendCustom(
              p.userId,
              `Advance tax due ${dd}/${mm}`,
              `About ${inr(amount)} (${due.cumulativePercent}% of your estimated tax for the year) is due by then, less anything already paid. Estimate only, not tax advice.`,
            );
            sent++;
          } catch (e) {
            this.logger.warn(`Advance-tax reminder failed for a user: ${(e as Error).message}`);
          }
        }
        return { ran: true, sent };
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVANCE_TAX_REMINDER_LOCK_KEY]);
      }
    } finally {
      await runner.release();
    }
  }
}
