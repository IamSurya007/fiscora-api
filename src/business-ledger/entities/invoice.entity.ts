import { BeforeInsert, Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { randomUUID } from 'crypto';
import type { InvoiceItem } from '../ledger';
import { moneyTransformer } from './money.transformer';

export type InvoiceStatus = 'draft' | 'sent' | 'paid';

@Entity('invoices')
@Index(['userId', 'number'], { unique: true })
@Index(['userId', 'fy', 'serial'])
@Index(['userId', 'partyId'])
export class Invoice {
  @PrimaryColumn('varchar')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = randomUUID();
  }

  @Column()
  userId: string;

  @Column()
  partyId: string;

  /** e.g. 2026-27/0001 */
  @Column({ type: 'varchar', length: 16 })
  number: string;

  @Column({ type: 'varchar', length: 7 })
  fy: string;

  @Column({ type: 'int' })
  serial: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'jsonb' })
  items: InvoiceItem[];

  /** Snapshot of the seller's GSTIN when the invoice was issued. */
  @Column({ type: 'varchar', length: 15, nullable: true })
  sellerGstin: string | null;

  /** 2-digit state code. */
  @Column({ type: 'varchar', length: 2, nullable: true })
  placeOfSupply: string | null;

  @Column({ type: 'varchar', length: 5, default: 'draft' })
  status: InvoiceStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
  total: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
