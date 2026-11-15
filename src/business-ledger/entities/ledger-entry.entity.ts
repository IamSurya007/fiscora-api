import { BeforeInsert, Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'crypto';
import type { EntryDirection } from '../ledger';
import { moneyTransformer } from './money.transformer';

@Entity('ledger_entries')
@Index(['userId', 'partyId', 'date'])
@Index(['invoiceId'])
export class LedgerEntry {
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

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: moneyTransformer })
  amount: number;

  /** 'gave' = you gave goods/credit (they owe you); 'got' = you received payment. */
  @Column({ type: 'varchar', length: 4 })
  direction: EntryDirection;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', nullable: true })
  invoiceId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
