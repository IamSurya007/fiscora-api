import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { NetworthService } from './networth.service';

@ApiTags('networth')
@ApiBearerAuth('bearer')
@Controller('networth')
export class NetworthController {
  constructor(private readonly networthService: NetworthService) {}

  @Get()
  @ApiOperation({ summary: 'Current assets, liabilities and net worth with breakdown' })
  async current(@CurrentUser('uid') userId: string) {
    return this.networthService.computeNetWorth(userId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Daily net-worth snapshots, oldest first; today is live if not yet snapshotted' })
  @ApiQuery({ name: 'days', required: false, example: 365 })
  async history(@CurrentUser('uid') userId: string, @Query('days') days?: string) {
    const n = days !== undefined ? Number(days) : 365;
    return this.networthService.history(userId, Number.isFinite(n) ? n : 365);
  }
}
