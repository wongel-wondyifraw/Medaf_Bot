import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Reseller } from '../resellers/reseller.entity';

export type OrderStatus = 'pending' | 'cancelled' | 'completed';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ name: 'reseller_id' })
  resellerId!: number;

  @ManyToOne(() => Reseller, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'reseller_id' })
  reseller!: Reseller;

  @Column({ type: 'text', nullable: true, name: 'product_id' })
  productId!: string | null;

  @Column({ type: 'text', name: 'product_title' })
  productTitle!: string;

  @Column({ type: 'int', name: 'selling_etb' })
  sellingEtb!: number;

  @Index()
  @Column({ type: 'text', default: 'pending' })
  status!: OrderStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'cancelled_at' })
  cancelledAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
