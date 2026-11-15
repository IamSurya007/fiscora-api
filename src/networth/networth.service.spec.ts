import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NetworthService, NETWORTH_SNAPSHOT_LOCK_KEY } from './networth.service';
import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { NetWorthSnapshot } from '../database/entities/net-worth-snapshot.entity';
import { AccountType, LoanStatus, LoanType } from '../database/enums';
import { currentIstDate } from '../utils/ledger';

const queryBuilder = (raw: any[] = []) => {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(raw),
  };
  return qb;
};

const mockRepository = () => ({
  find: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue(undefined),
  upsert: jest.fn().mockResolvedValue(undefined),
  createQueryBuilder: jest.fn(() => queryBuilder()),
});

describe('NetworthService', () => {
  let service: NetworthService;
  let accountRepo: any;
  let expenseRepo: any;
  let loanRepo: any;
  let investmentRepo: any;
  let snapshotRepo: any;
  let runner: any;

  beforeEach(async () => {
    runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn(async (sql: string) =>
        sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [{ pg_advisory_unlock: true }],
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworthService,
        { provide: getRepositoryToken(Account), useFactory: mockRepository },
        { provide: getRepositoryToken(Expense), useFactory: mockRepository },
        { provide: getRepositoryToken(Loan), useFactory: mockRepository },
        { provide: getRepositoryToken(Investment), useFactory: mockRepository },
        { provide: getRepositoryToken(NetWorthSnapshot), useFactory: mockRepository },
        { provide: DataSource, useValue: { createQueryRunner: jest.fn(() => runner) } },
      ],
    }).compile();

    service = module.get(NetworthService);
    accountRepo = module.get(getRepositoryToken(Account));
    expenseRepo = module.get(getRepositoryToken(Expense));
    loanRepo = module.get(getRepositoryToken(Loan));
    investmentRepo = module.get(getRepositoryToken(Investment));
    snapshotRepo = module.get(getRepositoryToken(NetWorthSnapshot));
  });

  const seed = () => {
    accountRepo.find.mockResolvedValue([
      { id: 'bank', userId: 'u1', name: 'Bank', type: AccountType.BANK, openingBalance: 1000, currentBalance: 1000, isDeleted: false },
      { id: 'card', userId: 'u1', name: 'Card', type: AccountType.CREDIT_CARD, openingBalance: 0, currentBalance: 0, isDeleted: false },
    ]);
    // 200 spent on the card: card owes 200, bank unchanged.
    expenseRepo.find.mockResolvedValue([{ id: 'e1', amount: 200, accountId: 'card', transferAccountId: null }]);
    investmentRepo.find.mockResolvedValue([{ id: 'i1', name: 'FD', type: 'FD', principal: 5000, isDeleted: false }]);
    loanRepo.find.mockResolvedValue([
      { id: 'l1', name: 'To A', type: LoanType.GIVEN, total: 300, status: LoanStatus.ACTIVE, isDeleted: false },
    ]);
  };

  it('recomputes balances before aggregating', async () => {
    seed();
    const nw = await service.computeNetWorth('u1');
    expect(accountRepo.update).toHaveBeenCalledWith({ id: 'card' }, { openingBalance: 0, currentBalance: 200 });
    expect(nw).toMatchObject({ assets: 6300, liabilities: 200, netWorth: 6100 });
    expect(investmentRepo.find).toHaveBeenCalledWith({ where: { userId: 'u1', isDeleted: false } });
  });

  it('upserts the snapshot on userId+date', async () => {
    seed();
    await service.snapshotUser('u1', '2026-11-15');
    expect(snapshotRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', date: '2026-11-15', netWorth: 6100 }),
      expect.objectContaining({ conflictPaths: ['userId', 'date'] }),
    );
  });

  describe('history', () => {
    it('appends today as a live point when no snapshot exists for today', async () => {
      seed();
      snapshotRepo.find.mockResolvedValue([
        { date: '2026-01-01', assets: 10, liabilities: 0, netWorth: 10, breakdown: null },
      ]);
      const points = await service.history('u1', 30);
      expect(points).toHaveLength(2);
      expect(points[0]).toMatchObject({ date: '2026-01-01', live: false });
      expect(points[1]).toMatchObject({ date: currentIstDate(), netWorth: 6100, live: true });
      expect(snapshotRepo.find.mock.calls[0][0].where.userId).toBe('u1');
    });

    it("does not recompute when today's snapshot exists", async () => {
      snapshotRepo.find.mockResolvedValue([
        { date: currentIstDate(), assets: 10, liabilities: 0, netWorth: 10, breakdown: null },
      ]);
      const points = await service.history('u1');
      expect(points).toEqual([expect.objectContaining({ netWorth: 10, live: false })]);
      expect(accountRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('snapshotAll', () => {
    it('snapshots every user with accounts under the advisory lock', async () => {
      seed();
      accountRepo.createQueryBuilder.mockReturnValue(queryBuilder([{ userId: 'u1' }, { userId: 'u2' }]));
      const res = await service.snapshotAll();
      expect(res).toEqual({ ran: true, users: 2 });
      expect(snapshotRepo.upsert).toHaveBeenCalledTimes(2);
      expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'), [NETWORTH_SNAPSHOT_LOCK_KEY]);
      expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'), [NETWORTH_SNAPSHOT_LOCK_KEY]);
      expect(runner.release).toHaveBeenCalled();
    });

    it('skips when another instance holds the lock', async () => {
      runner.query.mockResolvedValueOnce([{ locked: false }]);
      const res = await service.snapshotAll();
      expect(res).toEqual({ ran: false, users: 0 });
      expect(snapshotRepo.upsert).not.toHaveBeenCalled();
      expect(runner.query).toHaveBeenCalledTimes(1);
      expect(runner.release).toHaveBeenCalled();
    });

    it('keeps going when one user fails', async () => {
      accountRepo.createQueryBuilder.mockReturnValue(queryBuilder([{ userId: 'u1' }, { userId: 'u2' }]));
      snapshotRepo.upsert.mockRejectedValueOnce(new Error('boom'));
      const res = await service.snapshotAll();
      expect(res).toEqual({ ran: true, users: 1 });
    });
  });
});
