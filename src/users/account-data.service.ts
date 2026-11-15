import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityTarget, Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { Budget } from '../database/entities/budget.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { Category } from '../database/entities/category.entity';
import { CategoryRule } from '../database/entities/category-rule.entity';
import { ChatConversation } from '../database/entities/chat-conversation.entity';
import { ChatMessage } from '../database/entities/chat-message.entity';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

/**
 * Tables holding a user's rows, children before parents: chat messages
 * reference conversations, and every table references users. All FKs also
 * cascade on delete, but deleting explicitly keeps us safe if one doesn't.
 */
export const USER_DATA_DELETE_ORDER: EntityTarget<any>[] = [
  ChatMessage,
  ChatConversation,
  Expense,
  Budget,
  Loan,
  Investment,
  CategoryRule,
  Category,
  Account,
];

/** DPDP data-principal rights: access (export) and erasure (delete). */
@Injectable()
export class AccountDataService {
  private readonly logger = new Logger(AccountDataService.name);

  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Account) private accounts: Repository<Account>,
    @InjectRepository(Expense) private expenses: Repository<Expense>,
    @InjectRepository(Budget) private budgets: Repository<Budget>,
    @InjectRepository(Loan) private loans: Repository<Loan>,
    @InjectRepository(Investment) private investments: Repository<Investment>,
    @InjectRepository(Category) private categories: Repository<Category>,
    @InjectRepository(CategoryRule) private categoryRules: Repository<CategoryRule>,
    @InjectRepository(ChatConversation) private conversations: Repository<ChatConversation>,
    @InjectRepository(ChatMessage) private messages: Repository<ChatMessage>,
    private dataSource: DataSource,
    private firebase: FirebaseAdminService,
  ) {}

  /** Everything stored for [userId], including soft-deleted rows. Secrets are left out. */
  async export(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { fcmToken: _fcm, sheetsToken: _sheets, ...profile } = user;
    const byUser = { where: { userId } };

    const [accounts, expenses, budgets, loans, investments, categories, categoryRules, conversations, messages] =
      await Promise.all([
        this.accounts.find(byUser),
        this.expenses.find(byUser),
        this.budgets.find(byUser),
        this.loans.find(byUser),
        this.investments.find(byUser),
        this.categories.find(byUser),
        this.categoryRules.find(byUser),
        this.conversations.find(byUser),
        this.messages.find(byUser),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      format: 'fiscora-export-v1',
      profile,
      accounts,
      expenses,
      budgets,
      loans,
      investments,
      categories,
      categoryRules,
      chatConversations: conversations.map((c) => ({
        ...c,
        messages: messages.filter((m) => m.conversationId === c.id),
      })),
    };
  }

  /**
   * Permanently erases the user's rows in every table, then the Firebase Auth
   * account. Postgres goes first so a failed Firebase call can be retried by the
   * still-signed-in user. The knowledge base in Qdrant is shared, not per-user,
   * so there is nothing user-scoped to remove there.
   */
  async deleteAll(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      for (const entity of USER_DATA_DELETE_ORDER) {
        await manager.delete(entity, { userId });
      }
      await manager.delete(User, { id: userId });
    });

    try {
      await this.firebase.deleteUser(userId);
    } catch (err: any) {
      this.logger.error(`Data deleted but Firebase user ${userId} could not be removed: ${err?.message}`);
      throw new ServiceUnavailableException('Your data was deleted, but sign-in removal failed. Please try again.');
    }
  }
}
