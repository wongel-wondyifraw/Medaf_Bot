import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('health_log')
export class HealthLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'int', name: 'ping_count' })
  pingCount!: number;

  @Column({ type: 'timestamptz', name: 'first_ping_at' })
  firstPingAt!: Date;

  @Column({ type: 'timestamptz', name: 'last_ping_at' })
  lastPingAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
