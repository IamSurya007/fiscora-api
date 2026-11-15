import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Seller details printed on invoices and used in reminders. One row per user. */
@Entity('business_profiles')
export class BusinessProfile {
  @PrimaryColumn('varchar')
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  businessName: string | null;

  /** When set, the seller is GST-registered and may charge GST. */
  @Column({ type: 'varchar', length: 15, nullable: true })
  gstin: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  phone: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
