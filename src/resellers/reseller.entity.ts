import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('resellers')
export class Reseller {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'bigint', unique: true, name: 'telegram_id' })
  telegramId!: string;

  @Column({ type: 'text', nullable: true, name: 'telegram_username' })
  telegramUsername!: string | null;

  @Column({ type: 'text', nullable: true, name: 'full_name' })
  fullName!: string | null;

  @Column({ type: 'text', nullable: true, name: 'phone_number' })
  phoneNumber!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'registered_at' })
  registeredAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  isRegistered(): boolean {
    return !!(this.fullName && this.phoneNumber && this.registeredAt);
  }
}
