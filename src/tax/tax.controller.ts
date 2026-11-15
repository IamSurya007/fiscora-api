import { Body, Controller, Get, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { TaxService } from './tax.service';
import { UpdateTaxProfileDto } from './tax-profile.dto';

@ApiTags('tax')
@ApiBearerAuth('bearer')
@Controller('tax')
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Tax profile (defaults until saved)' })
  getProfile(@CurrentUser('uid') userId: string) {
    return this.tax.getProfile(userId);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Create or update the tax profile' })
  updateProfile(@CurrentUser('uid') userId: string, @Body() dto: UpdateTaxProfileDto) {
    return this.tax.updateProfile(userId, dto);
  }

  @Get('summary')
  @ApiOperation({ summary: 'FY receipts, presumptive income, threshold meters, set-aside, advance tax, TDS (estimates)' })
  @ApiQuery({ name: 'fy', required: false, example: '2026-27' })
  summary(@CurrentUser('uid') userId: string, @Query('fy') fy?: string) {
    return this.tax.summary(userId, fy);
  }

  @Get('export')
  @ApiOperation({ summary: 'CSV of receipts, business expenses by category and TDS for the CA / ITR-4' })
  @ApiQuery({ name: 'fy', required: false, example: '2026-27' })
  async export(@CurrentUser('uid') userId: string, @Res() res: Response, @Query('fy') fy?: string) {
    const { filename, csv } = await this.tax.exportCsv(userId, fy);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM so Excel reads ₹ and other UTF-8 text correctly.
    res.send('﻿' + csv);
  }
}
