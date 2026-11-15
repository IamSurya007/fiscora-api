import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense } from '../database/entities/expense.entity';
import { User } from '../database/entities/user.entity';
import { CategoriesModule } from '../categories/categories.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  imports: [TypeOrmModule.forFeature([Expense, User]), CategoriesModule, NotificationsModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
