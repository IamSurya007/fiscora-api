import { Controller, Get, Post, Delete, Body } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { SheetsService } from './sheets.service';
import { ConnectSheetsDto, ExchangeSheetsCodeDto } from './dto/connect-sheets.dto';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiBearerAuth('bearer')
@Controller('sheets')
export class SheetsController {
  constructor(private readonly sheetsService: SheetsService) {}

  @Post('connect')
  async connect(
    @CurrentUser('uid') userId: string,
    @Body() dto: ConnectSheetsDto,
  ) {
    return this.sheetsService.connect(userId, dto);
  }

  /** Preferred: the server exchanges the OAuth code, so the client secret stays private. */
  @Post('oauth/exchange')
  async exchange(
    @CurrentUser('uid') userId: string,
    @Body() dto: ExchangeSheetsCodeDto,
  ) {
    return this.sheetsService.connectWithCode(userId, dto);
  }

  @Post('sync')
  async sync(@CurrentUser('uid') userId: string) {
    await this.sheetsService.sync(userId);
    return { message: 'Data synced to Google Sheets successfully' };
  }

  @Get('status')
  async getStatus(@CurrentUser('uid') userId: string) {
    return this.sheetsService.getStatus(userId);
  }

  @Delete('disconnect')
  async disconnect(@CurrentUser('uid') userId: string) {
    return this.sheetsService.disconnect(userId);
  }
}
