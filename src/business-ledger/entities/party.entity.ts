import { BeforeInsert, Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'crypto';

@Entity('parties')
@Index(['userId', 'name'])
export class Party {
  @PrimaryColumn('varchar')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = randomUUID();
  }

  @Column()
  userId: string;

  @Column()
  name: string;

  /** 10-digit Indian mobile, without +91. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  gstin: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
