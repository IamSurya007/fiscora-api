import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { Party } from './entities/party.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Invoice } from './entities/invoice.entity';
import { BusinessProfile } from './entities/business-profile.entity';
import { BusinessLedgerService } from './business-ledger.service';
import { BusinessProfileController, InvoicesController, PartiesController } from './business-ledger.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Party, LedgerEntry, Invoice, BusinessProfile, User])],
  providers: [BusinessLedgerService],
  controllers: [BusinessProfileController, PartiesController, InvoicesController],
})
export class BusinessLedgerModule {}
