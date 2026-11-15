import { Controller, Get, Post, Patch, Delete, Body } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpsertUserDto } from './dto/upsert-user.dto';
import { UpdateFcmDto } from './dto/update-fcm.dto';
import { RecordConsentDto } from './dto/record-consent.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccountDataService } from './account-data.service';

@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountData: AccountDataService,
  ) {}

  @Post('me')
  async upsertUser(
    @CurrentUser('uid') userId: string,
    @Body() dto: UpsertUserDto,
  ) {
    return this.usersService.upsert(userId, dto);
  }

  @Post('me/migrate-firestore')
  async migrateFirestore(@CurrentUser('uid') userId: string) {
    return this.usersService.migrateFirestore(userId);
  }

  @Get('me')
  async getProfile(@CurrentUser('uid') userId: string) {
    return this.usersService.findOne(userId);
  }

  @Patch('me/fcm')
  async updateFcm(
    @CurrentUser('uid') userId: string,
    @Body() dto: UpdateFcmDto,
  ) {
    return this.usersService.updateFcm(userId, dto.fcmToken);
  }

  @Post('me/consent')
  async recordConsent(
    @CurrentUser('uid') userId: string,
    @Body() dto: RecordConsentDto,
  ) {
    const user = await this.usersService.recordConsent(userId, dto.version, dto.isAdult);
    return { consentVersion: user.consentVersion, consentedAt: user.consentedAt, isAdult: user.isAdult };
  }

  @Get('me/export')
  async exportData(@CurrentUser('uid') userId: string) {
    return this.accountData.export(userId);
  }

  @Delete('me')
  async deleteAccount(@CurrentUser('uid') userId: string) {
    await this.accountData.deleteAll(userId);
    return { message: 'Account deleted successfully' };
  }
}
