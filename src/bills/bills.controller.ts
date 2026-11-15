import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { BillsService } from './bills.service';

@ApiBearerAuth('bearer')
@Controller('bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  /** Subscriptions, card dues and loan dues in the next `days` days (default 45, max 120). */
  @Get('upcoming')
  upcoming(@CurrentUser('uid') userId: string, @Query('days') days?: string) {
    const n = Math.min(Math.max(parseInt(days ?? '45', 10) || 45, 1), 120);
    return this.bills.upcoming(userId, n);
  }

  /** Detected recurring payments with cadence and next expected date. */
  @Get('recurring')
  recurring(@CurrentUser('uid') userId: string) {
    return this.bills.recurring(userId);
  }
}
