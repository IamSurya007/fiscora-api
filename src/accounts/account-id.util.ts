import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Account } from '../database/entities/account.entity';

/**
 * Account ids are a single global primary key, but clients choose them
 * (mobile uses its local id, every user's default account is "default_bank").
 * TypeORM's save() updates whatever row has that key, so an id already owned by
 * another user would move that user's account to the caller. Keep the requested
 * id only when it is free or already the caller's; otherwise use a fresh UUID
 * (callers keep the client's id in `clientId`, which every lookup also checks).
 */
export async function ownAccountId(
  repo: Repository<Account>,
  userId: string,
  requestedId?: string | null,
): Promise<string> {
  if (!requestedId) return randomUUID();
  const holder = await repo.findOne({
    where: { id: requestedId },
    select: { id: true, userId: true },
  });
  return !holder || holder.userId === userId ? requestedId : randomUUID();
}
