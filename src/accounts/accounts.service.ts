import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../database/entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AccountType } from '../database/enums';
import { ownAccountId } from './account-id.util';
import { Expense } from '../database/entities/expense.entity';
import { openingForTarget, recomputeBalances } from './account-balance';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
  ) {}

  async ensureDefaultAccount(userId: string): Promise<Account> {
    let account = await this.accountsRepository.findOne({
      where: [
        { id: 'default_bank', userId },
        { clientId: 'default_bank', userId },
      ],
    });

    if (!account) {
      account = this.accountsRepository.create({
        id: await ownAccountId(this.accountsRepository, userId, 'default_bank'),
        clientId: 'default_bank',
        userId,
        name: 'Default Bank Account',
        type: AccountType.BANK,
        currentBalance: 0,
        creditLimit: 0,
        accountNumberLast4: '0000',
        colorValue: 4280962800,
        version: 1,
        isDeleted: false,
      });
      account = await this.accountsRepository.save(account);
    }

    return account;
  }

  async validateAccountExists(userId: string, accountId: string): Promise<boolean> {
    const targetId = accountId || 'default_bank';
    const account = await this.accountsRepository.findOne({
      where: [
        { id: targetId, userId, isDeleted: false },
        { clientId: targetId, userId, isDeleted: false },
      ],
    });

    if (account) return true;

    if (targetId === 'default_bank') {
      await this.ensureDefaultAccount(userId);
      return true;
    }

    return false;
  }

  async create(userId: string, dto: CreateAccountDto): Promise<Account> {
    const account = this.accountsRepository.create({
      ...dto,
      id: await ownAccountId(this.accountsRepository, userId, dto.id),
      userId,
      type: dto.type || AccountType.BANK,
      currentBalance: dto.currentBalance ?? 0,
      // A new account has no transactions yet, so its balance is its opening balance.
      openingBalance: dto.currentBalance ?? 0,
      creditLimit: dto.creditLimit ?? 0,
      accountNumberLast4: dto.accountNumberLast4 || null,
      colorValue: dto.colorValue ?? 4280962800,
      version: 1,
      isDeleted: false,
    });

    return this.accountsRepository.save(account);
  }

  async findAll(userId: string): Promise<Account[]> {
    await this.ensureDefaultAccount(userId);
    await recomputeBalances(this.accountsRepository, this.expensesRepository, userId);
    return this.accountsRepository.find({
      where: { userId, isDeleted: false },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(userId: string, id: string): Promise<Account> {
    const account = await this.accountsRepository.findOne({ where: { id } });
    if (!account || account.isDeleted) {
      throw new NotFoundException('Account not found');
    }
    if (account.userId !== userId) {
      throw new ForbiddenException("You cannot access another user's account");
    }
    return account;
  }

  async update(userId: string, id: string, dto: UpdateAccountDto): Promise<Account> {
    const account = await this.findOne(userId, id);

    if (dto.name !== undefined) account.name = dto.name;
    if (dto.type !== undefined) account.type = dto.type;
    const typeChanged = dto.type !== undefined && dto.type !== account.type;
    if (typeChanged || dto.currentBalance !== undefined) {
      // "Set balance to X" moves the opening balance; the balance stays derived.
      // A type change (bank <-> card) flips how transactions count, so keep the
      // balance the user sees by re-deriving the opening balance too.
      await recomputeBalances(this.accountsRepository, this.expensesRepository, userId);
      const fresh = await this.accountsRepository.findOne({ where: { id: account.id } });
      const target = dto.currentBalance ?? fresh?.currentBalance ?? account.currentBalance;
      if (dto.type !== undefined) account.type = dto.type;
      account.openingBalance = await openingForTarget(this.expensesRepository, userId, account, target);
      account.currentBalance = target;
    }
    if (dto.creditLimit !== undefined) account.creditLimit = dto.creditLimit;
    if (dto.accountNumberLast4 !== undefined) account.accountNumberLast4 = dto.accountNumberLast4;
    if (dto.colorValue !== undefined) account.colorValue = dto.colorValue;

    account.version = (account.version || 1) + 1;
    account.updatedAt = new Date();

    return this.accountsRepository.save(account);
  }

  async remove(userId: string, id: string): Promise<void> {
    const account = await this.findOne(userId, id);
    account.isDeleted = true;
    account.version = (account.version || 1) + 1;
    account.updatedAt = new Date();
    await this.accountsRepository.save(account);
  }
}
