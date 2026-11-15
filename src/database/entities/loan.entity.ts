import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { User } from './user.entity';
import { LoanType, LoanStatus } from '../enums';
import { randomUUID } from 'crypto';
import type { LoanRepayment } from '../../loans/emi';

@Entity('loans')
@Index(['userId', 'type'])
@Index(['userId', 'status'])
export class Loan {
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

  @Column({
    type: 'varchar',
  })
  type: LoanType;

  @Column()
  name: string;

  @Column('float')
  principal: number;

  @Column('float')
  total: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  repaymentDate: Date | null;

  @Column({
    type: 'varchar',
    default: LoanStatus.ACTIVE,
  })
  status: LoanStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ default: false })
  reminderSent: boolean;

  @Column({ type: 'float', default: 0 })
  interestRate: number;

  @Column({ type: 'boolean', default: false })
  isEmi: boolean;

  @Column({ type: 'float', nullable: true })
  emiAmount: number | null;

  @Column({ type: 'int', nullable: true })
  tenureMonths: number | null;

  @Column({ type: 'date', nullable: true })
  emiStartDate: string | null;

  @Column({ type: 'int', nullable: true })
  emiDayOfMonth: number | null;

  /** Repayment log: [{ id, date: 'YYYY-MM-DD', amount, note }]. */
  @Column({ type: 'jsonb', nullable: true, default: () => "'[]'" })
  repayments: LoanRepayment[] | null;

  /** Due date ('YYYY-MM-DD') of the last EMI a reminder went out for. */
  @Column({ type: 'date', nullable: true })
  emiReminderFor: string | null;

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

  @ManyToOne(() => User, (user) => user.loans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
