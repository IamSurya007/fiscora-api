import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** A user's tax settings for the freelancer / presumptive-tax helpers (one per user). */
@Entity('tax_profiles')
export class TaxProfile {
  @PrimaryColumn('varchar')
  userId: string;

  /** '44ADA' (professionals), '44AD' (business) or 'regular'. */
  @Column({ type: 'varchar', default: '44ADA' })
  regime: string;

  /** 'services' or 'goods' (picks the GST threshold). */
  @Column({ type: 'varchar', default: 'services' })
  businessType: string;

  /** Share of business receipts to set aside for tax, in percent. */
  @Column('float', { default: 20 })
  setAsidePercent: number;

  @Column({ type: 'boolean', default: false })
  gstRegistered: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
