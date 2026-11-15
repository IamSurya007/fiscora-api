import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Party } from './entities/party.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { BusinessProfile } from './entities/business-profile.entity';
import { User } from '../database/entities/user.entity';
import { CreatePartyDto, UpdatePartyDto } from './dto/party.dto';
import { CreateEntryDto } from './dto/entry.dto';
import { BusinessProfileDto, CreateInvoiceDto } from './dto/invoice.dto';
import {
  balancesByParty,
  computeInvoiceTotals,
  financialYear,
  formatInvoiceNumber,
  nextSerial,
  normalizeIndianMobile,
  partyBalance,
  reminderMessage,
  whatsappReminderLink,
} from './ledger';

function today(): string {
  // IST calendar date
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function phoneOrThrow(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const p = normalizeIndianMobile(raw);
  if (!p) throw new BadRequestException('phone must be a valid Indian mobile number');
  return p;
}

@Injectable()
export class BusinessLedgerService {
  constructor(
    @InjectRepository(Party) private readonly parties: Repository<Party>,
    @InjectRepository(LedgerEntry) private readonly entries: Repository<LedgerEntry>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(BusinessProfile) private readonly profiles: Repository<BusinessProfile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  // ---- business profile ----

  async getProfile(userId: string): Promise<BusinessProfile> {
    const p = await this.profiles.findOne({ where: { userId } });
    return (
      p ?? this.profiles.create({ userId, businessName: null, gstin: null, address: null, phone: null })
    );
  }

  async saveProfile(userId: string, dto: BusinessProfileDto): Promise<BusinessProfile> {
    const p = await this.getProfile(userId);
    if (dto.businessName !== undefined) p.businessName = dto.businessName;
    if (dto.gstin !== undefined) p.gstin = dto.gstin;
    if (dto.address !== undefined) p.address = dto.address?.trim() || null;
    if (dto.phone !== undefined) p.phone = phoneOrThrow(dto.phone);
    return this.profiles.save(p);
  }

  // ---- parties ----

  async listParties(userId: string) {
    const [parties, entries] = await Promise.all([
      this.parties.find({ where: { userId }, order: { name: 'ASC' } }),
      this.entries.find({ where: { userId }, select: { partyId: true, amount: true, direction: true } }),
    ]);
    const balances = balancesByParty(entries);
    return parties.map((p) => ({ ...p, balance: balances.get(p.id) ?? 0 }));
  }

  async findParty(userId: string, id: string): Promise<Party> {
    const p = await this.parties.findOne({ where: { id, userId } });
    if (!p) throw new NotFoundException('Party not found');
    return p;
  }

  async getParty(userId: string, id: string) {
    const party = await this.findParty(userId, id);
    const entries = await this.listEntries(userId, id);
    return { ...party, balance: partyBalance(entries), entries };
  }

  async createParty(userId: string, dto: CreatePartyDto): Promise<Party> {
    const party = this.parties.create({
      userId,
      name: dto.name,
      phone: phoneOrThrow(dto.phone),
      gstin: dto.gstin ?? null,
    });
    return this.parties.save(party);
  }

  async updateParty(userId: string, id: string, dto: UpdatePartyDto): Promise<Party> {
    const party = await this.findParty(userId, id);
    if (dto.name !== undefined) party.name = dto.name;
    if (dto.phone !== undefined) party.phone = phoneOrThrow(dto.phone);
    if (dto.gstin !== undefined) party.gstin = dto.gstin;
    return this.parties.save(party);
  }

  async deleteParty(userId: string, id: string): Promise<void> {
    await this.findParty(userId, id);
    await this.dataSource.transaction(async (m) => {
      await m.delete(LedgerEntry, { userId, partyId: id });
      await m.delete(Invoice, { userId, partyId: id });
      await m.delete(Party, { userId, id });
    });
  }

  async reminder(userId: string, id: string) {
    const party = await this.findParty(userId, id);
    if (!party.phone) throw new BadRequestException('Add a mobile number for this customer first');
    const entries = await this.entries.find({ where: { userId, partyId: id } });
    const due = partyBalance(entries);
    if (due <= 0) throw new BadRequestException('Nothing is due from this customer');
    const profile = await this.profiles.findOne({ where: { userId } });
    const user = profile?.businessName ? null : await this.users.findOne({ where: { id: userId } });
    const businessName = profile?.businessName || user?.name || 'us';
    const message = reminderMessage(party.name, due, businessName);
    return { amountDue: due, message, url: whatsappReminderLink(party.phone, message) };
  }

  // ---- entries ----

  async listEntries(userId: string, partyId: string): Promise<LedgerEntry[]> {
    return this.entries.find({
      where: { userId, partyId },
      order: { date: 'DESC', createdAt: 'DESC' },
    });
  }

  async addEntry(userId: string, partyId: string, dto: CreateEntryDto): Promise<LedgerEntry> {
    await this.findParty(userId, partyId);
    return this.entries.save(
      this.entries.create({
        userId,
        partyId,
        date: dto.date.slice(0, 10),
        amount: dto.amount,
        direction: dto.direction,
        note: dto.note || null,
        invoiceId: null,
      }),
    );
  }

  async deleteEntry(userId: string, partyId: string, entryId: string): Promise<void> {
    const entry = await this.entries.findOne({ where: { id: entryId, userId, partyId } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.invoiceId) {
      throw new BadRequestException('This entry belongs to an invoice; change or delete the invoice instead');
    }
    await this.entries.delete({ id: entryId, userId });
  }

  // ---- invoices ----

  private withTotals(invoice: Invoice, party: Party | null, profile: BusinessProfile | null) {
    const totals = computeInvoiceTotals(
      invoice.items,
      invoice.sellerGstin,
      party?.gstin ?? null,
      invoice.placeOfSupply,
    );
    return { ...invoice, party, seller: profile, totals };
  }

  async listInvoices(userId: string, partyId?: string) {
    const where = partyId ? { userId, partyId } : { userId };
    const [invoices, parties] = await Promise.all([
      this.invoices.find({ where, order: { date: 'DESC', serial: 'DESC' } }),
      this.parties.find({ where: { userId } }),
    ]);
    const byId = new Map(parties.map((p) => [p.id, p]));
    return invoices.map((i) => ({ ...i, partyName: byId.get(i.partyId)?.name ?? null }));
  }

  async getInvoice(userId: string, id: string) {
    const invoice = await this.invoices.findOne({ where: { id, userId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const [party, profile] = await Promise.all([
      this.parties.findOne({ where: { id: invoice.partyId, userId } }),
      this.profiles.findOne({ where: { userId } }),
    ]);
    return this.withTotals(invoice, party, profile);
  }

  async createInvoice(userId: string, dto: CreateInvoiceDto) {
    const party = await this.findParty(userId, dto.partyId);
    const profile = await this.profiles.findOne({ where: { userId } });
    const sellerGstin = profile?.gstin ?? null;
    const items = dto.items.map((i) => ({
      description: i.description.trim(),
      ...(i.hsnSac ? { hsnSac: i.hsnSac } : {}),
      qty: i.qty,
      rate: i.rate,
      ...(i.gstRate !== undefined && sellerGstin ? { gstRate: i.gstRate } : {}),
    }));
    if (!sellerGstin && dto.items.some((i) => (i.gstRate ?? 0) > 0)) {
      throw new BadRequestException('GST can only be charged when your GSTIN is set in the business profile');
    }
    if (!sellerGstin && dto.placeOfSupply) {
      throw new BadRequestException('Place of supply applies only to GST invoices');
    }
    const totals = computeInvoiceTotals(items, sellerGstin, party.gstin, dto.placeOfSupply);
    if (totals.total <= 0) throw new BadRequestException('Invoice total must be more than zero');

    const date = dto.date.slice(0, 10);
    const fy = financialYear(date);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.dataSource.transaction(async (m) => {
          const used = await m
            .createQueryBuilder(Invoice, 'i')
            .select('MAX(i.serial)', 'max')
            .where('i.userId = :userId AND i.fy = :fy', { userId, fy })
            .getRawOne<{ max: number | null }>();
          const serial = nextSerial(used?.max ? [Number(used.max)] : []);
          const invoice = m.create(Invoice, {
            userId,
            partyId: party.id,
            number: formatInvoiceNumber(fy, serial),
            fy,
            serial,
            date,
            dueDate: dto.dueDate ? dto.dueDate.slice(0, 10) : null,
            items,
            sellerGstin,
            placeOfSupply: sellerGstin ? dto.placeOfSupply ?? null : null,
            status: dto.status ?? 'draft',
            notes: dto.notes || null,
            total: totals.total,
          });
          const saved = await m.save(invoice);
          await m.save(
            m.create(LedgerEntry, {
              userId,
              partyId: party.id,
              date,
              amount: totals.total,
              direction: 'gave',
              note: `Invoice ${saved.number}`,
              invoiceId: saved.id,
            }),
          );
          return this.withTotals(saved, party, profile);
        });
      } catch (err: any) {
        // unique (userId, number) clash from a concurrent create: retry with the next serial
        if (err?.code === '23505' && attempt < 2) continue;
        throw err;
      }
    }
    throw new ConflictException('Could not allocate an invoice number, please retry');
  }

  async setInvoiceStatus(userId: string, id: string, status: InvoiceStatus, paidOn?: string) {
    const invoice = await this.invoices.findOne({ where: { id, userId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== status) {
      await this.dataSource.transaction(async (m) => {
        if (status === 'paid') {
          await m.save(
            m.create(LedgerEntry, {
              userId,
              partyId: invoice.partyId,
              date: paidOn ? paidOn.slice(0, 10) : today(),
              amount: invoice.total,
              direction: 'got',
              note: `Payment for invoice ${invoice.number}`,
              invoiceId: invoice.id,
            }),
          );
        } else if (invoice.status === 'paid') {
          await m.delete(LedgerEntry, { userId, invoiceId: invoice.id, direction: 'got' });
        }
        invoice.status = status;
        await m.save(invoice);
      });
    }
    return this.getInvoice(userId, id);
  }

  async deleteInvoice(userId: string, id: string): Promise<void> {
    const invoice = await this.invoices.findOne({ where: { id, userId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.dataSource.transaction(async (m) => {
      await m.delete(LedgerEntry, { userId, invoiceId: id });
      await m.delete(Invoice, { userId, id });
    });
  }
}
