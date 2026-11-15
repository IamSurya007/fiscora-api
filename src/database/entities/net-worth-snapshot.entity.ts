import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';
import type { NetWorthBreakdown } from '../../networth/networth.calc';

/** One net-worth figure per user per IST calendar day, written by the nightly job. */
@Entity('net_worth_snapshots')
@Unique('UQ_net_worth_snapshot_user_date', ['userId', 'date'])
export class NetWorthSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  /** IST calendar date, 'YYYY-MM-DD'. */
  @Column({ type: 'date' })
  date: string;

  @Column('float', { default: 0 })
  assets: number;

  @Column('float', { default: 0 })
  liabilities: number;

  @Column('float', { default: 0 })
  netWorth: number;

  @Column({ type: 'jsonb', nullable: true })
  breakdown: NetWorthBreakdown | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
