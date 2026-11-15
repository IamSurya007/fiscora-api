import { SchedulerService, istDatePlus } from './scheduler.service';
import { LoanStatus, LoanType } from '../database/enums';

function makeService(loans: any[]) {
  const loansRepository = {
    find: jest.fn(async ({ where }: any) =>
      loans.filter((l) => (where.isEmi === undefined ? true : Boolean(l.isEmi) === where.isEmi)),
    ),
    save: jest.fn(async (l: any) => l),
  };
  const notificationsService = { sendLoanReminder: jest.fn(async () => undefined) };
  const service = new SchedulerService(
    loansRepository as any,
    {} as any,
    {} as any,
    {} as any,
    notificationsService as any,
    {} as any,
  );
  return { service, loansRepository, notificationsService };
}

const emiLoan = (over: Partial<any> = {}) => ({
  id: 'l1',
  userId: 'u1',
  name: 'Car loan',
  type: LoanType.TAKEN,
  status: LoanStatus.ACTIVE,
  isEmi: true,
  principal: 12000,
  total: 12000,
  interestRate: 0,
  tenureMonths: 12,
  emiStartDate: '2026-01-10',
  emiDayOfMonth: null,
  repayments: [],
  emiReminderFor: null,
  ...over,
});

// 04:00 UTC on 7 Jan 2026 = 09:30 IST on 7 Jan; +3 days = 10 Jan.
const NOW = new Date('2026-01-07T04:00:00Z');

describe('SchedulerService EMI reminders', () => {
  it('computes IST dates', () => {
    expect(istDatePlus(NOW, 3)).toBe('2026-01-10');
    // 20:00 UTC on 31 Jan is already 1 Feb in IST
    expect(istDatePlus(new Date('2026-01-31T20:00:00Z'), 0)).toBe('2026-02-01');
  });

  it('reminds 3 days before the next EMI and records it', async () => {
    const loan = emiLoan();
    const { service, notificationsService, loansRepository } = makeService([loan]);
    await service.checkEmiReminders(NOW);
    expect(notificationsService.sendLoanReminder).toHaveBeenCalledWith('u1', 'Car loan', 1000, 3);
    expect(loansRepository.save).toHaveBeenCalledWith(expect.objectContaining({ emiReminderFor: '2026-01-10' }));
  });

  it('does not remind twice for the same instalment', async () => {
    const { service, notificationsService } = makeService([emiLoan({ emiReminderFor: '2026-01-10' })]);
    await service.checkEmiReminders(NOW);
    expect(notificationsService.sendLoanReminder).not.toHaveBeenCalled();
  });

  it('reminds again for the following instalment', async () => {
    const loan = emiLoan({
      emiReminderFor: '2026-01-10',
      repayments: [{ id: 'r1', date: '2026-01-10', amount: 1000 }],
    });
    const { service, notificationsService } = makeService([loan]);
    await service.checkEmiReminders(new Date('2026-02-07T04:00:00Z'));
    expect(notificationsService.sendLoanReminder).toHaveBeenCalledWith('u1', 'Car loan', 1000, 3);
    expect(loan.emiReminderFor).toBe('2026-02-10');
  });

  it('skips an instalment already covered by repayments', async () => {
    const loan = emiLoan({ repayments: [{ id: 'r1', date: '2026-01-05', amount: 1000 }] });
    const { service, notificationsService } = makeService([loan]);
    await service.checkEmiReminders(NOW);
    expect(notificationsService.sendLoanReminder).not.toHaveBeenCalled();
  });

  it('leaves non-EMI loans to the one-off repayment reminder', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(today);
    due.setDate(today.getDate() + 3);
    const plain = {
      id: 'l2', userId: 'u2', name: 'Rahul', isEmi: false, status: LoanStatus.ACTIVE,
      total: 5000, repaymentDate: due, reminderSent: false,
    };
    const { service, notificationsService, loansRepository } = makeService([plain, emiLoan()]);
    await service.checkLoanReminders();
    expect(loansRepository.find).toHaveBeenCalledWith({ where: expect.objectContaining({ isEmi: false }) });
    expect(notificationsService.sendLoanReminder).toHaveBeenCalledTimes(1);
    expect(notificationsService.sendLoanReminder).toHaveBeenCalledWith('u2', 'Rahul', 5000, 3);
    expect(plain.reminderSent).toBe(true);
  });
});
