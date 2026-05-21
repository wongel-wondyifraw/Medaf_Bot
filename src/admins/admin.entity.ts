import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'bigint', unique: true, name: 'telegram_id' })
  telegramId!: string;

  @Column({ type: 'text', nullable: true, name: 'telegram_username' })
  telegramUsername!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'added_at' })
  addedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_notified_at' })
  lastNotifiedAt!: Date | null;
}
