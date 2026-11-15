import { BadRequestException } from '@nestjs/common';
import { ADVANCE_TAX_REMINDER_LOCK_KEY, TaxService } from './tax.service';

function setup(opts: { locked?: boolean; profiles?: any[]; entries?: any[] } = {}) {
  const runner = {
    connect: jest.fn(),
    release: jest.fn(),
    query: jest.fn(async (sql: string) =>
      sql.includes('pg_try_advisory_lock') ? [{ locked: opts.locked ?? true }] : [{}],
    ),
  };
  const expenses = { find: jest.fn(async () => opts.entries ?? []) };
  const profiles = {
    find: jest.fn(async () => opts.profiles ?? []),
    findOne: jest.fn(async () => null),
    save: jest.fn(async (x) => x),
    create: jest.fn((x) => x),
  };
  const dataSource = { createQueryRunner: () => runner };
  const notifications = { sendCustom: jest.fn() };
  const categories = { namesForUser: jest.fn(async () => ({ name: () => null })) };
  const service = new TaxService(
    expenses as any,
    profiles as any,
    dataSource as any,
    categories as any,
    notifications as any,
  );
  return { service, runner, notifications, profiles, expenses };
}

const receipt = { amount: -500_000, scope: 'business', categoryId: 'income', method: 'UPI', date: new Date('2026-08-01T05:00:00Z') };
// 10 Dec 09:00 IST: 5 days before the 15 Dec instalment.
const DEC_10 = new Date('2026-12-10T03:30:00Z');

describe('TaxService.sendAdvanceTaxReminders', () => {
  it('does nothing (and takes no lock) on days that are not 5 days before a due date', async () => {
    const { service, runner } = setup();
    expect(await service.sendAdvanceTaxReminders(new Date('2026-12-09T03:30:00Z'))).toEqual({ ran: false, sent: 0 });
    expect(runner.query).not.toHaveBeenCalled();
  });

  it('reminds regular-regime users with receipts, under the advisory lock', async () => {
    const { service, runner, notifications } = setup({
      profiles: [{ userId: 'u1', regime: 'regular', businessType: 'services', setAsidePercent: 20, gstRegistered: false }],
      entries: [receipt],
    });
    const res = await service.sendAdvanceTaxReminders(DEC_10);
    expect(res).toEqual({ ran: true, sent: 1 });
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'), [ADVANCE_TAX_REMINDER_LOCK_KEY]);
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'), [ADVANCE_TAX_REMINDER_LOCK_KEY]);
    expect(runner.release).toHaveBeenCalled();
    const [userId, title, body] = notifications.sendCustom.mock.calls[0];
    expect(userId).toBe('u1');
    expect(title).toBe('Advance tax due 15/12');
    expect(body).toContain('75%');
    expect(body).toContain('Estimate only');
  });

  it('skips presumptive users before December (they pay by 15 March) and users without receipts', async () => {
    const presumptive = setup({
      profiles: [{ userId: 'u1', regime: '44ADA', businessType: 'services', setAsidePercent: 20, gstRegistered: false }],
      entries: [receipt],
    });
    expect(await presumptive.service.sendAdvanceTaxReminders(DEC_10)).toEqual({ ran: true, sent: 0 });
    const empty = setup({
      profiles: [{ userId: 'u1', regime: 'regular', businessType: 'services', setAsidePercent: 20, gstRegistered: false }],
    });
    expect(await empty.service.sendAdvanceTaxReminders(DEC_10)).toEqual({ ran: true, sent: 0 });
  });

  it('reminds presumptive users before 15 March', async () => {
    const { service, notifications } = setup({
      profiles: [{ userId: 'u1', regime: '44AD', businessType: 'goods', setAsidePercent: 10, gstRegistered: false }],
      entries: [receipt],
    });
    expect(await service.sendAdvanceTaxReminders(new Date('2027-03-10T03:30:00Z'))).toEqual({ ran: true, sent: 1 });
    expect(notifications.sendCustom.mock.calls[0][1]).toBe('Advance tax due 15/03');
  });

  it('skips when another instance holds the lock', async () => {
    const { service, notifications, runner } = setup({ locked: false, profiles: [{ userId: 'u1', regime: 'regular' }], entries: [receipt] });
    expect(await service.sendAdvanceTaxReminders(DEC_10)).toEqual({ ran: false, sent: 0 });
    expect(notifications.sendCustom).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });
});

describe('TaxService profile and fy', () => {
  it('returns defaults until saved and merges updates', async () => {
    const { service, profiles } = setup();
    expect(await service.getProfile('u1')).toEqual({
      regime: '44ADA',
      businessType: 'services',
      setAsidePercent: 20,
      gstRegistered: false,
      saved: false,
    });
    await service.updateProfile('u1', { regime: '44AD' });
    expect(profiles.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', regime: '44AD', setAsidePercent: 20 }));
  });

  it('rejects a malformed fy', () => {
    const { service } = setup();
    expect(() => service.resolveFy('2026-28')).toThrow(BadRequestException);
    expect(service.resolveFy('2025-26')).toBe(2025);
  });
});
