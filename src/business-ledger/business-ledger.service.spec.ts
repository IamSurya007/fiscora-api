import { BadRequestException } from '@nestjs/common';
import { BusinessLedgerService } from './business-ledger.service';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Invoice } from './entities/invoice.entity';

function repo(rows: any[] = []) {
  return {
    rows,
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
    ),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
    delete: jest.fn(async () => ({})),
  };
}

function setup(opts: { gstin?: string | null; maxSerial?: number | null; partyGstin?: string | null } = {}) {
  const party = { id: 'p1', userId: 'u1', name: 'Ravi', phone: '9876543210', gstin: opts.partyGstin ?? null };
  const parties = repo([party]);
  const entries = repo([]);
  const invoices = repo([]);
  const profiles = repo(
    opts.gstin !== undefined
      ? [{ userId: 'u1', businessName: 'Sharma Traders', gstin: opts.gstin }]
      : [{ userId: 'u1', businessName: 'Sharma Traders', gstin: null }],
  );
  const users = repo([{ id: 'u1', name: 'Surya' }]);
  const saved: any[] = [];
  const manager = {
    createQueryBuilder: jest.fn(() => ({
      select: () => ({ where: () => ({ getRawOne: async () => ({ max: opts.maxSerial ?? null }) }) }),
    })),
    create: jest.fn((entity: any, x: any) => ({ __entity: entity, ...x })),
    save: jest.fn(async (x: any) => {
      saved.push(x);
      return { id: x.__entity === Invoice ? 'inv1' : 'e1', ...x };
    }),
    delete: jest.fn(async () => ({})),
  };
  const dataSource = { transaction: jest.fn(async (fn: any) => fn(manager)) };
  const service = new BusinessLedgerService(
    parties as any,
    entries as any,
    invoices as any,
    profiles as any,
    users as any,
    dataSource as any,
  );
  return { service, entries, invoices, manager, saved };
}

describe('BusinessLedgerService', () => {
  it('numbers invoices per FY and posts a "gave" entry', async () => {
    const { service, saved } = setup({ maxSerial: 7 });
    const res = await service.createInvoice('u1', {
      partyId: 'p1',
      date: '2026-11-15',
      items: [{ description: 'Logo design', qty: 1, rate: 4000 }],
    });
    expect(res.number).toBe('2026-27/0008');
    expect(res.totals.title).toBe('Invoice');
    expect(res.total).toBe(4000);
    const entry = saved.find((s) => s.__entity === LedgerEntry);
    expect(entry).toMatchObject({ direction: 'gave', amount: 4000, partyId: 'p1', invoiceId: 'inv1' });
  });

  it('refuses GST lines when the seller has no GSTIN', async () => {
    const { service } = setup();
    await expect(
      service.createInvoice('u1', {
        partyId: 'p1',
        date: '2026-11-15',
        items: [{ description: 'x', qty: 1, rate: 100, gstRate: 18 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('charges IGST for an inter-state GST invoice', async () => {
    const { service } = setup({ gstin: '29ABCDE1234F1Z5', partyGstin: '27PQRSX6789K1Z2' });
    const res = await service.createInvoice('u1', {
      partyId: 'p1',
      date: '2027-04-01',
      items: [{ description: 'Consulting', hsnSac: '998311', qty: 2, rate: 5000, gstRate: 18 }],
    });
    expect(res.number).toBe('2027-28/0001');
    expect(res.totals.title).toBe('Tax Invoice');
    expect(res.totals.igst).toBe(1800);
    expect(res.total).toBe(11800);
  });

  it('marking paid posts a "got" entry; un-paying removes it', async () => {
    const { service, invoices, manager, saved } = setup();
    invoices.rows.push({
      id: 'inv1', userId: 'u1', partyId: 'p1', number: '2026-27/0001', status: 'sent', total: 500,
      items: [{ description: 'x', qty: 1, rate: 500 }], sellerGstin: null, placeOfSupply: null,
    });
    await service.setInvoiceStatus('u1', 'inv1', 'paid', '2026-11-20');
    expect(saved.find((s) => s.__entity === LedgerEntry)).toMatchObject({
      direction: 'got', amount: 500, date: '2026-11-20', invoiceId: 'inv1',
    });
    await service.setInvoiceStatus('u1', 'inv1', 'sent');
    expect(manager.delete).toHaveBeenCalledWith(LedgerEntry, { userId: 'u1', invoiceId: 'inv1', direction: 'got' });
  });

  it('builds a WhatsApp reminder for the amount due', async () => {
    const { service, entries } = setup();
    entries.rows.push({ partyId: 'p1', amount: 1500, direction: 'gave' }, { partyId: 'p1', amount: 500, direction: 'got' });
    const r = await service.reminder('u1', 'p1');
    expect(r.amountDue).toBe(1000);
    expect(r.url.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    expect(r.message).toContain('Sharma Traders');
  });

  it('rejects a reminder when nothing is due', async () => {
    const { service } = setup();
    await expect(service.reminder('u1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates party phone numbers', async () => {
    const { service } = setup();
    await expect(service.createParty('u1', { name: 'A', phone: '12345' })).rejects.toBeInstanceOf(BadRequestException);
    const p = await service.createParty('u1', { name: 'A', phone: '+91 91234 56789' });
    expect(p.phone).toBe('9123456789');
  });
});
