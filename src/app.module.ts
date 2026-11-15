import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ExpensesModule } from './expenses/expenses.module';
import { BudgetsModule } from './budgets/budgets.module';
import { LoansModule } from './loans/loans.module';
import { InvestmentsModule } from './investments/investments.module';
import { SheetsModule } from './sheets/sheets.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SyncModule } from './sync/sync.module';
import { AccountsModule } from './accounts/accounts.module';
import { RagModule } from './rag/rag.module';
import { CategoriesModule } from './categories/categories.module';
import { NetworthModule } from './networth/networth.module';
import { BusinessModule } from './business/business.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { BillsModule } from './bills/bills.module';
import { InsightsModule } from './insights/insights.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    UsersModule,
    NotificationsModule,
    ExpensesModule,
    AccountsModule,
    BudgetsModule,
    LoansModule,
    InvestmentsModule,
    SheetsModule,
    SchedulerModule,
    SyncModule,
    RagModule,
    CategoriesModule,
    BillsModule,
    InsightsModule,
    NetworthModule,
    BusinessModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: true,
        ssl: {
          rejectUnauthorized: false,
        },
      }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
