import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { BusinessService } from './business.service';

@ApiTags('business')
@ApiBearerAuth('bearer')
@Controller('business')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get('pnl')
  @ApiOperation({ summary: 'Business profit and loss for a month or a range of months' })
  @ApiQuery({ name: 'month', required: false, example: '2026-11' })
  @ApiQuery({ name: 'from', required: false, example: '2026-04' })
  @ApiQuery({ name: 'to', required: false, example: '2027-03' })
  async pnl(
    @CurrentUser('uid') userId: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.business.pnl(userId, { month, from, to });
  }
}
