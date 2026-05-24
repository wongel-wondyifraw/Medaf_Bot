import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';

const numericTransformer: ValueTransformer = {
  to: (v: number | null | undefined): number | null => (v == null ? null : v),
  from: (v: string | number | null): number | null =>
    v == null ? null : typeof v === 'number' ? v : parseFloat(v),
};

@Entity('aed_observations')
export class AedObservation {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'text', name: 'product_id' })
  productId!: string;

  @Column({ type: 'text', name: 'product_link' })
  productLink!: string;

  @Column({ type: 'text', name: 'category_name' })
  categoryName!: string;

  @Column({ type: 'text', name: 'broad_group' })
  broadGroup!: string;

  @Column({
    type: 'numeric',
    name: 'eth_usd',
    precision: 10,
    scale: 2,
    transformer: numericTransformer,
  })
  ethUsd!: number;

  @Column({
    type: 'numeric',
    name: 'aed_price',
    precision: 10,
    scale: 2,
    transformer: numericTransformer,
  })
  aedPrice!: number;

  @Column({
    type: 'numeric',
    name: 'usd_to_aed_at_obs',
    precision: 10,
    scale: 4,
    transformer: numericTransformer,
  })
  usdToAedAtObs!: number;

  @Column({
    type: 'numeric',
    name: 'dubai_usd_implied',
    precision: 10,
    scale: 2,
    transformer: numericTransformer,
  })
  dubaiUsdImplied!: number;

  @Column({
    type: 'numeric',
    name: 'factor_implied',
    precision: 6,
    scale: 4,
    transformer: numericTransformer,
  })
  factorImplied!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'observed_at' })
  observedAt!: Date;
}
