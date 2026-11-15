import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { BusinessLedgerService } from './business-ledger.service';
import { CreatePartyDto, UpdatePartyDto } from './dto/party.dto';
import { CreateEntryDto } from './dto/entry.dto';
import { BusinessProfileDto, CreateInvoiceDto, UpdateInvoiceStatusDto } from './dto/invoice.dto';

@ApiBearerAuth('bearer')
@Controller('business-profile')
export class BusinessProfileController {
  constructor(private readonly service: BusinessLedgerService) {}

  @Get()
  get(@CurrentUser('uid') userId: string) {
    return this.service.getProfile(userId);
  }

  @Put()
  save(@CurrentUser('uid') userId: string, @Body() dto: BusinessProfileDto) {
    return this.service.saveProfile(userId, dto);
  }
}

@ApiBearerAuth('bearer')
@Controller('parties')
export class PartiesController {
  constructor(private readonly service: BusinessLedgerService) {}

  @Get()
  list(@CurrentUser('uid') userId: string) {
    return this.service.listParties(userId);
  }

  @Post()
  create(@CurrentUser('uid') userId: string, @Body() dto: CreatePartyDto) {
    return this.service.createParty(userId, dto);
  }

  @Get(':id')
  get(@CurrentUser('uid') userId: string, @Param('id') id: string) {
    return this.service.getParty(userId, id);
  }

  @Patch(':id')
  update(@CurrentUser('uid') userId: string, @Param('id') id: string, @Body() dto: UpdatePartyDto) {
    return this.service.updateParty(userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser('uid') userId: string, @Param('id') id: string) {
    await this.service.deleteParty(userId, id);
    return { message: 'Customer deleted' };
  }

  @Get(':id/reminder')
  reminder(@CurrentUser('uid') userId: string, @Param('id') id: string) {
    return this.service.reminder(userId, id);
  }

  @Get(':id/entries')
  entries(@CurrentUser('uid') userId: string, @Param('id') id: string) {
    return this.service.findParty(userId, id).then(() => this.service.listEntries(userId, id));
  }

  @Post(':id/entries')
  addEntry(@CurrentUser('uid') userId: string, @Param('id') id: string, @Body() dto: CreateEntryDto) {
    return this.service.addEntry(userId, id, dto);
  }

  @Delete(':id/entries/:entryId')
  async deleteEntry(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
  ) {
    await this.service.deleteEntry(userId, id, entryId);
    return { message: 'Entry deleted' };
  }
}

@ApiBearerAuth('bearer')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly service: BusinessLedgerService) {}

  @Get()
  list(@CurrentUser('uid') userId: string, @Query('partyId') partyId?: string) {
    return this.service.listInvoices(userId, partyId);
  }

  @Post()
  create(@CurrentUser('uid') userId: string, @Body() dto: CreateInvoiceDto) {
    return this.service.createInvoice(userId, dto);
  }

  @Get(':id')
  get(@CurrentUser('uid') userId: string, @Param('id') id: string) {
    return this.service.getInvoice(userId, id);
  }

  @Patch(':id/status')
  setStatus(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceStatusDto,
  ) {
    return this.service.setInvoiceStatus(userId, id, dto.status, dto.paidOn);
  }

  @Delete(':id')
  async remove(@CurrentUser('uid') userId: string, @Param('id') id: string) {
    await this.service.deleteInvoice(userId, id);
    return { message: 'Invoice deleted' };
  }
}
