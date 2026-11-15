import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { CategoriesModule } from '../categories/categories.module';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Expense]), CategoriesModule],
  controllers: [BusinessController],
  providers: [BusinessService],
})
export class BusinessModule {}
