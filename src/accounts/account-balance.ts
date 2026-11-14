import { In, Repository } from 'typeorm';
import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { AccountType } from '../database/enums';

/**
 * Balances are derived, never pushed: currentBalance = openingBalance + the
 * effect of every live transaction on the account. Devices used to push an
 * absolute balance and the last write won, so two phones adding expenses at
 * the same time lost one of them (1000 - 100 - 50 ended at 900 or 950).
 *
 * Sign convention: `amount` > 0 is money out of `accountId`, < 0 is money in.
 * A transfer also names `transferAccountId`, which receives the money.
 * For a credit card the stored balance is the amount owed, so a purchase
 * raises it and a bill payment (a transfer into the card) lowers it.
 */
export function effectOn(
  account: Pick<Account, 'id' | 'clientId' | 'type'>,
  tx: Pick<Expense, 'amount' | 'accountId' | 'transferAccountId'>,
): number {
  const ids = [account.id, account.clientId].filter(Boolean);
  const debitSign = account.type === AccountType.CREDIT_CARD ? 1 : -1;
  let effect = 0;
  if (tx.accountId && ids.includes(tx.accountId))
    effect += debitSign * tx.amount;
  if (tx.transferAccountId && ids.includes(tx.transferAccountId))
    effect -= debitSign * tx.amount;
  return effect;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Recomputes and stores currentBalance for the user's accounts. Accounts
 * created before balances were derived get an opening balance worked back from
 * their stored balance, so the figure users see does not change.
 * The version is not bumped: devices compute balances themselves, so this
 * must not look like an edit that conflicts with theirs.
 */
export async function recomputeBalances(
  accounts: Repository<Account>,
  expenses: Repository<Expense>,
  userId: string,
): Promise<Account[]> {
  const rows = await accounts.find({ where: { userId } });
  if (rows.length === 0) return rows;
  const txs = await expenses.find({
    where: { userId, isDeleted: false },
    select: {
      id: true,
      amount: true,
      accountId: true,
      transferAccountId: true,
    },
  });

  const changed: Account[] = [];
  for (const account of rows) {
    const effects = txs.reduce((sum, tx) => sum + effectOn(account, tx), 0);
    if (
      account.openingBalance === null ||
      account.openingBalance === undefined
    ) {
      account.openingBalance = round2((account.currentBalance ?? 0) - effects);
      changed.push(account);
    }
    const balance = round2(account.openingBalance + effects);
    if (balance !== account.currentBalance) {
      account.currentBalance = balance;
      if (!changed.includes(account)) changed.push(account);
    }
  }
  if (changed.length > 0) {
    // Plain UPDATEs keep version untouched (save() would also do that, but
    // being explicit documents the intent).
    for (const a of changed) {
      await accounts.update(
        { id: a.id },
        { openingBalance: a.openingBalance, currentBalance: a.currentBalance },
      );
    }
  }
  return rows;
}

/** Opening balance that makes the account show `targetBalance` today. */
export async function openingForTarget(
  expenses: Repository<Expense>,
  userId: string,
  account: Pick<Account, 'id' | 'clientId' | 'type'>,
  targetBalance: number,
): Promise<number> {
  const ids = [account.id, account.clientId].filter((x): x is string => !!x);
  const txs = await expenses.find({
    where: [
      { userId, isDeleted: false, accountId: In(ids) },
      { userId, isDeleted: false, transferAccountId: In(ids) },
    ],
    select: {
      id: true,
      amount: true,
      accountId: true,
      transferAccountId: true,
    },
  });
  const effects = txs.reduce((sum, tx) => sum + effectOn(account, tx), 0);
  return round2(targetBalance - effects);
}
