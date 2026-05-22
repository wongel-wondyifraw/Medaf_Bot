import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

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
    transformer: {
      to: (v: number | null | undefined): number | null =>
        v == null ? null : v,
      from: (v: string | null): number | null => (v == null ? null : parseFloat(v)),
    },
  })
  shippingCost!: number | null;
}
