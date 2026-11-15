import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { User } from './user.entity';
import { AccountType } from '../enums';
import { randomUUID } from 'crypto';

@Entity('accounts')
@Index(['userId', 'name'])
export class Account {
  @PrimaryColumn('varchar')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @Column()
  userId: string;

  @Column()
  name: string;

  @Column({
    type: 'varchar',
    default: AccountType.BANK,
  })
  type: AccountType | string;

  /** Derived: openingBalance + effects of live transactions (see account-balance.ts). */
  @Column('float', { default: 0 })
  currentBalance: number;

  /** Balance before any recorded transaction. Null until first computed. */
  @Column('float', { nullable: true })
  openingBalance: number | null;

  @Column('float', { default: 0 })
  creditLimit: number;

  @Column({ type: 'varchar', nullable: true })
  accountNumberLast4: string | null;

  /** Credit cards: day of month the statement is generated (1-31). */
  @Column({ type: 'int', nullable: true })
  statementDay: number | null;

  /** Credit cards: day of month the payment is due (1-31). */
  @Column({ type: 'int', nullable: true })
  dueDay: number | null;

  @Column({ type: 'bigint', default: 4280962800 })
  colorValue: number;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  clientId: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.accounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
