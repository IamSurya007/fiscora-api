import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { currentIstMonth } from '../utils/ledger';
import { InsightsService } from './insights.service';

@ApiBearerAuth('bearer')
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Month in review: totals vs last month, category changes, biggest purchases. */
  @Get('month-review')
  monthReview(@CurrentUser('uid') userId: string, @Query('month') month?: string) {
    const m = month ?? currentIstMonth();
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BadRequestException('Month must be YYYY-MM');
    return this.insights.monthReview(userId, m);
  }

  /** Last 7 days vs the 7 before (the same text the Sunday push uses). */
  @Get('weekly')
  weekly(@CurrentUser('uid') userId: string) {
    return this.insights.weekly(userId);
  }
}
