import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { Investment } from '../database/entities/investment.entity';
import { Loan } from '../database/entities/loan.entity';
import { NetWorthSnapshot } from '../database/entities/net-worth-snapshot.entity';
import { recomputeBalances } from '../accounts/account-balance';
import { currentIstDate, istDateOf } from '../utils/ledger';
import { aggregateNetWorth, NetWorth, NetWorthBreakdown } from './networth.calc';

/** Arbitrary constant key for pg_try_advisory_lock; one instance snapshots at a time. */
export const NETWORTH_SNAPSHOT_LOCK_KEY = 74_201_001;

export interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  breakdown: NetWorthBreakdown | null;
  /** True for today's live figure when no snapshot has been written yet. */
  live: boolean;
}

@Injectable()
export class NetworthService {
  private readonly logger = new Logger(NetworthService.name);

  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(Expense)
    private readonly expenses: Repository<Expense>,
    @InjectRepository(Loan)
    private readonly loans: Repository<Loan>,
    @InjectRepository(Investment)
    private readonly investments: Repository<Investment>,
    @InjectRepository(NetWorthSnapshot)
    private readonly snapshots: Repository<NetWorthSnapshot>,
    private readonly dataSource: DataSource,
  ) {}

  async computeNetWorth(userId: string): Promise<NetWorth> {
    const accounts = await recomputeBalances(this.accounts, this.expenses, userId);
    const [investments, loans] = await Promise.all([
      this.investments.find({ where: { userId, isDeleted: false } }),
      this.loans.find({ where: { userId, isDeleted: false } }),
    ]);
    return aggregateNetWorth({ accounts, investments, loans });
  }

  /** Snapshots (oldest first) for the last `days` IST days, plus today's live value if not yet snapshotted. */
  async history(userId: string, days = 365): Promise<NetWorthPoint[]> {
    const span = Math.min(Math.max(Math.floor(days) || 365, 1), 3650);
    const today = currentIstDate();
    const from = istDateOf(new Date(Date.now() - (span - 1) * 86_400_000));
    const rows = await this.snapshots.find({
      where: { userId, date: MoreThanOrEqual(from) },
      order: { date: 'ASC' },
    });
    const points: NetWorthPoint[] = rows.map((r) => ({
      date: r.date,
      assets: r.assets,
      liabilities: r.liabilities,
      netWorth: r.netWorth,
      breakdown: r.breakdown,
      live: false,
    }));
    if (points.length === 0 || points[points.length - 1].date !== today) {
      const now = await this.computeNetWorth(userId);
      points.push({ date: today, ...now, live: true });
    }
    return points;
  }

  /** Writes or overwrites the user's snapshot for `date` (idempotent on userId+date). */
  async snapshotUser(userId: string, date = currentIstDate()): Promise<NetWorth> {
    const nw = await this.computeNetWorth(userId);
    await this.snapshots.upsert(
      {
        userId,
        date,
        assets: nw.assets,
        liabilities: nw.liabilities,
        netWorth: nw.netWorth,
        breakdown: nw.breakdown,
      },
      { conflictPaths: ['userId', 'date'], skipUpdateIfNoValuesChanged: false },
    );
    return nw;
  }

  // Runs every day at 23:50 IST (18:20 UTC)
  @Cron('0 20 18 * * *')
  async snapshotAll(): Promise<{ ran: boolean; users: number }> {
    // Session-level advisory locks belong to one connection, so hold a
    // dedicated query runner for the whole job.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        NETWORTH_SNAPSHOT_LOCK_KEY,
      ]);
      if (!locked) {
        this.logger.log('Net-worth snapshot already running elsewhere; skipping');
        return { ran: false, users: 0 };
      }
      try {
        const date = currentIstDate();
        const rows: { userId: string }[] = await this.accounts
          .createQueryBuilder('a')
          .select('DISTINCT a.userId', 'userId')
          .where('a.isDeleted = :deleted', { deleted: false })
          .getRawMany();
        let done = 0;
        for (const { userId } of rows) {
          try {
            await this.snapshotUser(userId, date);
            done++;
          } catch (error) {
            this.logger.error(`Net-worth snapshot failed for user ${userId}: ${error?.message}`);
          }
        }
        this.logger.log(`Net-worth snapshots written for ${done}/${rows.length} users (${date})`);
        return { ran: true, users: done };
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [NETWORTH_SNAPSHOT_LOCK_KEY]);
      }
    } finally {
      await runner.release();
    }
  }
}
