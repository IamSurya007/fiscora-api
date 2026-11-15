import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { Investment } from '../database/entities/investment.entity';
import { Loan } from '../database/entities/loan.entity';
import { NetWorthSnapshot } from '../database/entities/net-worth-snapshot.entity';
import { NetworthController } from './networth.controller';
import { NetworthService } from './networth.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Expense, Loan, Investment, NetWorthSnapshot])],
  controllers: [NetworthController],
  providers: [NetworthService],
  exports: [NetworthService],
})
export class NetworthModule {}
