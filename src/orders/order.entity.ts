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

export type OrderStatus =
  | 'awaiting_approval'
  | 'awaiting_payment'
  | 'pending'
  | 'shipping'
  | 'cancelled'
  | 'completed';

// PostgreSQL NUMERIC columns are returned as strings by the pg driver. This
// transformer keeps the application-side type as a plain number while
// preserving null.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => {
    if (value == null) return null;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  },
};

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

  @Column({ type: 'text', nullable: true })
  link!: string | null;

  @Column({ type: 'text', nullable: true })
  size!: string | null;

  @Column({ type: 'text', nullable: true })
  color!: string | null;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @Column({ type: 'int', nullable: true, name: 'unit_etb' })
  unitEtb!: number | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    name: 'scraped_unit_usd',
    transformer: numericTransformer,
  })
  scrapedUnitUsd!: number | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    name: 'user_unit_usd',
    transformer: numericTransformer,
  })
  userUnitUsd!: number | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    name: 'user_unit_aed',
    transformer: numericTransformer,
  })
  userUnitAed!: number | null;

  @Column({ type: 'int', name: 'selling_etb' })
  sellingEtb!: number;

  /** Total margin profit (product cost only, all units). Excludes delivery/commission. */
  @Column({ type: 'int', nullable: true, name: 'profit_etb' })
  profitEtb!: number | null;

  @Column({ type: 'int', nullable: true, name: 'original_selling_etb' })
  originalSellingEtb!: number | null;

  @Column({ type: 'int', nullable: true, name: 'down_payment_etb' })
  downPaymentEtb!: number | null;

  @Column({ type: 'text', nullable: true, name: 'rejection_reason' })
  rejectionReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'admin_approved_at' })
  adminApprovedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'payment_confirmed_at' })
  paymentConfirmedAt!: Date | null;

  @Index()
  @Column({ type: 'text', default: 'pending' })
  status!: OrderStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'cancelled_at' })
  cancelledAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
