import { Entity, PrimaryGeneratedColumn, Column, ValueTransformer } from 'typeorm';

const numericTransformer: ValueTransformer = {
  to: (v: number | null | undefined): number | null => (v == null ? null : v),
  from: (v: string | number | null): number | null =>
    v == null ? null : typeof v === 'number' ? v : parseFloat(v),
};

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({
    type: 'numeric',
    name: 'shipping_cost',
    nullable: true,
    precision: 10,
    scale: 2,
    transformer: numericTransformer,
  })
  shippingCost!: number | null;

  @Column({
    type: 'numeric',
    name: 'commission_etb',
    nullable: true,
    precision: 10,
    scale: 2,
    transformer: numericTransformer,
  })
  commissionEtb!: number | null;

  @Column({
    type: 'numeric',
    name: 'dubai_factor',
    nullable: true,
    precision: 6,
    scale: 4,
    transformer: numericTransformer,
  })
  dubaiFactor!: number | null;

  @Column({
    type: 'numeric',
    name: 'dubai_factor_low',
    nullable: true,
    precision: 6,
    scale: 4,
    transformer: numericTransformer,
  })
  dubaiFactorLow!: number | null;

  @Column({
    type: 'numeric',
    name: 'dubai_factor_avg',
    nullable: true,
    precision: 6,
    scale: 4,
    transformer: numericTransformer,
  })
  dubaiFactorAvg!: number | null;

  /** High factor for step 2 of the three-factor decision engine. */
  @Column({
    type: 'numeric',
    name: 'dubai_factor_high',
    nullable: true,
    precision: 6,
    scale: 4,
    transformer: numericTransformer,
  })
  dubaiFactorHigh!: number | null;

  @Column({ type: 'boolean', name: 'ai_created', default: false })
  aiCreated!: boolean;

  @Column({ type: 'text', name: 'source_title', nullable: true })
  sourceTitle!: string | null;
}
