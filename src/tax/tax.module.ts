import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense } from '../database/entities/expense.entity';
import { TaxProfile } from '../database/entities/tax-profile.entity';
import { CategoriesModule } from '../categories/categories.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';

@Module({
  imports: [TypeOrmModule.forFeature([Expense, TaxProfile]), CategoriesModule, NotificationsModule],
  controllers: [TaxController],
  providers: [TaxService],
})
export class TaxModule {}
