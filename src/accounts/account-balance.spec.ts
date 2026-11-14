import { effectOn, recomputeBalances } from './account-balance';

const bank = { id: 'srv-bank', clientId: 'bank', type: 'bank' } as any;
const card = { id: 'srv-card', clientId: 'card', type: 'credit_card' } as any;

describe('effectOn', () => {
  it('debits lower a bank balance and raise a card balance owed', () => {
    expect(
      effectOn(bank, {
        amount: 100,
        accountId: 'bank',
        transferAccountId: null,
      }),
    ).toBe(-100);
    expect(
      effectOn(card, {
        amount: 100,
        accountId: 'card',
        transferAccountId: null,
      }),
    ).toBe(100);
  });

  it('credits do the reverse', () => {
    expect(
      effectOn(bank, {
        amount: -500,
        accountId: 'bank',
        transferAccountId: null,
      }),
    ).toBe(500);
  });

  it('a card bill paid from the bank lowers both the bank balance and the amount owed', () => {
    const payment = {
      amount: 2000,
      accountId: 'bank',
      transferAccountId: 'card',
    };
    expect(effectOn(bank, payment)).toBe(-2000);
    expect(effectOn(card, payment)).toBe(-2000);
  });

  it('matches accounts by server id or client id', () => {
    expect(
      effectOn(bank, {
        amount: 50,
        accountId: 'srv-bank',
        transferAccountId: null,
      }),
    ).toBe(-50);
  });
});

describe('recomputeBalances', () => {
  it('derives balances from transactions, so concurrent devices cannot lose an expense', async () => {
    const account = {
      ...bank,
      userId: 'u',
      openingBalance: 1000,
      currentBalance: 950,
    };
    const accounts = {
      find: jest.fn().mockResolvedValue([account]),
      update: jest.fn(),
    } as any;
    const expenses = {
      find: jest.fn().mockResolvedValue([
        { amount: 100, accountId: 'bank', transferAccountId: null }, // phone A
        { amount: 50, accountId: 'bank', transferAccountId: null }, // phone B
      ]),
    } as any;
    await recomputeBalances(accounts, expenses, 'u');
    expect(account.currentBalance).toBe(850);
    expect(accounts.update).toHaveBeenCalledWith(
      { id: 'srv-bank' },
      { openingBalance: 1000, currentBalance: 850 },
    );
  });

  it('works back an opening balance for accounts that predate derived balances', async () => {
    const account = {
      ...bank,
      userId: 'u',
      openingBalance: null,
      currentBalance: 700,
    };
    const accounts = {
      find: jest.fn().mockResolvedValue([account]),
      update: jest.fn(),
    } as any;
    const expenses = {
      find: jest
        .fn()
        .mockResolvedValue([
          { amount: 300, accountId: 'bank', transferAccountId: null },
        ]),
    } as any;
    await recomputeBalances(accounts, expenses, 'u');
    expect(account.openingBalance).toBe(1000);
    expect(account.currentBalance).toBe(700);
  });
});
