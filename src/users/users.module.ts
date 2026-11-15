import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { Expense } from '../database/entities/expense.entity';
import { Budget } from '../database/entities/budget.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { Account } from '../database/entities/account.entity';
import { Category } from '../database/entities/category.entity';
import { CategoryRule } from '../database/entities/category-rule.entity';
import { ChatConversation } from '../database/entities/chat-conversation.entity';
import { ChatMessage } from '../database/entities/chat-message.entity';
import { UsersService } from './users.service';
import { AccountDataService } from './account-data.service';
import { PrivacyController } from './privacy.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Expense,
      Budget,
      Loan,
      Investment,
      Account,
      Category,
      CategoryRule,
      ChatConversation,
      ChatMessage,
    ]),
  ],
  providers: [UsersService, AccountDataService],
  controllers: [UsersController, PrivacyController],
  exports: [UsersService],
})
export class UsersModule {}
